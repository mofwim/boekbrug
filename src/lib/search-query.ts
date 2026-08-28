// src/lib/search-query.ts
// [ZOEK-BEGRIJPT] Read the parts of a query that are not text, and hand back what is left.
// Pure — no I/O, no clock of its own. Run: npx tsx --test src/lib/search-query.test.ts
//
// ── WHY ──
//
// The cap is honest now: when a search holds results back it says so. But saying "there are more"
// without a way to narrow leaves the owner exactly where they were — and the one thing they most
// often want to narrow BY is already in what they typed. "doyum 2025" means the 2025 ones.
//
// That is what makes Gmail and Drive feel intelligent: not a cleverer ranking, but understanding
// the parts of a sentence that are not search terms at all. This does the same with the handful of
// words a Dutch bookkeeping query actually contains: a year, a quarter, a month, a direction, and
// whether it is paid.
//
// ── THE TWO RULES THAT KEEP IT HONEST ──
//
// 1. A RECOGNISED TOKEN IS CONSUMED. If "2025" narrows to that year AND stays a text term, the
//    filter changes nothing — every 2025 invoice matches the term anyway — and the owner sees no
//    difference. Recognising it has to REMOVE it.
//
// 2. WHAT WAS UNDERSTOOD IS SHOWN, AND CAN BE UNDONE. A query that silently means something other
//    than what was typed is worse than one that ignores half of it: results disappear and nothing
//    says why. Every filter comes back with a label for a chip the owner can remove.
//
// ── WHAT IT DELIBERATELY DOES NOT RECOGNISE ──
//
// A bare year on its own ("2025") stays a plain term. Alone it is far more likely to be part of an
// invoice number than a period, and guessing wrong there hides the exact document being looked for.
// It is only a period when there is something else to narrow.

export type Direction = "incoming" | "outgoing";
export type PaidState = "paid" | "open";

export interface QueryFilters {
  year?: number;
  /** 1-4. Only ever set together with a year — a quarter without one is not a period. */
  quarter?: 1 | 2 | 3 | 4;
  /** 1-12, from a Dutch month name. Only ever set together with a year. */
  month?: number;
  direction?: Direction;
  paid?: PaidState;
}

/** One thing the search understood, as the screen shows it back. */
export interface RecognisedFilter {
  /** Which filter this is, so a chip can remove exactly it. */
  key: keyof QueryFilters;
  /** The word the owner actually typed, so the chip reads like their own query. */
  token: string;
  /** Dutch, owner-facing — this lands on a chip. */
  label: string;
}

export interface ParsedQuery {
  /** What is left for ordinary term matching, after the recognised words are removed. */
  text: string;
  filters: QueryFilters;
  recognised: RecognisedFilter[];
}

const MONTHS: Record<string, number> = {
  januari: 1, februari: 2, maart: 3, april: 4, mei: 5, juni: 6,
  juli: 7, augustus: 8, september: 9, oktober: 10, november: 11, december: 12,
};

// Narrow on purpose. "klant" and "open" are ordinary words that appear in real company names and
// descriptions; consuming them would silently drop half the query on an innocent search.
const DIRECTION_WORDS: Record<string, Direction> = {
  inkoop: "incoming", inkoopfactuur: "incoming", inkoopfacturen: "incoming", inkomend: "incoming",
  verkoop: "outgoing", verkoopfactuur: "outgoing", verkoopfacturen: "outgoing", uitgaand: "outgoing",
};

const PAID_WORDS: Record<string, PaidState> = {
  betaald: "paid", voldaan: "paid",
  onbetaald: "open", openstaand: "open", openstaande: "open",
};

const YEAR_RE = /^(20\d{2})$/;
const QUARTER_RE = /^(?:q|kw|kwartaal)\s*([1-4])$/;

/** The label a chip shows. Dutch: it is read by the owner. */
function labelFor(key: keyof QueryFilters, f: QueryFilters): string {
  switch (key) {
    case "year": return `Jaar ${f.year}`;
    case "quarter": return `Q${f.quarter} ${f.year}`;
    case "month": {
      const name = Object.keys(MONTHS).find((m) => MONTHS[m] === f.month) ?? "";
      return `${name.charAt(0).toUpperCase()}${name.slice(1)} ${f.year}`;
    }
    case "direction": return f.direction === "incoming" ? "Inkoop" : "Verkoop";
    case "paid": return f.paid === "paid" ? "Betaald" : "Openstaand";
  }
}

export function parseSearchQuery(raw: string): ParsedQuery {
  const tokens = String(raw ?? "").trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return { text: "", filters: {}, recognised: [] };

  const filters: QueryFilters = {};
  const consumed = new Set<number>();
  const tokenOf: Partial<Record<keyof QueryFilters, string>> = {};

  // "q2" and "kwartaal 2" both occur; join the pair so the second form is one token to look at.
  const lower = tokens.map((t) => t.toLowerCase());
  const joined = lower.map((t, i) => (i + 1 < lower.length ? `${t} ${lower[i + 1]}` : t));

  for (let i = 0; i < tokens.length; i++) {
    if (consumed.has(i)) continue;
    const t = lower[i];

    if (filters.year === undefined && YEAR_RE.test(t)) {
      // Rule 1: a bare year, with nothing else in the query, stays a search term.
      if (tokens.length > 1) { filters.year = Number(t); tokenOf.year = tokens[i]; consumed.add(i); }
      continue;
    }
    const qm = QUARTER_RE.exec(t) ?? QUARTER_RE.exec(joined[i]);
    if (filters.quarter === undefined && qm) {
      filters.quarter = Number(qm[1]) as 1 | 2 | 3 | 4;
      tokenOf.quarter = tokens[i];
      consumed.add(i);
      if (QUARTER_RE.exec(t) === null) consumed.add(i + 1); // it matched the joined pair
      continue;
    }
    if (filters.month === undefined && MONTHS[t] !== undefined) {
      filters.month = MONTHS[t]; tokenOf.month = tokens[i]; consumed.add(i); continue;
    }
    if (filters.direction === undefined && DIRECTION_WORDS[t] !== undefined) {
      filters.direction = DIRECTION_WORDS[t]; tokenOf.direction = tokens[i]; consumed.add(i); continue;
    }
    if (filters.paid === undefined && PAID_WORDS[t] !== undefined) {
      filters.paid = PAID_WORDS[t]; tokenOf.paid = tokens[i]; consumed.add(i); continue;
    }
  }

  // A quarter or a month is a PERIOD, and a period without a year is not one. Rather than assume
  // the current year — which would silently answer a different question in January — the token
  // goes back to being ordinary text.
  if (filters.year === undefined) {
    for (const k of ["quarter", "month"] as const) {
      if (filters[k] !== undefined) {
        delete filters[k];
        const back = tokens.findIndex((tok) => tok === tokenOf[k]);
        if (back !== -1) consumed.delete(back);
        delete tokenOf[k];
      }
    }
  }
  // A quarter and a month together describe two periods. The month is the narrower of the two and
  // is what the owner typed most deliberately, so it wins and the quarter goes back to being text.
  if (filters.quarter !== undefined && filters.month !== undefined) {
    delete filters.quarter;
    const back = tokens.findIndex((tok) => tok === tokenOf.quarter);
    if (back !== -1) consumed.delete(back);
    delete tokenOf.quarter;
  }

  const recognised: RecognisedFilter[] = (Object.keys(filters) as Array<keyof QueryFilters>)
    .filter((k) => filters[k] !== undefined)
    .map((k) => ({ key: k, token: tokenOf[k] ?? "", label: labelFor(k, filters) }));

  return {
    text: tokens.filter((_, i) => !consumed.has(i)).join(" "),
    filters,
    recognised,
  };
}

/** The date range a set of filters describes, as ISO dates, or null when it names no period. */
export function filterDateRange(f: QueryFilters): { start: string; end: string } | null {
  if (f.year === undefined) return null;
  const p = (n: number) => String(n).padStart(2, "0");
  if (f.month !== undefined) {
    // Day 0 of the NEXT month is the last day of this one — leap years included, no table.
    const last = new Date(Date.UTC(f.year, f.month, 0)).getUTCDate();
    return { start: `${f.year}-${p(f.month)}-01`, end: `${f.year}-${p(f.month)}-${p(last)}` };
  }
  if (f.quarter !== undefined) {
    const firstMonth = (f.quarter - 1) * 3 + 1;
    const lastMonth = firstMonth + 2;
    const last = new Date(Date.UTC(f.year, lastMonth, 0)).getUTCDate();
    return { start: `${f.year}-${p(firstMonth)}-01`, end: `${f.year}-${p(lastMonth)}-${p(last)}` };
  }
  return { start: `${f.year}-01-01`, end: `${f.year}-12-31` };
}
