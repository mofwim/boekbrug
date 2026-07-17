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

// ─── [BANK-QUARTER] Group dated rows by quarter for the bank-matching filter ──────────
// The bank screen mixes every uploaded statement, so an owner working on Q2 also sees all
// the Q1 rows and the "Geen factuur" count balloons. These group by the quarter of the BANK
// DATE (the payment date, not the invoice date), so a Q1 invoice paid in Q2 shows under Q2
// (when the money moved) while the matcher still offers the Q1 invoice as a candidate.

/** "2026-06-20" → "2026-Q2". null / unparseable → null (caller shows it in every quarter). */
export function quarterKeyOf(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const m = /^(\d{4})-(\d{2})/.exec(iso);
  if (!m) return null;
  const month = Number(m[2]);
  if (month < 1 || month > 12) return null;
  const q = Math.floor((month - 1) / 3) + 1;
  return `${m[1]}-Q${q}`;
}

/** "2026-Q2" → "Q2 2026" (human, for a chip label). Unknown shape → the key unchanged. */
export function quarterLabelOf(key: string): string {
  const m = /^(\d{4})-Q([1-4])$/.exec(key);
  return m ? `Q${m[2]} ${m[1]}` : key;
}

/** Distinct quarter keys present in a set of dated rows, newest first, with counts. */
export function quartersPresent(
  dates: Array<string | null | undefined>,
): Array<{ key: string; count: number }> {
  const counts = new Map<string, number>();
  for (const d of dates) {
    const k = quarterKeyOf(d);
    if (k) counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) => (a.key < b.key ? 1 : a.key > b.key ? -1 : 0)); // newest first
}

/**
 * Does a dated row belong to the selected quarter? 'all' matches everything. A row with NO
 * parseable date matches ANY specific quarter too — fail-SAFE: a dateless payment is never
 * hidden by a quarter filter (better shown in every quarter than silently dropped).
 */
export function matchesQuarter(iso: string | null | undefined, selected: string): boolean {
  if (selected === "all") return true;
  const k = quarterKeyOf(iso);
  return k === null || k === selected;
}

// ─── [CROSS-QUARTER] "Paid in a different quarter than it was booked" ──────────────────
// BoekBrug is accrual (factuurstelsel): BTW/omzet/kosten fall in the quarter of the INVOICE
// date, never the payment date. That is correct and never changes. But the owner still needs
// to SEE when a Q1 invoice was actually settled in Q2 — for their own cash view and to answer
// the accountant's "when did this come in?" — without ever being told the tax quarter moved.
// This is the one honest signal for that: it returns the PAYMENT quarter's label only when
// both dates parse AND they fall in different quarters. Everything else → null (no badge).
export interface CrossQuarterPayment {
  /** The quarter the money actually moved, e.g. "Q2 2026" — for the badge text. */
  paidQuarterLabel: string;
  /** The quarter the invoice belongs to for BTW/omzet (unchanged), e.g. "Q1 2026". */
  bookedQuarterLabel: string;
}

/**
 * Returns the cross-quarter marker when an invoice's payment landed in a DIFFERENT quarter
 * than its invoice date, else null. Both dates must parse; a missing/unpaid payment_date, an
 * unparseable date, or a same-quarter payment all yield null (no marker). Pure + display-only:
 * it never implies the accrual/tax quarter moved — only that the settlement happened later.
 */
export function crossQuarterPayment(
  invoiceDateIso: string | null | undefined,
  paymentDateIso: string | null | undefined,
): CrossQuarterPayment | null {
  const bookedKey = quarterKeyOf(invoiceDateIso);
  const paidKey = quarterKeyOf(paymentDateIso);
  if (!bookedKey || !paidKey) return null;
  if (bookedKey === paidKey) return null;
  return {
    paidQuarterLabel: quarterLabelOf(paidKey),
    bookedQuarterLabel: quarterLabelOf(bookedKey),
  };
}
