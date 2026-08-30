// src/lib/result-range-assemble.ts
// [TRUTH-SEAM] The pure half of computeResultForRange: given every row the window needs, produce
// the reconciled result. No I/O, no clock, no Supabase. Run:
//   npx tsx --test src/lib/result-range-assemble.test.ts
//
// ── WHY THIS FILE EXISTS ─────────────────────────────────────────────────────────────────────
//
// MONEY_PATH_AUDIT_2026-08.md §3 names compute-result-range.ts as **the single largest untested
// money surface in the repo**: 485 lines, one source-level gate, no behavioural test, sitting
// behind the screen called "je financiële waarheid". §6 gives the remedy and the precedent —
// _"a pure seam in compute-result-range.ts. Extract the windowing and aggregation from the
// fetching, the way truth-lens.ts was extracted during the July audit."_ This is that extraction.
//
// The reason it had no test was never neglect: every path into it began with `await pipeline.from(...)`,
// so asserting on any of it required a live database. The logic that decides the money, though,
// needs no database at all — it needs ROWS. Splitting the function at that line makes the entire
// decision layer node-testable with fixtures, which is the same move kas-payment-events.ts already
// made for fetchSettlementEvents ("the PURE core", its own header says).
//
// ── WHAT WAS MOVED, AND WHAT DELIBERATELY WAS NOT ────────────────────────────────────────────
//
// Moved: buffering, filtering, the covered-day set and its budget, the triangle call, the acquirer
// de-dup, the kas/factuur branch, computeResult, and every count in the response.
//
// Not moved: the reads. compute-result-range.ts still owns the eleven queries, in the same order,
// with the same error handling — including the two soft ones whose failure modes are documented
// there (the PIN ledger, which can only make the reconciliation look CLEANER than it is, and the
// turnover read, which must throw rather than silently shrink revenue).
//
// This is a REFACTOR: the code below is the original body, moved rather than rewritten, so that
// the tests it now admits are testing what already shipped. Where a comment explains a decision it
// travelled with the code it explains.

import {
  computeResult, toResultBankTx, cardBudgetBound,
  type RawBankRow, type ResultInvoice, type ResultBankTx, type ResultCashEntry, type FinancialResult,
} from "./financial-result";
import { turnoverNetOmzet, type DailyTurnover } from "./turnover";
import { reconcileTriangle, bankNetByDay } from "./triangle";
import { netCommissionToBook, ACQUIRER_VENDOR_RE } from "./card-reconcile";
import type { EftSettlement } from "./eft-parser";
import type { VatScheme } from "./vat-scheme";
import { exemptShareOf } from "./vat-exemption";
import { round2 } from "./invoice-totals";
import type { RateShare } from "./btw-rate-split";
import { statedCommission, type StatedCommission } from "./pos-commission";
import type { QuarterSettlements } from "./kas-payment-events";

// ── The pure helpers the fetch half needs too, so they live on this side of the seam ──────────

/**
 * [FIN-4] Infer a NULL direction from ownership (the owner is the receiver of an incoming
 * invoice) — the SAME rule effectiveDirection / aangifte / readiness use — so a null-direction
 * row is never dropped and the result never diverges from the concept.
 */
export function effDirOf(
  i: { direction: string | null; receiver_id: string | null },
  ownerId: string,
): "incoming" | "outgoing" {
  return i.direction === "incoming" || i.direction === "outgoing"
    ? i.direction
    : i.receiver_id === ownerId ? "incoming" : "outgoing";
}

function pad(n: number): string { return String(n).padStart(2, "0"); }

/** Shift an ISO 'YYYY-MM-DD' by whole days via UTC (no local-TZ drift). */
export function isoShiftDays(iso: string, days: number): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return iso;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  d.setUTCDate(d.getUTCDate() + days);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

/** The settlement-lag buffer, in days, on both edges of the window. One definition, two edges. */
export const SETTLEMENT_BUFFER_DAYS = 5;

// ── The rows ─────────────────────────────────────────────────────────────────────────────────

/** An invoices row as the window fetch selects it. */
export interface RangeInvoiceRow {
  id?: string | null;
  direction: string | null;
  status: string | null;
  total_ex_btw: number | null;
  btw_amount: number | null;
  invoice_date?: string | null;
  sender_id?: string | null;
  receiver_id: string | null;
  client_name?: string | null;
}

/** A cash_entries row as the window fetch selects it. */
export interface RangeCashRow {
  direction: string | null;
  amount: number | null;
  category: string | null;
  btw_rate: number | null;
  entry_date: string | null;
  document_id?: string | null;
}

/** A daily_turnover row as the buffered fetch selects it. */
export interface RangeTurnoverRow {
  turnover_date: string;
  base_0: number | null; base_9: number | null; base_21: number | null;
  btw_9: number | null; btw_21: number | null; total_incl: number | null;
  pin_amount: number | null; cash_amount: number | null; other_amount: number | null;
}

/** An eft_settlements row as the buffered fetch selects it. */
export interface RangeEftRow {
  settlement_date: string | null; terminal_id: string | null; period_nr: string | null;
  shift_nr: string | null; period_start: string | null; period_end: string | null;
  first_trx: string | null; last_trx: string | null; gross_total: number | null;
  tx_count: number | null; by_scheme: unknown;
}

/** A ledger_daily row (kind='pin') as the in-window fetch selects it. */
export interface RangeLedgerRow {
  ledger_date: string;
  received: number | null;
  spent: number | null;
}

/**
 * Everything the cash-basis branch needs, already fetched.
 *
 * Null on the accrual path — which is the default and almost every owner — so a factuur window
 * carries no kas-shaped input at all rather than an empty one that reads as "no settlements".
 */
export interface RangeKasInputs extends QuarterSettlements {
  /** The distinct sales invoices the settlements reference, header amounts only. */
  settledSales: Array<{ id: string; total_ex_btw: number | null; btw_amount: number | null }>;
  /** Their rate mix, fetched separately because they can predate this window entirely. */
  settledShares: ReadonlyMap<string, RateShare[]>;
  /** And their exempt ex-BTW amounts, for the same reason. */
  settledExempt: ReadonlyMap<string, number>;
  /** vat_deduction for the PURCHASE invoices the settlements reference. */
  settledDeductionByInvoice: ReadonlyMap<string, string | null>;
}

/** Every row and every already-resolved fact the window needs. Assembled by the fetch half. */
export interface RangeInputs {
  ownerId: string;
  /** Inclusive ISO window bounds. */
  start: string;
  end: string;
  scheme: VatScheme;
  /** Null when the caller passed an explicit scheme, so no profile was read to straddle against. */
  span: { spansSchemeChange: boolean; schemeSince: string | null } | null;
  invRows: readonly RangeInvoiceRow[];
  /** [VRIJGESTELD] The exempt regime for this window, from the one shared collector. */
  exemption: { active: boolean; deductionByInvoice: ReadonlyMap<string, string | null> };
  /** [RUBRIEK-SPLIT] The rate mix of the in-window SALES invoices, read from their own lines. */
  rateSharesByInvoice: ReadonlyMap<string, RateShare[]>;
  exemptExByInvoice: ReadonlyMap<string, number>;
  /** Bank lines over the ±5-day BUFFER window — read once, both legs derived from it. */
  bankBufRows: readonly RawBankRow[];
  cashRows: readonly RangeCashRow[];
  /** daily_turnover over the ±5-day buffer window. */
  turnoverRows: readonly RangeTurnoverRow[];
  /** eft_settlements over the ±5-day buffer window. */
  eftRows: readonly RangeEftRow[];
  /** ledger_daily (kind='pin'), in-window only. */
  pinLedgerRows: readonly RangeLedgerRow[];
  /** FALSE when that read failed — the flag travels out, see RangeResult.reconciliation. */
  pinLedgerAvailable: boolean;
  /** Null on the accrual path. */
  kas: RangeKasInputs | null;
  /** [DATELESS] Verified invoices with NO invoice_date. Empty under kas, where it does not apply. */
  datelessRows: readonly RangeInvoiceRow[];
}

export interface RangeResult {
  result: FinancialResult;
  datelessVerifiedCount: number;
  // [KASSTELSEL] Under cash basis: paid money we could NOT date (undatedPaidCount) MUST block
  // klaar/aangifte — it would otherwise silently under-declare. estimatedPortionCount counts
  // invoices whose paid-date is only an estimate (marked_paid_at). Both 0 under factuur.
  undatedPaidCount: number;
  estimatedPortionCount: number;
  // [COMPLETENESS] Purchase invoices dated in this window that are still in the verify queue
  // ('processing'). Their amount and BTW are NOT in the figures, so the window is knowingly too
  // low. Computed here — from the SAME rows and the SAME effective-direction rule the figures use
  // — so the filing gate and every screen count it identically and cannot drift apart.
  unconfirmedIncomingCount: number;
  scheme: VatScheme;
  // [SCHEME-SPAN] TRUE when [start, end] straddles the owner's factuur→kas switch, so no single
  // basis is right for it: the figures use `scheme` (resolved at `start`, which never rewrites an
  // already-filed period) and the surface must say the window crosses the switch rather than
  // present a one-basis number for a two-basis period. Always false for a single-quarter window
  // and for every factuur owner. `schemeSince` is the owner's kas effective date, for the copy.
  spansSchemeChange: boolean;
  schemeSince: string | null;
  reconciliation: {
    totalCommission: number;
    commissionBooked: number;
    acquirerFeeInvoices: number;
    grossMismatchDays: number;
    incompleteDays: number;
    // [EXCEPTION-COUNT] Days whose payout/commission is suspect and therefore books NO commission.
    // Counted in neither of the two above (a day carries exactly one status), so the three are
    // safe to sum.
    commissionIssueDays: number;
    eftSettlements: number;
    // [LEDGER-READ] FALSE when the bookkeeper's PIN ledger could not be read (the table may not
    // exist on every deployment yet). The ledger only ever ADDS gross-mismatch detections, so a
    // failed read makes the reconciliation look CLEANER than it is — the caller must be able to say
    // "this cross-check did not run" instead of showing a silently weaker all-clear.
    pinLedgerAvailable: boolean;
    // [COM-IN-DE-REGEL] The acquirer commission the BANK LINE states outright (`BRUTO … /COM …`),
    // summed over the in-window card payouts that proved their own arithmetic. See
    // pos-commission.ts for why it verifies rather than parses.
    //
    statedCommission: StatedCommission;
    // TRUE when the figure above was folded into `commissionBooked` and therefore into kosten.
    // FALSE when it is reported only — see the guard at statedIsBookable for exactly when, and
    // why the ambiguous case is held back rather than guessed at. Never quietly true: a surface
    // that says "found" about money the books do not contain is the failure this flag prevents.
    statedCommissionBooked: boolean;
  };
}

/**
 * The reconciled result for one owner over [start, end], from rows alone.
 *
 * Every branch below is the original computeResultForRange body; only the awaits are gone.
 */
export function assembleRangeResult(inputs: RangeInputs): RangeResult {
  const {
    ownerId, start, end, scheme, span, invRows, exemption,
    rateSharesByInvoice, exemptExByInvoice, bankBufRows, cashRows,
    turnoverRows, eftRows, pinLedgerRows, pinLedgerAvailable, kas, datelessRows,
  } = inputs;

  const invoices: ResultInvoice[] = invRows.map((i) => ({
    direction: effDirOf(i, ownerId),
    status: i.status,
    total_ex_btw: i.total_ex_btw,
    btw_amount: i.btw_amount,
    // [RUBRIEK-SPLIT] Present only on a mixed-rate sales invoice; everything else keeps the
    // header-derived rate exactly as before.
    rate_lines: i.id ? rateSharesByInvoice.get(i.id) ?? null : null,
    exempt_ex: i.id ? exemptExByInvoice.get(i.id) ?? null : null,
    vat_deduction: i.id ? exemption.deductionByInvoice.get(i.id) ?? null : null,
  }));

  // The RESULT leg stays strictly in-window: the buffer days exist only to key the triangle, and
  // booking their money here would move revenue/cost into a period that does not own it. A NULL
  // date cannot be placed in any window, exactly as the old date-bounded query implied.
  const bankTx: ResultBankTx[] = bankBufRows
    .filter((b) => b.date != null && b.date >= start && b.date <= end)
    .map(toResultBankTx);

  const cashEntries: ResultCashEntry[] = cashRows.map((c) => ({
    direction: c.direction === "in" ? "in" : "out",
    amount: c.amount, category: c.category, btw_rate: c.btw_rate,
    date: c.entry_date,
    document_id: c.document_id ?? null, // [CASH-COST-VAT]
  }));

  const allTurnover: DailyTurnover[] = turnoverRows.map((t) => ({
    turnover_date: t.turnover_date,
    base_0: t.base_0 ?? 0, base_9: t.base_9 ?? 0, base_21: t.base_21 ?? 0,
    btw_9: t.btw_9 ?? 0, btw_21: t.btw_21 ?? 0,
    total_incl: t.total_incl, pin_amount: t.pin_amount, cash_amount: t.cash_amount, other_amount: t.other_amount,
  }));

  // Revenue rows: strictly in-window [start, end]. The +5 buffer days exist ONLY to anchor the
  // triangle's cross-boundary re-attribution — they must NEVER enter omzet (that would book a
  // next-quarter sale here). Covered set: revenue rows in [start−5, end] (a payout settling into the
  // window from a pre-window sale is suppressed; a +5 next-quarter day must NOT suppress anything).
  const turnover = allTurnover.filter((t) => t.turnover_date >= start && t.turnover_date <= end);
  const coveredDates = new Set(
    allTurnover
      .filter((t) => t.turnover_date <= end && (turnoverNetOmzet(t) > 0 || (t.total_incl ?? 0) > 0))
      .map((t) => t.turnover_date),
  );

  const eftSettlements: EftSettlement[] = eftRows.map((e) => ({
    terminalId: e.terminal_id, periodNr: e.period_nr, shiftNr: e.shift_nr,
    periodStart: e.period_start, periodEnd: e.period_end, firstTrx: e.first_trx, lastTrx: e.last_trx,
    settlementDate: e.settlement_date, grossTotal: e.gross_total ?? 0, txCount: e.tx_count ?? 0,
    byScheme: (Array.isArray(e.by_scheme) ? e.by_scheme : []) as unknown as EftSettlement["byScheme"],
  }));

  // [ONE-BANK-READ] Sliced out of the single buffered bank read, using toResultBankTx — the SAME
  // "is this a card payout?" decision the omzet-suppression leg makes. Asking the database for
  // `category = 'pos_income'` instead silently dropped the commission on every acquirer payout the
  // owner had tapped as plain 'omzet'.
  // [COM-IN-DE-REGEL] Only the IN-WINDOW payouts state this window's commission. A buffer line
  // belongs to the neighbouring window, exactly as its money does — the same clip as bankTx.
  const statedCommissionInWindow = statedCommission(
    bankBufRows.filter((b) => b.date != null && b.date >= start && b.date <= end),
  );

  const posBufRows = bankBufRows.filter((b) => toResultBankTx(b).posSettlement);
  const netByDay = bankNetByDay(posBufRows.map((b) => ({ description: b.description, amount: b.amount, date: b.date })));

  const pinLedgerByDay = new Map<string, number>();
  for (const r of pinLedgerRows) if (r.ledger_date) pinLedgerByDay.set(r.ledger_date, (Number(r.received) || 0) - (Number(r.spent) || 0));

  // [CROSS-QUARTER] Feed the BUFFERED turnover (allTurnover, [start−5, end+5]) as anchors so a
  // boundary takings day can catch its cross-edge payout; windowStart/windowEnd then restrict which
  // days actually book commission to [start, end], so the fee lands in exactly the owning quarter.
  const triangle = reconcileTriangle({
    turnover: allTurnover,
    eftSettlements,
    bankNetByDay: netByDay,
    pinLedgerByDay,
    windowStart: start,
    windowEnd: end,
  });

  // Acquirer-fee invoices already booked as kosten — subtract so the commission delta isn't
  // double-counted. Gated to the SAME statuses computeResult books as kosten (paid/received).
  const INCOMING_OK = new Set(["paid", "received"]);
  const acquirerFeesBooked = invRows
    .filter((i) =>
      effDirOf(i, ownerId) === "incoming" &&
      INCOMING_OK.has(i.status ?? "") &&
      ACQUIRER_VENDOR_RE.test(i.client_name ?? ""))
    .reduce((s, i) => s + (i.total_ex_btw ?? 0) + (i.btw_amount ?? 0), 0);

  // [COM-IN-DE-REGEL] Is this window's bank-stated commission safe to BOOK, or only to report?
  //
  // The guard is the whole window rather than the day, and that is the careful choice, not the
  // lazy one. Leg B books per DAY, keyed on the takings day. A stating bank line keys on its
  // BOOKING day — its `DAT.` field is a week number (202618), not a date, so parsePosSettlement
  // returns null and the booking date is used. Those two keys can name different days for the same
  // money, so a per-day overlap test would compare keys that do not mean the same thing, and its
  // failure mode is one commission booked twice in somebody's books, silently, with every total
  // downstream carrying it into the aangifte.
  //
  // When the window holds NO EFT settlement, Leg B booked nothing anywhere in it, so there is
  // provably nothing to overlap. That covers every shop in production today — eft_settlements is
  // empty across the whole database — so the automatic path reaches all of them, while the one
  // ambiguous combination stays reported-only until real data carrying both exists to verify a
  // finer rule against. Reported-only is not a gap here: the figure still travels out, and
  // `statedCommissionBooked` tells the surface exactly which of the two it is looking at.
  const statedIsBookable = eftSettlements.length === 0 && statedCommissionInWindow.total > 0;
  const rawCommission = round2(
    triangle.totalCommission + (statedIsBookable ? statedCommissionInWindow.total : 0),
  );
  const commissionToBook = netCommissionToBook(rawCommission, acquirerFeesBooked);

  // [CARD-BUDGET] Per covered day, the max bank revenue it may suppress as till card takings.
  const coveredBudget = new Map(
    allTurnover
      // [CROSS-QUARTER] Same [start−5, end] bound as coveredDates — the +5 anchor days must not add
      // a next-quarter suppression budget (they exist only to anchor the triangle).
      .filter((t) => t.turnover_date <= end && (turnoverNetOmzet(t) > 0 || (t.total_incl ?? 0) > 0))
      .map((t) => [t.turnover_date, cardBudgetBound(t)] as const),
  );

  // [KASSTELSEL] Under cash basis, the invoice leg is driven by SETTLEMENTS (BTW on the paid
  // date), not the invoice_date. Only the invoice leg changes: the bank/cash/turnover legs are
  // already payment-dated (a till sale, a bank credit, a cash entry all happen when money moves),
  // so they stay identical. The acquirer-commission auto-book is disabled under kas (its cost is
  // deductible when the acquirer's invoice is PAID, booked via that invoice's own settlement — so
  // auto-booking the triangle delta here would place it in the wrong period / double-count).
  let undatedPaidCount = 0;
  let estimatedPortionCount = 0;
  // [VRIJGESTELD] The regime and the cost attributions belong to BOTH bases — the kas branch
  // below only adds the settlement-shaped inputs on top. Seeding them here is what stops the
  // accrual path (the default, and almost every owner) from silently skipping the apportionment
  // because the exempt inputs happened to live in a variable named after the other scheme.
  let kasOpts: Parameters<typeof computeResult>[7] = {
    exemptRegime: exemption.active,
    deductionByInvoice: new Map(exemption.deductionByInvoice),
    exemptShareByInvoice: exemptShareOf(invRows, exemptExByInvoice),
  };
  if (scheme === "kas" && kas) {
    undatedPaidCount = kas.undatedPaidCount;
    estimatedPortionCount = kas.estimatedCount;
    kasOpts = {
      // Spread, never replace: exemptRegime and deductionByInvoice were seeded above and belong
      // to both bases. Assigning a fresh object here is how they would silently disappear for
      // every kasstelsel owner — the accrual path apportioning correctly while the cash-basis
      // one deducted everything, which is the harder bug to ever notice.
      ...kasOpts,
      scheme: "kas",
      settlements: kas.events,
      priorByInvoice: kas.priorByInvoice,
      // [VRIJGESTELD] Merged the same way the rate mix is: the settlements reach invoices from
      // earlier windows that this window's own map knows nothing about.
      exemptShareByInvoice: new Map([
        ...exemptShareOf(kas.settledSales, kas.settledExempt),
        ...exemptShareOf(invRows, exemptExByInvoice),
      ]),
      rateSharesByInvoice: new Map([...kas.settledShares, ...rateSharesByInvoice]),
      // [VRIJGESTELD · KASSTELSEL] And the PURCHASE side of the same argument. kasOpts was seeded
      // with the attributions of the invoices DATED in this window; the costs a cash-basis window
      // actually books are the ones SETTLED in it, and those routinely belong to invoices dated
      // earlier. A settled cost with no attribution falls to the pro-rata bucket, so an owner who
      // marked a cost 'direct_taxed' loses part of a deduction they were fully entitled to.
      deductionByInvoice: new Map([
        ...kas.settledDeductionByInvoice,
        ...exemption.deductionByInvoice,
      ]),
    };
  }
  // [KASSTELSEL] Under cash basis the triangle delta is NOT auto-booked (see the note above), so
  // the honest figure for "commission actually booked as a cost" is zero. Reporting
  // commissionToBook regardless made the response claim a cost the result never contained.
  const commissionActuallyBooked = scheme === "kas" ? 0 : commissionToBook;
  const result = computeResult(
    invoices, bankTx, cashEntries, turnover, coveredDates,
    commissionActuallyBooked, coveredBudget, kasOpts,
  );

  // [COMPLETENESS] Purchase invoices in this window still sitting in the verify queue. Their money
  // is NOT in the figures above, so the window is knowingly too low — the filing gate blocks on
  // this, and until now the truth screen never mentioned it, which is how an owner reached
  // "Markeer als ingediend" and met a 409 about a problem no screen had shown.
  // The effective-direction rule is effDirOf, NOT a `direction = 'incoming'` filter: a purchase
  // invoice whose direction column is NULL is inferred from ownership everywhere else in this
  // engine ([FIN-4]), and a gate that filtered on the column alone simply did not see those rows.
  const unconfirmedIncomingCount = invRows.filter(
    (i) => effDirOf(i, ownerId) === "incoming" && i.status === "processing",
  ).length;

  // [DATELESS] Under FACTUUR: verified invoices with NO invoice_date are dropped by the date-range
  // fetch, so they are absent from the figures — count them (same rule as /api/aangifte) so the
  // surface can warn. Under KAS the invoice_date is irrelevant (invoices enter by payment date);
  // the analogous "money we can't place" signal is undatedPaidCount, computed above.
  const OUTGOING_OK = new Set(["paid", "sent", "overdue"]);
  const datelessVerifiedCount = scheme === "kas" ? 0 : datelessRows.filter((i) => {
    const dir = effDirOf(i, ownerId);
    return dir === "incoming" ? INCOMING_OK.has(i.status ?? "") : OUTGOING_OK.has(i.status ?? "");
  }).length;

  return {
    result,
    datelessVerifiedCount,
    undatedPaidCount,
    estimatedPortionCount,
    unconfirmedIncomingCount,
    scheme,
    // An explicit `args.scheme` (tests, or a caller that already resolved it) means no profile was
    // read, so there is nothing to report a straddle against.
    spansSchemeChange: span?.spansSchemeChange ?? false,
    schemeSince: span?.schemeSince ?? null,
    reconciliation: {
      totalCommission: triangle.totalCommission,
      commissionBooked: commissionActuallyBooked,
      acquirerFeeInvoices: round2(acquirerFeesBooked),
      grossMismatchDays: triangle.grossMismatchDays,
      incompleteDays: triangle.incompleteDays,
      commissionIssueDays: triangle.commissionIssueDays,
      eftSettlements: eftSettlements.length,
      pinLedgerAvailable,
      statedCommission: statedCommissionInWindow,
      statedCommissionBooked: statedIsBookable && scheme !== "kas",
    },
  };
}
