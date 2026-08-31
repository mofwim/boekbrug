// src/app/api/cron/reconcile/route.ts
// [CRON] Scheduled SERVER-SIDE reconcile — the second heartbeat of the financial-truth circle.
// Until now the matching circle (bank auto-confirm + cash settlement) only turned when a browser
// sat on /dashboard/bank or /kas. This cron closes it on its own for EVERY user: it books the
// near-certain bank payments (isSafeAutoConfirm) and reconciles the cash-settlement entries,
// then notifies the owner of anything it booked. "Snap and throw, the app does the rest" — even
// when nobody has the app open.
//
// SECURITY: iterates every user, so it must never be publicly callable — Bearer CRON_SECRET,
// fail-closed (same guard as /api/cron/email-sync).
//
// Money discipline is unchanged: runBankAutoConfirm only touches isSafeAutoConfirm matches
// (reference printed + amount to the cent, single invoice), fully reversible + audited;
// reconcileCashSettlements is idempotent + self-healing. Both are best-effort per user so one
// user's failure never stops the rest.

import { NextRequest, NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { createPipelineClient } from "@/lib/supabase-pipeline";
import { fetchAllRows } from "@/lib/supabase-paginate";
import { timingSafeEqualStr } from "@/lib/timing-safe";
import { runBankAutoConfirm } from "@/lib/bank-auto-confirm";
import { reconcileCashSettlements } from "@/lib/cash-settle";
// [KAS-ZACHT] A removed cash movement counts in no total — one definition, see cash-live.ts.
import { liveCashEntries } from "@/lib/cash-live";
import { applyLearnedBankCategories } from "@/lib/bank-auto-categorize";
import { createNotification } from "@/lib/notifications";
// [CRON-HARTSLAG] Vastleggen DAT deze cron draaide — zie src/lib/cron-heartbeat.ts.
import { beginCronRun, finishCronRun } from "@/lib/cron-heartbeat";
// [AUTO-INCASSO] Book the invoices the bank collects on its own — see src/lib/incasso-settle.ts.
import { incassoSupported, settleIncassoForUser, proposeIncassoMandates, markIncassoSuggested } from "@/lib/incasso-settle";
import { amsterdamToday, formatEuroNL } from "@/lib/format-nl";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(req: NextRequest) {
  // [CRON-HARTSLAG] Het startmoment, zodat een afgebroken run herkenbaar blijft.
  const cronStartedAt = new Date().toISOString();
  // De startregel wordt pas geopend NA de auth-poort hieronder — zie daar.
  let cronRunId: string | null = null;
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization");
  if (!secret) {
    console.error("[CRON-RECONCILE] CRON_SECRET is not configured — the automatic reconcile is DISABLED.");
    return NextResponse.json({ error: "cron_secret_not_configured" }, { status: 401 });
  }
  // [SECURITY] Constant-time compare — see /api/cron/email-sync; a plain !== leaks the secret via
  // response timing over repeated guesses.
  if (!auth || !timingSafeEqualStr(auth, `Bearer ${secret}`)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // [CRON-HARTSLAG] Pas NA de poort: een onbevoegde probe hoort geen regel te schrijven.
  cronRunId = await beginCronRun(createPipelineClient(), "reconcile", cronStartedAt);

  // [CRON-HARTSLAG-EIND] Zie de uitleg in api/cron/reminders. Deze route wist het al het beste van
  // allemaal — haar vroege uitgang zegt zelf `ok: false` — maar schreef dat oordeel nergens op de
  // hartslagregel. Van buiten was een mislukte run dus niet te onderscheiden van een afgebroken
  // run, en dat verschil is nu juist het enige waar een gezondheidscheck iets aan heeft.
  const klaar = async (body: Record<string, unknown>, ok: boolean, status?: number) => {
    await finishCronRun(createPipelineClient(), cronRunId, { ok, result: body });
    return NextResponse.json(body, status ? { status } : undefined);
  };

  const pipeline = createPipelineClient();

  // Only iterate users who actually have something to reconcile — pending bank lines (auto-
  // confirm candidates), paid-in-cash incoming invoices (cash settle), or existing betaling
  // entries (orphan cleanup). Keeps the run bounded to the users where work exists.
  // [CRON-HONEST + NO-SILENT-VOID] A total discovery failure must NOT read as a green run. The old
  // `.catch(() => [[], [], []])` turned a DB outage into `{ok:true, users:0}` — a silent full
  // no-op that status-code monitoring reads as healthy, hour after hour. Fail loudly (500 + Sentry)
  // so alerting fires and the scheduler retries; the whole reconcile is idempotent, so a retry is safe.
  const liveCash = await liveCashEntries(pipeline);
  let pendingTx: { user_id: string | null }[];
  let kasInv: { sender_id: string | null; receiver_id: string | null }[];
  let betaling: { user_id: string | null }[];
  let kasTermijn: { user_id: string | null }[];
  try {
    [pendingTx, kasInv, betaling, kasTermijn] = await Promise.all([
      fetchAllRows<{ user_id: string | null }>((from, to) =>
        pipeline.from("bank_transactions").select("user_id").eq("status", "pending")
          .order("id", { ascending: true }).range(from, to)),
      // BOTH directions of cash-paid invoices — a cash SALE (sender_id) must settle into the
      // drawer too, not only a cash purchase (receiver_id).
      fetchAllRows<{ sender_id: string | null; receiver_id: string | null }>((from, to) =>
        pipeline.from("invoices").select("sender_id, receiver_id")
          .eq("status", "paid").eq("payment_method", "kas")
          .order("id", { ascending: true }).range(from, to)),
      fetchAllRows<{ user_id: string | null }>((from, to) =>
        // [KAS-ZACHT] A REMOVED settlement is not a reason to reconcile a user: the reconcile reads
        // live rows only, so a deleted 'betaling' row would nominate its owner on every run forever.
        liveCash.only(pipeline.from("cash_entries").select("user_id").eq("category", "betaling"))
          .order("id", { ascending: true }).range(from, to)),
      // [MANUAL-PARTIAL-PAY] The fourth reason, and the one the three above cannot produce.
      //
      // Who has cash to reconcile is a DEFINITION, written once in loadCashSettlementState: status
      // paid + method kas, UNION anything holding a kas instalment. This discovery only ever
      // spelled the first half. An owner who took €200 of a €500 invoice from the till has an
      // invoice that is still OPEN — so it is not status 'paid', and the read above cannot see it.
      //
      // Set 3 usually rescues them, because the synchronous reconcile at pay time writes a
      // 'betaling' entry and every later run finds them by it. But the cron IS the net under that
      // synchronous call: the case it exists for is precisely the one where the call failed. An
      // owner whose first cash instalment failed to reconcile has no drawer entry to be found by,
      // no pending bank lines, and no paid-kas invoice — so the hourly pass never visits them and
      // the money stays out of the kasboek until they happen to open the Kas page.
      //
      // Nobody is in that state today (13 kas instalments, all on invoices the first read already
      // catches). This closes the hole before the first one is.
      fetchAllRows<{ user_id: string | null }>((from, to) =>
        pipeline.from("bank_tx_invoices").select("user_id")
          .eq("method", "kas").is("transaction_id", null)
          .order("id", { ascending: true }).range(from, to)),
    ]);
  } catch (e) {
    console.error("[CRON-RECONCILE] user discovery failed — aborting run (will retry next schedule)", e);
    Sentry.captureException(e instanceof Error ? e : new Error(String(e)), { tags: { cron: "reconcile", phase: "user-set" } });
    return klaar({ ok: false, error: "user discovery failed" }, false, 500);
  }

  const userIds = new Set<string>();
  for (const r of pendingTx) if (r.user_id) userIds.add(r.user_id);
  for (const r of kasInv) { if (r.receiver_id) userIds.add(r.receiver_id); if (r.sender_id) userIds.add(r.sender_id); }
  for (const r of betaling) if (r.user_id) userIds.add(r.user_id);
  for (const r of kasTermijn) if (r.user_id) userIds.add(r.user_id);

  // [AUTO-INCASSO] A fourth reason to visit an owner, and one the three above cannot produce: an
  // owner whose invoices are all collected automatically has no pending bank lines, no cash-paid
  // invoices and no drawer entries. Discovered from the mandate itself — the suppliers they marked.
  //
  // Deliberately NOT inside the Promise.all above. That block aborts the whole run when it fails,
  // which is right for the three reads that decide who gets reconciled at all; this one is allowed
  // to be absent (the column arrives with a migration) and a run that skips the incasso pass is a
  // reduced run, not a broken one. Failing the reconcile for every user over it would be the
  // reporting causing a bigger outage than the thing reported.
  let incassoUsers = 0;
  try {
    if (await incassoSupported(pipeline)) {
      const rows = await fetchAllRows<{ user_id: string | null }>((from, to) =>
        // auto_incasso is added by auto_incasso.sql and not yet in the generated types;
        // incassoSupported() above is what makes the read safe.
         
        pipeline.from("suppliers").select("user_id").eq("auto_incasso", true)
          .order("id", { ascending: true }).range(from, to));
      for (const r of rows) if (r.user_id) { userIds.add(r.user_id); incassoUsers += 1; }
    }
  } catch (e) {
    console.error("[AUTO-INCASSO] mandate discovery failed — this run books no collections", { error: e instanceof Error ? e.message : String(e) });
    Sentry.captureException(e instanceof Error ? e : new Error(String(e)), { tags: { cron: "reconcile", phase: "incasso-discovery" } });
  }

  // [DD-SIGNAL] A fifth reason to visit an owner, and the one the other four systematically miss.
  //
  // proposeIncassoMandates reads bank lines of ANY status — that is the point of it: the evidence
  // for "this supplier collects automatically" is a HISTORY of collections, and a collection the
  // owner already confirmed is still evidence. But the four signals above are all about work left
  // undone: a pending line, a cash-paid invoice, a drawer entry, an existing mandate.
  //
  // So the owner who keeps their bank tidy has none of them, is never visited, and is never told
  // that four of their suppliers have been collecting for months. That is exactly backwards. The
  // owner who books diligently is the one this proposal helps most — they are the one still being
  // asked to pay invoices the bank has already taken — and they were the one it could never reach.
  //
  // Cheap to add: the same predicate the partial index on bank_transactions was built for, and
  // tolerant like the block above, because these columns arrive with bank_tx_direct_debit.sql. A
  // run without this pass is a reduced run; failing the reconcile for every owner over a missing
  // column would be the reporting causing a bigger outage than the thing reported.
  let ddUsers = 0;
  try {
    const rows = await fetchAllRows<{ user_id: string | null }>((from, to) =>
      // [TYPES] The cast that stood here is gone. mandate_id, creditor_id and type_code were not
      // in the generated schema when this block was written, so the query had to be widened to
      // `any` to name them — and a widened query stops checking every OTHER column name in it.
      // The six migrations of 9 August put those three in the types, so the filter is now checked
      // by the compiler like any other.
      pipeline.from("bank_transactions").select("user_id")
        .or("mandate_id.not.is.null,creditor_id.not.is.null,type_code.not.is.null")
        .order("id", { ascending: true }).range(from, to));
    for (const r of rows) if (r.user_id && !userIds.has(r.user_id)) { userIds.add(r.user_id); ddUsers += 1; }
  } catch (e) {
    // 42703 is "that column does not exist yet", which is a database that cannot answer the
    // question rather than a failure to read it — same distinction proposeIncassoMandates makes.
    const code = (e as { code?: string })?.code;
    if (code !== "42703") {
      console.error("[DD-SIGNAL] statement-marker discovery failed — owners with no other pending work are not visited this run", { error: e instanceof Error ? e.message : String(e) });
      Sentry.captureException(e instanceof Error ? e : new Error(String(e)), { tags: { cron: "reconcile", phase: "dd-discovery" } });
    }
  }

  let usersProcessed = 0;
  let bookedTotal = 0;
  let failed = 0;
  let truncated = 0;
  let incassoBooked = 0;
  let incassoProposed = 0;

  // [CRON-FAIRNESS] Rotate the start each run so, if the full list can't finish within maxDuration,
  // a FIXED tail never permanently starves. On Vercel Pro this cron now fires HOURLY, so key the
  // offset off the EPOCH HOUR — it advances by one each run, walking the start across the whole list
  // so every user reaches the head within N hours (was N days when it ran daily). The soft deadline
  // stops cleanly BETWEEN users (never mid-write), so a truncation can't leave a half-linked payment.
  const arr = [...userIds];
  const epochHour = Math.floor(Date.now() / 3_600_000);
  const offset = arr.length > 0 ? epochHour % arr.length : 0;
  const ordered = [...arr.slice(offset), ...arr.slice(0, offset)];
  const startedAt = Date.now();
  const DEADLINE_MS = 250_000; // stop ~50s before the 300s ceiling, between users

  for (const uid of ordered) {
    if (Date.now() - startedAt > DEADLINE_MS) {
      truncated = ordered.length - usersProcessed - failed;
      console.warn("[CRON-RECONCILE] soft deadline hit — deferring remaining users to next run", { remaining: truncated });
      break;
    }
    try {
      const confirmed = await runBankAutoConfirm({ payClient: pipeline, pipeline, userId: uid });
      await reconcileCashSettlements(pipeline, uid);
      // [BANK-AUTO-CATEGORIZE] Code fresh bank lines from the owner's learned memory (confident
      // only) so uncategorized money shrinks on its own between logins. A failure here is no longer
      // swallowed silently — it is logged + Sentry'd (previously a persistently-failing user's
      // auto-categorization could stop forever with no trace).
      let categorized: Awaited<ReturnType<typeof applyLearnedBankCategories>> = [];
      try {
        categorized = await applyLearnedBankCategories({ pipeline, userId: uid });
      } catch (ce) {
        console.error("[CRON-RECONCILE] auto-categorize failed (non-fatal)", { uid, error: ce instanceof Error ? ce.message : String(ce) });
        Sentry.captureException(ce instanceof Error ? ce : new Error(String(ce)), { tags: { cron: "reconcile", phase: "auto-categorize" }, extra: { uid } });
      }
      // [AUTOCAT-NOTIFY] An automatic category lands in the P&L IMMEDIATELY (the engine counts any
      // non-null category). Push a single "controleer" nudge so a machine coding is never applied to
      // the owner's books with zero signal — the review tab (?scope=review) is otherwise never linked.
      if (categorized.length > 0) {
        await createNotification({
          userId: uid,
          type: "status",
          title: `${categorized.length} banktransactie(s) automatisch gecategoriseerd`,
          body: "We hebben deze op basis van eerdere keuzes ingedeeld. Controleer ze even — ze tellen al mee in je cijfers.",
          link: "/dashboard/bank/categoriseren?scope=review",
        }).catch((ne) => console.error("[CRON-RECONCILE] autocat notify failed", { uid, error: ne instanceof Error ? ne.message : String(ne) }));
      }
      // [AUTO-INCASSO] Book what the bank collected on its own. It runs AFTER the bank pass on
      // purpose: a real bank line is evidence and this is an assumption, so wherever both could
      // settle the same invoice, the evidence gets there first and the assumption finds it paid.
      //
      // Never fatal to the user's reconcile — a failed pass leaves the invoices open, which is the
      // state they are in today, and the next hour tries again.
      try {
        const incasso = await settleIncassoForUser(pipeline, pipeline, uid, amsterdamToday());
        if (incasso.booked.length > 0) {
          incassoBooked += incasso.booked.length;
          const sum = incasso.booked.reduce((s, b) => s + b.amount, 0);
          // The owner is TOLD. This is the one pass in the reconcile that books a payment nobody
          // observed, so it may never be the quiet one — "we marked five invoices paid" has to
          // reach the person whose books they are, with the amount, so a wrong one is catchable.
          await createNotification({
            userId: uid,
            type: "payment",
            title: `${incasso.booked.length} factu(u)r(en) automatisch afgeschreven`,
            body: `${formatEuroNL(sum)} is bij je incasso-leveranciers afgeschreven. We hebben ze op betaald gezet — kloppen ze niet? Zet ze terug op openstaand.`,
            link: "/dashboard/incoming/manage?filter=paid",
          }).catch((ne) => console.error("[AUTO-INCASSO] notify failed", { uid, error: ne instanceof Error ? ne.message : String(ne) }));
        }
      } catch (ie) {
        console.error("[AUTO-INCASSO] settle failed (non-fatal)", { uid, error: ie instanceof Error ? ie.message : String(ie) });
        Sentry.captureException(ie instanceof Error ? ie : new Error(String(ie)), { tags: { cron: "reconcile", phase: "auto-incasso" }, extra: { uid } });
      }

      // [DD-SIGNAL] …and the half where the app notices on its own. The bank statement NAMES a
      // SEPA incasso — MT940's NDDT, CAMT's <MndtId>, ING's "IC", Rabobank's Machtigingskenmerk —
      // so a supplier that has collected twice does not need the owner to remember the mandate.
      //
      // It PROPOSES. Turning it on changes how that supplier's invoices are booked from then on,
      // and this app's rule for that step is the one at the top of bank-matching.ts: the system
      // prepares, the human confirms. Asked once per supplier (incasso_suggested_at) — an hourly
      // repeat is a notification the owner switches off, taking the ones that matter with it.
      try {
        const proposals = await proposeIncassoMandates(pipeline, uid);
        if (proposals.length > 0) {
          const names = proposals.slice(0, 3).map((p) => p.name).join(", ");
          const more = proposals.length > 3 ? ` en ${proposals.length - 3} andere` : "";
          await createNotification({
            userId: uid,
            type: "status",
            title: proposals.length === 1 ? `${proposals[0].name} schrijft automatisch af` : `${proposals.length} leveranciers schrijven automatisch af`,
            body: `Dat zien we op je bankafschrift bij ${names}${more}. Zet het aan, dan vragen we je niet meer om deze facturen te betalen — en zetten we ze na de vervaldatum vanzelf op betaald.`,
            link: "/dashboard/incoming/manage",
          }).catch((ne) => console.error("[DD-SIGNAL] proposal notify failed", { uid, error: ne instanceof Error ? ne.message : String(ne) }));
          // Only AFTER the notification went out: stamping first and then failing to send would
          // lose the proposal for good, since the question is asked exactly once.
          await markIncassoSuggested(pipeline, uid, proposals, new Date().toISOString());
          incassoProposed += proposals.length;
        }
      } catch (pe) {
        console.error("[DD-SIGNAL] mandate proposal failed (non-fatal)", { uid, error: pe instanceof Error ? pe.message : String(pe) });
      }
      usersProcessed += 1;
      // [JET-GAP0] The "automatisch gekoppeld" bell now lives INSIDE runBankAutoConfirm, so every
      // entry point (incl. this cron) notifies from one place — no duplicate insert here.
      if (confirmed.length > 0) bookedTotal += confirmed.length;
    } catch (e) {
      // Isolate + LOG + Sentry (a persistently-failing user was previously an anonymous counter bump).
      failed += 1;
      console.error("[CRON-RECONCILE] user reconcile failed (non-fatal)", { uid, error: e instanceof Error ? e.message : String(e) });
      Sentry.captureException(e instanceof Error ? e : new Error(String(e)), { tags: { cron: "reconcile", phase: "per-user" }, extra: { uid } });
    }
  }

  // [CRON-HONEST] ok reflects the truth: per-user failures are isolated (the run itself completed,
  // so no 500 → no noisy hourly retries for one flaky user), but ok:false makes them visible to
  // any body-reading monitor instead of an always-green flag.
  // [CRON-HARTSLAG] De uitkomst vastleggen. Best effort: dit mag de cron nooit laten vallen.
  await finishCronRun(createPipelineClient(), cronRunId, { ok: failed === 0, result: { ok: failed === 0, users: userIds.size, usersProcessed, bookedTotal, failed, truncated, incassoUsers, ddUsers, incassoBooked, incassoProposed } });

  return NextResponse.json({ ok: failed === 0, users: userIds.size, usersProcessed, bookedTotal, failed, truncated, incassoUsers, ddUsers, incassoBooked, incassoProposed });
}
