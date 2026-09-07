// src/lib/depreciation.ts
// [BEDRIJFSMIDDEL] Straight-line depreciation of a business asset, the way the Belastingdienst
// states it — nothing more.
//
// The rule, verbatim from belastingdienst.nl ("Hoe berekent u het bedrag van de afschrijving?"):
//
//   afschrijving per jaar = (aanschafkosten − restwaarde) : vermoedelijke gebruiksduur
//
// with the gebruiksduur in whole years, and a first year that is used for part of the year
// depreciated for that part only. Their own example: a machine of € 30.000, ten years, restwaarde
// € 5.000 → € 2.500 per year; bought on 1 October → 3/12 × € 2.500 = € 625 in that year. Every
// number in the tests is that example or a corner of it.
//
// What this module refuses:
//   · it does not decide WHETHER something is a bedrijfsmiddel — that is the owner's answer, kept
//     in the register, never inferred from an amount (a butcher's weekly € 3.000 meat invoice is
//     stock, not an asset);
//   · it does not apply the € 450 threshold itself — assetThreshold() states it, the screen
//     asks; the threshold is ex btw when the btw is deductible and incl btw when it is not
//     (belastingdienst.nl, "Kosten die u in 1 jaar mag aftrekken");
//   · it does not do willekeurige afschrijving (starters) or the bodemwaarde of a bedrijfspand —
//     both are named on the screen as a boekhouder's call, and MAX_RATE_PER_YEAR keeps a
//     gebruiksduur under five years from being entered as if it were the ordinary rule.
//
// Months, not days: the Belastingdienst counts the month of ingebruikname as a whole month, and
// so does every accountant's package. All money is integer cents inside; the API takes and
// returns euros rounded to the cent.

import { round2 } from "./invoice-totals";

/** The ordinary maximum: 20% of the acquisition cost per year (goodwill: 10%). */
export const MAX_RATE_PER_YEAR = 0.2;
/** The shortest gebruiksduur the 20% rule allows. */
export const MIN_USEFUL_LIFE_YEARS = 5;
export const MAX_USEFUL_LIFE_YEARS = 50;
/** Below this acquisition cost a purchase is a cost in one year, never an asset. */
export const ASSET_THRESHOLD_EUR = 450;

export interface AssetLike {
  /** Acquisition cost (ex btw when the btw is deductible), euros. */
  cost: number;
  /** Expected value when the asset leaves the business, euros. 0 when unknown. */
  residualValue: number;
  /** Whole years. */
  usefulLifeYears: number;
  /** First day of use, YYYY-MM-DD. Depreciation starts in this month. */
  inUseFrom: string;
  /** Day the asset left the business (sold, scrapped), YYYY-MM-DD, or null. */
  disposedOn?: string | null;
}

/**
 * The € 450 line, in the owner's own regime: ex btw when they deduct btw on the purchase,
 * incl btw when they cannot (vrijgesteld, KOR). Returns the amount to compare and the answer.
 */
export function assetThreshold(args: { totalExBtw: number; totalIncBtw: number; btwDeductible: boolean }): {
  compared: number; isAboveThreshold: boolean;
} {
  const compared = args.btwDeductible ? args.totalExBtw : args.totalIncBtw;
  return { compared, isAboveThreshold: compared >= ASSET_THRESHOLD_EUR };
}

function cents(eur: number): number { return Math.round(eur * 100); }

/** Month index since year 0 for a YYYY-MM-DD string; the day is irrelevant by the month rule. */
function monthIndex(ymd: string): number {
  const m = /^(\d{4})-(\d{2})/.exec(ymd);
  if (!m) throw new Error(`not a date: ${ymd}`);
  return Number(m[1]) * 12 + (Number(m[2]) - 1);
}

/** (cost − restwaarde) ÷ gebruiksduur, euros, rounded to the cent. */
export function yearlyDepreciation(a: Pick<AssetLike, "cost" | "residualValue" | "usefulLifeYears">): number {
  validate(a);
  return round2((a.cost - a.residualValue) / a.usefulLifeYears);
}

function validate(a: Pick<AssetLike, "cost" | "residualValue" | "usefulLifeYears">): void {
  if (!Number.isFinite(a.cost) || a.cost < 0) throw new Error("cost must be a non-negative number");
  if (!Number.isFinite(a.residualValue) || a.residualValue < 0) throw new Error("residual value must be a non-negative number");
  if (a.residualValue > a.cost) throw new Error("residual value cannot exceed cost");
  if (!Number.isInteger(a.usefulLifeYears) || a.usefulLifeYears < 1) throw new Error("useful life must be a whole number of years");
}

/**
 * Cumulative depreciation, in cents, after `monthsUsed` whole months of use — capped at the
 * depreciable base so the boekwaarde never drops below the restwaarde. The cap is what makes
 * the last year come out exact: 120 months of € 2.500/12 rounds to 250.000 cents, never 249.996.
 */
function cumulativeCents(a: AssetLike, monthsUsed: number): number {
  if (monthsUsed <= 0) return 0;
  const base = cents(a.cost) - cents(a.residualValue);
  const totalMonths = a.usefulLifeYears * 12;
  if (monthsUsed >= totalMonths) return base;
  return Math.min(base, Math.round((base * monthsUsed) / totalMonths));
}

/** Months of use up to and including the month of `ymd`; 0 before the first month. */
function monthsUsedThrough(a: AssetLike, ymd: string): number {
  const first = monthIndex(a.inUseFrom);
  let last = monthIndex(ymd);
  // A disposed asset stops depreciating after its disposal month; what happens to the boekwaarde
  // then (boekwinst or -verlies) is not this function's business — see disposalNote below.
  if (a.disposedOn) last = Math.min(last, monthIndex(a.disposedOn));
  return Math.max(0, last - first + 1);
}

/**
 * Depreciation that falls in [start, end] (both YYYY-MM-DD, inclusive), euros. Computed as the
 * difference of two cumulative amounts, so a year's twelve months and four quarters always
 * re-sum to the same total to the cent.
 */
export function depreciationInRange(a: AssetLike, start: string, end: string): number {
  validate(a);
  if (monthIndex(end) < monthIndex(start)) return 0;
  const before = monthsUsedThrough(a, previousMonthEnd(start));
  const through = monthsUsedThrough(a, end);
  return (cumulativeCents(a, through) - cumulativeCents(a, before)) / 100;
}

/** Boekwaarde at the end of the month of `ymd`, euros. */
export function bookValueAt(a: AssetLike, ymd: string): number {
  validate(a);
  return (cents(a.cost) - cumulativeCents(a, monthsUsedThrough(a, ymd))) / 100;
}

/** Whether the asset was still on the books at any point in [start, end]. */
export function activeInRange(a: AssetLike, start: string, end: string): boolean {
  const first = monthIndex(a.inUseFrom);
  const s = monthIndex(start), e = monthIndex(end);
  if (first > e) return false;
  if (a.disposedOn && monthIndex(a.disposedOn) < s) return false;
  return true;
}

function previousMonthEnd(ymd: string): string {
  const idx = monthIndex(ymd) - 1;
  const y = Math.floor(idx / 12), m = idx - y * 12 + 1;
  return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-28`;
}

/** The 20%-per-year rule as a validation: true when the life is at least five whole years. */
export function withinOrdinaryRate(usefulLifeYears: number): boolean {
  return Number.isInteger(usefulLifeYears) && usefulLifeYears >= MIN_USEFUL_LIFE_YEARS && usefulLifeYears <= MAX_USEFUL_LIFE_YEARS;
}
