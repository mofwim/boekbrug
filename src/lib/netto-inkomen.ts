// src/lib/netto-inkomen.ts
// [NETTO-TOOL] The 2026 tax table behind the public net-income estimator, and the four functions
// that walk it. Pure, no React, no I/O.
//
// ── WHY THESE FIFTEEN NUMBERS MOVED OUT OF THE COMPONENT ──
//
// They were an object literal inside NettoCalculator.tsx, under src/app — which is outside the
// `src/lib/*.test.ts` glob that `npm run test:unit` runs, outside tests/render (which covers the
// FILE tools, not the calculators), and outside the Playwright sweep (which asserts only that the
// page is not a 5xx). So not one euro of a public tax table was asserted anywhere, and nothing in
// the whole gate chain would have noticed if a rate, a bracket or the tax year were wrong.
//
// A visitor types their profit and reads a net amount in a 36px figure. That is a number people
// act on — they under-spend on it, or reserve against an aanslag on it — so it belongs where the
// app's other money lives: behind a test.
//
// ── AND ONE NUMBER HERE IS NOT LAW ──
//
// `AK_FULL_AT` is not a Belastingdienst parameter. The real arbeidskorting is a staircase of four
// build-up segments; this file walks a single straight line to the maximum instead. That was a
// deliberate simplification, and it sat unlabelled among fourteen statutory figures where the next
// reader could only take it for one of them. It is named apart now, and the sentence the component
// prints beside the amount says the approximation exists — because the file's own header used to
// claim the error was always "toward MORE tax, safe for planning", and that is false in both
// directions: the ramp UNDER-credits below roughly € 26k of arbeidsinkomen and OVER-credits in the
// band between AK_FULL_AT and the phase-out start.
//
// Replacing the ramp with the real staircase needs the official 2026 segment boundaries and rates.
// Those are not in this repo and are not guessed here: a made-up staircase would be a second wrong
// number wearing more precision than the first, which is the one thing this codebase refuses to do.

/** The year every figure below is FOR. Printed beside the amount, and checked against the clock. */
export const TAX_YEAR = 2026;

/**
 * 2026 parameters (Belastingdienst / Rijksoverheid, verified July 2026).
 *
 * Every entry here except AK_FULL_AT is a published figure. Change one and the tests in
 * netto-inkomen.test.ts fail — that is what they are for.
 */
export const P = {
  zelfstandigenaftrek: 1200,
  startersaftrek: 2123,
  mkb: 0.127,
  brackets: [
    { upto: 38883, rate: 0.3575 },
    { upto: 78426, rate: 0.3756 },
    { upto: Infinity, rate: 0.495 },
  ],
  ahkMax: 3115,
  ahkStart: 29736,
  ahkRate: 0.06398,
  akMax: 5685,
  akPhaseStart: 45592,
  akPhaseRate: 0.0651,
  zvwRate: 0.0485,
  zvwMax: 79409,
} as const;

/**
 * NOT a fiscal parameter — see the header. The arbeidsinkomen at which this file's straight-line
 * approximation reaches akMax. The real curve reaches it at akPhaseStart, by construction.
 */
export const AK_FULL_AT = 39000;

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

/** Box 1 income tax, walked bracket by bracket over the taxable profit. */
export function box1(belastbaar: number): number {
  let tax = 0;
  let prev = 0;
  for (const b of P.brackets) {
    if (belastbaar <= prev) break;
    const slice = Math.min(belastbaar, b.upto) - prev;
    tax += slice * b.rate;
    prev = b.upto;
  }
  return tax;
}

/** Algemene heffingskorting: flat to ahkStart, then a straight afbouw to zero. */
export function algemeneHeffingskorting(belastbaar: number): number {
  return clamp(P.ahkMax - Math.max(0, belastbaar - P.ahkStart) * P.ahkRate, 0, P.ahkMax);
}

/**
 * Arbeidskorting — APPROXIMATED on the way up, exact on the way down.
 *
 * The phase-out is the statutory line (akMax, akPhaseStart, akPhaseRate are all published). The
 * build-up is the straight ramp described in the header, and it is the one part of this file that
 * does not reproduce the law.
 */
export function arbeidskorting(ai: number): number {
  if (ai <= 0) return 0;
  if (ai <= P.akPhaseStart) return Math.min(P.akMax, (P.akMax * ai) / AK_FULL_AT);
  return Math.max(0, P.akMax - (ai - P.akPhaseStart) * P.akPhaseRate);
}

/** Is the table still the one for the year we are in? False ⇒ the screen must say so. */
export function tableIsCurrent(nowYear: number): boolean {
  return nowYear <= TAX_YEAR;
}
