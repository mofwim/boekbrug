// src/lib/ritten.ts
// [RITTEN] The kilometre log: what was driven, for whom, and what it is worth.
//
// ── WHY THIS EXISTS ──
//
// A dienstverlener drives to customers in their own car, and two amounts follow from that. Both
// go missing for the same reason — nobody writes the trip down on the day it happened.
//
//   · The deduction. A business kilometre in a private car is worth € 0,23 off the profit (2026).
//     Two customer visits a week at 40 km is 4.000 km a year: around € 920 of profit taxed
//     because nothing was recorded. The Belastingdienst asks for a log, not an estimate.
//   · The travel agreed with a customer that never reached an invoice.
//
// ── THE RATE IS A LAW, NOT A SETTING ──
//
// What the Belastingdienst allows per business kilometre is set per year, and it changes. It is
// therefore looked up by year HERE and never stored on a row: a rate frozen into four thousand
// rows is a rate nobody can correct when the law moves, and the correction would have to be a
// migration over somebody's tax return.
//
// The rate the CUSTOMER pays is a different number entirely — that one IS an agreement, so it
// lives on the trip.
//
// Pure. Run: npx tsx --test src/lib/ritten.test.ts

import { round2 } from "./invoice-totals";

export interface MileageEntry {
  id?: string;
  client_id: string | null;
  driven_on: string | null;
  from_place?: string | null;
  to_place?: string | null;
  purpose?: string | null;
  kilometers: number | null;
  /** What the customer pays per kilometre, ex btw. Null = this trip is not charged on. */
  rate_per_km?: number | null;
  /** False = a private trip. Absent reads as business — that is the only kind that is logged. */
  business?: boolean | null;
  invoice_id?: string | null;
}

/**
 * What the Belastingdienst allows per business kilometre in a private car, by year.
 *
 * Sources are the yearly cijfers: € 0,19 through 2022, € 0,21 in 2023, € 0,23 from 2024. A year
 * that is not in this table gets the newest rate we know — an unannounced future year is far more
 * likely to keep the rate than to have none, and a zero here would silently erase a deduction.
 */
const KM_RATE_BY_YEAR: ReadonlyArray<{ from: number; rate: number }> = [
  { from: 2024, rate: 0.23 },
  { from: 2023, rate: 0.21 },
  { from: 2021, rate: 0.19 },
];

export function kmDeductionRate(year: number): number {
  for (const row of KM_RATE_BY_YEAR) if (year >= row.from) return row.rate;
  // Before 2021 the rate was € 0,19 as well, back to 2006. Nothing in this app reaches that far.
  return 0.19;
}

/** The rate a new trip is offered, so the owner does not look it up. */
export const SUGGESTED_KM_RATE = 0.23;

export const MAX_KM_PER_TRIP = 5000;
export const MAX_PLACE_LENGTH = 120;
export const MAX_PURPOSE_LENGTH = 300;

/** Is this trip business? Only an explicit false says no. */
export function isBusiness(entry: Pick<MileageEntry, "business">): boolean {
  return entry.business !== false;
}

/** Is this trip still waiting for an invoice? The column, never a guess. */
export function isUninvoiced(entry: Pick<MileageEntry, "invoice_id">): boolean {
  return !entry.invoice_id;
}

/**
 * What the customer owes for this trip, ex btw — or null when nothing was agreed.
 *
 * Null and zero are different answers. Null is "this trip is not charged on"; zero is travel
 * offered free, which is a decision and shows up as € 0,00.
 */
export function tripValue(entry: Pick<MileageEntry, "kilometers" | "rate_per_km">): number | null {
  const km = Number(entry.kilometers);
  if (!Number.isFinite(km) || km <= 0) return null;
  const rate = entry.rate_per_km;
  if (rate === null || rate === undefined) return null;
  const r = Number(rate);
  if (!Number.isFinite(r) || r < 0) return null;
  // [CENT] The app's one rounding, applied where the invoice line will apply it.
  return round2(km * r);
}

export interface MileageYear {
  year: number;
  /** Business kilometres driven in the year. */
  businessKm: number;
  /** The statutory rate that was applied. */
  rate: number;
  /** businessKm × rate, ex btw. What may come off the profit. */
  deduction: number;
  /** Of those trips, what a customer still owes for travel that is on no invoice. */
  unbilledValue: number;
  /** Trips in the year that are on no invoice and carry no rate — nothing is claimed for them. */
  unbilledWithoutRate: number;
  trips: number;
}

/**
 * The year, added up.
 *
 * Private trips are excluded from every figure: they are neither a deduction nor a customer's
 * debt, and the only reason they can be in the log at all is that the owner corrected a row.
 */
export function mileageYear(input: { entries: readonly MileageEntry[]; year: number }): MileageYear {
  const { entries, year } = input;
  const rate = kmDeductionRate(year);
  const start = `${year}-01-01`;
  const end = `${year}-12-31`;

  let businessKm = 0;
  let unbilledValue = 0;
  let unbilledWithoutRate = 0;
  let trips = 0;

  for (const entry of entries) {
    const day = typeof entry.driven_on === "string" ? entry.driven_on : "";
    if (!day || day < start || day > end) continue;
    if (!isBusiness(entry)) continue;
    const km = Number(entry.kilometers);
    if (!Number.isFinite(km) || km <= 0) continue;

    businessKm = round2(businessKm + km);
    trips += 1;

    if (isUninvoiced(entry)) {
      const value = tripValue(entry);
      if (value === null) unbilledWithoutRate += 1;
      else unbilledValue += value;
    }
  }

  return {
    year,
    businessKm,
    rate,
    deduction: round2(businessKm * rate),
    unbilledValue: round2(unbilledValue),
    unbilledWithoutRate,
    trips,
  };
}

export type MileageRefusal =
  | "no_date"
  | "no_from"
  | "no_to"
  | "no_purpose"
  | "place_too_long"
  | "purpose_too_long"
  | "no_kilometers"
  | "too_far"
  | "bad_rate";

export interface NormalizedMileage {
  client_id: string | null;
  driven_on: string;
  from_place: string;
  to_place: string;
  purpose: string;
  kilometers: number;
  rate_per_km: number | null;
  business: boolean;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * One trip out of a request body, or the reason it is refused.
 *
 * A rate that was FILLED IN with something unusable is a question, never a silent null: null here
 * means "not charged on", and turning a typo into that would quietly drop a customer's travel.
 */
export function normalizeMileageInput(
  row: Record<string, unknown>,
): { ok: true; entry: NormalizedMileage } | { ok: false; code: MileageRefusal } {
  const drivenOn = typeof row.driven_on === "string" ? row.driven_on.trim() : "";
  if (!ISO_DATE.test(drivenOn)) return { ok: false, code: "no_date" };

  const text = (v: unknown) => (typeof v === "string" ? v.trim().replace(/\s+/g, " ") : "");
  const from = text(row.from_place);
  const to = text(row.to_place);
  const purpose = text(row.purpose);
  if (!from) return { ok: false, code: "no_from" };
  if (!to) return { ok: false, code: "no_to" };
  if (!purpose) return { ok: false, code: "no_purpose" };
  if (from.length > MAX_PLACE_LENGTH || to.length > MAX_PLACE_LENGTH) return { ok: false, code: "place_too_long" };
  if (purpose.length > MAX_PURPOSE_LENGTH) return { ok: false, code: "purpose_too_long" };

  const rawKm = typeof row.kilometers === "string" ? row.kilometers.replace(",", ".") : row.kilometers;
  const km = Math.round(Number(rawKm) * 10) / 10;
  if (!Number.isFinite(Number(rawKm)) || km <= 0) return { ok: false, code: "no_kilometers" };
  if (km > MAX_KM_PER_TRIP) return { ok: false, code: "too_far" };

  let rate: number | null = null;
  const rawRate = typeof row.rate_per_km === "string" ? row.rate_per_km.replace(",", ".") : row.rate_per_km;
  const rateGiven = rawRate !== null && rawRate !== undefined && String(rawRate).trim() !== "";
  if (rateGiven) {
    const r = Math.round(Number(rawRate) * 1000) / 1000;
    if (!Number.isFinite(Number(rawRate)) || r < 0) return { ok: false, code: "bad_rate" };
    rate = r;
  }

  const clientId = typeof row.client_id === "string" && UUID.test(row.client_id.trim()) ? row.client_id.trim() : null;

  return {
    ok: true,
    entry: {
      client_id: clientId,
      driven_on: drivenOn,
      from_place: from,
      to_place: to,
      purpose,
      kilometers: km,
      rate_per_km: rate,
      business: row.business !== false,
    },
  };
}
