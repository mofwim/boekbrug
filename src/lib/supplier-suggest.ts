// src/lib/supplier-suggest.ts
// [LEVERANCIER-KIEZEN] While the owner types a supplier name, offer the suppliers they already
// have — so a correction lands ON an existing company instead of founding a new one.
//
// ── WHY THIS IS NOT COSMETIC ──
//
// A supplier is not typed into this app the way a customer is. A customer is someone the owner
// CHOOSES (klanten: a form, a list, a picker on /dashboard/invoice/new). A supplier ARRIVES, on a
// piece of paper, and the app has to read its name off the page — so suppliers.name is whatever
// the reader made of a letterhead. When that reading is wrong the owner corrects it here, and the
// correction is keyed: learnSupplierAlias resolves the corrected name through supplierNameKey and
// links this spelling to the supplier whose name_key matches. Land on the existing name and the
// two invoices become one supplier's history; land one character beside it and a SECOND supplier
// row is created for a company the owner already has, with the crediteurenstand split across both.
//
// Retyping a name from memory is exactly how you land beside it. So the field shows what is there.
//
// ── WHY A SUBSTRING FILTER WOULD NOT HAVE HELPED ──
//
// The case this was built for: the AI read a delivery stamp ("Jim Ketels 01-09-2026 09:38") and
// the owner started retyping the real company, "W. Ketels en Zoon Eierhandel". After four
// characters the field holds "w ke". A substring filter — which is what the customer picker on
// /dashboard/invoice/new does — asks whether "w ke" appears inside "w. ketels en zoon eierhandel",
// and it does not: the printed name has a period the owner did not type. So the one screen where
// the name matters most would have offered nothing until the spelling already matched.
//
// Hence token-prefix matching: every word typed must START a word of the name. "w ke" → w·ke →
// "w"·"ketels" ✓. That is how a person searches a company name, and it costs nothing to be right.
//
// ── WHAT THIS DELIBERATELY DOES NOT DO ──
//
// It does not use vendorCoreKey. That key strips entity-form words (bv, holding, cooperatie…)
// because two spellings of one company must produce ONE identity; a SEARCH that strips them
// answers nothing for an owner typing "Holding" — the word is on the screen and would match
// nothing. Identity and search are different jobs, and giving search identity's blind spots is how
// a field looks broken. normalizeVendor (the shared fold: diacritics, case, whitespace) is reused;
// the noise list is not.
//
// Pure — no I/O, no React. Run: npx tsx --test src/lib/supplier-suggest.test.ts

// [ÉÉN-LEVERANCIERSSLEUTEL] The one vendor fold in the app. A second lowercase/diacritic pass
// written here would be a copy that agrees today.
import { normalizeVendor } from '@/lib/safecore'

/** A supplier the owner already has. `iban` is shown to tell two similar names apart. */
export interface SupplierChoice {
  id: string
  name: string
  iban?: string | null
}

export interface SupplierMatch extends SupplierChoice {
  /** The typed text already IS this name (folded). */
  exact: boolean
}

export interface SupplierSuggestion {
  /** Best first, capped. */
  matches: SupplierMatch[]
  /**
   * [ZOEK-EERLIJK] How many more matched than fitted. A capped list presented as the whole list is
   * how an owner concludes a supplier is not in there and types a second spelling of it.
   */
  hidden: number
  /** The field holds a known supplier's name exactly — there is nothing left to choose. */
  settled: boolean
}

/** How many suggestions a panel shows at once. Six, like the customer picker on /invoice/new. */
export const SUPPLIER_SUGGEST_LIMIT = 6

/**
 * How many suppliers a screen ships to the browser for this panel.
 *
 * NOT a display cap — the panel shows six at a time and says how many more matched. This is the
 * payload cap, so an owner with years of history does not carry all of it on every page load. Well
 * past any real Dutch zzp'er's supplier count, and the field still accepts a typed name if a
 * supplier ever falls outside it: the panel is an aid, never a gate.
 *
 * Lives here, next to the matching it feeds, because two screens read it and a second number named
 * in a second file is how the two quietly stop agreeing.
 */
export const SUPPLIER_PICK_LIMIT = 400

/**
 * [LEVERANCIER-BLADEREN] How many the BROWSE list shows — the one the owner opens deliberately,
 * having asked to see what they have rather than typed a guess.
 *
 * Six is right for a panel that appears under a half-typed word and must not bury the form. It is
 * wrong for "show me my suppliers": an owner with 54 of them would get six and a line saying there
 * are 48 more, from a list they opened precisely because they did not know what to type. So the
 * browse list is the whole registry, and the panel scrolls instead of truncating.
 */
export const SUPPLIER_BROWSE_LIMIT = SUPPLIER_PICK_LIMIT

/** Below this the panel stays shut on typing: one letter matches most of a supplier list. */
export const SUPPLIER_SUGGEST_MIN_CHARS = 2

const EMPTY: SupplierSuggestion = { matches: [], hidden: 0, settled: false }

/** Fold, then split on anything that is not a letter or a digit. Script-agnostic on purpose:
 *  `[^a-z0-9]` would erase a supplier written in Arabic or Greek entirely. */
function words(raw: string): string[] {
  return normalizeVendor(raw)
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .split(' ')
    .filter((w) => w.length > 0)
}

/**
 * Rank one candidate against the typed text. Lower is better; null means it does not match.
 *
 *   0  the whole name, typed out
 *   1  the name starts with what was typed
 *   2  what was typed appears inside the name
 *   3  every word typed starts a (different) word of the name
 *   4  with every separator removed, what was typed appears in the name — an owner who leaves out
 *      the ampersand of "OZ&ER FOOD" is not making a mistake the panel should punish
 */
function rank(queryFolded: string, queryWords: string[], querySquashed: string, name: string): number | null {
  const folded = normalizeVendor(name)
  if (!folded) return null
  if (folded === queryFolded) return 0
  if (folded.startsWith(queryFolded)) return 1
  if (folded.includes(queryFolded)) return 2

  const nameWords = words(name)
  if (queryWords.length === 0 || nameWords.length === 0) return null
  const nameSquashed = nameWords.join('')
  // Each typed word claims a DIFFERENT word of the name, so "ket ket" does not match "Ketels"
  // twice — a doubled word is a typo, and answering it with a match hides the typo.
  const taken = new Set<number>()
  let everyWordFound = true
  for (const q of queryWords) {
    const at = nameWords.findIndex((w, i) => !taken.has(i) && w.startsWith(q))
    if (at < 0) { everyWordFound = false; break }
    taken.add(at)
  }
  if (everyWordFound) return 3
  return querySquashed !== '' && nameSquashed.includes(querySquashed) ? 4 : null
}

/**
 * The suppliers to offer for what has been typed so far.
 *
 * An empty query returns the whole list (capped) — that is the panel on focus, and seeing the
 * suppliers you have is the point. Ordering is fully determined (rank, then shortest name, then
 * name, then id), so the same input always produces the same list: a panel that reshuffles under
 * a finger is a panel that gets the wrong row tapped.
 */
export function suggestSuppliers(
  query: string,
  options: readonly SupplierChoice[] | null | undefined,
  limit: number = SUPPLIER_SUGGEST_LIMIT,
): SupplierSuggestion {
  if (!options || options.length === 0) return EMPTY
  const cap = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : SUPPLIER_SUGGEST_LIMIT

  const queryFolded = normalizeVendor(query)
  const queryWords = words(query)
  const querySquashed = queryWords.join('')

  const scored: { rank: number; choice: SupplierChoice; folded: string }[] = []
  for (const choice of options) {
    const folded = normalizeVendor(choice.name)
    if (!folded) continue // a nameless supplier row is nothing to offer
    // Empty query → the list itself, all of it equally relevant.
    const r = queryFolded === '' ? 9 : rank(queryFolded, queryWords, querySquashed, choice.name)
    if (r === null) continue
    scored.push({ rank: r, choice, folded })
  }
  if (scored.length === 0) return EMPTY

  // [LEVERANCIER-BLADEREN] Shortest-first is a RELEVANCE rule: among names that all matched what
  // was typed, the shortest is the tightest match. With nothing typed nothing matched, so it ranks
  // by an accident of spelling — and a list of 54 companies ordered by name length is one an owner
  // has to read end to end to find anything. With no query the order is the alphabet.
  const browsing = queryFolded === ''
  scored.sort((a, b) =>
    a.rank - b.rank ||
    (browsing ? 0 : a.choice.name.length - b.choice.name.length) ||
    a.folded.localeCompare(b.folded, 'nl') ||
    a.choice.id.localeCompare(b.choice.id),
  )

  const settled = queryFolded !== '' && scored.some((s) => s.folded === queryFolded)
  const shown = scored.slice(0, cap)
  return {
    matches: shown.map((s) => ({ ...s.choice, exact: s.folded === queryFolded })),
    hidden: scored.length - shown.length,
    settled,
  }
}

/** Should the panel be open for this text? Kept here so both doors answer it the same way. */
export function shouldSuggest(query: string, focused: boolean): boolean {
  if (!focused) return false
  // Empty and focused = "show me what I have". Otherwise wait for two characters, or every list
  // opens fully on the first keystroke of every word.
  const folded = normalizeVendor(query)
  return folded.length === 0 || folded.length >= SUPPLIER_SUGGEST_MIN_CHARS
}
