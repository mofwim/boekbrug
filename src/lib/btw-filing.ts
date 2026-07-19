// src/lib/btw-filing.ts
// [TRUTH-FILED] Pure comparison between a FILED BTW snapshot (frozen when the owner submitted the
// aangifte) and the CURRENT live figures. The living truth keeps moving (a late invoice changes a
// past quarter); a filed aangifte does not. When they diverge, the owner must be told — and told
// WHICH correction path applies. No I/O, fully testable.

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
}

// A change smaller than half a cent is rounding noise, never a real divergence.
const EPS = 0.005;
// Belastingdienst: a BTW correction of MORE than €1.000 must be filed as a suppletie; €1.000 or
// less may be carried into the next regular aangifte. Compared on the absolute saldo difference.
export const SUPPLETIE_THRESHOLD = 1000;

function round2(n: number): number {
  return Math.round((Number.isFinite(n) ? n : 0) * 100) / 100;
}

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
  };
}
