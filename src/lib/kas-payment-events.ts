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

/** One raw settlement as it comes from the DB: a MAGNITUDE (unsigned) applied on a day, plus
 *  whether the day is an estimate (marked_paid_at) or null (paid but no resolvable date). The
 *  sign is derived from the invoice header, never trusted from the stored amount. */
export interface RawSettlement {
  invoiceId: string;
  payDate: string | null;  // null → paid but undated (money we can't place in a quarter)
  magnitude: number;       // abs gross applied
  estimated: boolean;
}

/** An invoice header plus the total magnitude recorded as paid (to detect undated paid money). */
export interface HeaderWithPaid extends InvoiceHeader {
  amountPaidMagnitude: number;
}

/** The per-quarter settlement inputs the engine needs, assembled from raw rows. Pure. */
export interface QuarterSettlements {
  events: SettlementEvent[];             // in-window events (this quarter)
  priorByInvoice: Map<string, PriorSettled>; // unrounded ex/btw booked in earlier quarters (F1 seed)
  undatedPaidCount: number;              // invoices with paid money we could NOT date → block klaar
  estimatedCount: number;               // invoices whose in-window date came from marked_paid_at
}

/**
 * Assemble a quarter's settlement events from raw DB rows — the PURE core of fetchSettlementEvents,
 * so the risky grouping/splitting logic is node-testable. For each invoice:
 *   - sign each dated magnitude by the header (creditnota → negative),
 *   - split into prior (< start) and in-window ([start,end]),
 *   - seed the in-window closing detection with the prior gross (priorInc),
 *   - compute the unrounded prior ex/btw slices → priorByInvoice (so the closing event books the
 *     exact remainder and never re-books an earlier quarter),
 *   - flag paid-but-undated money (amountPaidMagnitude beyond the dated total) so it is NEVER
 *     silently under-declared — it raises undatedPaidCount, which the routes use to block klaar.
 * Pure. `start`/`end`/dates are ISO 'YYYY-MM-DD'.
 */
export function buildQuarterSettlements(
  headers: Map<string, HeaderWithPaid>,
  raw: RawSettlement[],
  start: string,
  end: string,
): QuarterSettlements {
  const byInvoice = new Map<string, RawSettlement[]>();
  for (const r of raw) {
    if (!headers.has(r.invoiceId)) continue; // ignore rows for invoices we don't own/know
    (byInvoice.get(r.invoiceId) ?? byInvoice.set(r.invoiceId, []).get(r.invoiceId)!).push(r);
  }

  const events: SettlementEvent[] = [];
  const priorByInvoice = new Map<string, PriorSettled>();
  let undatedPaidCount = 0;
  let estimatedCount = 0;

  for (const [invoiceId, recs] of byInvoice) {
    const header = headers.get(invoiceId)!;
    const sign = header.totalInc >= 0 ? 1 : -1;

    const dated = recs.filter((r) => r.payDate && r.payDate <= end);
    const datedMagnitude = dated.reduce((s, r) => s + Math.abs(r.magnitude), 0);
    // Paid money we could NOT date (undated rows, or amount_paid beyond what dated rows explain)
    // must never vanish: flag the invoice so klaar/aangifte block instead of under-declaring.
    const undatedMagnitude = Math.max(0, header.amountPaidMagnitude - datedMagnitude);
    const hasUndated =
      recs.some((r) => !r.payDate) || undatedMagnitude > SETTLEMENT_CLOSE_SLACK;
    if (hasUndated) undatedPaidCount++;

    const toRec = (r: RawSettlement) => ({ payDate: r.payDate as string, amountApplied: Math.abs(r.magnitude) * sign, estimated: r.estimated });
    const sortByDate = (a: { payDate: string }, b: { payDate: string }) => (a.payDate < b.payDate ? -1 : a.payDate > b.payDate ? 1 : 0);
    const prior = dated.filter((r) => (r.payDate as string) < start).map(toRec).sort(sortByDate);
    const inWindow = dated.filter((r) => (r.payDate as string) >= start).map(toRec).sort(sortByDate);

    // Unrounded prior slices (the F1 seed): run the tested core over prior records.
    const priorInc = prior.reduce((s, r) => s + r.amountApplied, 0);
    if (prior.length > 0) {
      const priorEvents = buildSettlementEvents(header, 0, prior);
      const priorSlices = computeSettlementSlices(priorEvents, new Map());
      priorByInvoice.set(invoiceId, {
        ex: priorSlices.reduce((s, x) => s + x.ex, 0),
        btw: priorSlices.reduce((s, x) => s + x.btw, 0),
      });
    }

    if (inWindow.length > 0) {
      events.push(...buildSettlementEvents(header, priorInc, inWindow));
      if (inWindow.some((r) => r.estimated)) estimatedCount++;
    }
  }

  return { events, priorByInvoice, undatedPaidCount, estimatedCount };
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
