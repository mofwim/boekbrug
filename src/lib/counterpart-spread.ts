// src/lib/counterpart-spread.ts
// [ZELFDE-TEGENPARTIJ] Which other bank lines the owner just answered for, without knowing it.
// Pure, no I/O. Run: npx tsx --test src/lib/counterpart-spread.test.ts
//
// ── WHY ──────────────────────────────────────────────────────────────────────────────────────
//
// Answering "Trimex is kosten" teaches counterpart_memory, and the memory is genuinely applied —
// but only by the NEXT import, the nightly cron, or the owner pressing the bulk button. Until one
// of those happens, the twenty-seven other Trimex lines sit on the same screen, unanswered, and
// the owner answers the same question again.
//
// Measured on the live database: 305 unresolved bank lines, 272 of them (89%) repeat appearances
// of a counterpart that also appears elsewhere in the same list, € 248.762,80 between them, and
// one counterpart asked about 28 separate times.
//
// ── WHY NOT JUST RUN THE FULL BULK SWEEP ─────────────────────────────────────────────────────
//
// The route already has one (`bulkApply`), and calling it here was the shorter change. It also
// applies PATTERN guesses — tax, prive, transfer, pos_income, fee — to lines that have nothing to
// do with the counterpart just answered. Firing all of that off the back of one answer means the
// owner taps "kosten" on a rent line and watches a dozen unrelated rows change for reasons the
// screen never gave. Every one of those would be defensible on its own and the whole would still
// be a screen that did something the owner did not ask for.
//
// So this spreads exactly one fact: the answer just given, to the party it was given about.
// Nothing else moves. That is a sentence the interface can say out loud, which is the test.
//
// ── WHAT IS DELIBERATELY NOT DECIDED HERE ────────────────────────────────────────────────────
//
// Whether the spread is a CONFIRMATION. It is not: these rows are written the way every learned
// suggestion is written (category_source 'memory', category_confirmed false), because the owner
// confirmed ONE line and inferred the rest. A row the owner never looked at may not carry their
// confirmation — that distinction is what lets them find and change it later.

import { counterpartKey } from "./bank-identity";

/** The bank-line fields this decision reads. */
export interface SpreadCandidate {
  id: string;
  counterpart_name: string | null;
  /** Already-set category, when any. A line that carries one is never touched. */
  category?: string | null;
}

/**
 * The ids of the lines that share a counterpart with the one just answered.
 *
 * The answered line itself is excluded — the caller has already written it, with the owner's own
 * confirmation on it, and re-writing it here would downgrade that to an inference.
 */
export function linesForCounterpart(
  rows: readonly SpreadCandidate[],
  answeredName: string | null,
  answeredId: string,
): string[] {
  const key = counterpartKey(answeredName);
  // No usable key means no spread. A blank or unrecognisable counterpart name would otherwise
  // match every other blank one — which is not "the same party", it is "two unknowns".
  if (!key) return [];
  const out: string[] = [];
  for (const r of rows) {
    if (r.id === answeredId) continue;
    if (r.category != null && r.category !== "") continue;
    if (counterpartKey(r.counterpart_name) !== key) continue;
    out.push(r.id);
  }
  return out;
}
