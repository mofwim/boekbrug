// src/lib/kas-payment-events.ts
// [KASSTELSEL] The payment-date settlement model for cash-basis BTW. This module owns the
// money-critical arithmetic: turning an invoice's PAYMENTS into per-quarter omzet/BTW slices
// that, summed over ALL quarters, equal the invoice header EXACTLY — to the cent, with no
// rounding drift and no euro counted twice. Pure; run: npx tsx src/lib/kas-payment-events.test.ts
//
// Under kasstelsel an invoice's BTW is due in the quarter it is PAID. A part-paid invoice is
// therefore split across quarters in proportion to what was settled in each. The danger is
// rounding: if every quarter booked `header × fraction` independently, the slices would not
// re-sum to the header (a cent leaks, over- or under-declaring BTW). The fix (verified F1/S2):
// the quarter that COMPLETES the invoice books the REMAINDER against an UNROUNDED running
// total seeded from all prior quarters — so Σ(slices) ≡ header, always.
//
// The I/O that gathers the raw settlements (bank_tx_invoices ⨝ bank_transactions.date, then
// invoices.payment_date, then marked_paid_at) lives beside this as fetchSettlementEvents (added
// with the engine wiring); this file stays a pure, exhaustively-tested arithmetic core.

import { nearestLegalRate } from "./btw-rate";

/** Cumulative "invoice considered fully settled" slack (cents) — mirrors the partial-payment
 *  RPC's `abs(total) − 0.01` rule so app and engine agree on when an invoice is closed. */
export const SETTLEMENT_CLOSE_SLACK = 0.01;

export type InvoiceDirection = "incoming" | "outgoing";

/** One raw settlement of an invoice: the day money moved + the signed GROSS (incl. BTW) applied. */
export interface SettlementRecord {
  payDate: string;        // ISO 'YYYY-MM-DD'
  amountApplied: number;  // signed gross; a refund/creditnota settlement is negative
  estimated: boolean;     // true when the date came from marked_paid_at (a human-confirm approximation)
}

/** The invoice header snapshot (signed: a creditnota carries negative totals). */
export interface InvoiceHeader {
  invoiceId: string;
  direction: InvoiceDirection;
  totalEx: number;
  totalBtw: number;
  totalInc: number;
}

/** A settlement placed in a quarter: the header + this payment's share + whether it closes the invoice. */
export interface SettlementEvent {
  invoiceId: string;
  direction: InvoiceDirection;
  payDate: string;
  amountApplied: number;
  headerEx: number;
  headerBtw: number;
  headerInc: number;
  closesInvoice: boolean; // this event brings cumulative |paid| to ≥ |header| − slack
  estimated: boolean;
}

/** Unrounded cumulative ex/btw already booked in PRIOR windows (the F1 seed). */
export interface PriorSettled { ex: number; btw: number; }

/** One invoice-payment's omzet/BTW contribution to a quarter (UNROUNDED — rounding happens once,
 *  later, on the aangifte total). Direction routes it to omzet+verschuldigd or kosten+voorbelasting. */
export interface SettlementSlice {
  invoiceId: string;
  direction: InvoiceDirection;
  ex: number;
  btw: number;
  rate: number;   // header-derived legal rate (for the 1a/1b/1c rubriek split)
}

/** The legal BTW rate implied by an invoice header (0 when there's no net to derive from). */
export function deriveRate(headerEx: number, headerBtw: number): number {
  return headerEx !== 0 ? nearestLegalRate(Math.round((headerBtw / headerEx) * 100)) : 0;
}

/**
 * Mark which in-window settlement (if any) CLOSES the invoice — the one whose cumulative paid
 * (prior + in-window up to and including it) first reaches |header_inc| − slack. `inWindow` must
 * be date-sorted. `priorInc` is the signed gross settled before this window. Pure.
 */
export function buildSettlementEvents(
  header: InvoiceHeader,
  priorInc: number,
  inWindow: SettlementRecord[],
): SettlementEvent[] {
  const threshold = Math.abs(header.totalInc) - SETTLEMENT_CLOSE_SLACK;
  let cum = priorInc;
  const out: SettlementEvent[] = [];
  for (const r of inWindow) {
    const before = Math.abs(cum);
    cum += r.amountApplied;
    const after = Math.abs(cum);
    // Closes when this payment crosses the "fully settled" threshold. A zero-total invoice
    // (threshold ≤ 0) closes on its first event so its (zero) remainder is still booked.
    const closes = before < threshold + 1e-9 && after >= threshold;
    out.push({
      invoiceId: header.invoiceId,
      direction: header.direction,
      payDate: r.payDate,
      amountApplied: r.amountApplied,
      headerEx: header.totalEx,
      headerBtw: header.totalBtw,
      headerInc: header.totalInc,
      closesInvoice: closes,
      estimated: r.estimated,
    });
  }
  return out;
}

/**
 * Turn settlement events into per-quarter omzet/BTW slices. Processes events in date order,
 * seeding each invoice's running total from `prior` (unrounded cumulative from earlier quarters).
 *   - a NON-closing event books its proportional share:  header × (amountApplied / header_inc)
 *   - the CLOSING event books the exact REMAINDER:        header − runningTotal
 * so the sum of every slice for an invoice across all quarters equals the header to the cent.
 * Pure. `prior` is not mutated.
 */
export function computeSettlementSlices(
  events: SettlementEvent[],
  prior: Map<string, PriorSettled>,
): SettlementSlice[] {
  const running = new Map<string, PriorSettled>();
  for (const [k, v] of prior) running.set(k, { ex: v.ex, btw: v.btw });

  const ordered = [...events].sort((a, b) =>
    a.payDate < b.payDate ? -1 : a.payDate > b.payDate ? 1 : 0,
  );

  const slices: SettlementSlice[] = [];
  for (const e of ordered) {
    const r = running.get(e.invoiceId) ?? { ex: 0, btw: 0 };
    let ex: number, btw: number;
    if (e.closesInvoice) {
      // Exact remainder — cancels any accumulated proportional rounding (F1/S2).
      ex = e.headerEx - r.ex;
      btw = e.headerBtw - r.btw;
    } else {
      const frac = e.headerInc !== 0 ? e.amountApplied / e.headerInc : 0;
      ex = e.headerEx * frac;
      btw = e.headerBtw * frac;
    }
    running.set(e.invoiceId, { ex: r.ex + ex, btw: r.btw + btw });
    slices.push({
      invoiceId: e.invoiceId,
      direction: e.direction,
      ex,
      btw,
      rate: deriveRate(e.headerEx, e.headerBtw),
    });
  }
  return slices;
}
