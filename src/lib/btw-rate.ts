// src/lib/btw-rate.ts
// [HUNT-A/B] One place that turns a computed/blended BTW percentage into a legal NL rate.
//
// The header of an invoice stores a single (ex, btw) pair, so the rate is DERIVED as
// round(btw / ex * 100). On a mixed invoice — e.g. 9% goods PLUS 0%-BTW statiegeld folded
// into ex — that blend is LOWER than the real rate (199.74 / 2364.90 → 8%). A raw 8% then
// mis-buckets a 9% sale into aangifte rubriek 1c instead of 1b, and prints a bogus "8%" row
// in the accountant's closing package. Snapping the blend to the nearest legal NL rate
// ({0, 9, 21}) fixes both while leaving every clean invoice (exactly 0/9/21) untouched.
//
// Folding a 0% base can only LOWER the blend (never raise it), so ties resolve UPWARD toward
// the non-zero rate — the direction the true rate lies.
export function nearestLegalRate(computedRate: number): 0 | 9 | 21 {
  if (!Number.isFinite(computedRate)) return 0;
  const candidates: Array<0 | 9 | 21> = [0, 9, 21];
  let best: 0 | 9 | 21 = 0;
  let bestDist = Infinity;
  for (const c of candidates) {
    const d = Math.abs(computedRate - c);
    if (d <= bestDist) { bestDist = d; best = c; } // <= → ties bias to the higher rate
  }
  return best;
}
