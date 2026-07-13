// src/lib/turnover.ts
// [TURNOVER] Phase 1 — pure helpers for daily till/POS turnover (dagomzet), split by
// BTW rate, plus the reconciliation against bank pos_income settlements and the cash
// book. No I/O, fully testable (run: npx tsx src/lib/turnover.test.ts).
//
// A retail day's revenue is the Z-report: one day mixes 0% / 9% / 21% turnover across
// pin / contant / overig. These helpers turn that into per-rate net revenue + BTW, and
// reconcile the THREE independent witnesses of the same money:
//   1. the till   — this turnover row (pin_amount / cash_amount expected)
//   2. the bank   — pos_income lines that SETTLED that day's card takings
//   3. the drawer — cash-book omzet entries counted that day
// A gap between them is a real signal (a missing bon, a skim, a timing lag) — it is
// SURFACED as a break, never guessed away.

export interface DailyTurnover {
  turnover_date: string;       // ISO 'YYYY-MM-DD'
  base_0: number;              // net taxable base per rate (excl. BTW)
  base_9: number;
  base_21: number;
  btw_9: number;
  btw_21: number;
  pin_amount: number | null;   // payment-method split (reconciliation keys)
  cash_amount: number | null;
  other_amount: number | null;
}

/** Net revenue (ex-BTW) of a turnover day: the three per-rate bases summed. */
export function turnoverNetOmzet(t: DailyTurnover): number {
  return (t.base_0 ?? 0) + (t.base_9 ?? 0) + (t.base_21 ?? 0);
}

/**
 * BTW verschuldigd of a turnover day, kept PER RATE (0% contributes nothing). The result
 * engine needs the split — a single collapsed total cannot fill rubriek 1a (21%) vs 1b
 * (9%) of the aangifte. Values come straight from the Z-report; we do not re-derive them
 * from base × rate (the till already rounded per line — trust its documented figure).
 */
export function turnoverBtw(t: DailyTurnover): { r9: number; r21: number; total: number } {
  const r9 = t.btw_9 ?? 0;
  const r21 = t.btw_21 ?? 0;
  return { r9, r21, total: r9 + r21 };
}

/**
 * A bank pos_income line (card-terminal / PSP settlement) embeds the ORIGINAL takings
 * date and transaction count in its description, e.g.
 *   "AFREK. BETAALAUTOMAAT MAES ... DAT. 20260404/6094 AANT. 31 MREFNR. KFM".
 * Parsing "DAT. YYYYMMDD" lets us reconcile a settlement to the exact turnover DAY,
 * independent of when the money actually landed (settlement lags a day and PSPs batch,
 * so the transaction's own booking date is the wrong key). Returns the ISO date + count,
 * or nulls when the markers are absent (a non-POS line, or a bank that does not emit
 * them — then the caller falls back to a date window).
 */
export function parsePosSettlement(
  description: string | null | undefined,
): { date: string | null; count: number | null } {
  if (!description) return { date: null, count: null };
  const d = description.match(/DAT\.\s*(\d{4})(\d{2})(\d{2})/);
  const a = description.match(/AANT\.\s*(\d+)/);
  return {
    date: d ? `${d[1]}-${d[2]}-${d[3]}` : null,
    count: a ? Number(a[1]) : null,
  };
}

export interface ReconcileInput {
  turnover: DailyTurnover;
  /** Σ bank pos_income amounts whose parsed DAT == turnover_date (positive euros). */
  posSettledForDay: number;
  /** Σ cash-book omzet entries for that date (positive euros). */
  cashCountedForDay: number;
  /** Absolute euro tolerance for rounding / minor drift. Default €0.02. */
  tolerance?: number;
}

export interface ReconcileBreak {
  kind: "pin" | "cash";
  expected: number;            // what the Z-report says the day took by that method
  actual: number;             // what the bank settled / the drawer counted
  diff: number;               // actual − expected (signed; + = more than the till said)
}

/**
 * Compare a turnover day's EXPECTED pin/cash (from the Z-report) against what the bank
 * actually settled and what the cash book counted. Returns one break per witness that
 * disagrees beyond tolerance; an empty array means the three witnesses agree — the day
 * is "true". Pure: the caller fetches and sums the bank/cash figures. A missing expected
 * value (null) is treated as 0, so an unrecorded method still surfaces as a break rather
 * than passing silently.
 */
export function reconcileDay(input: ReconcileInput): ReconcileBreak[] {
  const tol = input.tolerance ?? 0.02;
  const breaks: ReconcileBreak[] = [];

  const pinExpected = input.turnover.pin_amount ?? 0;
  const pinDiff = input.posSettledForDay - pinExpected;
  if (Math.abs(pinDiff) > tol) {
    breaks.push({ kind: "pin", expected: pinExpected, actual: input.posSettledForDay, diff: pinDiff });
  }

  const cashExpected = input.turnover.cash_amount ?? 0;
  const cashDiff = input.cashCountedForDay - cashExpected;
  if (Math.abs(cashDiff) > tol) {
    breaks.push({ kind: "cash", expected: cashExpected, actual: input.cashCountedForDay, diff: cashDiff });
  }

  return breaks;
}
