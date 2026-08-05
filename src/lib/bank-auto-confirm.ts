// src/lib/bank-auto-confirm.ts
// [BANK-AUTO-CONFIRM-CORE] The server-side safe-set pass, extracted so the circle closes from
// ANY entry point — the /bank page, an invoice verify, a bank IMPORT, and a background cron —
// not only when a browser happens to sit on /dashboard/bank. It books the two auto tiers:
// 'certain' (invoice number printed in the statement OR supplier IBAN, + amount to the cent —
// booked silently) and 'amount_only' (exact amount + strong counterpart name + date proximity,
// single clear winner — booked but flagged "controleer"; blocked under kasstelsel), plus the
// provably-exact multi-invoice batch ties. Fully reversible (owner can unlink) and audited.
//
// payClient vs pipeline: the invoice→'paid' write goes through `payClient`. A ROUTE passes its
// SESSION client, so the DB 'verwerkt' guard trigger fires with a real auth.uid(); a CRON or a
// server IMPORT (no session) passes the service-role `pipeline`, where the app-level isEligible
// check below is the authoritative guard (it already rejects a 'verwerkt' invoice). The bank
// line link + all reads always use the service-role `pipeline` (user-pinned by user_id).

import type { SupabaseClient } from "@supabase/supabase-js";
import type { PipelineClient } from "./supabase-pipeline";
import { fetchAllRows } from "./supabase-paginate";
import {
  matchTransactions,
  autoConfirmTier,
  isEligible,
  ibanMatches,
  type AutoConfirmTier,
  type InvoiceForMatching,
  type TransactionMatch,
} from "./bank-matching";
// [MATCH-CONFIDENCE] The Business Central-shaped second opinion. One-directional: it may
// refuse an automatic booking, never authorise one — see bank-match-confidence.ts.
import { applyConfidenceVeto } from "./bank-match-confidence";
import { rowToTransaction, type BankTransactionDbRow } from "./bank-import";
import { planBatchAutoConfirm, type BatchCandidateInvoice } from "./bank-batch-reconcile";
import { recordPaymentLinks } from "./bank-tx-links";
import { logAuditAction } from "./audit";
import { getVatScheme } from "./vat-scheme";
// [ALARM] Opgevangen fouten die tóch iemand moeten bereiken — zie report-handled.ts.
import { reportHandledFailure } from "@/lib/report-handled"

export interface AutoConfirmed {
  transactionId: string;
  invoiceId: string;
  invoiceNumber: string | null;
  amount: number;
  // [JET-GAP0] How sure the booking was: 'certain' (printed reference / IBAN + amount to the cent,
  // or an exact multi-invoice batch tie) vs 'amount_only' (amount + counterpart name, single clear
  // winner — booked but flagged "controleer"). Drives the honesty of the notification body.
  tier: AutoConfirmTier;
  // [MATCH-BUTTON] The settlement date written on the invoice — the BANK LINE's date, not "today".
  // Returned so an on-demand caller can patch its list with the real payment date instead of
  // showing a freshly-paid invoice with an empty date until the next server render.
  paymentDate: string | null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type PayClient = SupabaseClient<any>;

/**
 * Book every near-certain (transaction, invoice) match for one user. Idempotent + safe to call
 * repeatedly: it only ever touches `pending` transactions and non-`paid` invoices, re-checks the
 * confirm-route invariants per match, and rolls the invoice back on a link race so it never
 * leaves a paid invoice with no bank line. Returns the bookings made (empty if none).
 */
export async function runBankAutoConfirm(args: {
  payClient: PayClient;
  pipeline: PipelineClient;
  userId: string;
}): Promise<AutoConfirmed[]> {
  const { payClient, pipeline, userId } = args;

  // [JET-GAP2] Is the owner on kasstelsel? Under kas the payment DATE an auto-booking writes is
  // VAT-timing truth (it decides the BTW quarter), so an 'amount_only' match — amount + name but NO
  // printed reference — must NOT auto-book: a wrong same-amount pick would land BTW in the wrong
  // quarter. 'certain' (printed reference / IBAN to the cent) still auto-books. Own deploy-safe
  // query; defaults factuur if the vat_scheme migration lags (then amount_only books as before,
  // which is safe under accrual where the pay date is not VAT-timing).
  const { data: schemeProf } = await pipeline
    .from("profiles").select("vat_scheme").eq("id", userId).maybeSingle();
  const ownerScheme = getVatScheme((schemeProf as { vat_scheme?: string | null } | null)?.vat_scheme);

  const txRows = await fetchAllRows((from, to) =>
    pipeline
      .from("bank_transactions")
      .select("id, date, amount, description, counterpart_name, counterpart_iban, reference, invoice_id, status")
      .eq("user_id", userId)
      .eq("status", "pending")
      .order("id", { ascending: true })
      .range(from, to),
  );
  const invRows = await fetchAllRows((from, to) =>
    pipeline
      .from("invoices")
      .select("id, invoice_number, total_inc_btw, invoice_date, due_date, client_name, direction, status, accountant_status, vendor_iban, payment_reference, amount_paid, payment_prepared_at")
      .or(`sender_id.eq.${userId},receiver_id.eq.${userId}`)
      .neq("status", "paid")
      .order("id", { ascending: true })
      .range(from, to),
  );
  if (txRows.length === 0 || invRows.length === 0) return [];

  const transactions = (txRows as BankTransactionDbRow[]).map((r) => rowToTransaction(r));
  const allInvoices = invRows as (InvoiceForMatching & { amount_paid?: number | null })[];
  // [PARTIAL-PAY] Auto-confirm books full-amount matches by writing status='paid' directly (not
  // via apply_bank_payment), so it must NEVER touch an invoice that is mid-instalment (amount_paid
  // > 0): a full-amount payment landing on a partially-settled invoice would over-pay it. Those are
  // left for the human to complete through the partial-aware confirm route (which caps at the
  // remaining balance). A fully-unpaid invoice (amount_paid 0) is unaffected — the common case.
  const invoices = allInvoices.filter((i) => Math.max(0, Number(i.amount_paid ?? 0)) === 0);
  if (invoices.length === 0) return [];
  const invById = new Map(invoices.map((i) => [i.id, i]));
  // [PARTIAL-PAY] The BATCH pass may legitimately settle a partly-paid invoice (see its comment),
  // so it needs an index over every candidate, not just the fully-open 1:1 pool.
  const allById = new Map(allInvoices.map((i) => [i.id, i]));

  // [BANK-PARTLY-CONSUMED] A PENDING bank line that already carries an invoice_id has already
  // paid something: the multi-invoice confirm flow keeps a batch visible for its remaining
  // numbers, and apply_bank_payment leaves a payment pending while money of it is unspent. The
  // 1:1 pass books the FULL amount of such a line against another invoice with no awareness of
  // what it already settled — the same euros counted twice. The batch pass has always skipped
  // these lines (row.invoice_id below); the 1:1 pass must too.
  const partlyConsumedTxIds = new Set(
    (txRows as BankTransactionDbRow[]).filter((r) => r.invoice_id).map((r) => r.id).filter(Boolean),
  );

  // [BANK-PARTLY-CONSUMED] Exclude the partly-consumed lines from the MATCHER's input, not only
  // from the booking loop below. matchTransactions holds a one-to-one guard: the strongest match
  // CLAIMS its invoice and removes it from every other transaction's candidates. Feeding it a
  // line that we are about to skip anyway meant such a line could claim an invoice and then be
  // dropped — so the clean payment that could safely have been booked against that invoice lost
  // it, fell back to 'choice'/'none', and stayed there. Nothing changes between runs, so that was
  // a permanent block, not a transient one. Skipping them here costs nothing: the batch pass
  // reads txRows directly and skips these lines by the same rule.
  // ── [BANK-BATCH-FIRST] The BATCH pass runs BEFORE the 1:1 pass. A printed-number batch tie
  // (every referenced number resolves, one supplier, open amounts sum to the debit TO THE CENT)
  // is the strongest evidence the engine ever has — yet it ran LAST, so a same-supplier
  // same-amount 1:1 line could claim (and amount_only-book) an invoice that provably belonged
  // to a bundle: the bundle then never tied ('incomplete' forever) and its invoice sat linked
  // to the wrong bank line. Strong evidence books first; the 1:1 pass works the leftovers.
  const confirmed: AutoConfirmed[] = [];
  const bookedInvoiceIds = new Set<string>();
  const bookedTxIds = new Set<string>();
  for (const row of txRows as BankTransactionDbRow[]) {
    const txId = row.id;
    if (!txId || row.status !== "pending" || row.invoice_id || bookedTxIds.has(txId)) continue;

    // Candidates exclude anything already booked this run, so two batches can't claim one invoice.
    // [PARTIAL-PAY] The batch pass draws from allInvoices, NOT the 1:1 pool: that pool drops every
    // invoice with amount_paid > 0 because a lone payment against a half-paid invoice is genuinely
    // ambiguous (the restant? a coincidental same-amount line?). A batch carries far stronger
    // evidence — ≥2 referenced numbers, each resolving to exactly one invoice, one supplier, and
    // the sum of the OPEN amounts equal to the cent — so that ambiguity does not exist here.
    const candidates = allInvoices.filter((i) => !bookedInvoiceIds.has(i.id)) as BatchCandidateInvoice[];
    // [BUNDEL-REF-RECOVER] The description travels with the reference: the extractor mutilates any
    // invoice number that carries a prefix or a separator ("2026-045" → "045"), and the raw
    // statement line is where the real number still is.
    const plan = planBatchAutoConfirm({
      reference: row.reference ?? null,
      description: row.description ?? null,
      bankAmount: row.amount ?? null,
      invoices: candidates,
    });
    if (!plan) continue;

    // Resolve against ALL invoices — invById only indexes the fully-open 1:1 pool, so a batch
    // containing a partly-paid invoice would otherwise lose it here and be skipped silently.
    const planInvs = plan.invoiceIds.map((id) => allById.get(id)).filter((x): x is InvoiceForMatching => !!x);
    if (planInvs.length !== plan.invoiceIds.length) continue;
    const tx = rowToTransaction(row);
    if (!planInvs.every((inv) => isEligible(tx, inv))) continue; // accountant-'verwerkt' + invariants

    // [BANK-BATCH-ATOMIC] Book the whole tie in ONE database transaction via book_bank_batch —
    // see the RPC's header for the lock/re-verify/all-or-nothing contract. Outcomes: rows ⇒
    // booked · empty ⇒ tx claimed concurrently ⇒ skip · error ⇒ not payable / migration not
    // applied ⇒ the batch stays for the human.
    const { data: bookedRows, error: batchErr } = await payClient.rpc("book_bank_batch", {
      p_user_id: userId,
      p_tx_id: txId,
      p_invoice_ids: plan.invoiceIds,
      p_pay_date: tx.date || null,
    });
    if (batchErr) continue;
    if (!bookedRows || (bookedRows as unknown[]).length === 0) continue;

    for (const inv of planInvs) {
      // A batch tie is 'certain' by construction (every number resolves + the sum equals the debit).
      confirmed.push({ transactionId: txId, invoiceId: inv.id, invoiceNumber: inv.invoice_number, amount: inv.total_inc_btw ?? 0, tier: "certain", paymentDate: tx.date || null });
      bookedInvoiceIds.add(inv.id);
    }
    bookedTxIds.add(txId);
    await logAuditAction({
      userId,
      action: "bank.auto_confirmed_batch",
      entityType: "bank_transaction",
      entityId: txId,
      newValue: { invoice_ids: plan.invoiceIds, invoice_count: plan.invoiceIds.length, amount: row.amount ?? 0, reason: "exact_multi_invoice_batch_tie" },
    });
  }

  // ── The 1:1 pass, over what the batch pass left ──────────────────────────────────────────
  const bookable = transactions.filter(
    (t) => !t.transactionId || (!partlyConsumedTxIds.has(t.transactionId) && !bookedTxIds.has(t.transactionId)),
  );
  const soloInvoices = invoices.filter((i) => !bookedInvoiceIds.has(i.id));
  const result = matchTransactions(bookable, soloInvoices);
  // [BANK-AMOUNT-ONLY] Book BOTH auto tiers. 'certain' (printed number / IBAN + amount) is booked
  // silently; 'amount_only' (exact amount + matching counterpart name, single clear winner) is
  // booked too but tagged auto_match_reason='amount_only' so the Gekoppeld tab flags it
  // "controleer". Both use the identical money discipline below and both are one-tap reversible.
  // [MATCH-CONFIDENCE] A second, independent opinion on every pairing the tiers would book, in the
  // shape Business Central publishes it: related party × document number × how many open invoices
  // fall within the amount tolerance → High / Medium / Low. It is wired here rather than inside
  // autoConfirmTier because the amount column needs the whole candidate pool, which lives at this
  // level — and because keeping it out of bank-matching avoids an import cycle.
  //
  // The contract is ONE-DIRECTIONAL: it may turn an automatic booking into a human one, never the
  // reverse. bank-matching's guards (a contradicting printed number, phantomSecond, the identity
  // caps) were each earned from a real wrong booking, and a table imported from another product
  // does not get to overrule them. So this filter can only ever remove.
  //
  // Today it removes nothing — verified by probing the ambiguous cases, and pinned by
  // bank-match-confidence.test.ts. That is the point: the agreement is now asserted rather than
  // believed, so a future change that makes a Low pairing bookable stops here instead of in
  // someone's quarter.
  const autoMatches = applyConfidenceVeto({
    matches: result.matches.map((m) => ({ m, tier: autoConfirmTier(m) })),
    invoiceById: invById,
    // The same eligibility the matcher used, so the amount count cannot disagree with the
    // candidate list it is judging.
    eligibleFor: (tx) => soloInvoices.filter((i) => isEligible(tx, i)),
    onVeto: ({ match, tier, classification }) => {
      console.warn("[MATCH-CONFIDENCE] refused an automatic booking the tiers allowed", {
        userId,
        transactionId: match.transaction.transactionId,
        invoiceId: match.best?.invoiceId,
        tier,
        classification: classification.reason,
      });
    },
  }).filter((x): x is { m: TransactionMatch; tier: AutoConfirmTier } => x.tier !== null);

  for (const { m, tier } of autoMatches) {
    const txId = m.transaction.transactionId;
    const invoiceId = m.best?.invoiceId;
    if (!txId || !invoiceId) continue;
    if (partlyConsumedTxIds.has(txId) || bookedTxIds.has(txId) || bookedInvoiceIds.has(invoiceId)) continue;
    const inv = invById.get(invoiceId);
    if (!inv) continue;

    // [JET-GAP2] Under kasstelsel, an amount-only match stays a human-confirm suggestion (it remains
    // a pending transaction the /bank matcher surfaces for one-tap confirm) — never auto-booked,
    // because the pay date it would write decides the BTW quarter. 'certain' still books.
    if (tier === "amount_only" && ownerScheme === "kas") continue;

    // [BANK-HIDDEN-COMPETITOR] The matcher's "single clear winner" is judged against the VISIBLE
    // candidate pool — but a same-amount invoice sitting in the verify queue ('processing', not yet
    // human-verified) or mid-instalment (amount_paid > 0) is excluded from that pool, so its absence
    // MANUFACTURES false uniqueness. Concrete: a monthly €89 incasso arrives while this month's
    // invoice is still unverified → last month's open invoice is the "only" candidate and books,
    // while the money paid THIS month's bill. When such a hidden same-amount competitor exists, an
    // 'amount_only' match is not genuinely unambiguous — leave it a human one-tap. 'certain'
    // (printed number / IBAN) is supplier-doc identity and stays immune to this.
    // [BANK-IBAN-COMPETITOR] The guard also covers a 'certain' that rests on IBAN alone. An
    // IBAN identifies the SUPPLIER's account, not the document — for a recurring same-amount
    // incasso (huur, lease) every month's invoice shares the vendor_iban AND the amount, so a
    // hidden competitor (this month's bill still in the verify queue) makes an iban-certain
    // exactly as ambiguous as an amount_only. Only a PRINTED NUMBER is document identity and
    // stays immune. Scoped to competitors on the SAME account so an unrelated same-amount
    // invoice never vetoes a genuine iban match.
    const bestSig = m.best?.signals ?? [];
    const ibanCertain = tier === "certain" && bestSig.includes("iban") && !bestSig.includes("reference");
    if (tier === "amount_only" || ibanCertain) {
      const txAmt = m.transaction.amount ?? 0;
      const hiddenCompetitor = allInvoices.some((i) => {
        if (i.id === invoiceId) return false;
        if (!(i.status === "processing" || Math.max(0, Number(i.amount_paid ?? 0)) > 0)) return false;
        if (typeof i.total_inc_btw !== "number") return false;
        // [BANK-OPEN-COMPETITOR] Compare against the OPEN balance as well as the gross total: a
        // mid-instalment invoice whose RESTANT equals this payment is precisely the competitor a
        // restant-sized transfer is likeliest to be paying — matching only the full total let it
        // hide. (paymentExceedsOpenBalance semantics, inlined for the magnitude compare.)
        const total = Math.abs(i.total_inc_btw);
        const open = Math.max(0, total - Math.max(0, Number(i.amount_paid ?? 0)));
        // [BANK-CENTS-EXACT] Integer cents, same rule as amountMatches — a raw float compare
        // made the one-cent tolerance a lottery per euro-pair.
        const near = (v: number) => Math.abs(Math.round(Math.abs(txAmt) * 100) - Math.round(v * 100)) <= 1;
        if (!near(total) && !near(open)) return false;
        // An iban-certain is only contested by an invoice on the SAME supplier account.
        if (ibanCertain) return ibanMatches(m.transaction.counterpartIban, i.vendor_iban);
        return true;
      });
      if (hiddenCompetitor) continue;
    }

    // Defense-in-depth: the same invariants the confirm route enforces (incl. accountant
    // 'verwerkt' exclusion) — authoritative when payClient is service_role (no DB trigger).
    if (!isEligible(m.transaction, inv)) continue;

    // (a) invoice → paid. .select() detects a concurrent pay (0 rows) → skip, never re-own.
    //     [BANK-PAYDATE] the real settlement date is the bank line's date (cross-quarter safe).
    //     [B4-WRITE-GUARD] Re-assert the accountant 'verwerkt' exclusion IN the WHERE clause, not
    //     only in the (possibly minutes-stale) isEligible read above. From cron/import/intake the
    //     payClient is service-role — no DB trigger with auth.uid() — so without this, an invoice
    //     the accountant locked in the read-to-write window was still flipped to 'paid'. The .or
    //     keeps NULL accountant_status matchable (NEQ alone would exclude NULL rows in SQL).
    const { data: payData, error: payErr } = await payClient
      .from("invoices")
      .update({ status: "paid", payment_method: "bank", marked_paid_at: new Date().toISOString(), payment_date: m.transaction.date || null })
      .eq("id", invoiceId)
      .neq("status", "paid")
      .or("accountant_status.is.null,accountant_status.neq.verwerkt")
      .select("id");
    if (payErr) continue; // verwerkt/RLS/other — leave for the human, don't fail the batch
    if (!payData || payData.length === 0) continue; // concurrently paid — not ours to link

    // (b) link the bank line → matched (single invoice ⇒ fully covered). 0 rows ⇒ roll back.
    //     'amount_only' also stamps auto_match_reason so the UI can flag it "controleer". The
    //     column is set ONLY for that tier, so a not-yet-applied migration leaves the 'certain'
    //     path untouched (it never writes the column) — those keep booking; an 'amount_only' write
    //     would just error → roll back → that one line stays a one-tap manual confirm (safe).
    const linkPayload: Record<string, unknown> = { status: "matched", invoice_id: invoiceId };
    if (tier === "amount_only") linkPayload.auto_match_reason = "amount_only";
    const { data: linkData, error: linkErr } = await pipeline
      .from("bank_transactions")
      // auto_match_reason is added by bank_auto_match_reason.sql and not yet in the generated types.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .update(linkPayload as any)
      .eq("id", txId)
      .eq("user_id", userId)
      .eq("status", "pending")
      .select("id");

    if (linkErr || !linkData || linkData.length === 0) {
      // [ROLLBACK-LOUD] The rollback itself can fail (transient DB error) — that leaves an invoice
      // 'paid' with NO linked bank line, the exact state this design promises never exists. It
      // cannot be silent: log it with ids so it is findable and fixable (the owner can also undo
      // via pay-toggle). A double fault is rare; an invisible double fault is a lost truth.
      const { error: rbErr } = await payClient
        .from("invoices")
        .update({ status: inv.status, payment_method: null, marked_paid_at: null, payment_date: null })
        .eq("id", invoiceId)
        .eq("status", "paid");
      if (rbErr) {
        // [ALARM] The code above calls this "the exact state this design promises never exists".
        // A promise nobody is told has been broken is not a promise — this one wakes someone.
        reportHandledFailure({
          tag: "BANK-AUTO-CONFIRM",
          message: "pay rollback FAILED — invoice may be paid with no bank link",
          severity: "data-integrity",
          context: { userId, invoiceId, txId, error: rbErr.message },
        });
      }
      continue;
    }

    // [BANK-TX-INVOICES] Record the exact invoice this payment paid so a later reversal
    // (unlink / delete-statement) reverses by id, never by number. Best-effort — the money-truth
    // is the tx.invoice_id + invoice.status above; this row is only the collision-free undo index.
    // [PARTIAL-PAY] The amount MUST travel with the link: recompute_invoice_amount_paid re-derives
    // invoices.amount_paid as SUM(amount_applied) on every later unlink/undo, so a NULL here would
    // silently zero a genuinely settled invoice. This pass only ever books fully-open invoices
    // (amount_paid === 0, line 97) at their full total, so the applied amount is that total.
    await recordPaymentLinks(pipeline, userId, txId, [invoiceId], {
      [invoiceId]: Math.abs(Number(inv.total_inc_btw ?? 0)),
    });

    confirmed.push({ transactionId: txId, invoiceId, invoiceNumber: inv.invoice_number, amount: m.transaction.amount ?? 0, tier, paymentDate: m.transaction.date || null });
    await logAuditAction({
      userId,
      action: "bank.auto_confirmed",
      entityType: "invoice",
      entityId: invoiceId,
      newValue: { transaction_id: txId, invoice_number: inv.invoice_number, amount: m.transaction.amount ?? 0, tier, reason: tier === "amount_only" ? "amount_counterpart_single" : "near_certain_reference_amount" },
    });
  }

  // [JET-GAP1 — DELIBERATELY NOT DONE] Auto-booking a partial-payment instalment was proposed, but
  // the matching engine already makes a considered, documented decision the other way: completing an
  // already-partly-paid invoice is a HUMAN decision, never a silent auto-book (bank-matching.ts caps
  // a partial candidate at 0.6 so it surfaces as a one-tap "restant" suggestion, not an 'auto'). That
  // honours "human intervention at maximum ambiguity" — a partial is genuinely more ambiguous (which
  // instalment? the restant, or a coincidental same-amount line?). So partials stay a human confirm
  // on /bank, by design; the auto path books only fully-open invoices + exact multi-invoice batches.

  // ── [JET-GAP0] The bell lives HERE, inside the core, so it is IMPOSSIBLE to book an invoice
  // paid from ANY of the six entry points (import, verify, cron, /bank page, email) without the
  // owner being told. Before, only two callers notified — the other four moved money silently.
  // The body is honest about tier: an 'amount_only' booking (matched on amount + name, not a
  // printed reference) is flagged "controleer". Best-effort but LOGGED on failure — a swallowed
  // insert must never regress to silent money. (Money is not moved here; a paid invoice is a fact
  // recorded, one-tap reversible under "Bevestigd".)
  if (confirmed.length > 0) {
    const n = confirmed.length;
    const amountOnly = confirmed.filter((c) => c.tier === "amount_only").length;
    const body =
      `${n === 1 ? "1 factuur is" : `${n} facturen zijn`} automatisch herkend in je bankafschrift en op ` +
      `betaald gezet. Bekijk ze onder "Bevestigd" — elke koppeling draai je met één tik terug.` +
      (amountOnly > 0
        ? ` Let op: ${amountOnly === 1 ? "1 koppeling is" : `${amountOnly} koppelingen zijn`} alleen op bedrag ` +
          "herkend (geen factuurnummer in de omschrijving) — controleer die even."
        : "");
    try {
      const { error } = await pipeline.from("notifications").insert({
        user_id: userId,
        title: n === 1 ? "1 factuur automatisch gekoppeld" : `${n} facturen automatisch gekoppeld`,
        body,
        type: "payment",
        // [NOTIF-DEADEND] The body says "bekijk ze onder Bevestigd" — so the bell must
        // actually go there. It carried no link at all, which made the one notification
        // about money the app moved by itself the one you could not open. ?tab=done
        // opens the Bevestigd tab directly (BankClient reads it), where every automatic
        // link is listed and reversible with one tap.
        link: "/dashboard/bank?tab=done",
      });
      if (error) console.error("[JET-GAP0] auto-confirm notification insert failed", { userId, error: error.message });
    } catch (e) {
      console.error("[JET-GAP0] auto-confirm notification threw", { userId, error: e instanceof Error ? e.message : String(e) });
    }
  }

  return confirmed;
}
