// src/app/api/bank/allocate/route.ts
// [BETAALPLAN] One bank line, several invoices, an amount per invoice — booked as ONE decision.
//
// ── WHY THIS ROUTE EXISTS NEXT TO /api/bank/confirm ──
// confirm books ONE invoice. A batch had to be N calls to it, and N independent calls cannot see
// the thing that actually matters: their sum. Each of three calls booking €3.000, €2.000 and
// €1.200 against a €5.000 debit is individually reasonable and collectively books €1.200 that never
// left the account. Nothing downstream — the P&L, the BTW return, the accountant's package — can
// tell that it did not.
//
// So the plan is validated as a WHOLE first (payment-plan.ts, 18 tests), and only then applied.
//
// ── WHAT "ATOMIC" MEANS HERE, HONESTLY ──
// Every line goes through apply_bank_payment, the same audited RPC confirm uses — one call per
// line, because that function is where the per-invoice locking, the amount_paid recompute and the
// 'verwerkt' guard live, and reimplementing that here would be a second source of truth for money.
//
// That means the loop is not one database transaction. The whole-plan validation runs BEFORE any
// write precisely because of that: by the time the first line is applied, the plan is known to fit
// the payment and every invoice. What can still fail mid-way is a concurrent booking claiming the
// same transaction — and then this route stops, reports exactly which lines landed, and leaves the
// rest alone. It never retries and never partially guesses: a half-applied batch that SAYS it is
// half-applied is recoverable, and one that claims success is not.
//
// ── AND WHAT IT REFUSES TO DECIDE ──
// The leftover. Money this plan does not explain is reported and left where it is. It could be a
// bank charge, an early-payment discount, or an invoice that was never imported, and those have
// different right answers. Naming the amount and leaving the reason to the owner is the honest
// shape; guessing it writes a number into an administration with our name on it.

import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { createPipelineClient } from "@/lib/supabase-pipeline";
import { logAuditAction, getClientIP } from "@/lib/audit";
import { requireOwner } from "@/lib/owner-only";
import { resolvePaymentPlan, type PlanInvoice, type PlanLine } from "@/lib/payment-plan";

export const dynamic = "force-dynamic";
// A ten-invoice batch is ten RPC calls, each locking and recomputing. Well above the real work.
export const maxDuration = 60;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** A plan larger than this is not a batch, it is a mistake or a script. */
const MAX_LINES = 40;

export async function POST(req: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  // [OWNER-ONLY] Booking money is the owner's own act — a linked accountant may look, never book.
  const { response: notOwner } = await requireOwner("Een betaling boeken");
  if (notOwner) return notOwner;

  let body: { transactionId?: string; lines?: PlanLine[] };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }

  const transactionId = body.transactionId;
  const rawLines = Array.isArray(body.lines) ? body.lines : [];
  if (!transactionId || !UUID_RE.test(transactionId)) {
    return NextResponse.json({ error: "invalid_transaction" }, { status: 400 });
  }
  if (rawLines.length === 0) {
    return NextResponse.json({ error: "Kies eerst minstens één factuur." }, { status: 400 });
  }
  if (rawLines.length > MAX_LINES) {
    return NextResponse.json(
      { error: `Een betaling verdelen over meer dan ${MAX_LINES} facturen gaat niet in één keer.` },
      { status: 400 },
    );
  }
  for (const l of rawLines) {
    if (!l || typeof l.invoiceId !== "string" || !UUID_RE.test(l.invoiceId)) {
      return NextResponse.json({ error: "invalid_invoice_id" }, { status: 400 });
    }
  }

  const pipeline = createPipelineClient();

  // ── The bank line, scoped to its owner ────────────────────────────────────
  const { data: tx, error: txErr } = await pipeline
    .from("bank_transactions")
    .select("id, user_id, amount, date, status")
    .eq("id", transactionId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (txErr || !tx) return NextResponse.json({ error: "transaction_not_found" }, { status: 404 });

  // ── What this line already gave away ──────────────────────────────────────
  // Existing links with a NULL amount predate bank_tx_invoices_amount.sql and, by construction,
  // settled their invoice in full — so their invoice total is what they took. Reading them as 0
  // would let the same euros be spent twice.
  let alreadyAllocated = 0;
  {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: links } = await (pipeline as any)
      .from("bank_tx_invoices")
      .select("invoice_id, amount")
      .eq("transaction_id", transactionId)
      .eq("user_id", user.id);
    const rows = (links ?? []) as Array<{ invoice_id: string; amount: number | null }>;
    const unpriced = rows.filter((r) => r.amount == null).map((r) => r.invoice_id);
    for (const r of rows) if (r.amount != null) alreadyAllocated += Math.abs(Number(r.amount) || 0);
    if (unpriced.length > 0) {
      const { data: olds } = await pipeline
        .from("invoices")
        .select("id, total_inc_btw")
        .in("id", unpriced)
        .or(`sender_id.eq.${user.id},receiver_id.eq.${user.id}`);
      for (const o of olds ?? []) alreadyAllocated += Math.abs(Number(o.total_inc_btw) || 0);
    }
  }

  // ── The invoices the plan names ───────────────────────────────────────────
  const ids = rawLines.map((l) => l.invoiceId);
  const { data: invRows, error: invErr } = await pipeline
    .from("invoices")
    .select("id, direction, invoice_type, total_inc_btw, amount_paid, invoice_number, accountant_status")
    .in("id", ids)
    .or(`sender_id.eq.${user.id},receiver_id.eq.${user.id}`);
  if (invErr) return NextResponse.json({ error: "invoice_read_failed" }, { status: 500 });

  const invoices: PlanInvoice[] = (invRows ?? []).map((r) => ({
    id: r.id,
    direction: r.direction === "outgoing" ? "outgoing" : "incoming",
    invoiceType: r.invoice_type,
    totalIncBtw: r.total_inc_btw,
    amountPaid: r.amount_paid,
  }));

  // [VERWERKT] An invoice the accountant has already processed is closed to new money. The RPC
  // enforces it too; refusing here means the owner learns it BEFORE half the batch is booked.
  const locked = (invRows ?? []).find((r) => r.accountant_status === "verwerkt");
  if (locked) {
    return NextResponse.json(
      { error: "verwerkt", invoiceNumber: locked.invoice_number },
      { status: 409 },
    );
  }

  // ── The whole plan, before any write ──────────────────────────────────────
  const plan = resolvePaymentPlan({
    txAmount: Number(tx.amount) || 0,
    alreadyAllocated,
    lines: rawLines.map((l) => ({ invoiceId: l.invoiceId, amount: Number(l.amount) })),
    invoices,
  });
  if (!plan.ok) {
    return NextResponse.json({ error: plan.message, reason: plan.reason, invoiceId: plan.invoiceId }, { status: 400 });
  }

  // ── Apply, line by line, stopping honestly ────────────────────────────────
  const applied: Array<{ invoiceId: string; amount: number; fullyPaid: boolean }> = [];
  for (const line of plan.lines) {
    const { data: rows, error } = await supabase.rpc("apply_bank_payment", {
      p_user_id: user.id,
      p_tx_id: transactionId,
      p_invoice_id: line.invoiceId,
      // apply_bank_payment settles a MAGNITUDE; the creditnota's sign is the plan's arithmetic,
      // and it is preserved on the link below so the reversal gives back exactly this.
      p_amount: Math.abs(line.amount),
      p_pay_date: tx.date ?? null,
    });

    if (error || !Array.isArray(rows) || rows.length === 0) {
      // Stop. Report what landed rather than pressing on — a batch that says it is half-applied
      // can be finished by hand; one that claims success cannot be found again.
      return NextResponse.json(
        {
          error: error?.message?.toLowerCase().includes("verwerkt")
            ? "Een van deze facturen is intussen door je boekhouder verwerkt. De rest is niet geboekt."
            : "De verdeling is halverwege gestopt. Wat hieronder staat is wél geboekt — controleer de rest.",
          partial: true,
          applied,
          failedInvoiceId: line.invoiceId,
        },
        { status: 409 },
      );
    }

    const row = rows[0] as { applied: number; amount_paid: number; total: number; is_paid: boolean };
    applied.push({ invoiceId: line.invoiceId, amount: line.amount, fullyPaid: row.is_paid === true });

    // [BETAALPLAN] The signed amount on the link. apply_bank_payment writes the link itself; this
    // records how much of THIS payment it represents, which is the only thing that makes a later
    // per-invoice unlink give back the right number instead of the invoice's whole total.
    // Best-effort: without the column (migration not yet applied) the booking still stands and
    // only the exactness of a future reversal is reduced to what it already was.
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (pipeline as any)
        .from("bank_tx_invoices")
        .update({ amount: line.amount })
        .eq("transaction_id", transactionId)
        .eq("invoice_id", line.invoiceId)
        .eq("user_id", user.id);
    } catch {
      /* non-fatal — see above */
    }
  }

  await logAuditAction({
    userId: user.id,
    action: "bank.payment_allocated",
    entityType: "bank_transaction",
    entityId: transactionId,
    newValue: {
      lines: applied.length,
      allocated: plan.allocated,
      remainder: plan.remainder,
      invoiceIds: applied.map((a) => a.invoiceId),
    },
    ipAddress: getClientIP(req),
  }).catch(() => { /* an audit failure must never undo a correct booking */ });

  return NextResponse.json({
    ok: true,
    applied,
    allocated: plan.allocated,
    remainder: plan.remainder,
    remainderNote: plan.remainderNote,
  });
}
