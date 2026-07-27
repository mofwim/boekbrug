// src/lib/recurring.ts
// [HERHAAL] Terugkerende facturen — the date arithmetic and the safety rules, pure and no I/O.
// Run: npx tsx src/lib/recurring.test.ts
//
// The shape of the feature, and why it is this shape:
//
// A schedule REPEATS AN EXISTING INVOICE. Not a template the owner fills in again, not a second
// place where client data and line items live — the invoice they already sent once IS the
// definition. That keeps one source of truth for what is billed, and it means setting one up
// costs a single tap on an invoice that already exists.
//
// Each occurrence produces a CONCEPT, never a sent invoice. That is deliberate and it is the
// safest useful line to draw:
//   · an invoice number is minted on SEND and only there (next_invoice_seq, forward-only, art.
//     35) — a background job that mints numbers would put holes in the sequence the moment
//     anything failed halfway;
//   · sending is an outward act toward a third party. A wrong recurring invoice that goes out by
//     itself is a letter the owner never wrote and cannot unsend.
// So the app does the whole job except the last tap: the concept is ready, complete, dated, and
// the owner sends it when they want to. That removes the typing, which is the actual work.

export type Cadence = "weekly" | "monthly" | "quarterly" | "yearly";

export const CADENCES: readonly Cadence[] = ["weekly", "monthly", "quarterly", "yearly"];

export function isCadence(v: unknown): v is Cadence {
  return typeof v === "string" && (CADENCES as readonly string[]).includes(v);
}

/** Dutch labels — the UI and the notification say the same words. */
export const CADENCE_LABEL: Record<Cadence, string> = {
  weekly: "elke week",
  monthly: "elke maand",
  quarterly: "elk kwartaal",
  yearly: "elk jaar",
};

const MONTHS_PER: Record<Exclude<Cadence, "weekly">, number> = {
  monthly: 1,
  quarterly: 3,
  yearly: 12,
};

/**
 * An occurrence older than this is skipped, never invoiced. A schedule that has been dormant for
 * months is not a forgotten invoice — it is a schedule nobody is watching — and waking it up as a
 * pile of back-dated concepts would be a surprise, not a service. The skip advances the schedule
 * silently to the next live occurrence.
 */
export const STALE_OCCURRENCE_DAYS = 90;

function parseIso(iso: string): { y: number; m: number; d: number } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? "");
  if (!m) return null;
  return { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) };
}

function toIso(y: number, m: number, d: number): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${y}-${p(m)}-${p(d)}`;
}

/** Days in a given month (1-based month). */
export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** Whole-day arithmetic in UTC, so a server timezone can never shift a billing date. */
export function addDays(iso: string, days: number): string {
  const p = parseIso(iso);
  if (!p) return iso;
  const d = new Date(Date.UTC(p.y, p.m - 1, p.d));
  d.setUTCDate(d.getUTCDate() + days);
  return toIso(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
}

/** Days BETWEEN two ISO dates (b − a), or null when either is unusable. */
export function daysBetween(a: string, b: string): number | null {
  const pa = parseIso(a);
  const pb = parseIso(b);
  if (!pa || !pb) return null;
  const ms = Date.UTC(pb.y, pb.m - 1, pb.d) - Date.UTC(pa.y, pa.m - 1, pa.d);
  return Math.round(ms / 86400000);
}

/**
 * The occurrence after `from`, for a schedule anchored on `anchorDay` (the day-of-month the owner
 * bills on).
 *
 * The anchor is kept, never the last clamped result — and that is the whole trick of monthly
 * billing. A schedule anchored on the 31st must run 31 Jan → 28 Feb → 31 Mar. Stepping "one
 * month" from the clamped 28 Feb would give 28 March and the series would silently collapse to
 * the 28th forever, moving every future invoice date of a business that bills on month-end.
 * Weekly has no such problem — it is plain +7 days.
 */
export function nextOccurrence(from: string, cadence: Cadence, anchorDay: number): string {
  const p = parseIso(from);
  if (!p) return from;
  if (cadence === "weekly") return addDays(from, 7);

  const step = MONTHS_PER[cadence];
  let year = p.y;
  let month = p.m + step;
  year += Math.floor((month - 1) / 12);
  month = ((month - 1) % 12) + 1;
  const day = Math.min(Math.max(1, Math.round(anchorDay)), daysInMonth(year, month));
  return toIso(year, month, day);
}

export interface Schedule {
  /** The next date an invoice should be produced for. */
  next_run_date: string;
  cadence: Cadence;
  /** Day-of-month the series is anchored on (ignored for weekly). */
  anchor_day: number;
  active?: boolean | null;
  /** Optional end date — the schedule stops after this day (inclusive). */
  ends_on?: string | null;
}

export type OccurrenceAction =
  /** Produce a concept for `date`, then move the schedule to `nextRunDate`. */
  | { kind: "generate"; date: string; nextRunDate: string }
  /** Too old to invoice — advance without producing anything. */
  | { kind: "skip"; date: string; nextRunDate: string; reason: "stale" }
  /** Nothing to do right now. */
  | { kind: "wait" }
  /** The schedule is finished (past its end date) or switched off. */
  | { kind: "done"; reason: "ended" | "inactive" };

/**
 * What should happen to this schedule today? One occurrence per call, deliberately.
 *
 * A cron that had been down for three months could otherwise produce three months of invoices in
 * one burst. Handling exactly one occurrence per run means a gap heals at one per day — visible,
 * reversible, and impossible to mistake for a runaway loop.
 */
export function planOccurrence(schedule: Schedule, todayIso: string): OccurrenceAction {
  if (schedule.active === false) return { kind: "done", reason: "inactive" };
  const due = parseIso(schedule.next_run_date);
  const today = parseIso(todayIso);
  if (!due || !today) return { kind: "wait" };

  if (schedule.ends_on) {
    const end = parseIso(schedule.ends_on);
    if (end && schedule.next_run_date > schedule.ends_on) return { kind: "done", reason: "ended" };
  }
  if (schedule.next_run_date > todayIso) return { kind: "wait" };

  const nextRunDate = nextOccurrence(schedule.next_run_date, schedule.cadence, schedule.anchor_day);
  const age = daysBetween(schedule.next_run_date, todayIso) ?? 0;
  if (age > STALE_OCCURRENCE_DAYS) {
    return { kind: "skip", date: schedule.next_run_date, nextRunDate, reason: "stale" };
  }
  return { kind: "generate", date: schedule.next_run_date, nextRunDate };
}

/**
 * The first run date for a new schedule: the next occurrence STRICTLY AFTER the invoice it
 * repeats. Anchored on that invoice's own date, so "repeat this monthly" started on an invoice of
 * the 8th bills on the 8th — no configuration, no surprise.
 */
export function firstRunAfter(sourceInvoiceDate: string, cadence: Cadence): string {
  const p = parseIso(sourceInvoiceDate);
  const anchor = p ? p.d : 1;
  return nextOccurrence(sourceInvoiceDate, cadence, anchor);
}

/** The anchor day a schedule started from its source invoice. */
export function anchorDayOf(sourceInvoiceDate: string): number {
  return parseIso(sourceInvoiceDate)?.d ?? 1;
}

/**
 * The payment term to carry into each new concept: the source invoice's own term, so a customer
 * on 30 days stays on 30 days. Falls back to 14 (the Dutch default) when the source has no due
 * date or an unusable one — never a term of 0, which would make an invoice overdue on arrival.
 */
export const DEFAULT_TERM_DAYS = 14;

export function termDaysOf(invoiceDate: string | null | undefined, dueDate: string | null | undefined): number {
  if (!invoiceDate || !dueDate) return DEFAULT_TERM_DAYS;
  const days = daysBetween(invoiceDate, dueDate);
  return days != null && days > 0 && days <= 365 ? days : DEFAULT_TERM_DAYS;
}
