// src/lib/article-learning.ts
// [ARTIKEL-LEREN] Which invoice lines are worth remembering, and what to do with the ones the
// catalog already knows. Pure, no I/O — run: npx tsx --test src/lib/article-learning.test.ts
//
// WHY THIS EXISTS
// The catalog (`articles`) could only be filled two ways: by typing an article on /dashboard/
// artikelen, or by pressing the small "bewaar in catalogus" button next to a line. Both require
// the owner to know the catalog exists BEFORE it can help them. So the first invoice teaches the
// app nothing, the second is typed out again by hand, and the picker an owner meets on invoice
// twenty is still empty. A catalog that only fills when you remember to fill it is a catalog for
// the people who least need one.
//
// So the lines an owner writes on their first invoice are learned as they are written.
//
// THE RULE THIS MODULE PROTECTS: LEARNING NEVER OVERRULES A PERSON.
// Three consequences, each of them a decision that is easy to get backwards:
//
//   · A description the catalog ALREADY holds is bumped, never rewritten. If the owner set the
//     catalog price of "Consult" to EUR 95 and then invoices one at EUR 80 as a favour, the
//     catalog keeps 95. Silently rewriting it would put the favour price on every later invoice —
//     a price change nobody asked for, arriving through a feature about convenience.
//   · A description the owner ARCHIVED is left completely alone: no insert, no bump, no revival.
//     Archiving is the owner saying "stop offering me this". Re-learning it from the next invoice
//     that happens to mention it would make that button do nothing, and there would be no error
//     to explain why.
//   · Nothing here decides anything about the INVOICE. The plan is additive to a side table; an
//     invoice line keeps every word of what it said either way.

import { foldText } from "./search";
import { round2 } from "./invoice-totals";

/** A line as it was written on the invoice, after the route's own validation. */
export interface LearnableLine {
  description: string;
  unit_price: number;
  btw_rate: number;
  unit: string | null;
}

/** What the catalog already holds, as little of it as the decision needs. */
export interface CatalogEntry {
  id: string;
  description: string;
  usage_count: number;
  active: boolean;
}

export interface CatalogInsert {
  description: string;
  unit_price: number;
  btw_rate: number;
  unit: string | null;
}

export interface CatalogLearningPlan {
  /** New articles, in the order the lines appeared. */
  toInsert: CatalogInsert[];
  /** Existing ACTIVE articles to raise by one, so "most used first" means something. */
  toBump: Array<{ id: string; usage_count: number }>;
  /** Lines that carried nothing worth remembering (blank text, a rate the catalog cannot hold). */
  skipped: number;
  /**
   * Lines that WOULD have been learned but fell outside the per-invoice cap.
   *
   * Reported rather than swallowed: a cap the caller cannot see is a cap that reads as "everything
   * was learned". The caller logs it. It should stay 0 for any invoice a human typed.
   */
  dropped: number;
}

/** The BTW rates an article may carry — the same set normalizeArticleInput enforces. */
const VALID_RATES = new Set([0, 9, 21]);

/**
 * A twenty-line invoice is ordinary; a five-hundred-line import is not something to learn from.
 * The cap bounds the write, and `dropped` makes it visible when it bites.
 */
const DEFAULT_MAX_NEW_PER_INVOICE = 25;

/**
 * The key both sides match on.
 *
 * foldText is what the PICKER already ranks with (matchArticles → foldText), so a line learned here
 * is findable by the same rule that will look for it. Whitespace is collapsed on top of that: an
 * owner who types "Consult  " on Tuesday and "Consult" on Friday means one article, and a catalog
 * that disagreed would answer with two identical-looking rows and no way to tell them apart.
 */
export function articleKey(description: string): string {
  return foldText(description).replace(/\s+/g, " ").trim();
}

/**
 * Decide what the catalog should learn from one invoice's lines.
 *
 * Deterministic and side-effect free: the caller performs the writes and is free to drop the whole
 * plan on the floor. Learning is never allowed to be the reason an invoice fails.
 */
export function planCatalogLearning(
  lines: readonly LearnableLine[],
  catalog: readonly CatalogEntry[],
  opts?: { maxNewPerInvoice?: number },
): CatalogLearningPlan {
  const maxNew = opts?.maxNewPerInvoice ?? DEFAULT_MAX_NEW_PER_INVOICE;

  // Every key the catalog knows, ACTIVE or NOT. Archived entries are in here on purpose: they must
  // block an insert (no duplicate row) without earning a bump.
  const known = new Map<string, CatalogEntry>();
  for (const entry of catalog) {
    const key = articleKey(entry.description);
    if (!key) continue;
    const seen = known.get(key);
    // An active row wins a tie: if the same description exists twice (possible — there is no
    // uniqueness on description), the one the picker can actually offer is the one to bump.
    if (!seen || (!seen.active && entry.active)) known.set(key, entry);
  }

  const plan: CatalogLearningPlan = { toInsert: [], toBump: [], skipped: 0, dropped: 0 };
  // Within ONE invoice the same description may appear on several lines (two days of the same
  // work). That is one article and one bump, not two of each.
  const handled = new Set<string>();

  for (const line of lines) {
    const description = (line.description ?? "").trim();
    const key = articleKey(description);
    if (!key) {
      plan.skipped++;
      continue;
    }
    if (handled.has(key)) continue;

    const existing = known.get(key);
    if (existing) {
      handled.add(key);
      // Archived: the owner already said no. Silence is the correct answer here — see the header.
      if (existing.active) plan.toBump.push({ id: existing.id, usage_count: existing.usage_count });
      continue;
    }

    // A rate the catalog cannot hold would be rejected by normalizeArticleInput anyway; counting it
    // as skipped keeps the numbers addable instead of losing the line between two layers.
    if (!VALID_RATES.has(line.btw_rate) || !Number.isFinite(line.unit_price) || line.unit_price < 0) {
      plan.skipped++;
      continue;
    }

    if (plan.toInsert.length >= maxNew) {
      plan.dropped++;
      continue;
    }
    handled.add(key);
    plan.toInsert.push({
      description,
      unit_price: round2(line.unit_price),
      btw_rate: line.btw_rate,
      unit: (line.unit ?? "").trim() || null,
    });
  }

  return plan;
}

/**
 * Should this document teach the catalog at all?
 *
 * A `creditnota` is a correction of something already invoiced. Its lines are copies of lines that
 * were learned when the original was written, and its own wording ("correctie factuur 2026-014") is
 * not work anyone sells. Learning from one would fill the picker with the record of a mistake.
 *
 * An `offerte` does count: it is the owner describing real work, often before the first invoice
 * exists, and the second quote should already suggest what the first one said.
 *
 * WHY THIS TAKES THREE SPELLINGS FOR TWO THINGS
 * A quote is `offerte` in the UI and in /api/invoice/draft's own vocabulary, but that route stores
 * it as `pro_forma` (DB_TYPE) — and invoices.invoice_type accepts BOTH, so rows exist under either
 * word. The edit route asks this question with the stored value, the draft route with the UI one.
 * Letting each caller translate is how one truth comes to be spelled two ways in two files, which
 * is the exact defect the skipped-import panel was built to survive. It is one rule, so it lives
 * in one function, and the function knows every word its callers actually have.
 */
export function documentTeachesCatalog(kind: string): boolean {
  return kind === "factuur" || kind === "offerte" || kind === "pro_forma";
}
