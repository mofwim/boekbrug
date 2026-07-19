// src/lib/kas-payment-events-fetch.ts
// [KASSTELSEL] The I/O that gathers an owner's invoice SETTLEMENTS (which day money moved, and how
// much) and hands them to the pure buildQuarterSettlements. Kept out of kas-payment-events.ts so
// that module stays a pure, exhaustively-tested arithmetic core.
//
// Date resolution per invoice, most-authoritative first (verified by the design's payment-date map):
//   1. bank_tx_invoices.amount_applied ⨝ bank_transactions.date  — real settlement date, PER
//      installment (collision-free; a batch payment dates each linked invoice by its own tx).
//   2. invoices.payment_date            — a cash/manual pay the owner recorded (exact date).
//   3. invoices.marked_paid_at          — the human-confirm moment (an ESTIMATE of the pay date).
//   4. none                             — paid but undated → surfaced (undatedPaidCount), never dropped.
//
// The engine never trusts a stored sign: the grouper signs each magnitude from the invoice header,
// so a creditnota (negative header) nets correctly.

import type { PipelineClient } from "./supabase-pipeline";
import { fetchAllRows } from "./supabase-paginate";
import {
  buildQuarterSettlements,
  type HeaderWithPaid,
  type RawSettlement,
  type QuarterSettlements,
  type InvoiceDirection,
} from "./kas-payment-events";

// [KASSTELSEL] Under cash basis an invoice counts ONLY when money moved: amount_paid > 0 (any
// partial) OR status 'paid' (fully settled). NOT a bare 'sent'/'overdue' (unpaid sale) or
// 'received' (unpaid purchase) — those carry no settlement yet. A status 'paid' row whose
// amount_paid was never populated (legacy, pre-partial-payments) still counts its FULL total,
// so a real paid invoice is never silently under-declared.
function isSettled(i: { amount_paid: number | null; status: string | null }): boolean {
  return (Number(i.amount_paid) || 0) > 0 || i.status === "paid";
}
/** The magnitude of money settled: amount_paid when present, else the full header for a legacy
 *  'paid' invoice (never 0 for a genuinely paid invoice). */
function paidMagnitude(i: { amount_paid: number | null; status: string | null }, headerInc: number): number {
  const ap = Math.abs(Number(i.amount_paid) || 0);
  if (ap > 0) return ap;
  return i.status === "paid" ? Math.abs(headerInc) : 0;
}

/**
 * Fetch the quarter's settlement events for one owner. Returns everything buildQuarterSettlements
 * produced (in-window events, priorByInvoice, undatedPaidCount, estimatedCount). Throws on a query
 * error (the caller surfaces it) rather than silently returning zero figures — under kasstelsel a
 * swallowed error would under-declare BTW. `start`/`end` are ISO 'YYYY-MM-DD'.
 */
export async function fetchSettlementEvents(
  pipeline: PipelineClient,
  ownerId: string,
  start: string,
  end: string,
): Promise<QuarterSettlements> {
  // 1) The owner's invoices that carry any settlement (amount_paid > 0, or a paid/received status).
  //    NO invoice_date filter — a prior-year invoice paid this quarter must be reachable.
  const invRows = await fetchAllRows<{
    id: string; direction: string | null; sender_id: string | null; receiver_id: string | null;
    total_ex_btw: number | null; btw_amount: number | null; total_inc_btw: number | null;
    amount_paid: number | null; payment_date: string | null; marked_paid_at: string | null; status: string | null;
  }>((from, to) => pipeline
    .from("invoices")
    .select("id, direction, sender_id, receiver_id, total_ex_btw, btw_amount, total_inc_btw, amount_paid, payment_date, marked_paid_at, status")
    .or(`sender_id.eq.${ownerId},receiver_id.eq.${ownerId}`)
    .order("id", { ascending: true }).range(from, to),
  ).catch((e: unknown) => { throw new Error(`[KASSTELSEL] invoice fetch failed: ${e instanceof Error ? e.message : String(e)}`); });

  const settled = invRows.filter(isSettled);
  if (settled.length === 0) return { events: [], priorByInvoice: new Map(), undatedPaidCount: 0, estimatedCount: 0 };

  const headers = new Map<string, HeaderWithPaid>();
  for (const i of settled) {
    const direction: InvoiceDirection =
      i.direction === "incoming" || i.direction === "outgoing"
        ? i.direction
        : i.receiver_id === ownerId ? "incoming" : "outgoing";
    const ex = Number(i.total_ex_btw) || 0;
    const btw = Number(i.btw_amount) || 0;
    const inc = i.total_inc_btw != null ? Number(i.total_inc_btw) : ex + btw;
    headers.set(i.id, {
      invoiceId: i.id, direction, totalEx: ex, totalBtw: btw, totalInc: inc,
      amountPaidMagnitude: paidMagnitude(i, inc),
    });
  }
  const ids = [...headers.keys()];

  // 2) Per-installment bank settlements: bank_tx_invoices (amount_applied) ⨝ bank_transactions.date.
  //    Fetch links for the owner's settled invoices, then resolve each link's transaction date.
  const links = await fetchAllRows<{ invoice_id: string; transaction_id: string; amount_applied: number | null }>(
    (from, to) => pipeline
      .from("bank_tx_invoices")
      .select("invoice_id, transaction_id, amount_applied")
      .eq("user_id", ownerId)
      .in("invoice_id", ids)
      .order("id", { ascending: true }).range(from, to),
  ).catch((e: unknown) => { throw new Error(`[KASSTELSEL] bank_tx_invoices fetch failed: ${e instanceof Error ? e.message : String(e)}`); });

  const txIds = [...new Set(links.map((l) => l.transaction_id).filter(Boolean))];
  const txDate = new Map<string, string>();
  if (txIds.length > 0) {
    const txRows = await fetchAllRows<{ id: string; date: string | null }>((from, to) => pipeline
      .from("bank_transactions").select("id, date").in("id", txIds)
      .order("id", { ascending: true }).range(from, to),
    ).catch((e: unknown) => { throw new Error(`[KASSTELSEL] bank_transactions fetch failed: ${e instanceof Error ? e.message : String(e)}`); });
    for (const t of txRows) if (t.date) txDate.set(t.id, t.date.slice(0, 10));
  }

  const linksByInvoice = new Map<string, Array<{ transaction_id: string; amount_applied: number | null }>>();
  for (const l of links) {
    if (!linksByInvoice.has(l.invoice_id)) linksByInvoice.set(l.invoice_id, []);
    linksByInvoice.get(l.invoice_id)!.push(l);
  }

  // 3) Build the raw settlement records per invoice, using the resolution order.
  const raw: RawSettlement[] = [];
  for (const i of settled) {
    const bankLinks = linksByInvoice.get(i.id) ?? [];
    const dated = bankLinks
      .map((l) => ({ date: txDate.get(l.transaction_id) ?? null, mag: Math.abs(Number(l.amount_applied) || 0) }))
      .filter((l) => l.mag > 0);
    if (dated.length > 0) {
      for (const d of dated) raw.push({ invoiceId: i.id, payDate: d.date, magnitude: d.mag, estimated: false });
      continue;
    }
    // No bank link → cash/manual: payment_date (exact) → marked_paid_at (estimate) → undated.
    const paidMag = headers.get(i.id)!.amountPaidMagnitude; // amount_paid, or full total for a legacy 'paid'
    if (paidMag <= 0) continue;
    if (i.payment_date) raw.push({ invoiceId: i.id, payDate: i.payment_date.slice(0, 10), magnitude: paidMag, estimated: false });
    else if (i.marked_paid_at) raw.push({ invoiceId: i.id, payDate: i.marked_paid_at.slice(0, 10), magnitude: paidMag, estimated: true });
    else raw.push({ invoiceId: i.id, payDate: null, magnitude: paidMag, estimated: true });
  }

  return buildQuarterSettlements(headers, raw, start, end);
}
