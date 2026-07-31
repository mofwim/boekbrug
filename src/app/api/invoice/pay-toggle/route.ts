// src/app/api/invoice/pay-toggle/route.ts
// [PAY-TOGGLE] The server-authoritative "mark paid" / "undo paid" for a manually-handled invoice
// (the Crediteuren + Facturen "Betaald" toggle). It replaces the old direct client-side write for
// two audited-truth reasons the audit surfaced:
//   [16] every money mutation must be AUDITED — the client write left no audit row.
//   [15] an UNDO of a bank-matched invoice must DETACH its bank transaction — the client toggle
//        undid the invoice side only, stranding the tx as 'matched' (invoice payable a second time,
//        the payment unreachable to re-link). Here the undo runs the same reversal the /bank/unlink
//        path does: detach the tx → pending, clear the join rows, recompute amount_paid.
// The invoice status write uses the SESSION client so the B.4 'verwerkt' trigger fires with a real
// auth.uid(); bank/join writes + audit use the service-role pipeline.

import { NextRequest, NextResponse } from "next/server";
import { amsterdamToday } from "@/lib/format-nl";
// [PAY-DATE-SANE] one tested answer to "could a person have paid on this day?" — see payment-date.ts
import { paymentDateOutOfWindow, PAYMENT_DATE_REFUSAL } from "@/lib/payment-date";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { createPipelineClient } from "@/lib/supabase-pipeline";
import { reconcileCashSettlements, cashInstalmentsSupported } from "@/lib/cash-settle";
import { logAuditAction, getClientIP } from "@/lib/audit";
// [MANUAL-PARTIAL-PAY] one shape for a booked payment — the write path and the replay path
// must answer identically, or the clients cannot tell a deelbetaling from a settlement.
import { buildPaymentResult } from "@/lib/partial-payment";

export const dynamic = "force-dynamic";

// [PAY-DURATION] Marking paid is not one write: an undo walks every bank transaction linked to
// this invoice (per-tx reads, a scoped detach, a recompute RPC) and both directions finish with
// reconcileCashSettlements over the owner's kasboek. A kill midway through the undo is the bad
// case — the bank links are already detached while the invoice is still 'paid', and the rollback
// that repairs exactly that cannot run. A ceiling well above the real work keeps that shut.
export const maxDuration = 60;

// [MANUAL-PARTIAL-PAY] Idempotency keys are uuids — reject anything else rather than
// letting a junk key through as "no key" (which would silently re-enable double booking).
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * [CASH-RETRY] Reconcile the kasboek, and if the pass reported it bailed, ask exactly once more.
 *
 * One retry, not a loop: the failure this covers is a transient read (a chunked invoice fetch that
 * errored), and a pass that fails twice is a real outage the hourly cron and the Kas page load are
 * there for. Still best-effort by contract — the invoice write already succeeded and must never be
 * undone over a drawer entry that will heal by itself.
 */
async function reconcileCashWithRetry(
  client: Awaited<ReturnType<typeof createServerSupabaseClient>>,
  userId: string,
): Promise<void> {
  try {
    const first = await reconcileCashSettlements(client, userId);
    if (first.ok) return;
    console.warn("[CASH-RETRY] kasboek reconcile bailed — retrying once", { userId });
    const second = await reconcileCashSettlements(client, userId);
    if (!second.ok) console.error("[CASH-RETRY] kasboek reconcile bailed twice — the cron/Kas load will heal it", { userId });
  } catch (e) {
    // Documented as never-throwing, but a contract is not a guarantee: a payment must not fail here.
    console.error("[CASH-RETRY] kasboek reconcile threw (non-fatal)", e);
  }
}

export async function POST(req: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let body: { invoiceId?: string; action?: string; paymentMethod?: string; paymentDate?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "invalid_body" }, { status: 400 }); }
  const invoiceId = body.invoiceId;
  const action = body.action;
  if (!invoiceId || (action !== "pay" && action !== "undo")) {
    return NextResponse.json({ error: "missing_fields" }, { status: 400 });
  }

  const pipeline = createPipelineClient();

  // Ownership + state. The user must own the invoice (sender OR receiver).
  const { data: inv, error: invErr } = await pipeline
    .from("invoices")
    // [MANUAL-PARTIAL-PAY] amount_paid decides whether an undo is allowed on an invoice
    // that is partly settled but still open.
    .select("id, invoice_number, status, direction, accountant_status, sender_id, receiver_id, amount_paid")
    .eq("id", invoiceId)
    .or(`sender_id.eq.${user.id},receiver_id.eq.${user.id}`)
    .maybeSingle();
  if (invErr) return NextResponse.json({ error: "invoice_lookup_failed", detail: invErr.message }, { status: 500 });
  if (!inv) return NextResponse.json({ error: "invoice_not_found" }, { status: 404 });
  if (inv.accountant_status === "verwerkt") {
    return NextResponse.json({ error: "verwerkt", invoiceNumber: inv.invoice_number }, { status: 409 });
  }

  const isIncoming = inv.direction === "incoming";

  // [PAY-GUARD] 'paid' may only be entered from a genuinely PAYABLE state: a
  // verified incoming Crediteur ('received') or a delivered outgoing invoice
  // ('sent'; stored-'overdue' included defensively for legacy rows). A row in
  // the verify queue ('processing'), a never-sent 'draft', or an 'archived'
  // one must NEVER become paid — that would inject unverified AI-extracted
  // amounts straight into the BTW figures (voorbelasting/omzet count 'paid'),
  // and a later undo would launder it into a verified 'received'/'sent'.
  const PAYABLE = isIncoming ? ["received"] : ["sent", "overdue"];

  if (action === "pay") {
    if (inv.status === "paid") {
      return NextResponse.json({ error: "invoice_already_paid" }, { status: 409 });
    }
    if (!inv.status || !PAYABLE.includes(inv.status)) {
      return NextResponse.json(
        { error: "not_payable", detail: `status '${inv.status}' kan niet als betaald worden gemarkeerd`, status: inv.status },
        { status: 409 }
      );
    }
    const paymentMethod = body.paymentMethod === "kas" ? "kas" : "bank";
    // [PAY-DATE-SANE] The shape test that stood here is not a date check: "2062-03-01" and
    // "1926-07-04" pass it, and a slipped digit in a date field is an ordinary mistake. What that
    // one digit moves is not cosmetic — payment_date decides the BTW quarter under the kasstelsel
    // (vat-scheme.ts:7), and a 'kas' payment becomes a DATED drawer movement (cash-settle.ts), so
    // an impossible day lands in the kasboek the accountant reads and in the negative-drawer
    // witness that blocks the aangifte. /api/cash has refused exactly this since [CASH-DATE-SANE];
    // this is the OTHER door into the same drawer, and it had no ceiling at all. One shared,
    // tested window now (payment-date.ts), Amsterdam's day on both sides.
    //
    // An absent/empty date still falls back to today, unchanged — most callers send none. A date
    // the caller DID fill in is answered honestly instead of being silently replaced by today:
    // booking on a day the owner did not choose is the same class of quiet error.
    const rawPaymentDate = typeof body.paymentDate === "string" && body.paymentDate.trim() !== ""
      ? body.paymentDate.trim()
      : null;
    if (rawPaymentDate && paymentDateOutOfWindow(rawPaymentDate, amsterdamToday())) {
      return NextResponse.json(
        { error: "invalid_payment_date", detail: PAYMENT_DATE_REFUSAL },
        { status: 400 }
      );
    }
    const paymentDate = rawPaymentDate ?? amsterdamToday();

    // [MANUAL-PARTIAL-PAY] An optional amount turns this into a DEELBETALING. Absent (the
    // empty field — the common case) it means "settle the whole remaining balance", which is
    // exactly what this toggle always did. Rejected here rather than silently coerced: a
    // number we cannot trust must never reach the money path.
    const rawAmount = (body as { amount?: unknown }).amount;
    let payAmount: number | null = null;
    if (rawAmount != null && rawAmount !== "") {
      const parsed = typeof rawAmount === "number" ? rawAmount : Number(rawAmount);
      if (!Number.isFinite(parsed) || parsed <= 0) {
        return NextResponse.json({ error: "invalid_amount" }, { status: 400 });
      }
      payAmount = Math.round(parsed * 100) / 100;
    }

    // [CASH-INSTALMENT] A partial CASH payment used to be refused here. The reason was real: the
    // kasboek held exactly one settlement entry per invoice, so a second cash instalment
    // collapsed into that entry and re-dated it to the latest one — retroactively moving money
    // out of an already-filed quarter and leaving the daily drawer balance wrong in between.
    // cash_entries now carries settlement_id, one row per instalment with its own date and
    // amount (cash_settlement_per_instalment.sql), so the refusal is gone: paying a supplier
    // from the till in two handovers is recorded as the two movements it was.
    //
    // [DEPLOY-SAFE] …but only once that column really exists. Code ships before a migration is
    // applied, and accepting the payment in that window would be the worst of both: the
    // instalment is recorded on the invoice while the drawer never moves, so the kasboek silently
    // understates what left the till. Until the migration lands we keep the old, honest refusal.
    if (payAmount != null && paymentMethod === "kas" && !(await cashInstalmentsSupported(supabase))) {
      return NextResponse.json(
        { error: "partial_cash_unsupported", detail: "Een deelbetaling kan op dit moment alleen via bank worden genoteerd." },
        { status: 400 }
      );
    }
    // Idempotency key: LEAST() clamps over-payment but does NOT deduplicate, so without
    // this a double tap or a retried POST would book the instalment twice.
    const rawKey = (body as { clientKey?: unknown }).clientKey;
    const clientKey = typeof rawKey === "string" && UUID_RE.test(rawKey) ? rawKey : null;

    // Session client so the B.4 'verwerkt' trigger sees a real auth.uid(); the RPC also
    // re-checks verwerkt AND the payable status under its own row lock.
    const { data: applyRows, error } = await supabase.rpc("apply_manual_payment", {
      p_user_id: user.id,
      p_invoice_id: invoiceId,
      p_amount: payAmount,
      p_pay_date: paymentDate,
      p_method: paymentMethod,
      p_payable_statuses: PAYABLE,
      p_client_key: clientKey,
    });
    if (error) {
      const msg = (error.message ?? "").toLowerCase();
      if (msg.includes("verwerkt")) {
        return NextResponse.json({ error: "verwerkt", invoiceNumber: inv.invoice_number }, { status: 409 });
      }
      if (msg.includes("already fully paid") || msg.includes("already covered")) {
        return NextResponse.json({ error: "invoice_already_paid" }, { status: 409 });
      }
      if (msg.includes("not payable")) {
        return NextResponse.json(
          { error: "not_payable", detail: `status '${inv.status}' kan niet als betaald worden gemarkeerd`, status: inv.status },
          { status: 409 }
        );
      }
      return NextResponse.json({ error: "pay_failed", detail: error.message }, { status: 500 });
    }
    const row = Array.isArray(applyRows)
      ? (applyRows[0] as { applied: number; amount_paid: number; total: number; is_paid: boolean; duplicate: boolean } | undefined)
      : undefined;
    if (!row) return NextResponse.json({ error: "invoice_already_paid" }, { status: 409 });

    const fullyPaid = row.is_paid === true;
    const remaining = Math.max(0, Math.round(((row.total ?? 0) - (row.amount_paid ?? 0)) * 100) / 100);

    // A replayed request changed nothing on the INVOICE — report the already-booked state, never a
    // second audit row. Same shape as the real booking below: both go through buildPaymentResult so
    // the two answers can never drift apart again.
    //
    // [CASH-RETRY] It does still reconcile the kasboek, and that is not a contradiction. A replay
    // exists precisely because the FIRST attempt did not finish: apply_manual_payment committed the
    // instalment and the handler was then cut off before its reconcile ran. The drawer entry for
    // that cash payment is exactly what would be missing. The pass is idempotent (it heals or
    // creates, it does not duplicate — cash-settle.ts), so running it here costs nothing and closes
    // the one gap a replay is for. Until now the only thing covering this branch was the manage
    // screen firing a second /api/cash/settle of its own — which no other caller of this route did.
    if (row.duplicate === true) {
      await reconcileCashWithRetry(supabase, user.id);
      return NextResponse.json(buildPaymentResult(row, inv.status));
    }

    // Only a COMPLETED payment clears the prepared marker; a partial one leaves the
    // invoice open, so the "Heb je betaald?" CTA must stay where the owner expects it.
    if (fullyPaid) {
      await supabase.from("invoices").update({ payment_prepared_at: null }).eq("id", invoiceId);
    }

    await logAuditAction({
      userId: user.id,
      action: fullyPaid ? "invoice.status_changed" : "invoice.partial_payment",
      entityType: "invoice", entityId: invoiceId,
      oldValue: { status: inv.status, amount_paid_before: Math.max(0, (row.amount_paid ?? 0) - (row.applied ?? 0)) },
      newValue: fullyPaid
        ? { status: "paid", payment_method: paymentMethod, payment_date: paymentDate, via: "manual_pay_toggle", applied: row.applied }
        : { status: inv.status, applied: row.applied, amount_paid: row.amount_paid, total: row.total, remaining, payment_method: paymentMethod, payment_date: paymentDate, via: "manual_pay_toggle" },
      ipAddress: getClientIP(req),
    });
    // Keep the kasboek in sync when paid in cash (create/heal the 'betaling' entry). Best-effort.
    // [CASH-RETRY] …but not deaf. reconcileCashSettlements NEVER throws — it catches internally and
    // reports `ok:false` (cash-settle.ts:167 bails on a failed id-chunk read, :261 after an internal
    // throw). That value was dropped on the floor here, so a bailed pass looked identical to a
    // successful one and this route still answered 200. The only thing that repaired it was the
    // SECOND reconcile the manage screen fired straight after — an accidental retry that the
    // client had no idea it was providing. Ask once more here instead, so the retry is deliberate
    // and every caller of this route gets it (not just the one screen that happened to double-call).
    await reconcileCashWithRetry(supabase, user.id);
    // [MANUAL-PARTIAL-PAY] Report what ACTUALLY happened. This used to be a bare
    // {ok, status:'paid'} — correct while the toggle was all-or-nothing, a lie the moment a
    // deelbetaling became possible: both clients read `partial` to decide between "still open
    // for the rest" and "settled", so an omitted flag made every first-time instalment render
    // as a completed payment (green chip, row out of the openstaand list, a "Factuur betaald"
    // notification) while the database correctly still said openstaand. Only the idempotent
    // REPLAY branch above returned the full shape — the one path that writes nothing.
    return NextResponse.json(buildPaymentResult(row, inv.status));
  }

  // ── action === 'undo' ──────────────────────────────────────────────────────
  // [PAY-GUARD] Undo is only meaningful on a PAID invoice. Guarding here also
  // prevents the destructive bank-link detach below from running for a row
  // that was never paid (a stray undo used to silently strip its links).
  // [MANUAL-PARTIAL-PAY] A PARTLY paid invoice must be undoable too — it is still 'sent' /
  // 'received', so the old `status !== 'paid'` guard made every deelbetaling permanent: one
  // mistyped instalment and the owner could never correct it. Undo is all-or-nothing by
  // design ("Deelbetalingen wissen" resets to zero paid, never half): the join rows for this
  // invoice are all removed below and amount_paid recomputes to 0.
  const paidSoFar = Math.max(0, Number((inv as { amount_paid?: number | null }).amount_paid ?? 0));
  const wasFullyPaid = inv.status === "paid";
  if (!wasFullyPaid && paidSoFar <= 0.005) {
    return NextResponse.json(
      { error: "not_paid", detail: "alleen een betaalde factuur kan worden teruggezet" },
      { status: 409 }
    );
  }

  // [BANK-UNLINK] If a bank transaction is matched to this invoice, DETACH it so we never leave
  // a paid-undone invoice beside a still-'matched' tx (which the pending-only matcher could
  // never resurface). Cover both the direct invoice_id link and any bank_tx_invoices join rows.
  //
  // [UNDO-SCOPED] Two hardenings over the old blunt detach:
  //  1. SCOPED to this invoice: a tx that also paid OTHER invoices (a batch booked via
  //     book_bank_batch) keeps its status and the siblings' join rows — only OUR link goes.
  //     The old clearPaymentLinks(tx) wiped the whole batch's reversal index and flipped a
  //     still-partially-valid payment back to 'pending'.
  //  2. ROLLBACK on a failed status write (mirrors /api/bank/unlink): the join rows are
  //     snapshotted WITH amount_applied and restored, tx status/invoice_id restored, and
  //     amount_paid recomputed — never "links destroyed but invoice still paid".

  // Snapshot this invoice's join rows (amount_applied included — a rollback must restore it,
  // it is what recompute_invoice_amount_paid sums).
  // [MANUAL-PARTIAL-PAY] `id` and the manual columns come along: a manual instalment has
  // transaction_id NULL, so a rollback keyed on (transaction_id, invoice_id) would be
  // meaningless for it — NULLs never conflict, so the upsert would INSERT duplicates and
  // inflate amount_paid. Keyed on the primary key instead, the restore is exact for both
  // kinds of row.
  // [UNDO-READ-CLOSED] Every read below is FAIL-CLOSED, and that is the whole point of doing them
  // first. They all ran with the error dropped, so a transient failure came back as an empty
  // snapshot — which does not mean "no links", it means "we do not know the links". The undo then
  // walked on anyway and did exactly the damage this route exists to prevent:
  //   · the delete further down runs unconditionally, so the join rows go — while the snapshot
  //     that the rollback restores from is empty, making the rollback a no-op;
  //   · a tx linked ONLY through the join table never reaches linkedTxIds, so it stays 'matched'
  //     with nothing pointing at it while the invoice returns to 'received' — the invoice is
  //     payable a second time and its payment is unreachable to re-link. That is defect [15] in
  //     this file's own header, reintroduced by a dropped error;
  //   · a failed `otherRows` read reads as "not a batch", so a tx that also pays OTHER invoices
  //     gets flipped back to 'pending' underneath them.
  // Nothing has been written at this point, so refusing here is genuinely free: the owner gets
  // "er is niets gewijzigd" and it is true.
  const readFailed = (what: string, message: string) => {
    console.error("[UNDO-READ-CLOSED] undo aborted before any write — could not read", { what, invoiceId, userId: user.id, message });
    return NextResponse.json(
      {
        error: "undo_read_failed",
        detail: "We konden de gekoppelde betalingen nu niet lezen. Er is niets gewijzigd — probeer het zo meteen opnieuw.",
      },
      { status: 503 }
    );
  };

  const { data: myLinkRowsRaw, error: myLinksErr } = await pipeline
    .from("bank_tx_invoices")
    .select("id, transaction_id, amount_applied, paid_on, method, client_key")
    .eq("user_id", user.id)
    .eq("invoice_id", invoiceId);
  if (myLinksErr) return readFailed("bank_tx_invoices", myLinksErr.message);
  const myLinks = (myLinkRowsRaw ?? []) as {
    id: string; transaction_id: string | null; amount_applied: number | null;
    paid_on: string | null; method: string | null; client_key: string | null;
  }[];

  const { data: directTx, error: directTxErr } = await pipeline
    .from("bank_transactions").select("id").eq("user_id", user.id).eq("invoice_id", invoiceId).eq("status", "matched");
  if (directTxErr) return readFailed("bank_transactions", directTxErr.message);

  const linkedTxIds = new Set<string>();
  for (const t of directTx ?? []) if (t.id) linkedTxIds.add(t.id);
  for (const l of myLinks) if (l.transaction_id) linkedTxIds.add(l.transaction_id);

  // Per-tx prior state + "does it also pay other invoices?" (batch detection).
  const txPrev = new Map<string, { status: string | null; invoice_id: string | null; hasOthers: boolean }>();
  for (const txId of linkedTxIds) {
    const [{ data: txRow, error: txErr }, { data: otherRows, error: othersErr }] = await Promise.all([
      pipeline.from("bank_transactions").select("status, invoice_id").eq("id", txId).eq("user_id", user.id).maybeSingle(),
      pipeline.from("bank_tx_invoices").select("id").eq("user_id", user.id).eq("transaction_id", txId).neq("invoice_id", invoiceId).limit(1),
    ]);
    if (txErr) return readFailed("bank_transactions row", txErr.message);
    if (othersErr) return readFailed("bank_tx_invoices siblings", othersErr.message);
    // No error and no row: the transaction genuinely is not there any more (a deleted statement).
    // Nothing to detach, and nothing unknown about it.
    if (!txRow) continue;
    txPrev.set(txId, {
      status: (txRow as { status: string | null }).status,
      invoice_id: (txRow as { invoice_id: string | null }).invoice_id,
      hasOthers: (otherRows ?? []).length > 0,
    });
  }

  // [UNDO-SCOPED] Restore the captured bank state — called when a write below fails, so the
  // detach never survives a failed undo. Best-effort (service role). Defined BEFORE the first
  // destructive write, because from here on every step needs a way back.
  const rollbackBankState = async () => {
    try {
      if (myLinks.length > 0) {
        // Restore by PRIMARY KEY — see the snapshot comment: a manual row's NULL
        // transaction_id makes the (transaction_id, invoice_id) target useless, and a
        // failed undo would then duplicate instalments instead of restoring them.
        await pipeline.from("bank_tx_invoices").upsert(
          myLinks.map((l) => ({
            id: l.id, user_id: user.id, transaction_id: l.transaction_id,
            invoice_id: invoiceId, amount_applied: l.amount_applied,
            paid_on: l.paid_on, method: l.method, client_key: l.client_key,
          })),
          { onConflict: "id" }
        );
      }
      for (const [txId, prev] of txPrev) {
        await pipeline.from("bank_transactions")
          .update({ status: prev.status, invoice_id: prev.invoice_id })
          .eq("id", txId).eq("user_id", user.id);
      }
      await pipeline.rpc("recompute_invoice_amount_paid", { p_user_id: user.id, p_invoice_id: invoiceId });
    } catch { /* best-effort */ }
  };

  // Detach — scoped. Batch tx (hasOthers): keep it 'matched' for the siblings, only drop a
  // direct pointer at US. Single-invoice tx: full detach back to 'pending'.
  for (const [txId, prev] of txPrev) {
    if (prev.hasOthers) {
      if (prev.invoice_id === invoiceId) {
        await pipeline.from("bank_transactions").update({ invoice_id: null }).eq("id", txId).eq("user_id", user.id);
      }
    } else {
      await pipeline.from("bank_transactions")
        .update({ status: "pending", invoice_id: null })
        .eq("id", txId).eq("user_id", user.id);
    }
  }
  // Remove ONLY this invoice's join rows (never the whole tx's set).
  // [UNDO-READ-CLOSED] The delete's own error was dropped too. If it fails, the transactions
  // above are already detached while their links survive — so put the bank state back and say so,
  // rather than continuing to mark the invoice unpaid on top of payments that still exist.
  const { error: delErr } = await pipeline.from("bank_tx_invoices").delete().eq("user_id", user.id).eq("invoice_id", invoiceId);
  if (delErr) {
    await rollbackBankState();
    console.error("[UNDO-READ-CLOSED] link delete failed — bank state restored", { invoiceId, userId: user.id, message: delErr.message });
    return NextResponse.json(
      { error: "undo_failed", detail: "De betaling kon niet worden losgekoppeld. Er is niets gewijzigd — probeer het zo meteen opnieuw." },
      { status: 503 }
    );
  }
  // Reconcile amount_paid from surviving links (0 once all are cleared). Atomic.
  // [UNDO-READ-CLOSED] The try/catch around this never fired (supabase-js reports an rpc failure
  // in `error`, it does not throw), so a failed recompute left amount_paid standing on links that
  // no longer exist: the invoice would return to 'received' still claiming "Deels betaald · € X
  // open" for money nobody paid, and the pay dialog would cap the owner at that invented
  // remainder. Roll back and refuse instead — the invoice write has not happened yet.
  const { error: recomputeErr } = await pipeline.rpc("recompute_invoice_amount_paid", { p_user_id: user.id, p_invoice_id: invoiceId });
  if (recomputeErr) {
    await rollbackBankState();
    console.error("[UNDO-READ-CLOSED] recompute failed — bank state restored", { invoiceId, userId: user.id, message: recomputeErr.message });
    return NextResponse.json(
      { error: "undo_failed", detail: "De betaling kon niet worden teruggedraaid. Er is niets gewijzigd — probeer het zo meteen opnieuw." },
      { status: 503 }
    );
  }

  const restoredStatus = isIncoming ? "received" : "sent";
  // [MANUAL-PARTIAL-PAY] Two shapes of undo:
  //  · a FULLY paid invoice returns to its open status (unchanged behaviour, and the
  //    `.eq('status','paid')` keeps it race-proof: two undos, only one wins).
  //  · a PARTLY paid one is already open — only the payment traces are wiped. Requiring
  //    status 'paid' there would match zero rows and report a false failure, and the
  //    payment fields (a first instalment stamps payment_date) would linger on an
  //    invoice that is back to nothing-paid.
  // amount_paid itself is already recomputed to 0 by the RPC above, once its links are gone.
  const undoQuery = supabase
    .from("invoices")
    .update({ status: restoredStatus, payment_method: null, marked_paid_at: null, payment_date: null, payment_prepared_at: null })
    .eq("id", invoiceId);
  const { data: undoData, error: undoErr } = await (wasFullyPaid
    ? undoQuery.eq("status", "paid")
    : undoQuery.in("status", isIncoming ? ["received"] : ["sent", "overdue"])
  ).select("id");
  if (undoErr) {
    await rollbackBankState();
    if (undoErr.message?.toLowerCase().includes("verwerkt")) {
      return NextResponse.json({ error: "verwerkt", invoiceNumber: inv.invoice_number }, { status: 409 });
    }
    return NextResponse.json({ error: "undo_failed", detail: undoErr.message }, { status: 500 });
  }
  // [PAY-GUARD] Honest zero-row report: if the row raced away from 'paid'
  // between the pre-check and this write, say so instead of claiming success.
  if (!undoData || undoData.length === 0) {
    await rollbackBankState();
    return NextResponse.json({ error: "status_conflict", detail: "factuur is niet (meer) betaald" }, { status: 409 });
  }

  await logAuditAction({
    userId: user.id, action: "invoice.status_changed", entityType: "invoice", entityId: invoiceId,
    oldValue: { status: "paid" }, newValue: { status: restoredStatus, via: "manual_undo_toggle", detached_transactions: [...linkedTxIds] },
    ipAddress: getClientIP(req),
  });
  await reconcileCashWithRetry(supabase, user.id);
  return NextResponse.json({ ok: true, status: restoredStatus, detached: linkedTxIds.size });
}
