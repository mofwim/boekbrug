// src/lib/quarter.ts
// [QUARTER] One shared definition of "which quarter" so every surface agrees. The DEFAULT
// across the app is the LAST COMPLETED quarter — the one whose BTW is actually due — NOT
// the current (still-open) quarter. klaar, aangifte and resultaat all use this, so their
// figures line up and a link from one to another never lands on a different quarter (the
// bug: the readiness card showed a concept-BTW figure for the last-completed quarter but
// its "Bekijk de concept-aangifte" link opened a near-empty current quarter).
//
// Pure + UTC (matches the API routes' own quarter math). Testable — inject `now`.

export type QuarterNo = 1 | 2 | 3 | 4;
export interface YearQuarter { year: number; quarter: QuarterNo }

/** The last COMPLETED quarter as of `now`. In Q1 that's Q4 of the previous year. */
export function lastCompletedQuarter(now: Date = new Date()): YearQuarter {
  const q = (Math.floor(now.getUTCMonth() / 3) + 1) as QuarterNo;
  return q === 1
    ? { year: now.getUTCFullYear() - 1, quarter: 4 }
    : { year: now.getUTCFullYear(), quarter: (q - 1) as QuarterNo };
}

/**
 * Resolve a year/quarter from URL params, falling back to the last completed quarter when
 * they are absent or invalid. So a surface opened WITH ?year&quarter (e.g. from a klaar
 * link) honours them, and opened WITHOUT (a menu card) defaults to the same quarter klaar
 * defaults to — keeping the three surfaces consistent either way.
 */
export function quarterFromParams(
  get: (key: string) => string | null,
  now: Date = new Date(),
): YearQuarter {
  const y = Number(get("year"));
  const q = Number(get("quarter"));
  const valid = Number.isInteger(y) && y >= 2000 && y <= 2100 && [1, 2, 3, 4].includes(q);
  return valid ? { year: y, quarter: q as QuarterNo } : lastCompletedQuarter(now);
}
