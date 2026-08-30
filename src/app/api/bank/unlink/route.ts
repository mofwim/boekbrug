// src/app/api/bank/unlink/route.ts
// [BANK-UNLINK] Undo a confirmed bank↔invoice match — the reverse of /api/bank/confirm.
// "Quiet by default" means the app books near-certain payments on its own; that is only
// trustworthy if the owner can undo any single booking. This detaches the bank line and
// puts the invoice back to unpaid, so a wrong auto-booking is one tap to reverse.
//
// Scope: BOTH single-invoice and multi-invoice batch payments. A single line detaches + restores
// its one invoice; a batch (reference lists >1 number, auto-booked or manually multi-confirmed)
// is reversed as a whole via unlinkBatch — every invoice this payment paid goes back to unpaid.
// Auto-booking is only trustworthy if EVERYTHING it books is one tap to undo, batches included.
//
// Guards mirror confirm: owner-pinned, and a 'verwerkt' invoice (the accountant already
// processed it, B.4) is refused — you must ask the accountant to undo processing first.
// BTW/omzet are on accrual (invoice date), so this only resets the paid/linked status.

import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { createPipelineClient } from "@/lib/supabase-pipeline";
import { parseReferenceNumbers, normalizeRef } from "@/lib/bank-matching";
import { invoiceIdsForTransactions, invoicesClaimedByOtherTx, clearPaymentLinks } from "@/lib/bank-tx-links";
import { reportHandledFailure } from "@/lib/report-handled";
import { fetchAllRows } from "@/lib/supabase-paginate";
import { logAuditAction } from "@/lib/audit";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let body: { transactionId?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }
  const transactionId = body.transactionId;
  if (!transactionId) return NextResponse.json({ error: "missing_transaction" }, { status: 400 });

  const pipeline = createPipelineClient();

  // 1. The transaction — owner-pinned. Must currently be linked to an invoice.
  const { data: tx, error: txErr } = await pipeline
    .from("bank_transactions")
    .select("id, user_id, invoice_id, status, reference, amount")
    .eq("id", transactionId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (txErr) return NextResponse.json({ error: "transaction_lookup_failed", detail: txErr.message }, { status: 500 });
  if (!tx) return NextResponse.json({ error: "transaction_not_found" }, { status: 404 });
  if (!tx.invoice_id) return NextResponse.json({ error: "not_linked" }, { status: 409 });

  // [BANK-BATCH-UNLINK] A multi-invoice batch (auto-booked by runBankAutoConfirm or manually
  // multi-confirmed) is reversed as a WHOLE: every invoice whose number is in this payment's
  // reference and is currently paid-by-bank is put back to unpaid, and the bank line detached.
  // Without this, an auto-booked batch would be irreversible — violating the "everything the app
  // books, the owner can undo" rule that makes quiet auto-booking trustworthy.
  const refNums = parseReferenceNumbers(tx.reference);
  // [BANK-ONE-PAYMENT-MANY-INVOICES] Route on the FACT of how many invoices this payment paid —
  // the join table — not only on how many number tokens the reference happens to carry. The
  // extractor mutilates any invoice number with a prefix or a separator ("2026-045, 2026-046" is
  // stored as "045, 046"), and it can leave a bundle with a single token or none at all. Undoing
  // such a payment through the single path would reverse only the LAST invoice and leave the
  // others paid with their bank line gone — an invisible, unreachable half-reversal.
  // [LINKS-READ-HONEST] This read DECIDES the branch, so it may not fail quietly. It used to
  // answer "[]" on a read error, and with a mutilated reference (the extractor stores
  // "2026-045, 2026-046" as "045, 046" — one usable token or none) that sends a real batch down
  // the SINGLE path: one invoice restored, the siblings left paid with their bank line detached
  // and their join rows cleared. Refuse instead; nothing has been written yet, so a retry is free.
  let linkedIds: string[];
  try {
    linkedIds = await invoiceIdsForTransactions(pipeline, user.id, [transactionId]);
  } catch (e) {
    return NextResponse.json(
      { error: "links_lookup_failed", detail: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
  // [BANK-UNLINK-ROUTE-FACTS] The join table outranks the token count. A SINGLE deelbetaling
  // whose transfer text happens to carry two number-shaped tokens ("Klantnr 884512 Factuur
  // 20260041" → stored reference "884512, 20260041") used to be routed into unlinkBatch, which
  // resolves its reversal set from PAID invoices only — a partly-paid invoice resolved to
  // NOTHING: the line was detached, its €500 link row wiped, amount_paid/payment_method left
  // standing as a phantom settlement, and {ok, restored:0} reported success. When the join
  // table says exactly ONE invoice was paid, take the single path — it handles partials
  // correctly. The token heuristic survives only for legacy lines with no join rows at all,
  // where it is the only signal there is.
  if (linkedIds.length > 1 || (linkedIds.length === 0 && refNums.length > 1)) {
    return unlinkBatch({ pipeline, payClient: supabase, userId: user.id, transactionId, tx, refNums });
  }

  // 2. The invoice — need its direction (to restore the right unpaid status) and the
  //    verwerkt guard.
  const invoiceId = tx.invoice_id as string;
  const { data: inv, error: invErr } = await pipeline
    .from("invoices")
    // [PARTIAL-PAY] Also read amount_paid + total + payment_date so we can undo the EXACT amount
    // this payment applied (an instalment), not force the whole invoice back to unpaid.
    .select("id, direction, status, accountant_status, amount_paid, total_inc_btw, payment_date")
    .eq("id", invoiceId)
    .or(`sender_id.eq.${user.id},receiver_id.eq.${user.id}`)
    .maybeSingle();
  if (invErr) return NextResponse.json({ error: "invoice_lookup_failed", detail: invErr.message }, { status: 500 });
  if (!inv) return NextResponse.json({ error: "invoice_not_found" }, { status: 404 });
  if (inv.accountant_status === "verwerkt") {
    return NextResponse.json({ error: "verwerkt" }, { status: 409 });
  }

  // [PARTIAL-PAY] How much did THIS payment apply to the invoice? The per-link amount_applied is
  // authoritative; fall back to the tx magnitude for a pre-migration link (amount_applied NULL).
  // Undoing a payment lowers amount_paid by exactly this — so an invoice fully paid by two
  // instalments drops back to "€400 van €1000" when you unlink the second one, not to fully unpaid.
  //
  // [PARTIAL-PAY-INVARIANT] The error is READ, not swallowed — the same rule this route states a
  // hundred lines down about the recompute, which this line quietly broke.
  //
  // The fallback exists for ONE situation: a link that predates amount_applied, where the whole
  // transaction is this invoice's payment and tx.amount is therefore the right number. A FAILED
  // READ is a different situation entirely, and it was landing in the same branch. On a split
  // transaction — €500 divided over two invoices by /api/bank/allocate — the share here is €300
  // and tx.amount is €500, so a hiccup would subtract the whole line from one invoice and leave a
  // paid invoice reading as unpaid. That is the state that sends a reminder to a customer who
  // already paid.
  //
  // Refusing costs nothing: this read happens BEFORE the detach, so nothing has been written yet
  // and the owner can retry once the hiccup passes.
  const { data: linkRow, error: linkErr } = await pipeline
    .from("bank_tx_invoices")
    .select("amount_applied")
    .eq("transaction_id", transactionId)
    .eq("invoice_id", invoiceId)
    .maybeSingle();
  if (linkErr) {
    console.error("[PARTIAL-PAY-INVARIANT] could not read the payment share — refusing to unlink", {
      invoiceId, userId: user.id, transactionId, message: linkErr.message,
    });
    return NextResponse.json(
      { error: "We konden niet nakijken welk deel van deze betaling bij deze factuur hoort. Er is niets gewijzigd — probeer het zo meteen opnieuw." },
      { status: 503 },
    );
  }
  const appliedAmount = Math.abs(Number(linkRow?.amount_applied ?? tx.amount ?? 0));
  const priorPaid = Math.max(0, Number(inv.amount_paid ?? 0));
  const newPaid = Math.max(0, priorPaid - appliedAmount);

  // 3. Detach the bank line FIRST → back to pending, no invoice_id. Order matters: if the
  //    invoice restore (step 4) then fails we roll THIS back, so we never end on the worse
  //    half-state the reviewer flagged — a restored (unpaid) invoice with a bank line still
  //    'matched' pointing at it, which the matcher (pending-only) would never resurface.
  //    Only detach OUR link (invoice_id guard) so a concurrent re-link is never clobbered.
  const { data: detachData, error: unlinkErr } = await pipeline
    .from("bank_transactions")
    .update({ status: "pending", invoice_id: null })
    .eq("id", transactionId)
    .eq("user_id", user.id)
    .eq("invoice_id", invoiceId)
    .select("id");
  if (unlinkErr) {
    return NextResponse.json({ error: "unlink_failed", detail: unlinkErr.message }, { status: 500 });
  }
  // [BANK-UNLINK-RACE] A 0-row detach (no error) means the tx was re-linked away from this
  // invoice between our fetch and this write. We must NOT then un-pay the invoice — its bank
  // line was never detached here, so restoring it would leave an inconsistent state. Bail as a
  // conflict; nothing was changed, so the owner can safely retry once the state settles.
  if (!detachData || detachData.length === 0) {
    return NextResponse.json({ error: "conflict" }, { status: 409 });
  }

  // 4. Restore the invoice. SESSION client so the B.4 trigger has auth context. incoming →
  //    'received', else 'sent'. 'overdue' is never stored (recomputed from due_date), and
  //    'processing' invoices are excluded from matching (isEligible), so by construction the
  //    prior open status was received/sent — restoring by direction is exact, not a guess.
  //
  //    [PARTIAL-PAY] Two cases:
  //      (a) the invoice was fully 'paid' → removing this payment un-completes it: back to the
  //          open status, amount_paid lowered by this payment's share. If instalments remain
  //          (newPaid > 0) it becomes a partial-open invoice again and keeps its first-instalment
  //          date + payment_method; if nothing remains it is a clean unpaid invoice (dates cleared).
  //      (b) the invoice was already partial-open (never 'paid') → status is untouched; we only
  //          lower amount_paid (to 0 when this was its only instalment).
  // [PAYDATE-REDERIVE] The payment_date written below is the invoice's CURRENT one, which after
  // removing the first of several instalments describes money that just left. It is deliberately
  // left as an optimistic value: recompute_invoice_amount_paid runs a few lines down and re-derives
  // both date and method from the EARLIEST surviving link, so the correct value lands there.
  // Writing null here instead would be worse on the failure path — if that best-effort recompute
  // ever fails we would have dropped the date entirely rather than merely kept a stale one.
  const restoredStatus = inv.direction === "incoming" ? "received" : "sent";
  const stillHasPayment = newPaid > 0;
  if (inv.status === "paid") {
    const { error: payErr } = await supabase
      .from("invoices")
      .update({
        status: restoredStatus,
        amount_paid: newPaid,
        payment_method: stillHasPayment ? "bank" : null,
        marked_paid_at: null,
        payment_date: stillHasPayment ? inv.payment_date : null,
      })
      .eq("id", invoiceId)
      .eq("status", "paid");
    if (payErr) {
      // Restore failed → re-link the bank line to its captured prior state so we don't leave
      // a detached line beside a still-paid invoice. Then surface the reason.
      await pipeline
        .from("bank_transactions")
        .update({ status: tx.status, invoice_id: invoiceId })
        .eq("id", transactionId)
        .eq("user_id", user.id);
      if (payErr.message?.toLowerCase().includes("verwerkt")) {
        return NextResponse.json({ error: "verwerkt" }, { status: 409 });
      }
      return NextResponse.json({ error: "restore_failed", detail: payErr.message }, { status: 500 });
    }
  } else if (priorPaid > 0) {
    // Partial-open invoice: status stays open; just lower the running total by this instalment.
    const { error: payErr } = await supabase
      .from("invoices")
      .update({
        amount_paid: newPaid,
        payment_method: stillHasPayment ? "bank" : null,
        payment_date: stillHasPayment ? inv.payment_date : null,
      })
      .eq("id", invoiceId);
    if (payErr) {
      await pipeline
        .from("bank_transactions")
        .update({ status: tx.status, invoice_id: invoiceId })
        .eq("id", transactionId)
        .eq("user_id", user.id);
      return NextResponse.json({ error: "restore_failed", detail: payErr.message }, { status: 500 });
    }
  }

  // [BANK-TX-INVOICES] The bank line is detached but the row survives (status pending), so the FK
  // cascade does NOT fire — clear the join row explicitly so a re-book starts from a clean index.
  // [LINKS-WRITE-HONEST] The boolean is READ. clearPaymentLinks returns it precisely so a failed
  // delete can be reported, and both call sites in this route threw it away — which inverts the
  // recompute below rather than merely losing a log line. That recompute derives
  // `amount_paid = Σ bank_tx_invoices.amount_applied` from the links that SURVIVE, so a failed
  // clear makes it restore the amount the optimistic decrement just took off: the unlink answers
  // ok, the invoice stays paid for money no longer on any bank line, and the detached line is
  // free to be booked again. The same euros, twice.
  const linksCleared = await clearPaymentLinks(pipeline, user.id, transactionId);

  // [PARTIAL-PAY] Authoritatively reconcile amount_paid to the SURVIVING links, under a row lock.
  // The JS decrement above is a fast optimistic write; this atomic recompute is order-independent,
  // so two near-simultaneous unlinks of different instalments of the same invoice can never leave a
  // phantom amount_paid — both converge on the true remaining sum (0 when no links remain).
  // [PARTIAL-PAY-INVARIANT] The error is READ, not swallowed. supabase-js does not throw on an RPC
  // failure — it answers { data, error } — so the try/catch this replaced could never have caught
  // anything, and a failed recompute of the one function that maintains
  // `amount_paid = Σ bank_tx_invoices.amount_applied` was completely invisible.
  //
  // Still non-fatal HERE, and that is a real difference from the batch path below: the optimistic
  // JS decrement a few lines up already wrote the right number for the ordinary case. What the
  // recompute adds is order-independence under concurrent unlinks — so a failure means that
  // protection is gone, not that the balance is wrong. Logged loudly and carried into the audit
  // trail, because "silently unprotected" is exactly the state nobody would ever notice.
  const { error: recomputeErr } = await pipeline.rpc("recompute_invoice_amount_paid", { p_user_id: user.id, p_invoice_id: invoiceId });
  if (recomputeErr) {
    console.error("[PARTIAL-PAY-INVARIANT] recompute failed after unlink — optimistic amount_paid stands", {
      invoiceId, userId: user.id, transactionId, message: recomputeErr.message,
    });
  }
  if (!linksCleared) {
    // Loud, and never only in a console line an hourly job nobody reads: this is the state where
    // an invoice claims money that has no bank line behind it any more.
    reportHandledFailure({
      tag: "BANK-TX-INVOICES",
      message: "payment links survived an unlink — the invoice still counts money that was detached",
      severity: "data-integrity",
      context: { userId: user.id, invoiceId, transactionId },
    });
  }

  await logAuditAction({
    userId: user.id,
    action: "bank.unlinked",
    entityType: "invoice",
    entityId: invoiceId,
    newValue: {
      transaction_id: transactionId,
      restored_status: restoredStatus,
      // [PARTIAL-PAY-INVARIANT] So an accountant reconstructing this a year later can see that the
      // authoritative recompute did not run, rather than wondering why a balance drifted.
      ...(recomputeErr ? { recompute_failed: true } : {}),
      // …and the same for the links, which is the failure that makes the recompute lie.
      ...(linksCleared ? {} : { links_not_cleared: true }),
    },
  });

  return NextResponse.json({ ok: true });
}

// [BANK-BATCH-UNLINK] Reverse a whole multi-invoice batch: put every invoice this payment paid
// back to unpaid and detach the bank line. The batch's invoices are exactly the ones, owned by
// this user and currently paid-by-bank, whose number appears in the payment's reference — the
// same reference-coverage identity the manual confirm + auto-book used to create the batch.
async function unlinkBatch(args: {
  pipeline: ReturnType<typeof createPipelineClient>;
  payClient: Awaited<ReturnType<typeof createServerSupabaseClient>>;
  userId: string;
  transactionId: string;
  tx: { invoice_id: string | null; status: string | null; amount: number | null };
  refNums: string[];
}): Promise<NextResponse> {
  const { pipeline, payClient, userId, transactionId, tx, refNums } = args;
  const linkedInvoiceId = tx.invoice_id;
  if (!linkedInvoiceId) return NextResponse.json({ error: "not_linked" }, { status: 409 });

  // [BANK-TX-INVOICES] The reversal set is built id-first, number-second, so it is BOTH
  // collision-free AND complete:
  //  (1) the exact invoice ids this transaction paid, recorded in the join table at booking time —
  //      reversing by id can only ever touch the invoices this payment actually paid, never an
  //      unrelated invoice that shares a number (numbers are not unique across suppliers/directions).
  //  (2) GAP-FILL: a PRE-migration batch only backfilled its representative id (the migration can't
  //      reconstruct the older siblings). For any reference number NOT already covered by an id-link,
  //      we fall back to a number match — GUARDED to the batch's direction so a same-number invoice
  //      of the opposite direction is never wrongly un-paid (the MED-3 collision). A freshly-booked
  //      batch is fully id-covered, so (2) adds nothing for it → no number-collision surface at all.
  // [LINKS-READ-HONEST] A failed read here would silently shrink the reversal set to the
  // representative alone, so it throws and we refuse before touching anything.
  let linkIds: string[];
  try {
    linkIds = await invoiceIdsForTransactions(pipeline, userId, [transactionId]);
  } catch (e) {
    return NextResponse.json(
      { error: "links_lookup_failed", detail: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
  const idSet = new Set(linkIds);
  idSet.add(linkedInvoiceId); // the linked representative is always part of the batch

  // The user's paid-by-bank invoices (owner-pinned). We resolve the batch from these in code.
  //
  // [PAGINATE] Paged past PostgREST's silent ~1000-row cap, with a stable order. This was a plain
  // .select(), and the batch is resolved by FILTERING this list in JS below — so an invoice that
  // fell outside the first (arbitrarily ordered) page was simply absent from `byId`, never
  // restored, and never reported. Meanwhile the bank line is detached and clearPaymentLinks wipes
  // its join rows regardless, leaving that invoice paid by a payment that no longer exists, with
  // no bank line to undo it from — while this route answers `ok: true, restored: N`. The set is
  // account-wide and all-time (status paid + payment_method bank), so a few busy years reach the
  // cap; supabase-paginate.ts documents this exact trap and every other read in this flow obeys it.
  let paid: {
    id: string; invoice_number: string | null; direction: string | null; status: string | null;
    accountant_status: string | null; marked_paid_at: string | null; payment_date: string | null;
    amount_paid: number | null;
  }[];
  try {
    paid = await fetchAllRows((from, to) =>
      pipeline
        .from("invoices")
        // [PARTIAL-PAY] amount_paid travels with the row so the rollback below can put it back —
        // the sibling reversal (delete-statement) already did this and this one did not.
        .select("id, invoice_number, direction, status, accountant_status, marked_paid_at, payment_date, amount_paid")
        .or(`sender_id.eq.${userId},receiver_id.eq.${userId}`)
        .eq("status", "paid")
        .eq("payment_method", "bank")
        .order("id", { ascending: true })
        .range(from, to),
    );
  } catch (e) {
    return NextResponse.json(
      { error: "invoice_lookup_failed", detail: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }

  // (1) exact id-linked part
  const byId = new Map<string, (typeof paid)[number]>();
  for (const inv of paid) if (idSet.has(inv.id)) byId.set(inv.id, inv);
  // (2) direction-guarded number gap-fill for reference numbers no id-link covers.
  //     Direction = the representative invoice's direction, or (if it is no longer paid-by-bank —
  //     e.g. re-marked cash — so `rep` is undefined) the bank movement's sign, so the gap-fill can
  //     never silently disable itself. A null/zero amount with no representative → skip (we don't
  //     guess a direction). A batch is one supplier/customer → exactly one direction.
  const rep = paid.find((i) => i.id === linkedInvoiceId);
  const signDir: "incoming" | "outgoing" | null =
    (tx.amount ?? 0) < 0 ? "incoming" : (tx.amount ?? 0) > 0 ? "outgoing" : null;
  const batchDir = (rep?.direction as "incoming" | "outgoing" | null) ?? signDir;
  const coveredNums = new Set<string>();
  for (const inv of byId.values()) coveredNums.add(normalizeRef(inv.invoice_number ?? ""));
  const uncovered = new Set(refNums.filter((n) => !coveredNums.has(n)));
  if (batchDir && uncovered.size > 0) {
    // Candidates: paid-by-bank invoices in the batch direction whose number is an uncovered ref
    // number. Exclude any that are id-linked to ANOTHER transaction — those provably belong to a
    // different payment (a same-number stray), never to this batch. Only a genuinely un-linked
    // pre-migration sibling survives the exclusion.
    const candidates = paid.filter(
      (inv) => inv.direction === batchDir && uncovered.has(normalizeRef(inv.invoice_number ?? "")),
    );
    // [LINKS-READ-HONEST] This is the guard that keeps a same-number stray out of the batch, so
    // it may not fail open: without it every candidate would be swept in and an invoice belonging
    // to a different payment would be un-paid. Nothing is written yet — refuse and let it retry.
    let claimed: Set<string>;
    try {
      claimed = await invoicesClaimedByOtherTx(pipeline, userId, candidates.map((c) => c.id), [transactionId]);
    } catch (e) {
      return NextResponse.json(
        { error: "links_lookup_failed", detail: e instanceof Error ? e.message : String(e) },
        { status: 500 },
      );
    }
    for (const inv of candidates) if (!claimed.has(inv.id)) byId.set(inv.id, inv);
  }
  const batch = [...byId.values()];

  // A 'verwerkt' invoice anywhere in the batch blocks the whole reversal (accrual is locked by the
  // accountant) — refuse before touching anything.
  if (batch.some((i) => i.accountant_status === "verwerkt")) {
    return NextResponse.json({ error: "verwerkt" }, { status: 409 });
  }

  // Detach the bank line FIRST (same ordering as the single path), guarded to OUR link so a
  // concurrent re-link is never clobbered. A 0-row detach → the link moved under us → conflict.
  const { data: detachData, error: unlinkErr } = await pipeline
    .from("bank_transactions")
    .update({ status: "pending", invoice_id: null })
    .eq("id", transactionId)
    .eq("user_id", userId)
    .eq("invoice_id", linkedInvoiceId)
    .select("id");
  if (unlinkErr) return NextResponse.json({ error: "unlink_failed", detail: unlinkErr.message }, { status: 500 });
  if (!detachData || detachData.length === 0) return NextResponse.json({ error: "conflict" }, { status: 409 });

  // Restore each invoice to unpaid (idempotent via .eq('status','paid')). On any failure, re-pay
  // what we already restored and re-link the bank line, so we never leave a half-reversed batch.
  // [MED-2] Re-pay restores the ORIGINAL marked_paid_at + payment_date, not just paid/bank, so a
  // rollback never loses the settlement date (which attributes the payment to the right quarter).
  // [PARTIAL-PAY] amount_paid is captured too, so a rollback restores the invoice to exactly what
  // it was. Without it a failed batch reversal put the invoice back to 'paid' with amount_paid 0
  // — paid and fully outstanding at the same time. Harmless on screen (openstaand is 0 by status)
  // and it self-heals at the next recompute, but the sibling route (delete-statement) already
  // restored it and two reversals of the same shape should not disagree about what "back" means.
  const restored: { id: string; marked_paid_at: string | null; payment_date: string | null; amount_paid: number | null }[] = [];
  for (const inv of batch) {
    const restoredStatus = inv.direction === "incoming" ? "received" : "sent";
    const { error: payErr } = await payClient
      .from("invoices")
      // [PARTIAL-PAY] Reset amount_paid too — the whole batch payment is being undone, so its share
      // of every invoice goes to 0. Without this a pre-migration batch invoice (backfilled to
      // amount_paid=|total|) would read €0-openstaand while unpaid AND block re-booking (the RPC sees
      // remaining=0 → "already covered"). The recompute pass below reconciles it authoritatively.
      .update({ status: restoredStatus, amount_paid: 0, payment_method: null, marked_paid_at: null, payment_date: null })
      .eq("id", inv.id)
      .eq("status", "paid");
    if (payErr) {
      for (const r of restored) {
        await payClient
          .from("invoices")
          // `?? undefined` leaves the column untouched when the original was NULL (an undefined
          // value is dropped from the JSON body), which is the same thing delete-statement does.
          .update({ status: "paid", payment_method: "bank", amount_paid: r.amount_paid ?? undefined, marked_paid_at: r.marked_paid_at, payment_date: r.payment_date })
          .eq("id", r.id)
          .neq("status", "paid");
      }
      await pipeline.from("bank_transactions").update({ status: tx.status ?? "matched", invoice_id: linkedInvoiceId }).eq("id", transactionId).eq("user_id", userId);
      if (payErr.message?.toLowerCase().includes("verwerkt")) return NextResponse.json({ error: "verwerkt" }, { status: 409 });
      return NextResponse.json({ error: "restore_failed", detail: payErr.message }, { status: 500 });
    }
    restored.push({ id: inv.id, marked_paid_at: inv.marked_paid_at, payment_date: inv.payment_date, amount_paid: inv.amount_paid });
  }

  // [BANK-TX-INVOICES] Row survives the detach (status pending) → clear its join rows explicitly.
  // [LINKS-WRITE-HONEST] The boolean is read here too, and the stakes are HIGHER than on the
  // single path: every invoice in this batch was forced to amount_paid = 0 on the promise that the
  // recompute below reconciles it. That recompute sums the SURVIVING links — so a failed clear
  // does not leave the batch as it was, it restores every one of them to fully paid while this
  // route answers ok and the detached bank line is offered for re-booking.
  const linksCleared = await clearPaymentLinks(pipeline, userId, transactionId);

  // [PARTIAL-PAY] Authoritatively reconcile amount_paid for EVERY invoice this payment had a
  // link to — the id-linked set, not only `restored`. The difference is exactly the invoices
  // this payment settled PARTIALLY (status never 'paid', so the paid-by-bank batch resolution
  // above cannot see them): their link rows were just wiped with clearPaymentLinks, and without
  // a recompute their amount_paid kept claiming money whose links no longer exist — a phantom
  // settlement that shrank the debiteuren/aging balance while the fully-detached bank line
  // offered its full amount for re-booking: the same euros twice. delete-statement fixes this
  // identical hole by iterating its whole affected set; this is the same rule here.
  // Best-effort + atomic (row-locked, order-independent).
  // [PARTIAL-PAY-INVARIANT] This one is NOT the same as the single-invoice path, and the old
  // "non-fatal" comment obscured the difference. There, an optimistic decrement had already written
  // a sensible number. HERE every invoice in the batch was forced to `amount_paid = 0` on the
  // explicit promise that this recompute reconciles it — and for an invoice that ALSO carries an
  // instalment from a DIFFERENT bank line, 0 is simply wrong. It then reads as more open than it is,
  // which is the direction that makes an owner pay the same money twice.
  //
  // The try/catch could never fire: supabase-js returns { data, error } on an RPC and does not
  // throw. So the failure was not merely tolerated, it was unobservable.
  const affected = new Set<string>([...idSet, ...restored.map((r) => r.id)]);
  if (!linksCleared) {
    reportHandledFailure({
      tag: "BANK-TX-INVOICES",
      message: "payment links survived a batch unlink — every invoice in it still counts detached money",
      severity: "data-integrity",
      context: { userId, transactionId, invoices: affected.size },
    });
  }
  const staleBalances: string[] = [];
  for (const id of affected) {
    const { error: recErr } = await pipeline.rpc("recompute_invoice_amount_paid", { p_user_id: userId, p_invoice_id: id });
    if (recErr) {
      staleBalances.push(id);
      console.error("[PARTIAL-PAY-INVARIANT] recompute failed after batch unlink — amount_paid may understate what is applied", {
        invoiceId: id, userId, transactionId, message: recErr.message,
      });
    }
  }
  // A partial invoice whose settlement just dropped to zero must not keep advertising a payment
  // method/date it no longer has — those fields would resurrect as "paid by bank on <date>" the
  // moment anything re-reads them. Only rows the recompute left at 0 and that are not 'paid'
  // (i.e. precisely the partials this payment alone had been feeding) are touched.
  for (const id of affected) {
    if (restored.some((r) => r.id === id)) continue; // fully-restored rows were already reset above
    try {
      await pipeline
        .from("invoices")
        .update({ payment_method: null, payment_date: null })
        .eq("id", id)
        .neq("status", "paid")
        .eq("amount_paid", 0);
    } catch {
      /* non-fatal — display-only fields; the money figures are already correct */
    }
  }

  await logAuditAction({
    userId,
    action: "bank.unlinked",
    entityType: "bank_transaction",
    entityId: transactionId,
    newValue: {
      transaction_id: transactionId,
      invoice_ids: restored.map((r) => r.id),
      invoice_count: restored.length,
      batch: true,
      // [PARTIAL-PAY-INVARIANT] The ids whose balance could not be re-derived, in the trail rather
      // than only in a log line — this is a money invariant, and an accountant reading this row a
      // year later should not have to guess why a figure drifted.
      ...(staleBalances.length ? { recompute_failed_for: staleBalances } : {}),
      ...(linksCleared ? {} : { links_not_cleared: true }),
    },
  });

  // The unlink itself DID happen — the links are cleared and undoing that would be worse than
  // reporting it. So it succeeds, and says what it could not finish. `balanceWarning` is Dutch
  // because the screen shows it verbatim.
  return NextResponse.json({
    ok: true,
    batch: true,
    restored: restored.length,
    ...(staleBalances.length
      ? {
          balanceWarning:
            `De koppeling is ongedaan gemaakt, maar van ${staleBalances.length === 1 ? "één factuur" : `${staleBalances.length} facturen`} ` +
            `kon het openstaande bedrag niet opnieuw worden berekend. Dat bedrag kan nu te hoog staan — ` +
            `controleer die facturen voordat je ze betaalt.`,
        }
      : {}),
  });
}
