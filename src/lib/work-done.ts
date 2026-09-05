// src/lib/work-done.ts
// [WERK-GEDAAN] What the app did instead of a person, counted. Pure — no I/O, no clock.
// Run: npx tsx src/lib/work-done.test.ts
//
// ── WHY THIS EXISTS ──────────────────────────────────────────────────────────────────────────
//
// An accounting office does not buy software; it buys back hours. The whole case for putting two
// hundred clients into one system rests on a single number — how much work it takes off the desk —
// and BoekBrug could not state that number, because nothing recorded it.
//
// It is recorded, though, all over the database. Measured on one live administration:
//
//   317  invoices pulled out of the owner's e-mail
//   227  of them verified without a human tap (_auto_verified)
//    91  till days read from Z-reports
//    24  bank lines categorised from the owner's own earlier answers
//    23  bank lines matched to an invoice by the reconciler
//
// 682 actions on ONE client, each of which a person would otherwise have done by hand.
//
// ── AND WHY IT REFUSES TO SAY "WE SAVED YOU 4,7 HOURS" ───────────────────────────────────────
//
// That sentence is what this file is for and it is exactly what this file must not write. Nobody
// here knows how long it takes an office to book an invoice: it depends on their software, their
// staff, their clients and what they check. An invented minutes figure is a number an accountant
// can disprove in an afternoon — and the first number you hand a professional that turns out to be
// made up is the last one they believe from you.
//
// So this module counts ACTIONS and stops. Minutes appear only when the office types its own
// figure, and then the arithmetic is theirs and visible: their minutes × our count. estimateMinutes
// returns null without one, and there is no default anywhere in this file.
//
// ── THE PERIOD IS PART OF THE ANSWER ─────────────────────────────────────────────────────────
//
// "682 actions" means nothing without "since when". The caller must name the period, because an
// all-time count read as a monthly one overstates the case by however long the client has been on
// the platform — and this whole file exists to be believed.

/** Actions the app performed, as counted by the caller over ONE named period. */
export interface WorkDoneCounts {
  /** Invoices pulled out of e-mail without anyone forwarding or uploading them. */
  invoicesFromEmail: number;
  /** Of those, the ones the reader verified on its own — no human tap. */
  invoicesAutoVerified: number;
  /** Bank lines given a category from the owner's own earlier answers, or a pattern. */
  bankLinesCategorised: number;
  /** Bank lines matched to an invoice by the reconciler. */
  bankLinesMatched: number;
  /** Till days read from a Z-report instead of typed. */
  tillDaysImported: number;
  /** Duplicate documents caught before they were booked twice. */
  duplicatesCaught: number;
}

export interface WorkDoneLine {
  /** Stable id for the row — never shown. */
  key: keyof WorkDoneCounts;
  count: number;
  /** Dutch, and about what HAPPENED — never about what it was worth. */
  sentence: string;
}

export interface WorkDoneLedger {
  /** e.g. "Q2 2026" or "augustus 2026". Required — see the header. */
  period: string;
  lines: WorkDoneLine[];
  /** Every counted action, added up. */
  total: number;
}

const ZIN: Record<keyof WorkDoneCounts, (n: number) => string> = {
  invoicesFromEmail: (n) => `${n} ${n === 1 ? "factuur" : "facturen"} uit de e-mail gehaald`,
  invoicesAutoVerified: (n) => `${n} ${n === 1 ? "factuur" : "facturen"} gecontroleerd en geboekt zonder tik`,
  bankLinesCategorised: (n) => `${n} ${n === 1 ? "bankregel" : "bankregels"} ingedeeld op eerdere antwoorden`,
  bankLinesMatched: (n) => `${n} ${n === 1 ? "bankregel" : "bankregels"} aan de juiste factuur gekoppeld`,
  tillDaysImported: (n) => `${n} ${n === 1 ? "kassadag" : "kassadagen"} ingelezen uit een Z-rapport`,
  duplicatesCaught: (n) => `${n} ${n === 1 ? "dubbel document" : "dubbele documenten"} tegengehouden`,
};

/**
 * The ledger, biggest first, with the zero rows left out.
 *
 * A zero is not a line: "0 kassadagen ingelezen" on a client without a till reads as a failure of
 * the app rather than as a fact about the client, and a list padded with zeroes buries the rows
 * that carry the case.
 */
export function workDoneLedger(period: string, counts: WorkDoneCounts): WorkDoneLedger {
  const lines: WorkDoneLine[] = (Object.keys(ZIN) as (keyof WorkDoneCounts)[])
    .map((key) => ({ key, count: Math.max(0, Math.trunc(counts[key] ?? 0)) }))
    .filter((l) => l.count > 0)
    .sort((a, b) => b.count - a.count)
    .map((l) => ({ ...l, sentence: ZIN[l.key](l.count) }));

  return { period, lines, total: lines.reduce((s, l) => s + l.count, 0) };
}

/**
 * The office's own arithmetic, done for them — and ONLY with their own number.
 *
 * Returns null when no per-action figure was supplied, and callers must render nothing rather
 * than fall back to a figure of their own. There is deliberately no default in this file: see the
 * header for why an invented minute is worse here than no minute at all.
 */
export function estimateMinutes(
  ledger: WorkDoneLedger,
  minutesPerAction: number | null | undefined,
): number | null {
  if (typeof minutesPerAction !== "number" || !Number.isFinite(minutesPerAction) || minutesPerAction <= 0) {
    return null;
  }
  return Math.round(ledger.total * minutesPerAction);
}

/**
 * The same, in the office's own money. Both numbers are theirs; only the multiplication is ours.
 */
export function estimateEuros(
  ledger: WorkDoneLedger,
  minutesPerAction: number | null | undefined,
  hourlyRate: number | null | undefined,
): number | null {
  const minutes = estimateMinutes(ledger, minutesPerAction);
  if (minutes === null) return null;
  if (typeof hourlyRate !== "number" || !Number.isFinite(hourlyRate) || hourlyRate <= 0) return null;
  return Math.round((minutes / 60) * hourlyRate * 100) / 100;
}
