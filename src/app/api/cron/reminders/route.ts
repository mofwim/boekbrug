// src/app/api/cron/reminders/route.ts
// [REMINDERS] Scheduled payment-reminder heartbeat — the third cron of the app.
// For every owner who has OPTED IN (profiles.reminders_enabled), it finds their
// outgoing invoices that are still openstaand past the due date, and — for each
// invoice whose next reminder tier has come due — e-mails the client a gentle,
// escalating reminder. "The app chases your money for you, even with nobody
// logged in."
//
// SECURITY: iterates across users → never publicly callable. Bearer CRON_SECRET,
// constant-time compare, fail-closed (identical guard to /api/cron/reconcile).
//
// FINANCIAL-TRUTH / TRUST discipline (why this cron is safe):
//   * It NEVER writes to a financial record — no status, amount, match or filing
//     changes. It only reads invoices and writes to invoice_reminders (a send log).
//   * CLAIM-THEN-SEND: the reminder row is inserted FIRST with ignoreDuplicates on
//     UNIQUE(invoice_id, day_offset). An empty insert result = another run already
//     claimed this tier → we do NOT send. This makes a double-reminder impossible
//     even if two cron runs overlap — the worse failure (dunning a client twice)
//     can't happen.
//   * The decision (which tier, or none) is the pure reminderTierDue(); the amount
//     shown is the pure openstaandOf() (remaining, never the full total). Neither
//     touches I/O, both are unit-tested.
//   * Best-effort per owner AND per invoice: one failure never stops the rest, and
//     a failed send is recorded status='failed' (visible), never retried as a
//     double-send.
//   * Ships DARK: reminders_enabled defaults false, so until an owner turns it on
//     this cron finds zero enabled owners and sends nothing.

import { NextRequest, NextResponse } from "next/server";
import { amsterdamToday } from "@/lib/format-nl";
import { createPipelineClient } from "@/lib/supabase-pipeline";
import { createNotification } from "@/lib/notifications";
import { fetchAllRows, fetchAllRowsForIds } from "@/lib/supabase-paginate";
import { timingSafeEqualStr } from "@/lib/timing-safe";
import {
  reminderTierDue,
  openstaandOf,
  amsterdamTodayDayNumber,
} from "@/lib/invoice-reminders";
// [CREDITNOTA-NO-CHASE] shared helper for the credited-ids set
// [DEEL-CREDIT] …and it is a COVERAGE question now, not a yes/no one. A partly credited invoice
// is still owed for the rest, so it must still be chased — for the remainder, never for the total.
import { creditedTotalsFrom, openAfterCredit } from "@/lib/credited-invoices";
import { sendInvoiceReminder } from "@/lib/email";
// [WIK] The final reminder is not a firmer nudge — it is the statutory aanmaning that gives the
// owner the right to charge collection costs at all. Pure law, no I/O: see incasso.ts.
import { buildWikNotice, debtorTypeOf, isFinalTier, aggregateWikClaims } from "@/lib/incasso";
// [CRON-HARTSLAG] Vastleggen DAT deze cron draaide — zie src/lib/cron-heartbeat.ts.
import { beginCronRun, finishCronRun } from "@/lib/cron-heartbeat";
// [ALARM] Opgevangen fouten die tóch iemand moeten bereiken — zie report-handled.ts.
import { reportHandledFailure } from "@/lib/report-handled"
// [SEC-STORAGE-PATH] A row check is not a path check — see the header of storage-path.ts.
import { toStoragePath, pathBelongsToOwner } from "@/lib/storage-path"

const EUR_NL = new Intl.NumberFormat("nl-NL", { style: "currency", currency: "EUR" });
// [TZ] timeZone PINNED — same reason as lib/incasso.ts: formatDayNL builds midnight UTC from the
// ISO parts, which only renders the intended day while the runtime's zone is UTC. Identical output
// on a UTC host, correct on any other.
const DAY_NL = new Intl.DateTimeFormat("nl-NL", { day: "numeric", month: "long", timeZone: "Europe/Amsterdam" });
const formatEuroNL = (n: number) => EUR_NL.format(n);
const formatDayNL = (iso: string) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? "");
  return m ? DAY_NL.format(new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])))) : iso;
};

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Storage bucket that holds rendered invoice PDFs (see invoice/send route).
const PDF_BUCKET = "documents";

type OwnerProfile = {
  id: string;
  reminder_offsets: number[] | null;
  company_name: string | null;
  email: string | null;
  full_name: string | null;
};

type CandidateInvoice = {
  id: string;
  sender_id: string | null;
  client_name: string | null;
  client_email: string | null;
  invoice_number: string | null;
  due_date: string | null;
  total_inc_btw: number | null;
  amount_paid: number | null;
  pdf_url: string | null;
  invoice_type: string | null;
  status: string | null;
  /** [WIK] Present → a business debtor; absent → treated as a consumer (the stricter regime). */
  client_btw_number: string | null;
};

export async function GET(req: NextRequest) {
  // [CRON-HARTSLAG] Het startmoment, zodat een afgebroken run herkenbaar blijft.
  const cronStartedAt = new Date().toISOString();
  // De startregel wordt pas geopend NA de auth-poort hieronder — zie daar.
  let cronRunId: string | null = null;
  // ── Auth — fail-closed, constant-time (same as reconcile/email-sync) ──
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization");
  if (!secret) {
    // [ALARM] Not an error in a run — a whole feature standing still. Every night it answers 401,
    // every night nothing is dunned, and the only trace is a log line in a job nobody opens. An
    // owner discovers it when a customer has not paid for three months.
    reportHandledFailure({
      tag: "CRON-REMINDERS",
      message: "CRON_SECRET is not configured — reminders are DISABLED",
      severity: "feature-off",
    });
    return NextResponse.json({ error: "cron_secret_not_configured" }, { status: 401 });
  }
  if (!auth || !timingSafeEqualStr(auth, `Bearer ${secret}`)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // [CRON-HARTSLAG] Pas NA de poort: een onbevoegde probe hoort geen regel te schrijven.
  cronRunId = await beginCronRun(createPipelineClient(), "reminders", cronStartedAt);

  // [CRON-HARTSLAG-EIND] Vanaf hier is er een OPEN regel in cron_runs, en die moet dicht — langs
  // welke uitgang de route ook vertrekt.
  //
  // Dat ging mis, en niet zeldzaam: `finishCronRun` stond alleen op het volledige pad, en deze
  // route heeft vier vroege returns. "Geen ondernemers met herinneringen aan", "niets vervallen"
  // — dat zijn de GEWONE uitkomsten, dus bleef de regel structureel op ok = NULL staan en las de
  // gezondheidscheck 'afgebroken'. Gemeten: reminders stond op 15 augustus op AFGEROND NOOIT
  // terwijl hij om 07:00 keurig had gedraaid en niets te doen had.
  //
  // Een alarm dat altijd afgaat leert je alarmen wegklikken, en dan mis je de keer dat hij wél
  // ergens over gaat. Erger nog: een echte leesfout verliet deze route via precies dezelfde deur,
  // dus "niets te doen" en "ik kon niet kijken" waren van buiten niet te onderscheiden.
  //
  // Daarom sluit `klaar()` de regel én bouwt het antwoord: door de uitgang zelf te zijn, kan een
  // volgende vroege return hem niet meer vergeten.
  const klaar = async (body: Record<string, unknown>, ok = true) => {
    await finishCronRun(createPipelineClient(), cronRunId, { ok, result: body });
    return NextResponse.json(body);
  };

  const pipeline = createPipelineClient();
  const today = amsterdamTodayDayNumber();

  // ── 1) Only owners who OPTED IN. No enabled owners → nothing to do (dark). ──
  //    A column-missing error (migration not yet applied) is caught and returned
  //    as a clean no-op, never a 500.
  let owners: OwnerProfile[];
  try {
    owners = await fetchAllRows<OwnerProfile>((from, to) =>
      pipeline
        .from("profiles")
        // [ANTWOORD-ADRES] `email` erbij — zie de herinneringsroute. Deze cron stuurt de meeste
        // herinneringen van het hele product; een antwoord daarop hoort bij de ondernemer.
        .select("id, reminder_offsets, company_name, full_name, email")
        .eq("reminders_enabled", true)
        .order("id", { ascending: true })
        .range(from, to),
    );
  } catch (e) {
    console.error("[CRON-REMINDERS] enabled-owner lookup failed (migration applied?)", {
      error: e instanceof Error ? e.message : String(e),
    });
    // Een leesfout is GEEN geslaagde run: hij hoort op te vallen als hij zich herhaalt.
    return klaar({ ok: false, enabledOwners: 0, note: "lookup_failed" }, false);
  }

  if (owners.length === 0) {
    return klaar({ ok: true, enabledOwners: 0, sent: 0 });
  }

  const ownerById = new Map<string, OwnerProfile>();
  for (const o of owners) ownerById.set(o.id, o);
  const ownerIds = [...ownerById.keys()];

  // ── 2) Their outgoing, still-open invoices (paginated, bounded to opted-in owners). ──
  // [ID-CHUNK] Keyed on the owner list, which travels in the URL at ~39 bytes per uuid. Paging
  // alone does not help with that: it is the REQUEST that outgrows the proxy's header buffer, not
  // the response. Today's opted-in owners fit; a few thousand would not, and the failure mode is a
  // 414 that supabase-js reports as an ordinary error — so fetchAllRows would throw and this cron
  // would simply stop sending, every night, with nobody looking. Chunking removes the cliff instead
  // of waiting for it. Same rows, same order, one bounded request per chunk.
  // [CRON-STIL] Set by the catch below; null means the read really did answer.
  let invoiceReadFailed: string | null = null;
  const invoices = await fetchAllRowsForIds<CandidateInvoice, string>(ownerIds, (chunk, from, to) =>
    pipeline
      .from("invoices")
      .select(
        // [WIK] client_btw_number decides consumer vs business — which decides whether the final
        // reminder must be the statutory fourteen-day aanmaning.
        "id, sender_id, client_name, client_email, invoice_number, due_date, total_inc_btw, amount_paid, pdf_url, invoice_type, status, client_btw_number",
      )
      .in("sender_id", chunk)
      .eq("direction", "outgoing")
      .in("status", ["sent", "overdue"])
      .eq("reminders_paused", false)
      .not("due_date", "is", null)
      .order("id", { ascending: true })
      .range(from, to),
  ).catch((e) => {
    // [CRON-STIL] Caught so one bad chunk does not kill the run — and REMEMBERED, because an empty
    // list from here is indistinguishable from "nothing is overdue tonight". Without the flag this
    // route answered ok:true, sent:0 on a failed read, so dunning could be dead every night while
    // the heartbeat reported the cron ran as intended and no owner was ever told.
    invoiceReadFailed = e instanceof Error ? e.message : String(e);
    console.error("[CRON-REMINDERS] candidate invoice fetch failed", { error: invoiceReadFailed });
    return [] as CandidateInvoice[];
  });

  if (invoiceReadFailed !== null) {
    // [ALARM] Not a quiet night: the question could not be asked. Through the reporter rather than
    // stdout, for the reason this file already gives about a cron writing to a log nobody opens —
    // and the run closes as FAILED, so the heartbeat says so too.
    reportHandledFailure({
      tag: "CRON-REMINDERS",
      message: "candidate invoice read failed — nobody was dunned tonight, and not because nothing was due",
      severity: "gate-unavailable",
      context: { enabledOwners: owners.length, error: invoiceReadFailed },
    });
    return klaar({ ok: false, enabledOwners: owners.length, sent: 0, note: "invoice_lookup_failed" }, false);
  }

  if (invoices.length === 0) {
    return klaar({ ok: true, enabledOwners: owners.length, sent: 0 });
  }

  // ── 3) Which tiers were already sent, per invoice (one batched read). ──
  const invoiceIds = invoices.map((i) => i.id);
  const sentRows = await fetchAllRows<{ invoice_id: string; day_offset: number }>((from, to) =>
    pipeline
      .from("invoice_reminders")
      .select("invoice_id, day_offset")
      .in("invoice_id", invoiceIds)
      .order("id", { ascending: true })
      .range(from, to),
  ).catch(() => [] as { invoice_id: string; day_offset: number }[]);

  // ── [CREDITNOTA-NO-CHASE] Which candidates were withdrawn with a creditnota? ──
  // A credited invoice KEEPS its 'sent'/'overdue' status, its positive total and its due date
  // (the +omzet must stay to be netted by the creditnota's −omzet), so nothing the query above
  // filters on reveals it. Without this read the cron mails the customer a payment demand for
  // an invoice the owner already withdrew.
  //
  // This read FAILS CLOSED. Degrading to "none credited" would quietly restore the exact
  // behaviour this guard exists to prevent — an automated demand sent to someone else's
  // customer — and nobody would know. A skipped run costs at most a day: the schedule is daily,
  // the tiers are day-offset based, and every tier is claimed idempotently, so tomorrow's run
  // sends precisely what today's would have.
  // Keyed on the OWNERS (the same bounded list the candidate query uses), not on the candidate
  // ids: an .in() over thousands of uuids would blow the URL length long before it broke
  // anything visible. A creditnota per owner is rare, so this stays a small read.
  // [ID-CHUNK] Same reason as the candidate query above — and it matters more here, because this
  // read is what stops a credited invoice being dunned. It already fails CLOSED on an error (see
  // below), so a URL that grew too long would silently halt every reminder rather than send a wrong
  // one; correct, and still a nightly outage nobody would notice.
  const creditNoteRows = await fetchAllRowsForIds<{ original_invoice_id: string | null; total_inc_btw: number | null }, string>(ownerIds, (chunk, from, to) =>
    pipeline
      .from("invoices")
      // [DEEL-CREDIT] The AMOUNT comes along: whether an invoice was withdrawn is no longer
      // answered by the existence of a creditnota but by whether the credits cover it.
      .select("original_invoice_id, total_inc_btw")
      .in("sender_id", chunk)
      .eq("invoice_type", "creditnota")
      .not("original_invoice_id", "is", null)
      .order("id", { ascending: true })
      .range(from, to),
  ).catch((e) => {
    console.error("[CRON-REMINDERS] creditnota lookup failed — skipping this run", {
      error: e instanceof Error ? e.message : String(e),
    });
    return null;
  });
  if (creditNoteRows == null) {
    // Fail closed: send nothing rather than risk one wrong demand. Tomorrow's run repeats it.
    // Bewust niets verstuurd — maar de run deed zijn werk niet, dus zegt de regel dat ook.
    return klaar({ ok: false, enabledOwners: owners.length, sent: 0, skipped: "creditnota_lookup_failed" }, false);
  }
  const creditedByInvoice = creditedTotalsFrom(creditNoteRows);

  const sentByInvoice = new Map<string, number[]>();
  for (const r of sentRows) {
    const arr = sentByInvoice.get(r.invoice_id) ?? [];
    arr.push(r.day_offset);
    sentByInvoice.set(r.invoice_id, arr);
  }

  // Group candidate invoices by owner so we can rotate fairly across owners.
  const invoicesByOwner = new Map<string, CandidateInvoice[]>();
  for (const inv of invoices) {
    if (!inv.sender_id) continue;
    const arr = invoicesByOwner.get(inv.sender_id) ?? [];
    arr.push(inv);
    invoicesByOwner.set(inv.sender_id, arr);
  }

  // ── 4) Fairness rotation + soft deadline (same discipline as reconcile). ──
  const orderedOwners = [...invoicesByOwner.keys()];
  const epochHour = Math.floor(Date.now() / 3_600_000);
  const offset = orderedOwners.length > 0 ? epochHour % orderedOwners.length : 0;
  const rotated = [...orderedOwners.slice(offset), ...orderedOwners.slice(0, offset)];
  const startedAt = Date.now();
  const DEADLINE_MS = 250_000; // stop ~50s before the 300s ceiling, between owners

  let sent = 0;
  let failed = 0;
  let skippedDuplicate = 0;
  let ownersProcessed = 0;
  let truncated = 0;

  for (const ownerId of rotated) {
    if (Date.now() - startedAt > DEADLINE_MS) {
      truncated = rotated.length - ownersProcessed;
      console.warn("[CRON-REMINDERS] soft deadline hit — deferring remaining owners", { remaining: truncated });
      break;
    }
    ownersProcessed += 1;

    const owner = ownerById.get(ownerId);
    if (!owner) continue;
    const offsets = owner.reminder_offsets && owner.reminder_offsets.length > 0
      ? owner.reminder_offsets
      : [14, 30];
    const maxTier = Math.max(...offsets);
    const zzperName = owner.company_name?.trim() || owner.full_name?.trim() || "BoekBrug";
    const ownerInvoices = invoicesByOwner.get(ownerId) ?? [];

    // ── [WIK-EEN-AANMANING] One aanmaning per DEBTOR, not per invoice ──
    //
    // Art. 6:96 lid 7 BW: where a debtor can be aanmaand for several claims, that happens in ONE
    // aanmaning with the hoofdsommen added together — and the staffel of lid 6, with its EUR 40
    // minimum, is then applied once. This loop sent a letter per invoice, each naming its own fee:
    // three EUR 100 invoices demanded 3 x EUR 40 instead of EUR 40. For a consumer lid 5 makes
    // that dwingend recht, and an over-stated fee is the classic ground on which the whole
    // incassokosten claim is struck — so the owner does not lose the difference, they lose the lot.
    //
    // Keyed on the e-mail address, because that is who actually receives the letter; the name is
    // the fallback for a debtor without one. Two customers sharing one mailbox genuinely receive
    // one demand, which is what art. 6:96 lid 7 asks for.
    const debiteurSleutel = (i: { client_email?: string | null; client_name?: string | null }) =>
      (i.client_email?.trim().toLowerCase() || i.client_name?.trim().toLowerCase() || "");
    const openstaandVan = (i: { total_inc_btw?: number | null; amount_paid?: number | null; id: string }) =>
      openAfterCredit(i.total_inc_btw, i.amount_paid, creditedByInvoice.get(i.id) ?? 0);
    const claimsPerDebiteur = new Map<string, Array<{ invoiceNumber: string | null; open: number }>>();
    for (const i of ownerInvoices) {
      const open = openstaandVan(i);
      if (open <= 0) continue;
      const k = debiteurSleutel(i);
      if (k === "") continue;
      const list = claimsPerDebiteur.get(k);
      if (list) list.push({ invoiceNumber: i.invoice_number, open });
      else claimsPerDebiteur.set(k, [{ invoiceNumber: i.invoice_number, open }]);
    }
    // Which debtors already received THE letter in this run. The second final-tier invoice of the
    // same debtor still gets its ordinary reminder and its trail row — it simply does not carry a
    // second statutory demand, because the first one already covered it by name.
    const aangemaand = new Set<string>();

    for (const inv of ownerInvoices) {
      // Pure decision: which tier (or none) is due right now?
      const tier = reminderTierDue({
        dueDate: inv.due_date,
        todayDayNumber: today,
        offsets,
        sentOffsets: sentByInvoice.get(inv.id) ?? [],
        status: inv.status,
        invoiceType: inv.invoice_type,
        direction: "outgoing",
        totalIncBtw: inv.total_inc_btw,
        amountPaid: inv.amount_paid,
        clientEmail: inv.client_email,
        remindersPaused: false,
        // [CREDITNOTA-NO-CHASE] Withdrawn with a creditnota → stop chasing the customer.
        // [DEEL-CREDIT] …but only when the credits cover the WHOLE invoice. Credit one disputed
        // line of five and the other four are still owed; stopping there would mean the owner is
        // never paid for them, on an invoice that keeps its 'sent' status and its full total, with
        // nothing on any screen saying why the reminders went quiet.
        hasCreditnota: openAfterCredit(inv.total_inc_btw, 0, creditedByInvoice.get(inv.id) ?? 0) <= 0,
      });
      if (tier == null) continue;

      // CLAIM the tier atomically. ignoreDuplicates → an empty result means a
      // concurrent run already claimed it, so we send NOTHING (no double dunning).
      const { data: claimed, error: claimError } = await pipeline
        .from("invoice_reminders")
        .upsert(
          {
            invoice_id: inv.id,
            user_id: ownerId,
            day_offset: tier,
            email_to: inv.client_email,
            status: "sent",
          },
          { onConflict: "invoice_id,day_offset", ignoreDuplicates: true },
        )
        .select("id");

      if (claimError) {
        console.error("[CRON-REMINDERS] claim insert failed (non-fatal)", { invoiceId: inv.id, tier, error: claimError.message });
        failed += 1;
        continue;
      }
      if (!claimed || claimed.length === 0) {
        skippedDuplicate += 1; // already claimed by another run — do not send
        continue;
      }
      const claimId = claimed[0].id as string;

      // The ONLY amount a reminder may show — remaining, never the full total.
      // [DEEL-CREDIT] Minus what was credited. Asking for the full total on a partly credited
      // invoice demands money that was given back IN WRITING — the fastest way to lose the trust
      // a reminder needs in order to work at all.
      const gecrediteerd = creditedByInvoice.get(inv.id) ?? 0;
      const openstaand = gecrediteerd > 0
        ? openAfterCredit(inv.total_inc_btw, inv.amount_paid, gecrediteerd)
        : openstaandOf(inv.total_inc_btw, inv.amount_paid);
      // [REMINDER-TRUTH] Hoisted out of the try: the catch has to know whether the letter that
      // just failed was the statutory one, and `wik` itself is built inside.
      const finalTier = isFinalTier(tier, offsets);

      // Best-effort PDF re-attach from the stored invoice PDF. Any failure →
      // send without attachment (the template renders fine without it).
      let pdfBuffer: Buffer | undefined;
      // [SEC-STORAGE-PATH] The invoice row is this owner's, which says nothing about where its
      // pdf_url POINTS: that column is ordinary text on a row the owner may update, and `pipeline`
      // is service_role, which bypasses the bucket policy that would otherwise catch a key from
      // another tenant's folder. This attachment is then mailed to an address the same row carries.
      // See the header of storage-path.ts — written for this shape, already applied at four doors.
      const pdfPath = toStoragePath(inv.pdf_url);
      if (inv.pdf_url && pathBelongsToOwner(pdfPath, ownerId)) {
        try {
          const { data: blob } = await pipeline.storage.from(PDF_BUCKET).download(pdfPath);
          if (blob) pdfBuffer = Buffer.from(await blob.arrayBuffer());
        } catch {
          /* non-blocking — reminder goes out without the PDF */
        }
      }

      try {
        // [WIK] On the LAST tier the letter becomes the legally effective one: it grants the
        // statutory fourteen days and names the exact incassokosten. Without those two elements
        // a consumer can never be charged those costs — so every polite reminder this app sent
        // before was helpful and legally worth nothing once the customer kept ignoring it. The
        // debtor type comes from the invoice itself (a BTW number means a business), defaulting
        // to consumer, which is the only mistake of the two that stays recoverable.
        // [WIK-EEN-AANMANING] The hoofdsom is this DEBTOR's total, not this invoice's, and the
        // letter names the invoices it adds up. A debtor who already had their one demand in this
        // run gets a plain reminder instead of a second one — see the grouping above.
        const debiteur = debiteurSleutel(inv);
        const samen = aggregateWikClaims(claimsPerDebiteur.get(debiteur) ?? []);
        const wik = finalTier && debiteur !== "" && !aangemaand.has(debiteur)
          ? buildWikNotice({
              // Falls back to this invoice alone when the grouping found nothing — a debtor with
              // no e-mail and no name cannot be grouped, and one claim is still a claim.
              openstaand: samen.principal > 0 ? samen.principal : openstaand,
              sentIso: amsterdamToday(),
              debtorType: debtorTypeOf({ client_btw_number: inv.client_btw_number }),
              covers: samen.numbers.length > 1 ? samen.numbers : [],
            })
          : null;
        if (wik) aangemaand.add(debiteur);
        const delivery = await sendInvoiceReminder({
          toEmail: inv.client_email as string, // guaranteed non-empty by reminderTierDue
          clientName: inv.client_name?.trim() || "klant",
          zzperName,
          senderEmail: owner.email ?? null,
          invoiceNumber: inv.invoice_number?.trim() || "—",
          openstaand,
          dueDate: inv.due_date as string,
          firm: offsets.length > 1 && tier === maxTier,
          wik,
          pdfBuffer,
        });
        // [REMINDER-TRUTH] A Resend rejection does not throw — it comes back as an error on the
        // send result. Until now that was logged and forgotten: the claimed tier stayed 'sent',
        // the owner was told the letter went out, and the tier could never be tried again (the
        // pre-read counts every invoice_reminders row, whatever its status). The customer simply
        // never received it — including, on the last tier, the statutory WIK aanmaning that is
        // the whole basis for charging incassokosten.
        //
        // Resend rejecting the message means it was NOT accepted, so retrying is safe here in a
        // way it is not after a THROW (see the catch below, where the outcome is unknowable).
        // Releasing the claim lets tomorrow's run try the same tier again.
        if (!delivery.delivered) {
          failed += 1;
          // [LINKS-WRITE-HONEST] The error is READ. This block already meant to say something when
          // the release failed — and could not: supabase-js reports a query error in the RESULT, it
          // does not throw, so that catch never fired and the delete's error was discarded. The
          // release silently not happening puts this invoice back in exactly the state the comment
          // above describes as the bug being fixed: the claim stays, the pre-read counts every
          // invoice_reminders row whatever its status, and the tier can NEVER be tried again. On
          // the last tier that is the statutory WIK aanmaning never reaching the customer while the
          // owner believes it went out — and with it the basis for charging incassokosten.
          const { error: releaseErr } = await pipeline
            .from("invoice_reminders").delete().eq("id", claimId);
          if (releaseErr) {
            console.error(
              "[CRON-REMINDERS] could NOT release a rejected claim — this tier can never be retried",
              { invoiceId: inv.id, tier, finalTier, error: releaseErr.message },
            );
          }
          console.error("[CRON-REMINDERS] reminder rejected by the mail provider — tier released for retry", {
            invoiceId: inv.id, tier, wik: !!wik,
          });
          continue;
        }

        sent += 1;
        // Reflect the send in the pre-read map so a later pass in THIS run can't re-pick it.
        const arr = sentByInvoice.get(inv.id) ?? [];
        arr.push(tier);
        sentByInvoice.set(inv.id, arr);

        // Notify the owner (best-effort) — visible proof the app acted for them.
        // [WIK] After the statutory letter the owner has something they did not have before:
        // the RIGHT to charge collection costs once the term passes. That right is invisible
        // unless it is said — and unsaid, the letter's whole purpose is lost on them.
        await createNotification({
          userId: ownerId,
          title: wik ? "Laatste aanmaning verstuurd" : "Herinnering verstuurd",
          body: wik
            ? `We hebben de laatste aanmaning gestuurd voor factuur ${inv.invoice_number ?? ""} aan ${inv.client_name ?? "je klant"}. ` +
              `Betaalt ${inv.client_name?.trim() || "je klant"} niet vóór ${formatDayNL(wik.deadline)}, dan mag je ${formatEuroNL(wik.costs)} aan incassokosten in rekening brengen.`
            : `We hebben een herinnering gestuurd voor factuur ${inv.invoice_number ?? ""} aan ${inv.client_name ?? "je klant"}.`,
          type: "invoice",
          link: `/dashboard/invoice/${inv.id}`,
        });
      } catch (sendErr) {
        // A THROW is the ambiguous case: the request may have reached the provider before the
        // connection died, so we cannot know whether the customer got a demand. The claim STAYS
        // (marked 'failed') and is never retried — a second dunning letter to someone who already
        // received one is the harm this cron must never cause.
        //
        // [REMINDER-TRUTH] But silence is its own harm. The app cannot resolve this, so it hands
        // it to the person who can: the owner is told the reminder may not have gone out, which
        // matters most on the final tier, where the letter is what makes incassokosten claimable.
        failed += 1;
        console.error("[CRON-REMINDERS] reminder send threw (non-fatal)", { invoiceId: inv.id, tier, error: sendErr instanceof Error ? sendErr.message : String(sendErr) });
        // [LINKS-WRITE-HONEST] The error is READ, same reason. invoice_reminders IS the send log:
        // a claim left on 'sent' after a send that may never have happened records a dunning letter
        // that was not demonstrably sent — and on the final tier that log is the basis on which
        // incassokosten are claimed. The tier stays unretryable either way (that is deliberate
        // after a throw: a second letter to someone who already got one is the worse harm), so
        // this failure costs the RECORD rather than the send, which is exactly why it may not
        // disappear.
        const { error: markErr } = await pipeline
          .from("invoice_reminders").update({ status: "failed" }).eq("id", claimId);
        if (markErr) {
          console.error(
            "[CRON-REMINDERS] could NOT mark a claim failed — the send log still reads 'sent'",
            { invoiceId: inv.id, tier, finalTier, error: markErr.message },
          );
        }
        await createNotification({
          userId: ownerId,
          title: finalTier ? "Laatste aanmaning mogelijk NIET verstuurd" : "Herinnering mogelijk niet verstuurd",
          body:
            `Het versturen van ${finalTier ? "de laatste aanmaning" : "een herinnering"} voor factuur ${inv.invoice_number ?? ""} ` +
            `aan ${inv.client_name ?? "je klant"} is misgegaan. We proberen het niet automatisch opnieuw — een dubbele ` +
            `aanmaning naar iemand die er al een kreeg is erger. ` +
            (finalTier
              ? "Let op: zonder deze aanmaning mag je (nog) geen incassokosten in rekening brengen. Stuur hem zelf, of neem contact op."
              : "Stuur hem zelf als je dat wilt."),
          type: "invoice",
          link: `/dashboard/invoice/${inv.id}`,
        });
      }
    }
  }

  // [CRON-HARTSLAG] De uitkomst vastleggen. Best effort: dit mag de cron nooit laten vallen.
  await finishCronRun(createPipelineClient(), cronRunId, { ok: failed === 0, result: {
    ok: failed === 0,
    enabledOwners: owners.length,
    candidates: invoices.length,
    sent,
    failed,
    skippedDuplicate,
    ownersProcessed,
    truncated,
  } });

  return NextResponse.json({
    ok: true,
    enabledOwners: owners.length,
    candidates: invoices.length,
    sent,
    failed,
    skippedDuplicate,
    ownersProcessed,
    truncated,
  });
}
