// src/lib/grootboek-lines.ts
// [GROOTBOEK] WHICH words the ledger screen says about a suggestion, apart from the screen.
// Pure, no I/O. Run: npx tsx --test src/lib/grootboek-lines.test.ts
//
// [TAAL] A component holds no language of its own. And the reason a suggestion gives is the whole
// point of suggesting rather than booking: "Huisvestingskosten" on its own is an instruction, and
// "Huisvestingskosten, because you put this supplier there before" is something the owner can
// disagree with. Deciding here rather than in JSX is also what makes the empty case testable —
// the one where the app knows nothing and has to say so.
//
// NOTE ON LANGUAGE: identifiers and comments are English (AGENTS.md); the KEYS resolve to Dutch.

import type { MessageKey } from "./i18n/messages";
import type { LedgerSuggestion } from "./grootboek";

export interface SuggestionPhrase {
  key: MessageKey;
  params?: Record<string, string | number>;
}

/**
 * Why this account is being suggested — never a machine tag, and never silence.
 *
 * `default` is a sentence too, and that is deliberate: an empty reason under a pre-filled account
 * reads as confidence nobody has. The app saying "we do not know, pick one" is the honest version
 * of the same screen.
 */
export function suggestionReason(suggestion: LedgerSuggestion): SuggestionPhrase {
  if (suggestion.basis === "supplier_history") return { key: "gb.waaromVaker" };
  if (suggestion.basis === "keywords" && suggestion.matched) {
    return { key: "gb.waaromWoord", params: { woord: suggestion.matched } };
  }
  // A keyword basis with no word recorded cannot name one; it falls back rather than inventing.
  return { key: "gb.waaromNiets" };
}

/** The count line above the list. Absent when there is nothing left to answer. */
export function openCountPhrase(open: number): SuggestionPhrase {
  if (open <= 0) return { key: "gb.klaar" };
  if (open === 1) return { key: "gb.openEen" };
  return { key: "gb.open", params: { n: open } };
}
