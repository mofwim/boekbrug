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
//
// KNOWN LIMITATION (documented for G4): a card settlement credited to the bank may be
// NET of PSP/scheme fees while the till's pin_amount is GROSS. The tolerance below is a
// percentage floor so a small per-batch fee does not fire a break every day, but true
// fee modeling (reconcile against the gross terminal batch, or subtract an expected fee)
// needs real settlement data and is deferred. A residual pin break is informational.

import { round2 } from './invoice-totals'

export interface DailyTurnover {
  turnover_date: string;       // ISO 'YYYY-MM-DD'
  base_0: number;              // net taxable base per rate (excl. BTW)
  base_9: number;
  base_21: number;
  btw_9: number;
  btw_21: number;
  total_incl: number | null;   // gross turnover as printed (cross-check; may be absent)
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
 * them — then the caller falls back to a date window / the booking date).
 *
 * The date is calendar-validated (month 01-12, day 01-31): a corrupt "DAT. 20261345"
 * returns date=null so the caller falls back rather than keying a settlement to a date
 * string that can never match any turnover_date (which would SILENTLY drop it).
 */
export function parsePosSettlement(
  description: string | null | undefined,
): { date: string | null; count: number | null } {
  if (!description) return { date: null, count: null };
  const d = description.match(/DAT\.\s*(\d{4})(\d{2})(\d{2})/);
  const a = description.match(/AANT\.\s*(\d+)/);
  let date: string | null = null;
  if (d) {
    // Real calendar validation (round-trip), not just 1-31: Feb 31 / Apr 31 roll over to
    // another month, so getUTCDate no longer matches → rejected. A corrupt date returns
    // null so the caller falls back to the booking date instead of keying garbage.
    const y = Number(d[1]), mo = Number(d[2]), dy = Number(d[3]);
    const probe = new Date(Date.UTC(y, mo - 1, dy));
    if (probe.getUTCFullYear() === y && probe.getUTCMonth() === mo - 1 && probe.getUTCDate() === dy) {
      date = `${d[1]}-${d[2]}-${d[3]}`;
    }
  }
  return { date, count: a ? Number(a[1]) : null };
}

/** One bank line as needed to sum card settlements. */
export interface PosSettlementLine {
  description: string | null;
  amount: number | null;      // signed as stored — credits positive, refunds negative
}

/**
 * Sum ALL pos_income settlement lines that key to one takings day. A retail day settles
 * across several card schemes (MAES / VPAY / VIDB / DBMC), each its own bank line sharing
 * the same "DAT." — so a caller MUST sum them, not read one. This helper owns that (an ad
 * hoc caller that read a single line would silently under-count pin). Also returns the
 * combined AANT count (transactions), a free cross-check against the till's ticket count.
 */
export function sumPosSettlements(
  lines: PosSettlementLine[],
  date: string,
): { total: number; count: number; matchedLines: number } {
  let total = 0;
  let count = 0;
  let matchedLines = 0;
  for (const l of lines) {
    const p = parsePosSettlement(l.description);
    if (p.date === date) {
      // SIGNED sum, not magnitude: a card REFUND settles as a negative bank line and must
      // be SUBTRACTED. Math.abs would flip it positive and inflate the day's pin, both
      // fabricating false breaks and masking real skims.
      total += l.amount ?? 0;
      count += p.count ?? 0;
      matchedLines += 1;
    }
  }
  return { total, count, matchedLines };
}

// [SETTLE-LAG] The ONE shared settlement-lag window (days) for card/PIN acquirer payouts. A payout
// posts T+0..T+5 after the takings day (a long weekend + a bank holiday can stretch a batch to five
// days), never before. TWO engines must look back the SAME number of days or they disagree on
// whether a payout is even attributable:
//   · financial-result.matchedCoveredDay looks back this many days to SUPPRESS the till's already-
//     counted omzet near the real takings day (no double-count).
//   · triangle re-attributes a DAT-less payout back this many days to a takings day so the acquirer
//     COMMISSION (gross − net) is booked there (not silently dropped).
// The window must match: with triangle at 3 and financial-result at 5, a T+4/T+5 DAT-less payout had
// its omzet suppressed but its fee orphaned on the payout day → commission lost → resultaat
// overstated. (The two still pick the exact day by slightly different tie-breaks when SEVERAL covered
// days sit in the window — a pre-existing detail card-reconcile guards via commission_negative — but
// the window length itself must never drift, which is why it lives here.)
export const SETTLE_LAG_DAYS = 5;

/**
 * The takings DAY a card/PIN bank line belongs to: the settlement's embedded "DAT." date when the
 * terminal printed it, else the bank BOOKING date as a fallback (which may itself be null when the
 * line carries neither). Shared by triangle + financial-result so the DAT-else-booking rule can
 * never drift between them. Pure.
 */
export function posTakingsDay(description: string | null, bookingDate: string | null): string | null {
  return parsePosSettlement(description).date ?? bookingDate;
}

export interface ReconcileInput {
  turnover: DailyTurnover;
  /** Σ bank pos_income amounts whose parsed DAT == turnover_date (positive euros). */
  posSettledForDay: number;
  /** Σ cash-book omzet entries for that date (positive euros). */
  cashCountedForDay: number;
  /** Absolute euro tolerance floor for rounding. Default €0.02. */
  tolerance?: number;
  /** Relative tolerance floor (fraction of the expected figure). Default 0.5%. */
  tolerancePct?: number;
}

export interface ReconcileBreak {
  kind: "pin" | "cash" | "internal" | "unknown";
  expected: number;            // what the till says (or the printed total, for internal)
  actual: number;             // what the bank settled / drawer counted / methods sum
  diff: number;               // actual − expected (signed; + = more than the till said)
  note?: string;
}

/**
 * Compare a turnover day's EXPECTED pin/cash (from the Z-report) against what the bank
 * actually settled and what the cash book counted, PLUS the Z-report's own internal
 * identity. Returns one break per witness that disagrees beyond tolerance; an empty array
 * means everything ties out — the day is "true". Pure: the caller fetches and sums the
 * bank/cash figures (see sumPosSettlements).
 *
 * Honesty guards (a silent "reconciled" on absent data is the enemy):
 *   - A method the Z-report never recorded (pin_amount / cash_amount = null) does NOT
 *     pass silently against a 0 settlement: if the day has revenue it emits an 'unknown'
 *     break so the gap is visible.
 *   - The internal identity (pin+contant+overig ≈ total_incl, and omzet+BTW ≈ total_incl)
 *     is checked so a day whose parts don't add up to its own printed total surfaces even
 *     when each part looks individually plausible.
 * Tolerance is a percentage floor (max of an absolute €0.02 and 0.5% of the expected),
 * compared on integer cents to avoid IEEE-754 boundary false breaks.
 */
export function reconcileDay(input: ReconcileInput): ReconcileBreak[] {
  const t = input.turnover;
  const absTol = input.tolerance ?? 0.02;
  const pctTol = input.tolerancePct ?? 0.005;
  const breaks: ReconcileBreak[] = [];

  const within = (diff: number, expected: number): boolean => {
    const diffCents = Math.round(diff * 100);
    const tolCents = Math.round(Math.max(absTol, pctTol * Math.abs(expected)) * 100);
    return Math.abs(diffCents) <= tolCents;
  };
  const hasRevenue = turnoverNetOmzet(t) > 0 || (t.total_incl ?? 0) > 0;

  // ── pin ──
  if (t.pin_amount == null) {
    if (hasRevenue) {
      breaks.push({ kind: "unknown", expected: 0, actual: input.posSettledForDay,
        diff: input.posSettledForDay, note: "pin_amount ontbreekt op de Z-bon" });
    }
  } else {
    const diff = input.posSettledForDay - t.pin_amount;
    if (!within(diff, t.pin_amount)) {
      breaks.push({ kind: "pin", expected: t.pin_amount, actual: input.posSettledForDay, diff });
    }
  }

  // ── cash ──
  if (t.cash_amount == null) {
    if (hasRevenue) {
      breaks.push({ kind: "unknown", expected: 0, actual: input.cashCountedForDay,
        diff: input.cashCountedForDay, note: "cash_amount ontbreekt op de Z-bon" });
    }
  } else {
    const diff = input.cashCountedForDay - t.cash_amount;
    if (!within(diff, t.cash_amount)) {
      breaks.push({ kind: "cash", expected: t.cash_amount, actual: input.cashCountedForDay, diff });
    }
  }

  // ── internal identity (only when the printed gross total is present) ──
  if (t.total_incl != null) {
    const methods = (t.pin_amount ?? 0) + (t.cash_amount ?? 0) + (t.other_amount ?? 0);
    const mDiff = methods - t.total_incl;
    if (!within(mDiff, t.total_incl)) {
      breaks.push({ kind: "internal", expected: t.total_incl, actual: methods, diff: mDiff,
        note: "pin+contant+overig ≠ totaal" });
    }
    const gross = turnoverNetOmzet(t) + turnoverBtw(t).total;
    const gDiff = gross - t.total_incl;
    if (!within(gDiff, t.total_incl)) {
      breaks.push({ kind: "internal", expected: t.total_incl, actual: gross, diff: gDiff,
        note: "omzet+BTW ≠ totaal" });
    }
  }

  return breaks;
}

// ── [TURNOVER-ARITHMETIC] Can this day's numbers be true at all? ──────────────
//
// daily_turnover is BTW-AUTHORITATIVE: /api/aangifte reads btw_9 and btw_21 straight out of it and
// puts them in rubriek 1a/1b as tax you OWE. And /api/turnover/import wrote them from the request
// body with nothing but a numeric coercion — it checked the DATE three ways (real calendar day, not
// in the future, no duplicate day) and never once looked at the money.
//
// So a day could be stored with base_9 = 100 and btw_9 = 52 and go straight into the return. Both
// directions cost: overstated, you pay the Belastingdienst money you do not owe; understated, the
// return is wrong. The parser in turnover-import.ts derives the split correctly, but a server that
// trusts the client's arithmetic is not a guard — the same sentence stands over the amount-
// correction route.
//
// This does NOT re-derive the amounts. turnoverBtw above says why in as many words: the till
// already rounded per line, and its documented figure is the one that belongs in the books. What
// this asks is only whether the figure could be true — 52% on a 9% base could not.

/** One thing about a day that cannot be true. */
export interface TurnoverArithmeticBreak {
  kind: "rate_9" | "rate_21" | "total";
  /** Dutch — this is shown to the owner. See the language rule in AGENTS.md. */
  note: string;
  expected: number;
  actual: number;
}

/**
 * Deliberately loose.
 *
 * A Z-report is the sum of hundreds of per-line roundings, so the day's btw legitimately drifts
 * from base × rate by cents. Two percent of the expected btw (never less than fifty cents) is far
 * more than any accumulation of half-cent roundings and far less than any real mistake: swapping
 * 9% for 21% is off by 133%, and the misreads that put this on the list are multiples out. A tight
 * tolerance here would reject honest days, and a gate that rejects honest work gets switched off.
 */
const RATE_ABS_TOLERANCE = 0.5;
const RATE_PCT_TOLERANCE = 0.02;
/** The identity is exact arithmetic on figures already rounded — cents, not percentages. */
const TOTAL_ABS_TOLERANCE = 0.05;
const TOTAL_PCT_TOLERANCE = 0.005;

function rateBreak(
  kind: "rate_9" | "rate_21",
  base: number,
  btw: number,
  rate: number,
): TurnoverArithmeticBreak | null {
  // Signed, not magnitude: a correction day with more refunds than sales has a negative base, and
  // its btw is negative too. Comparing signed values gets that right for free, and would catch a
  // negative base carrying a positive btw — which no till produces.
  const expected = round2(base * (rate / 100));
  const tolerance = Math.max(RATE_ABS_TOLERANCE, RATE_PCT_TOLERANCE * Math.abs(expected));
  if (Math.abs(btw - expected) <= tolerance) return null;
  return {
    kind,
    expected,
    actual: btw,
    note:
      Math.abs(base) < 0.005
        ? `er staat ${rate}% btw op deze dag terwijl er geen omzet tegen ${rate}% tegenover staat`
        : `de ${rate}% btw past niet bij de ${rate}%-omzet van deze dag`,
  };
}

/**
 * Everything about one day's figures that cannot be true, or an empty list.
 *
 * Pure. It decides nothing about what to DO — the import route refuses the file (its established
 * all-or-nothing contract, the same one the duplicate-day check uses), and it names the days.
 */
export function checkTurnoverArithmetic(t: DailyTurnover): TurnoverArithmeticBreak[] {
  const breaks: TurnoverArithmeticBreak[] = [];
  const b9 = rateBreak("rate_9", t.base_9 ?? 0, t.btw_9 ?? 0, 9);
  if (b9) breaks.push(b9);
  const b21 = rateBreak("rate_21", t.base_21 ?? 0, t.btw_21 ?? 0, 21);
  if (b21) breaks.push(b21);

  // The printed gross total, when the Z-report carried one. reconcileDay checks this too, but that
  // one runs on the SCREEN, against bank and cash figures it needs as inputs — it is not, and
  // cannot be, a gate on the write.
  if (t.total_incl != null) {
    const gross = round2(turnoverNetOmzet(t) + turnoverBtw(t).total);
    const tolerance = Math.max(TOTAL_ABS_TOLERANCE, TOTAL_PCT_TOLERANCE * Math.abs(t.total_incl));
    if (Math.abs(gross - t.total_incl) > tolerance) {
      breaks.push({
        kind: "total",
        expected: t.total_incl,
        actual: gross,
        note: "omzet plus btw is niet gelijk aan het totaal van deze dag",
      });
    }
  }
  return breaks;
}
