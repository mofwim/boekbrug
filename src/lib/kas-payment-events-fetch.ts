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
import { getVatScheme, resolveSchemeForQuarter, type VatScheme } from "./vat-scheme";
import type { ComputeOpts } from "./financial-result";

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

  // 2) ALL of the owner's bank↔invoice links (by user_id, unfiltered). A payment reconciled via a
  //    bank link IS settled money — even if amount_paid/status weren't synced on the invoice row —
  //    so a linked invoice joins the settled set below (never a silent under-declaration).
  const links = await fetchAllRows<{ invoice_id: string; transaction_id: string; amount_applied: number | null }>(
    (from, to) => pipeline
      .from("bank_tx_invoices")
      .select("invoice_id, transaction_id, amount_applied")
      .eq("user_id", ownerId)
      .order("id", { ascending: true }).range(from, to),
  ).catch((e: unknown) => { throw new Error(`[KASSTELSEL] bank_tx_invoices fetch failed: ${e instanceof Error ? e.message : String(e)}`); });
  const linkedIds = new Set(links.map((l) => l.invoice_id).filter(Boolean));

  const settled = invRows.filter((i) => isSettled(i) || linkedIds.has(i.id));
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
    const paidMag = headers.get(i.id)!.amountPaidMagnitude; // amount_paid, or full total for a legacy 'paid'
    for (const d of dated) raw.push({ invoiceId: i.id, payDate: d.date, magnitude: d.mag, estimated: false });

    // [PARTIAL-PAY] The links do NOT always account for everything that was settled. A batch
    // booking historically left amount_paid untouched, and a cash/manual instalment has no bank
    // link at all — so an invoice can be settled for more than its links describe. The old code
    // `continue`d as soon as ONE dated link existed, and that difference silently vanished from
    // the kasstelsel BTW-aangifte: an under-declaration with no warning, because the undated
    // check nets to zero when a dated link is present. Book the REMAINDER through the same
    // exact → estimate → undated ladder, so money can never be settled yet uncounted.
    // Structurally the remainder is 0 once every path maintains amount_paid; this is the net.
    const datedMag = dated.reduce((s, d) => s + d.mag, 0);
    const remainderMag = Math.round((paidMag - datedMag) * 100) / 100;
    if (remainderMag <= 0.005) continue;
    if (i.payment_date) raw.push({ invoiceId: i.id, payDate: i.payment_date.slice(0, 10), magnitude: remainderMag, estimated: false });
    else if (i.marked_paid_at) raw.push({ invoiceId: i.id, payDate: i.marked_paid_at.slice(0, 10), magnitude: remainderMag, estimated: true });
    else raw.push({ invoiceId: i.id, payDate: null, magnitude: remainderMag, estimated: true });
  }

  return buildQuarterSettlements(headers, raw, start, end);
}

/** The VAT basis in force for a quarter, read from the owner's profile (own query → deploy-safe:
 *  if the vat_scheme migration lags, it degrades to factuur). Used where only the scheme is needed
 *  (the settlements are fetched separately, e.g. inside computeResultForRange). */
export async function resolveOwnerScheme(
  pipeline: PipelineClient,
  ownerId: string,
  quarterStart: string,
): Promise<VatScheme> {
  const { data: prof } = await pipeline
    .from("profiles").select("vat_scheme, vat_scheme_since").eq("id", ownerId).maybeSingle();
  const p = prof as { vat_scheme?: string | null; vat_scheme_since?: string | null } | null;
  return resolveSchemeForQuarter(getVatScheme(p?.vat_scheme), p?.vat_scheme_since ?? null, quarterStart);
}

/** What a money-read route needs to become scheme-aware in one call. */
export interface SchemeResolution {
  scheme: VatScheme;
  opts: ComputeOpts;              // {} under factuur (computeResult runs accrual); kas inputs under kas
  undatedPaidCount: number;      // paid money that couldn't be dated → block klaar/aangifte, suppress figures
  estimatedPortionCount: number; // paid-date is an estimate (marked_paid_at) → block klaar
}

/**
 * Resolve the VAT basis for one quarter and, under kas, gather its settlement inputs — the single
 * entry point the money-read routes (/api/result, /api/aangifte, /api/readiness) use so they can
 * never disagree on the scheme. `quarterStart` gates the per-quarter effective date; [start,end] is
 * the window whose settlements to fetch. The profile is read in its OWN query (deploy-safe: if the
 * vat_scheme migration lags, the select degrades to factuur, never a wrong number). Under factuur
 * it returns empty opts so computeResult runs the accrual path byte-identical.
 */
export async function resolveSchemeSettlements(
  pipeline: PipelineClient,
  ownerId: string,
  quarterStart: string,
  start: string,
  end: string,
): Promise<SchemeResolution> {
  const { data: prof } = await pipeline
    .from("profiles").select("vat_scheme, vat_scheme_since").eq("id", ownerId).maybeSingle();
  const p = prof as { vat_scheme?: string | null; vat_scheme_since?: string | null } | null;
  const scheme = resolveSchemeForQuarter(getVatScheme(p?.vat_scheme), p?.vat_scheme_since ?? null, quarterStart);
  if (scheme !== "kas") return { scheme: "factuur", opts: {}, undatedPaidCount: 0, estimatedPortionCount: 0 };
  const qs = await fetchSettlementEvents(pipeline, ownerId, start, end);
  return {
    scheme: "kas",
    opts: { scheme: "kas", settlements: qs.events, priorByInvoice: qs.priorByInvoice },
    undatedPaidCount: qs.undatedPaidCount,
    estimatedPortionCount: qs.estimatedCount,
  };
}
