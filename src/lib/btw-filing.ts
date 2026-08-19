// src/lib/btw-filing.ts
// [TRUTH-FILED] Pure comparison between a FILED BTW snapshot (frozen when the owner submitted the
// aangifte) and the CURRENT live figures. The living truth keeps moving (a late invoice changes a
// past quarter); a filed aangifte does not. When they diverge, the owner must be told — and told
// WHICH correction path applies. No I/O, fully testable.

import { round2 } from "./invoice-totals";

/**
 * [FILING-NO-OVERWRITE] What a "mark as filed" request may do to the record that is already there.
 *
 * The write used to be a bare upsert, so a second request silently replaced the frozen snapshot —
 * and with it the only evidence of what was declared, which is what every divergence on the truth
 * screen is measured against. Re-filing after a suppletie is legitimate, so the answer is not "no";
 * it is "only when that was the actual intention". Three outcomes, decided in one place because the
 * two screens that file (Waarheid, Kwartaaloverzicht) must not each invent their own rule:
 *
 *   "insert"  — nothing to replace. The insert (not an upsert) is also what makes it race-proof:
 *               a second tab loses on the unique (user_id, year, quarter) constraint.
 *   "ask"     — a filing exists and the request did not say `replace`. The owner is shown WHAT
 *               would be replaced and answers for themselves.
 *   "replace" — a filing exists and the request explicitly asked to replace it.
 *
 * `hasExisting` must never be a guess: a failed read is not "no filing" (that is the state in which
 * writing destroys a record), so the caller refuses before it gets here.
 */
export type FilingWrite = "insert" | "ask" | "replace";

export function decideFilingWrite(args: { hasExisting: boolean; replace?: boolean }): FilingWrite {
  if (!args.hasExisting) return "insert";
  return args.replace === true ? "replace" : "ask";
}

/** The figures that were filed, or that the live truth now shows. */
export interface FilingFigures {
  omzet: number;
  kosten: number;
  btwVerschuldigd: number;
  btwVoorbelasting: number;
  btwSaldo: number;
}

export interface FilingDivergence {
  /** Any material change since filing (BTW-saldo or a component moved). */
  changed: boolean;
  omzetDelta: number;           // current − filed
  kostenDelta: number;
  btwVerschuldigdDelta: number;
  btwVoorbelastingDelta: number;
  btwSaldoDelta: number;        // the number that decides the correction path
  /** > €1.000 BTW difference → a formal suppletie is required (Belastingdienst rule). */
  needsSuppletie: boolean;
  // [DIVERGENCE-SPLIT] `changed` is true when ANY of the five components moved — including the
  // cases where the BTW-saldo did NOT. A screen that reads `changed` and then narrates only the
  // saldo tells the owner "the BTW changed by € 0,00 (you must pay more)", which is nonsense and
  // destroys trust on the one surface that exists to be trusted. Two realistic ways to get there:
  // a 0%-BTW cost invoice arriving late (kosten moves, BTW does not), and a correction where
  // verschuldigd and voorbelasting move by the same amount. These two flags let a caller say the
  // true thing: what moved the BTW, what moved only the result (income-tax relevant), or both.
  /** The BTW-saldo itself moved beyond rounding noise → a BTW correction is due. */
  btwChanged: boolean;
  /** omzet − kosten moved beyond rounding noise → the profit (income tax) changed. */
  resultaatChanged: boolean;
  /** (current omzet − kosten) − (filed omzet − kosten). Positive = more profit than filed. */
  resultaatDelta: number;
}

// A change smaller than half a cent is rounding noise, never a real divergence.
const EPS = 0.005;
// Belastingdienst: a BTW correction of MORE than €1.000 must be filed as a suppletie; €1.000 or
// less may be carried into the next regular aangifte. Compared on the absolute saldo difference.
export const SUPPLETIE_THRESHOLD = 1000;

// [CENT] round2 comes from invoice-totals — one function for the whole app. This file had its
// own, and it gave a different answer; see the header of invoice-totals.round2.
// (The non-finite guard this file had is now in the canonical one, so nothing is lost.)

/**
 * Compare the current live figures to what was filed. Deltas are current − filed (a positive
 * btwSaldoDelta means you now owe MORE than you filed). `changed` is true when any component moved
 * beyond rounding noise; `needsSuppletie` when the BTW-saldo moved by more than €1.000.
 */
export function computeFilingDivergence(filed: FilingFigures, current: FilingFigures): FilingDivergence {
  const omzetDelta = round2(current.omzet - filed.omzet);
  const kostenDelta = round2(current.kosten - filed.kosten);
  const btwVerschuldigdDelta = round2(current.btwVerschuldigd - filed.btwVerschuldigd);
  const btwVoorbelastingDelta = round2(current.btwVoorbelasting - filed.btwVoorbelasting);
  const btwSaldoDelta = round2(current.btwSaldo - filed.btwSaldo);
  // [DIVERGENCE-SPLIT] The profit delta, computed from the components rather than a stored
  // `resultaat` — the filed snapshot only persists omzet/kosten (btw_filings.sql), so deriving it
  // here keeps one definition and cannot go stale against the table.
  const resultaatDelta = round2((current.omzet - current.kosten) - (filed.omzet - filed.kosten));

  const changed =
    Math.abs(omzetDelta) > EPS ||
    Math.abs(kostenDelta) > EPS ||
    Math.abs(btwVerschuldigdDelta) > EPS ||
    Math.abs(btwVoorbelastingDelta) > EPS ||
    Math.abs(btwSaldoDelta) > EPS;

  return {
    changed,
    omzetDelta,
    kostenDelta,
    btwVerschuldigdDelta,
    btwVoorbelastingDelta,
    btwSaldoDelta,
    needsSuppletie: Math.abs(btwSaldoDelta) > SUPPLETIE_THRESHOLD,
    btwChanged: Math.abs(btwSaldoDelta) > EPS,
    resultaatChanged: Math.abs(resultaatDelta) > EPS,
    resultaatDelta,
  };
}

/**
 * [SUPPLETIE-VERREKEND] What of a filed quarter's divergence has NOT yet been declared anywhere.
 *
 * A BTW correction of €1.000 or less may be processed in the next regular aangifte rather than as a
 * separate suppletie. Once it has been, the difference between the snapshot and the live figures is
 * still there — the snapshot is deliberately never rewritten — so something has to remember that the
 * gap has already been reported, or the next quarter offers the same correction again and the owner
 * declares it twice.
 *
 * That memory is an AMOUNT, not a flag, and the reason is the second movement. A quarter can move
 * again after part of it was carried: booked at €1.260, corrected to €1.100 and carried (€160), then
 * a late invoice takes it to €1.050. What is still owed is €50, not nothing and not €210. With a
 * boolean the second movement would be invisible — an UNDECLARED correction, which is the more
 * expensive of the two mistakes.
 *
 * Sign travels with it. `carried` is the delta that was declared, so it is negative when the owner
 * declared less BTW; subtracting it leaves what remains in the same direction as the original delta.
 * Rounded to cents, because it is compared against a €1.000 threshold and shown in a letter-grade
 * sentence — a half cent must not decide either.
 */
export function outstandingCorrection(btwSaldoDelta: number, carriedSaldo: number | null | undefined): number {
  const delta = Number(btwSaldoDelta);
  if (!Number.isFinite(delta)) return 0;
  const carried = Number(carriedSaldo);
  return round2(delta - (Number.isFinite(carried) ? carried : 0));
}

/**
 * Is there still a correction to make, and which route is it?
 *
 * "none"      — nothing outstanding beyond rounding noise. Either it never moved, or every cent of
 *               the movement has already been declared.
 * "carry"     — €1.000 or less: it may go into the next regular aangifte.
 * "suppletie" — more than €1.000: it needs its own form, and it may NOT be quietly carried.
 *
 * Measured on what is OUTSTANDING, not on the whole divergence, and that ordering matters in both
 * directions. A quarter that moved €1.400 and had €900 carried still needs a suppletie for the
 * remaining €500 — but only for €500. And a quarter that moved €1.400 in two steps of €700 never
 * becomes two carry-forwards: the first €700 is carried, and when the second arrives the
 * outstanding amount is what is judged, so the threshold is applied to a real remaining obligation
 * rather than to the history of how it accumulated.
 */
export type CorrectionRoute = "none" | "carry" | "suppletie";

export function correctionRoute(outstanding: number): CorrectionRoute {
  const amount = Math.abs(Number(outstanding));
  if (!Number.isFinite(amount) || amount <= EPS) return "none";
  return amount > SUPPLETIE_THRESHOLD ? "suppletie" : "carry";
}
