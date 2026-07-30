// src/app/api/bank/confirm/route.ts
// [BOEK-016] Confirm a bank match (phase 4). The HUMAN confirms; this executes.
// [BANK-MULTI-CONFIRM] One transaction can cover SEVERAL invoices (a supplier
//   combines two invoices in one transfer; a customer pays a gebundeld
//   betaalverzoek). Confirming ONE invoice must NOT hide the transaction while
//   money of it still belongs to another invoice. So:
//     - We always pay + link the confirmed invoice (as before).
//     - Each booking may only spend what the payment still HAS: the euros this
//       bank line already put on other invoices (bank_tx_invoices.amount_applied)
//       are subtracted first.
//     - We only flip the transaction to 'matched' when every euro of it sits on an
//       invoice. Otherwise it stays 'pending' so it remains in "Te bevestigen"
//       with the rest of the money still assignable.
// [BANK-ONE-PAYMENT-MANY-INVOICES] That is arithmetic, deliberately. The old rule
//   counted number-shaped tokens in the reference to decide "single or batch?" and
//   then checked that every token had a paid invoice. It was wrong in both
//   directions — a customer number in the description made a €500 instalment book
//   as a full settlement, and a bundle whose numbers the extractor had mutilated
//   ("2026-045, 2026-046" is stored as "045, 046") let one invoice swallow a
//   payment meant for two. The amounts answer both questions without guessing.
//
// Writes two things, in legal-priority order:
//   (a) invoice → status 'paid' + payment_method 'bank' + marked_paid_at   (reuses B.3 semantics)
//   (b) bank_transactions → status 'matched' + invoice_id                  (only when allCovered)
//
// Atomicity: Supabase has no REST transaction. We write (a) first (legally the important one).
// If (b) fails, we DO NOT roll back (a) — same philosophy as B.11 ("email failure does not
// block invoice completion"). The only possible half-state is invoice=paid + tx=pending, which
// is benign and self-healing (re-running /api/bank/match surfaces it again). A true-atomic RPC
// can replace the two writes later if desired (no rollback gaps in Dutch tax law).
//
// ⚠️ CRITICAL: the invoice UPDATE uses the SESSION client, never the pipeline (service_role).
//    The verwerkt guard trigger early-returns when auth.uid() IS NULL, so a service_role write
//    would SILENTLY BYPASS the B.4 Conflict Guard. The session client sets auth.uid() → guard fires.

import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { createPipelineClient } from "@/lib/supabase-pipeline";
// [BANK-MULTI-LINK-PERSIST] Coverage logic (parseReferenceNumbers + isFullyCovered)
// now lives in bank-matching.ts so this confirm path and the match path share ONE
// definition — no drift between "is this tx done?" answered in two places.
import { isEligible, normalizeRef, isFullyCovered, parseReferenceNumbers } from "@/lib/bank-matching";
import { recordPaymentLinks } from "@/lib/bank-tx-links";
import { fetchAllRows } from "@/lib/supabase-paginate";
import { openBalanceFromAmounts, paymentExceedsOpenBalance } from "@/lib/partial-payment";
import { logAuditAction } from "@/lib/audit";

export async function POST(req: NextRequest) {
  // 1. Auth
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // 2. Body
  let transactionId: string | undefined;
  let invoiceId: string | undefined;
  try {
    const body = await req.json();
    transactionId = body?.transactionId;
    invoiceId = body?.invoiceId;
  } catch {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }
  if (!transactionId || !invoiceId) {
    return NextResponse.json({ error: "missing_fields" }, { status: 400 });
  }

  const pipeline = createPipelineClient();

  // 3. Ownership + state checks (point 3): the user must own BOTH rows.
  //    [BANK-MULTI-CONFIRM] Also fetch `reference` (the expected invoice numbers)
  //    so we can decide allCovered after the payment.
  const { data: tx, error: txErr } = await pipeline
    .from("bank_transactions")
    .select("id, status, user_id, amount, reference, date")
    .eq("id", transactionId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (txErr) {
    return NextResponse.json({ error: "tx_lookup_failed", detail: txErr.message }, { status: 500 });
  }
  if (!tx) {
    return NextResponse.json({ error: "transaction_not_found" }, { status: 404 });
  }
  if (tx.status !== "pending") {
    return NextResponse.json({ error: "transaction_already_processed" }, { status: 409 });
  }

  const { data: inv, error: invErr } = await pipeline
    .from("invoices")
    // [PARTIAL-PAY] amount_paid decides what this invoice still has OPEN — the guard below
    // refuses to call a payment "full" when it cannot cover that balance.
    .select("id, invoice_number, status, accountant_status, sender_id, receiver_id, direction, total_inc_btw, amount_paid")
    .eq("id", invoiceId)
    .or(`sender_id.eq.${user.id},receiver_id.eq.${user.id}`)
    .maybeSingle();
  if (invErr) {
    return NextResponse.json({ error: "invoice_lookup_failed", detail: invErr.message }, { status: 500 });
  }
  if (!inv) {
    return NextResponse.json({ error: "invoice_not_found" }, { status: 404 });
  }
  if (inv.status === "paid") {
    return NextResponse.json({ error: "invoice_already_paid" }, { status: 409 });
  }
  // Pre-empt B.4 (the trigger is the real guard, but fail fast with a clear signal for the UI).
  if (inv.accountant_status === "verwerkt") {
    return NextResponse.json(
      { error: "verwerkt", invoiceNumber: inv.invoice_number },
      { status: 409 }
    );
  }

  // Defense-in-depth: the write path must enforce the SAME invariants the matcher used to
  // produce the suggestion. Reusing isEligible() (single source of truth) blocks a buggy or
  // crafted client from paying a draft/archived invoice, or pairing a credit with an incoming
  // invoice / a debit with an outgoing one. Legitimate confirmations always pass this.
  const eligible = isEligible(
    {
      date: "",
      amount: tx.amount ?? 0,
      currency: "EUR",
      description: "",
      counterpartName: null,
      counterpartIban: null,
      reference: null,
      transactionId: tx.id,
      rawLine: "",
    },
    {
      id: inv.id,
      invoice_number: inv.invoice_number,
      // [M7-CREDITNOTA] The REAL total, never null. isEligible derives "is this a creditnota"
      // from the sign of this field; passing null made every creditnota look like a normal
      // invoice, flipped the required direction, and rejected every credit-note refund with
      // `not_eligible` — the matcher (which passes the real amount) suggested it, and this
      // guard then refused it. Auto-confirm passes the full row and worked; only the human
      // path was blocked.
      total_inc_btw: inv.total_inc_btw ?? null,
      invoice_date: null,
      due_date: null,
      client_name: null,
      direction: (inv.direction ?? null) as "outgoing" | "incoming" | null,
      status: inv.status,
      accountant_status: inv.accountant_status,
    }
  );
  if (!eligible) {
    return NextResponse.json({ error: "not_eligible" }, { status: 409 });
  }

  // [PARTIAL-PAY] When the money this payment still has fits inside the invoice → the atomic
  // apply_bank_payment RPC. It applies LEAST(payment, remaining), so an amount SMALLER than the
  // invoice balance is recorded as a DEELBETALING — the invoice stays openstaand with the rest
  // tracked (amount_paid), instead of the old behaviour that flipped it to fully 'paid' on the
  // first instalment (a wrong number). It only flips to 'paid' when the instalments together
  // cover the total. Everything the payment had left goes to this one invoice, so the bank line
  // is fully consumed → matched. Session client so the B.4 verwerkt trigger has auth context
  // (the RPC also re-checks verwerkt under its row lock).
  const refNumbers = parseReferenceNumbers(tx.reference);
  const payAmount = Math.abs(tx.amount ?? 0);
  // [BANK-ONE-PAYMENT-MANY-INVOICES] Which path this booking takes is decided by the MONEY, not
  // by how many number-shaped tokens the reference happens to contain.
  //
  //   payment <= what this invoice still owes  → this one invoice absorbs the whole payment
  //                                              (in full, or as an honest deelbetaling)
  //   payment >  what this invoice still owes  → settle this invoice and keep the bank line OPEN
  //                                              for the rest of the money
  //
  // The reference-token count could not answer either question. It said "multi" for a single
  // payment whose description merely carried a customer number — booking a €500 instalment on a
  // €1.815 invoice as fully paid — and it said "single" for a real bundle whose numbers the
  // extractor had mutilated ("2026-045, 2026-046" is stored as "045, 046"), so the €1.100 that
  // paid two invoices was consumed by the first one and the second stayed open forever with its
  // money already spent. Both are the same mistake: guessing intent from text instead of
  // reading the amounts. (refNumbers survives below only as the legacy coverage fallback.)
  const invMoney = inv as { total_inc_btw?: number | null; amount_paid?: number | null };
  const invOpen = openBalanceFromAmounts(invMoney);

  // How much of this bank line is already spent on OTHER invoices. A payment can be confirmed
  // against several invoices one after another, and each booking may only spend what is LEFT —
  // otherwise the second confirmation of a €1.100 payment that already settled €605 would still
  // believe it has €1.100 to give, and would mark a €600 invoice fully paid with €105 that never
  // arrived. bank_tx_invoices.amount_applied records what each booking took, on every path.
  // Read BEFORE any write so a retry can never count our own link twice.
  let appliedElsewhere = 0;
  let appliedElsewhereKnown = true;
  {
    const { data: linkRows, error: linkReadErr } = await pipeline
      .from("bank_tx_invoices")
      .select("invoice_id, amount_applied")
      .eq("user_id", user.id)
      .eq("transaction_id", transactionId);
    if (linkReadErr) {
      appliedElsewhereKnown = false;
    } else {
      for (const r of (linkRows ?? []) as { invoice_id: string; amount_applied: number | null }[]) {
        if (r.invoice_id === invoiceId) continue;
        // A link with no amount is a pre-[PARTIAL-PAY] row: we cannot tell what it settled, so we
        // do not pretend to know what is left. The legacy reference rule takes over below.
        if (r.amount_applied == null) { appliedElsewhereKnown = false; continue; }
        appliedElsewhere += Math.max(0, Number(r.amount_applied));
      }
    }
  }
  // What this payment still has to give. Unknown sibling amounts ⇒ fall back to the full amount,
  // which is exactly how it behaved before per-link amounts existed.
  const payAvailable = appliedElsewhereKnown
    ? Math.round(Math.max(0, payAmount - appliedElsewhere) * 100) / 100
    : payAmount;

  const moneyLeftOver = paymentExceedsOpenBalance(payAvailable, invMoney);
  if (!moneyLeftOver) {
    if (payAvailable <= 0) {
      // Every euro of this bank line is already booked on other invoices — there is nothing left
      // to settle this one with. (The line should already be 'matched'; this is the honest answer
      // if a second confirm arrives anyway.)
      return NextResponse.json({ error: "payment_fully_applied" }, { status: 409 });
    }
    const { data: applyRows, error: applyErr } = await supabase.rpc("apply_bank_payment", {
      p_user_id: user.id,
      p_tx_id: transactionId,
      p_invoice_id: invoiceId,
      p_amount: payAvailable,
      p_pay_date: tx.date ?? null,
    });
    if (applyErr) {
      if (applyErr.message?.toLowerCase().includes("verwerkt")) {
        return NextResponse.json({ error: "verwerkt", invoiceNumber: inv.invoice_number }, { status: 409 });
      }
      if (applyErr.message?.toLowerCase().includes("already fully paid")) {
        return NextResponse.json({ error: "invoice_already_paid" }, { status: 409 });
      }
      return NextResponse.json({ error: "payment_failed", detail: applyErr.message }, { status: 500 });
    }
    // Empty result ⇒ the tx was claimed by a concurrent confirm/auto-book between our checks and
    // the RPC's lock (its mutex re-read saw status ≠ 'pending'). Nothing was written — 409, retryable.
    const row = Array.isArray(applyRows) ? (applyRows[0] as { applied: number; amount_paid: number; total: number; is_paid: boolean } | undefined) : undefined;
    if (!row) {
      return NextResponse.json({ error: "transaction_already_processed" }, { status: 409 });
    }
    const isPaid = row.is_paid === true;
    const remaining = Math.max(0, (row.total ?? 0) - (row.amount_paid ?? 0));
    // [PARTIAL-PAY-RESIDUE] apply_bank_payment clamps with LEAST(payment, remaining), so a
    // payment BIGGER than the balance books only the balance — and the excess used to vanish
    // without a trace while the transaction was still marked fully consumed ('matched'). The
    // money is real: usually the line belongs to another invoice too, or to the wrong invoice
    // entirely. We do not invent a credit balance (a new concept with no screen); we make the
    // leftover VISIBLE so the owner can check it. The pre-tap warning in BankClient says the
    // same thing before the click; this is the record after it.
    // We only reach this branch when the payment does NOT exceed the balance, so a residue now
    // means the balance shrank between our read and the RPC's lock (a concurrent booking) —
    // rare, and exactly the case that must not stay invisible. Measured against what this
    // booking was allowed to spend (payAvailable), not the whole line: euros already booked on
    // other invoices of this same payment are accounted for, not "left over".
    const residue = Math.round((payAvailable - (row.applied ?? 0)) * 100) / 100;
    const hasResidue = residue > 0.01;
    // [BANK-TX-INVOICES] The RPC already wrote the join row (with amount_applied) inside its
    // transaction — no recordPaymentLinks needed here.
    try {
      await pipeline.from("notifications").insert({
        user_id: user.id,
        title: isPaid ? "Factuur betaald" : "Deelbetaling geboekt",
        body: isPaid
          ? `Factuur ${inv.invoice_number ?? ""} is gekoppeld aan een banktransactie en gemarkeerd als betaald.`
          : `Deelbetaling van € ${row.applied.toFixed(2)} geboekt op factuur ${inv.invoice_number ?? ""}. Nog openstaand: € ${remaining.toFixed(2)}.`,
        type: "payment",
      });
      if (hasResidue) {
        await pipeline.from("notifications").insert({
          user_id: user.id,
          title: "Er bleef een bedrag over",
          body: `Van de betaling van € ${payAvailable.toFixed(2)} is € ${(row.applied ?? 0).toFixed(2)} op factuur ${inv.invoice_number ?? ""} geboekt. € ${residue.toFixed(2)} bleef over — controleer of deze betaling ook een andere factuur betreft.`,
          type: "payment",
          link: "/dashboard/bank",
        });
      }
    } catch {
      /* non-blocking */
    }
    if (hasResidue) {
      await logAuditAction({
        userId: user.id,
        action: "bank.overpayment_residue",
        entityType: "invoice",
        entityId: invoiceId,
        newValue: {
          transaction_id: transactionId,
          invoice_number: inv.invoice_number,
          payment_amount: payAmount,
          applied: row.applied,
          residue,
        },
      });
    }
    await logAuditAction({
      userId: user.id,
      action: isPaid ? "bank.confirmed" : "bank.partial_payment",
      entityType: "invoice",
      entityId: invoiceId,
      newValue: {
        transaction_id: transactionId,
        invoice_number: inv.invoice_number,
        applied: row.applied,
        amount_paid: row.amount_paid,
        total: row.total,
        remaining,
        fully_paid: isPaid,
      },
    });
    // allCovered = the TRANSACTION is done (fully consumed by this invoice); `partial` tells the UI
    // the INVOICE still has a balance so it can show "€X van €Y · €Z openstaand".
    // `residue` = what the clamp did NOT book (0 in the normal case).
    return NextResponse.json({ ok: true, allCovered: true, partial: !isPaid, applied: row.applied, remaining, residue });
  }

  // ── The payment still has more to give than this invoice can absorb: settle the invoice in
  //    full and keep the rest of the money reachable on the bank line.

  // 4. Write (a): invoice → paid. SESSION client so the verwerkt trigger fires (auth.uid() set).
  //    Never write `shared` (GENERATED) or 'voldaan' (UI-only).
  const { data: payData, error: payErr } = await supabase
    .from("invoices")
    .update({
      status: "paid",
      payment_method: "bank", // known from a bank match — no Bank/Contant question
      marked_paid_at: new Date().toISOString(),
      // [PARTIAL-PAY] This multi-number-batch branch pays the invoice in FULL, so amount_paid must
      // reach the total — otherwise an invoice that was mid-instalment and is now completed via a
      // batch would keep a stale amount_paid < total. Openstaand is status-gated (paid ⇒ 0) so this
      // is only an internal-consistency fix, but it keeps amount_paid honest for a later unlink.
      amount_paid: Math.abs(inv.total_inc_btw ?? 0),
      // [BANK-PAYDATE] The REAL settlement date is the bank line's date, not now(). A Q1
      // invoice paid in Q2 must carry its true payment day/quarter so the owner and the
      // accountant both see "paid in Q2" — the cross-quarter case, recorded not guessed.
      payment_date: tx.date,
    })
    .eq("id", invoiceId)
    .neq("status", "paid") // idempotent: don't re-pay / reset marked_paid_at on double-submit
    .select("id"); // [BANK-PAY-RACE] know whether THIS request actually paid it

  if (payErr) {
    // B.4 trigger rejection surfaces here → let the UI show the "vraag boekhouder" dialog.
    if (payErr.message && payErr.message.toLowerCase().includes("verwerkt")) {
      return NextResponse.json(
        { error: "verwerkt", invoiceNumber: inv.invoice_number },
        { status: 409 }
      );
    }
    return NextResponse.json({ error: "payment_failed", detail: payErr.message }, { status: 500 });
  }

  // [BANK-PAY-RACE] The idempotent .neq("status","paid") no-ops (0 rows, no error) if a
  // CONCURRENT request paid this invoice between our fetch and this write. We must NOT then
  // treat the payment as ours — otherwise a later link failure would roll back a payment we
  // didn't make. Zero rows updated ⇒ someone else already paid it: bail like the pre-check,
  // never proceed to link or rollback.
  if (!payData || payData.length === 0) {
    return NextResponse.json({ error: "invoice_already_paid" }, { status: 409 });
  }

  // 5. Decide allCovered: is this BANK LINE finished?
  //
  //    [BANK-ONE-PAYMENT-MANY-INVOICES] The honest answer is arithmetic: a payment is finished
  //    when every euro of it sits on an invoice. We reach this branch only when the payment is
  //    bigger than the invoice we just settled, so there IS money left — unless earlier
  //    confirmations on this same bank line already took it. bank_tx_invoices.amount_applied
  //    records exactly that, on every booking path, so summing it answers the question without
  //    reading a single character of the reference. Money left ⇒ the line stays 'pending' and
  //    keeps its remaining invoices reachable; nothing left ⇒ 'matched'.
  //
  //    [BANK-MULTI-CONFIRM] The old presence rule stays as the fallback for links written before
  //    amount_applied existed (or when the read fails): is EVERY invoice number listed in the
  //    reference now backed by a PAID invoice of this user, in the direction the sign implies?
  //    Conservative by design — an unresolved number keeps the tx visible, never hides on doubt.
  const settledByThisBooking = appliedElsewhere + invOpen;
  const moneyRemaining = Math.round((payAmount - settledByThisBooking) * 100) / 100;
  let allCovered = appliedElsewhereKnown ? moneyRemaining <= 0.01 : true;

  if (!appliedElsewhereKnown && refNumbers.length > 1) {
    // Direction the bank movement implies (mirrors isEligible's sign guard):
    //   credit (amount > 0) → outgoing invoices (a customer paid us)
    //   debit  (amount < 0) → incoming invoices (we paid a supplier)
    const requiredDirection: "outgoing" | "incoming" =
      (tx.amount ?? 0) > 0 ? "outgoing" : "incoming";

    // [SEARCH-FULL-COVERAGE] Page past PostgREST's silent ~1000-row cap. A plain .select()
    // truncates without an error, and a truncated paid-set makes isFullyCovered answer "no"
    // for a transaction that IS fully settled — it then stays in "Te bevestigen" forever.
    let paidRows: { invoice_number: string | null }[] = [];
    let paidErr: { message: string } | null = null;
    try {
      paidRows = await fetchAllRows<{ invoice_number: string | null }>((from, to) =>
        pipeline
          .from("invoices")
          .select("invoice_number")
          .eq("status", "paid")
          .eq("direction", requiredDirection)
          .or(`sender_id.eq.${user.id},receiver_id.eq.${user.id}`)
          .order("id", { ascending: true })
          .range(from, to)
      );
    } catch (e) {
      paidErr = { message: e instanceof Error ? e.message : String(e) };
    }

    if (paidErr) {
      // Don't fail the (completed) payment over a coverage read. Be conservative:
      // treat as not fully covered so the tx STAYS visible — never hide on doubt.
      console.error("[BANK-MULTI-CONFIRM] coverage lookup failed:", paidErr.message);
      allCovered = false;
    } else {
      const paidSet = new Set(
        (paidRows ?? [])
          .map((r) => normalizeRef(r.invoice_number ?? ""))
          .filter((n) => n.length > 0)
      );
      // [BANK-MULTI-LINK-PERSIST] Shared coverage rule (equality, not substring).
      allCovered = isFullyCovered(tx.reference, paidSet);
    }
  }

  // 6. Write (b): link the transaction. Pipeline (no trigger), user_id pinned.
  //    [BANK-MULTI-CONFIRM] Only flip to 'matched' when allCovered. Otherwise keep
  //    it 'pending' and just record invoice_id (the most recent link) so the tx
  //    remains in the active list with the open numbers still actionable.
  //    Failure here does NOT roll back the (legally complete) payment.
  const linkUpdate = allCovered
    ? { status: "matched" as const, invoice_id: invoiceId }
    : { invoice_id: invoiceId };

  const { data: linkData, error: linkErr } = await pipeline
    .from("bank_transactions")
    .update(linkUpdate)
    .eq("id", transactionId)
    .eq("user_id", user.id)
    .eq("status", "pending") // only touch a still-pending tx; never overwrite a matched link
    .select("id"); // [BANK-LINK-RACE] know whether the link actually landed (0 rows ⇒ tx grabbed)

  if (linkErr) {
    console.error("[BOEK-016] transaction link failed after payment:", linkErr.message);
    // [BANK-LINK-ROLLBACK] The payment write succeeded but the bank link did not. Leaving
    // the invoice 'paid' with no linked bank line ORPHANS it: the matcher excludes paid
    // invoices, so the tx reappears as "geen factuur" and can never be re-confirmed
    // (invoice_already_paid). Roll the invoice back to its prior status so the state stays
    // consistent and the owner can simply retry — never a paid invoice with no proof.
    const { error: rollbackErr } = await supabase
      .from("invoices")
      .update({
        status: inv.status,
        payment_method: null,
        marked_paid_at: null,
        payment_date: null,
        // [PARTIAL-PAY] The payment write above also set amount_paid to the full total. Leaving
        // it there gives a 'sent' invoice an open balance of 0: it vanishes from the debtor list,
        // and a retry takes the wrong branch because invOpen reads 0. Restore the value this
        // request found, so the rollback returns the invoice to exactly its prior state.
        amount_paid: inv.amount_paid ?? 0,
      })
      .eq("id", invoiceId)
      .eq("status", "paid");
    if (rollbackErr) {
      console.error("[BANK-LINK-ROLLBACK] rollback also failed:", rollbackErr.message);
    }
    return NextResponse.json(
      { error: "transaction_link_failed", detail: linkErr.message, rolledBack: !rollbackErr },
      { status: 500 }
    );
  }

  // [BANK-LINK-RACE] A 0-row link with NO error means a concurrent confirm grabbed the tx
  // between our fetch and this write (the .eq("status","pending") no longer matched). Every
  // booking in THIS branch is one whose payment is larger than the invoice it settled, so the
  // money genuinely covers this invoice whatever else the bank line went on to pay: the payment
  // stands on its own and the join row below keeps it reversible by id. Rolling it back here
  // would un-pay an invoice that really was paid, so a no-op is benign and self-healing — we
  // only record it. (The hard-error path above still rolls back: there is no link at all then.)
  if (!linkData || linkData.length === 0) {
    console.warn("[BANK-LINK-RACE] transaction claimed concurrently; invoice stays paid", {
      transactionId, invoiceId, invoiceNumber: inv.invoice_number,
    });
  }
  // [BANK-TX-INVOICES] Record this (transaction → invoice) so a later reversal reverses by id, not
  // by number. A multi-invoice batch is confirmed one invoice per call, so successive confirms
  // accumulate every paid invoice onto the same tx here — the full, collision-free reversal set.
  // [PARTIAL-PAY] Record WHAT this payment applied to this invoice, not just that it did. This
  // branch settles the invoice in full, so the amount is the balance it had open a moment ago
  // (invOpen, read before the write above) — the same figure book_bank_batch records. Without it
  // the link counts as zero in recompute_invoice_amount_paid and a later unlink of any OTHER
  // payment on this invoice erases the money this one really settled.
  await recordPaymentLinks(pipeline, user.id, transactionId, [invoiceId], { [invoiceId]: invOpen });

  // 7. Notification (non-blocking) — notifications inserts use service_role by rule.
  const unassigned = appliedElsewhereKnown && !allCovered ? Math.max(0, moneyRemaining) : 0;
  try {
    await pipeline.from("notifications").insert({
      user_id: user.id,
      title: "Factuur betaald",
      body: `Factuur ${inv.invoice_number ?? ""} is gekoppeld aan een banktransactie en gemarkeerd als betaald.`,
      type: "payment",
    });
    // [BANK-ONE-PAYMENT-MANY-INVOICES] Money of this payment is still unassigned. The bank line
    // stays in "Te bevestigen" so the next invoice can take it — say so, so the owner knows the
    // line is not stuck but waiting. (Before, that money was silently declared spent.)
    if (unassigned > 0.01) {
      await pipeline.from("notifications").insert({
        user_id: user.id,
        title: "Nog een deel van deze betaling open",
        body: `Van deze betaling van € ${payAmount.toFixed(2)} is € ${settledByThisBooking.toFixed(2)} op facturen geboekt. € ${unassigned.toFixed(2)} is nog niet toegewezen — koppel de volgende factuur.`,
        type: "payment",
        link: "/dashboard/bank",
      });
    }
  } catch {
    /* non-blocking */
  }

  await logAuditAction({
    userId: user.id,
    action: "bank.confirmed",
    entityType: "invoice",
    entityId: invoiceId,
    newValue: {
      transaction_id: transactionId,
      invoice_number: inv.invoice_number,
      applied: invOpen,
      payment_amount: payAmount,
      applied_total: settledByThisBooking,
      unassigned,
      all_covered: allCovered,
    },
  });

  // [BANK-MULTI-CONFIRM] Return allCovered so the UI knows whether this transaction
  // is now fully done (→ Gekoppeld) or still has open numbers (→ stays in Te bevestigen).
  // `unassigned` is what is still waiting on this bank line after this booking.
  return NextResponse.json({ ok: true, allCovered, applied: invOpen, unassigned });
}