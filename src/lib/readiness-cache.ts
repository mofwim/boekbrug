// src/lib/readiness-cache.ts
// [SNEL-BORD] When may a recorded readiness verdict stand in for a fresh one, and how old is it?
// Pure — no I/O, no clock of its own (`now` is always passed in).
// Run: npx tsx src/lib/readiness-cache.test.ts
//
// ── WHY THIS FILE EXISTS ──
//
// The accountant's board asks /api/readiness once per client. That route is a projection over the
// whole administration — about 22 database rounds and ~1.500 rows for one client for one quarter —
// so an office with eighty clients pays it eighty times, four at a time, every time the board is
// opened. The wait is the visible half; the load is the half that decides whether this product can
// hold a practice at all.
//
// readiness_cache holds the last report /api/readiness itself produced. This module answers the one
// question that makes using it safe: is this recording still worth showing, and what must the
// screen say about its age?
//
// ── THE RULE: A CACHED VERDICT IS SHOWN, NEVER PASSED OFF AS FRESH ──
//
// Readiness decides whether a quarter can be filed. A verdict that reads "klaar" while two invoices
// arrived this morning is not a small inaccuracy — it is the app telling an accountant to file. So
// the board shows the recorded figure IMMEDIATELY, prints when it was computed, and refreshes every
// row behind it. Stale is allowed; silently stale is not, and neither is stale for long.
//
// ── AND WHY OLD RECORDINGS ARE DROPPED RATHER THAN LABELLED ──
//
// A report is only meaningful under the version of buildReadiness that produced it. A score from
// three weeks and eleven deploys ago may be a number about a different question, and no label can
// rescue that — "berekend op 12 augustus" reads as trustworthy-but-old, when the honest answer is
// "we do not know what this meant". So beyond MAX_AGE the recording is not shown at all and the row
// simply loads, exactly as it does today. Nothing is lost that was worth having.

/**
 * How old a recording may be before it is dropped instead of shown.
 *
 * Seven days: long enough that an office that opens the board weekly still gets an instant screen,
 * short enough that a recording rarely outlives the code that made it. It is a bound on how wrong
 * this can be, not a promise about how fresh anything is — the age is on screen either way.
 */
export const MAX_CACHE_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * How old a recording may be before the board asks for it again.
 *
 * The age cap above decides whether a recording may be SHOWN. This decides whether it must be
 * RECOMPUTED, and they are different questions with different costs. Fifteen minutes: an office
 * that opens the board, opens a client, comes back and opens another does not pay eighty heavy
 * reports three times over, while a figure from this morning is always re-read before anyone works
 * from it. The age stands beside every one of those figures, so nothing is fresher than it says.
 *
 * The refresh button ignores this entirely — asking for the board again is a request for now, and
 * a control that quietly does nothing is worse than no control.
 */
export const REFRESH_AFTER_MS = 15 * 60 * 1000;

/** How the age is worded. The screen owns the words; this owns which sentence applies. */
export type AgeBand =
  /** Under a minute — say "zojuist" rather than "0 minuten geleden". */
  | "zojuist"
  | "minuten"
  | "uren"
  | "dagen";

export interface CacheFreshness {
  /** Show it? False when the timestamp is unusable or the recording is past MAX_AGE. */
  usable: boolean;
  /** Whole units of `band`, for the sentence. 0 when band is "zojuist". */
  amount: number;
  band: AgeBand;
  /** Milliseconds since the recording. Null when the timestamp could not be read. */
  ageMs: number | null;
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * Is this recording usable, and how old is it?
 *
 * An unreadable or future timestamp is NOT usable. A future one matters more than it looks: clock
 * skew between the database and a browser would otherwise render "over 3 minuten berekend", and a
 * screen that says something impossible about a money figure has spent the trust it needs for the
 * figure itself. Dropping it costs one row's head start.
 */
export function cacheFreshness(computedAt: string | null | undefined, now: number): CacheFreshness {
  const unusable: CacheFreshness = { usable: false, amount: 0, band: "zojuist", ageMs: null };
  if (!computedAt) return unusable;
  const then = Date.parse(computedAt);
  if (Number.isNaN(then)) return unusable;

  const ageMs = now - then;
  // A few seconds of skew is normal and harmless; treat it as "just now" rather than as a fault.
  if (ageMs < -5 * MINUTE) return unusable;
  if (ageMs > MAX_CACHE_AGE_MS) return { usable: false, amount: 0, band: "dagen", ageMs };

  const age = Math.max(0, ageMs);
  if (age < MINUTE) return { usable: true, amount: 0, band: "zojuist", ageMs };
  if (age < HOUR) return { usable: true, amount: Math.floor(age / MINUTE), band: "minuten", ageMs };
  if (age < DAY) return { usable: true, amount: Math.floor(age / HOUR), band: "uren", ageMs };
  return { usable: true, amount: Math.floor(age / DAY), band: "dagen", ageMs };
}

/**
 * Must this client's readiness be computed again, or is the recording recent enough to work from?
 *
 * True whenever there is nothing usable to work from — no recording, unreadable, or past the age
 * cap — because "we have no verdict" and "we have a recent verdict" must never take the same
 * branch. That is the direction this has to fail in: recomputing something that did not need it
 * costs one report; skipping something that did costs an accountant a wrong triage.
 */
export function needsRefresh(computedAt: string | null | undefined, now: number): boolean {
  const vers = cacheFreshness(computedAt, now);
  if (!vers.usable || vers.ageMs === null) return true;
  return vers.ageMs >= REFRESH_AFTER_MS;
}

/**
 * The message key for that age. Kept here rather than in the component so the bands and the keys
 * cannot drift apart, and so the [TAAL] gate can see every key this feature is able to render.
 *
 * A key per band AND per number, not one key with a noun parameter: "{n} {woord} geleden" works in
 * Dutch and breaks Arabic agreement and Turkish suffix harmony (AGENTS.md), and n = 1 needs its own
 * sentence in every one of those languages. Three of these are reachable on any board that has been
 * open for a minute, so none of them is theoretical.
 */
export type AgeMessageKey =
  | "bh.stand.zojuist"
  | "bh.stand.minuut1" | "bh.stand.minuten"
  | "bh.stand.uur1" | "bh.stand.uren"
  | "bh.stand.dag1" | "bh.stand.dagen";

export function ageMessageKey(band: AgeBand, amount: number): AgeMessageKey {
  switch (band) {
    case "zojuist": return "bh.stand.zojuist";
    case "minuten": return amount === 1 ? "bh.stand.minuut1" : "bh.stand.minuten";
    case "uren": return amount === 1 ? "bh.stand.uur1" : "bh.stand.uren";
    case "dagen": return amount === 1 ? "bh.stand.dag1" : "bh.stand.dagen";
  }
}

/** Every key this module can ask for — what the [TAAL] gate checks against messages.ts. */
export const AGE_MESSAGE_KEYS: readonly AgeMessageKey[] = [
  "bh.stand.zojuist",
  "bh.stand.minuut1", "bh.stand.minuten",
  "bh.stand.uur1", "bh.stand.uren",
  "bh.stand.dag1", "bh.stand.dagen",
];
