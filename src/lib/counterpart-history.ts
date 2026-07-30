// src/lib/counterpart-history.ts
// [BANK-COUNTERPART-HISTORY] "Wat deed ik hier de vorige keer mee?"
//
// The app already stores everything needed to answer that — counterpart_iban is written on every
// import (bank-import.ts), an IBAN hit is a CERTAIN-tier signal in the matcher (bank-matching.ts),
// and every categorised line records what the owner decided — and it shows none of it. So an
// owner staring at a EUR 30,49 debit to a wholesaler has no way to see that the previous six
// payments to that exact account number were all booked as kosten, even though the app knows.
//
// That is the cheapest possible resolution for an unidentifiable line, and it comes before any
// heavier answer: every euro of accountant time an unresolved bank line eventually costs is a
// euro this lookup might have saved.
//
// Deliberately NOT a suggestion and NOT an auto-fill. It reports what the owner did before and
// leaves the decision with them: `counterpart_memory` already drives the actual suggestion, and a
// second, differently-computed hint that could disagree with it would be worse than none.
//
// Pure + node-testable (run: npx tsx src/lib/counterpart-history.test.ts).

import { counterpartKey } from "./bank-identity";

/** The minimum a past line must expose to be counted. */
export interface HistoryLine {
  counterpart_name: string | null;
  counterpart_iban: string | null;
  category: string | null;
}

export interface CounterpartHistory {
  /** How many earlier categorised lines this counterpart has. */
  count: number;
  /** The category the owner chose most often for it. */
  topCategory: string;
  /** How many of `count` carried that category — so the UI can be honest about a split history. */
  topCount: number;
  /**
   * How the past lines were recognised. IBAN is an identity; a name is a resemblance — the bank
   * rewrites counterpart names constantly (processor prefixes, terminal ids, truncation), so a
   * name match is the weaker claim and the UI must be able to say which one it is.
   */
  matchedBy: "iban" | "naam";
}

/**
 * What did this owner do before with this counterpart? Returns null when there is nothing
 * honest to say: no identity to match on, or no earlier CATEGORISED line.
 *
 * IBAN first and exclusively when present on the current line: an account number is the identity
 * the matcher itself treats as decisive, and mixing in name matches would let a look-alike name
 * dilute a certain answer. Only when the line carries no IBAN do we fall back to the normalised
 * name key (the same one counterpart_memory uses, so the two agree about who "this" is).
 */
export function counterpartHistory(
  current: { counterpart_name: string | null; counterpart_iban: string | null },
  past: HistoryLine[],
): CounterpartHistory | null {
  const iban = (current.counterpart_iban ?? "").replace(/\s/g, "").toUpperCase();
  const key = counterpartKey(current.counterpart_name);

  let matchedBy: "iban" | "naam";
  let hits: HistoryLine[];

  if (iban) {
    matchedBy = "iban";
    hits = past.filter(
      (p) => (p.counterpart_iban ?? "").replace(/\s/g, "").toUpperCase() === iban,
    );
  } else if (key) {
    matchedBy = "naam";
    hits = past.filter((p) => counterpartKey(p.counterpart_name) === key);
  } else {
    return null;
  }

  // Only DECIDED lines count. An uncategorised past line is another open question, not an answer,
  // and reporting "5 eerdere betalingen" where none was ever placed would be the same false
  // reassurance this module exists to avoid.
  const decided = hits.filter((p) => p.category != null && p.category !== "");
  if (decided.length === 0) return null;

  const tally = new Map<string, number>();
  for (const p of decided) tally.set(p.category!, (tally.get(p.category!) ?? 0) + 1);

  // Highest count wins; ties break on the category name so the answer is stable across reloads
  // (a hint that changes between two equally-true values reads as a bug).
  let topCategory = "";
  let topCount = 0;
  for (const [cat, n] of [...tally.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    if (n > topCount) {
      topCategory = cat;
      topCount = n;
    }
  }

  return { count: decided.length, topCategory, topCount, matchedBy };
}
