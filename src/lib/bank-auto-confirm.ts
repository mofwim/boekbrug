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
  type AutoConfirmTier,
  type InvoiceForMatching,
  type TransactionMatch,
} from "./bank-matching";
import { rowToTransaction, type BankTransactionDbRow } from "./bank-import";
import { planBatchAutoConfirm, type BatchCandidateInvoice } from "./bank-batch-reconcile";
import { recordPaymentLinks } from "./bank-tx-links";
import { logAuditAction } from "./audit";
import { getVatScheme } from "./vat-scheme";

export interface AutoConfirmed {
  transactionId: string;
  invoiceId: string;
  invoiceNumber: string | null;
  amount: number;
  // [JET-GAP0] How sure the booking was: 'certain' (printed reference / IBAN + amount to the cent,
  // or an exact multi-invoice batch tie) vs 'amount_only' (amount + counterpart name, single clear
  // winner — booked but flagged "controleer"). Drives the honesty of the notification body.
  tier: AutoConfirmTier;
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
      .select("id, invoice_number, total_inc_btw, invoice_date, due_date, client_name, direction, status, accountant_status, vendor_iban, amount_paid")
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
  const result = matchTransactions(transactions, invoices);
  // [BANK-AMOUNT-ONLY] Book BOTH auto tiers. 'certain' (printed number / IBAN + amount) is booked
  // silently; 'amount_only' (exact amount + matching counterpart name, single clear winner) is
  // booked too but tagged auto_match_reason='amount_only' so the Gekoppeld tab flags it
  // "controleer". Both use the identical money discipline below and both are one-tap reversible.
  const autoMatches = result.matches
    .map((m): { m: TransactionMatch; tier: AutoConfirmTier | null } => ({ m, tier: autoConfirmTier(m) }))
    .filter((x): x is { m: TransactionMatch; tier: AutoConfirmTier } => x.tier !== null);

  const confirmed: AutoConfirmed[] = [];
  for (const { m, tier } of autoMatches) {
    const txId = m.transaction.transactionId;
    const invoiceId = m.best?.invoiceId;
    if (!txId || !invoiceId) continue;
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
    if (tier === "amount_only") {
      const txAmt = m.transaction.amount ?? 0;
      const hiddenCompetitor = allInvoices.some(
        (i) =>
          i.id !== invoiceId &&
          (i.status === "processing" || Math.max(0, Number(i.amount_paid ?? 0)) > 0) &&
          typeof i.total_inc_btw === "number" &&
          Math.abs(Math.abs(txAmt) - Math.abs(i.total_inc_btw)) <= 0.01,
      );
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
        console.error("[BANK-AUTO-CONFIRM] pay rollback FAILED — invoice may be paid with no bank link", {
          userId, invoiceId, txId, error: rbErr.message,
        });
      }
      continue;
    }

    // [BANK-TX-INVOICES] Record the exact invoice this payment paid so a later reversal
    // (unlink / delete-statement) reverses by id, never by number. Best-effort — the money-truth
    // is the tx.invoice_id + invoice.status above; this row is only the collision-free undo index.
    await recordPaymentLinks(pipeline, userId, txId, [invoiceId]);

    confirmed.push({ transactionId: txId, invoiceId, invoiceNumber: inv.invoice_number, amount: m.transaction.amount ?? 0, tier });
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

  // ── [BANK-BATCH] Automatic booking of unambiguous MULTI-invoice batches ──────────────────
  // The 1:1 pass above deliberately skips any payment that settles several invoices (a wholesaler
  // batching a week of deliveries into one debit — the common case for a shop). Those never
  // auto-reconciled and piled up as manual work. Book the provably-exact ones here using the SAME
  // tie-logic as the manual UI (planBatchAutoConfirm → reconcileBatch "ties"): every referenced
  // number resolves to exactly one unpaid invoice of the right direction, one supplier, and the
  // gross sum equals the debit to the cent. A short-payment (mismatch) or a not-yet-imported
  // invoice (incomplete) returns null and stays for the human. Same reversibility + audit.
  const bookedInvoiceIds = new Set(confirmed.map((c) => c.invoiceId));
  const bookedTxIds = new Set(confirmed.map((c) => c.transactionId));
  for (const row of txRows as BankTransactionDbRow[]) {
    const txId = row.id;
    if (!txId || row.status !== "pending" || row.invoice_id || bookedTxIds.has(txId)) continue;

    // Candidates exclude anything already booked this run, so two batches can't claim one invoice.
    const candidates = invoices.filter((i) => !bookedInvoiceIds.has(i.id)) as BatchCandidateInvoice[];
    const plan = planBatchAutoConfirm({ reference: row.reference ?? null, bankAmount: row.amount ?? null, invoices: candidates });
    if (!plan) continue;

    const planInvs = plan.invoiceIds.map((id) => invById.get(id)).filter((x): x is InvoiceForMatching => !!x);
    if (planInvs.length !== plan.invoiceIds.length) continue;
    const tx = rowToTransaction(row);
    if (!planInvs.every((inv) => isEligible(tx, inv))) continue; // accountant-'verwerkt' + invariants

    // [BANK-BATCH-ATOMIC] Book the whole tie in ONE database transaction via book_bank_batch.
    // The RPC locks the bank line FIRST (the mutex), re-verifies every invoice is still unpaid +
    // not accountant-'verwerkt' under that lock, then pays them all, links the tx, and records the
    // join rows — all-or-nothing. This closes the concurrent half-rollback the multi-statement
    // path had: two overlapping runs over the same batch tx could leave one invoice unpaid while
    // the tx showed 'matched' (and never retried). Now the loser blocks on the lock and gets an
    // EMPTY result → skips. If any invoice turned unpayable in the window the whole batch aborts
    // (error) and nothing is written. Reversal index (bank_tx_invoices) is written INSIDE the txn.
    //
    // Outcomes: rows returned ⇒ booked · empty (no error) ⇒ tx already claimed by a concurrent run
    // ⇒ skip · error ⇒ an invoice is no longer payable (or the migration isn't applied yet) ⇒
    // leave the whole batch for the human. Degrades safely: a missing function just means batches
    // aren't auto-booked until book_bank_batch_atomic.sql is applied.
    const { data: bookedRows, error: batchErr } = await payClient.rpc("book_bank_batch", {
      p_user_id: userId,
      p_tx_id: txId,
      p_invoice_ids: plan.invoiceIds,
      p_pay_date: tx.date || null,
    });
    if (batchErr) continue;                                        // not payable / not applied → skip
    if (!bookedRows || (bookedRows as unknown[]).length === 0) continue; // tx already claimed → skip

    for (const inv of planInvs) {
      // A batch tie is 'certain' by construction (every number resolves + the sum equals the debit).
      confirmed.push({ transactionId: txId, invoiceId: inv.id, invoiceNumber: inv.invoice_number, amount: inv.total_inc_btw ?? 0, tier: "certain" });
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
      });
      if (error) console.error("[JET-GAP0] auto-confirm notification insert failed", { userId, error: error.message });
    } catch (e) {
      console.error("[JET-GAP0] auto-confirm notification threw", { userId, error: e instanceof Error ? e.message : String(e) });
    }
  }

  return confirmed;
}
