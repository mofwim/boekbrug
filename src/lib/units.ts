// src/lib/units.ts
// [UNIT] The unit on an invoice line — and the code it must become in an e-invoice.
// Run: npx tsx --test src/lib/units.test.ts
//
// ═══ WHY THIS EXISTS ═══
//
// On a PDF "2 uur" is just text; a human reads it. In an E-INVOICE it is a CODE, and that code
// is standardised: Peppol BIS Billing 3.0 requires @unitCode to come from UN/ECE Recommendation
// 20 (rev. 11). A receiving accounting package reads that code, not our Dutch word.
//
// ═══ THE BUG THIS REPAIRS ═══
//
// ubl-export.ts wrote `unitCode="C62"` on EVERY line, regardless of what it said. C62 means
// "one / piece". That is right for a product, and WRONG for:
//
//   · 2 hours of labour  → must be HUR, went out as "2 pieces"
//   · 14 m² of painting  → must be MTK, went out as "14 pieces"
//   · 5 km of travel     → must be KMT, went out as "5 pieces"
//
// No amount changes because of it — the TOTAL stays correct — but the e-invoice describes
// something other than what was delivered. During an audit or a dispute that is the document
// that counts.
//
// The catalogue already had a `unit` field, but it was FREE TEXT nobody read: "uur", "Uur", "u",
// "stuk", "st." and "" all led to exactly the same C62. This module turns it into a closed list,
// with one translator to the standard.
//
// ═══ THE FAILURE DIRECTION ═══
//
// Unknown or empty unit → C62. Not pretty, but it is what already happens today, so no existing
// invoice changes meaning by adding this module. Whoever CHOOSES a unit gets the right code from
// now on; whoever chooses nothing keeps exactly what they had.
//
// NOTE ON LANGUAGE: identifiers and comments are English (see AGENTS.md). The `name`/`plural`
// VALUES stay Dutch — they are printed on a Dutch invoice, so they are content, not code.

/** The units that occur on a Dutch freelancer's invoice line. Deliberately short. */
export interface Unit {
  /** What appears in the app and on the PDF (Dutch — this is user-facing content). */
  name: string;
  /** The code from UN/ECE Rec 20 rev. 11 — this is what ends up in the e-invoice. */
  code: string;
  /** Plural for readability on a line ("2 uur", "3 stuks"). */
  plural?: string;
}

/**
 * The closed list. Every code was checked against UN/ECE Rec 20 rev. 11.
 *
 * Keeping it short is a choice: a list of 400 codes makes choosing harder than typing, and 99%
 * of the invoices in this product use the first four. If a unit is missing, that is one extra
 * line — but a DELIBERATE one, with the code looked up rather than guessed.
 */
export const UNITS: readonly Unit[] = [
  { name: "stuk", code: "C62", plural: "stuks" },
  { name: "uur", code: "HUR", plural: "uur" },
  { name: "dag", code: "DAY", plural: "dagen" },
  { name: "maand", code: "MON", plural: "maanden" },
  { name: "m²", code: "MTK" },
  { name: "m¹", code: "MTR" },
  { name: "km", code: "KMT" },
  { name: "kg", code: "KGM" },
  { name: "liter", code: "LTR" },
  // [SET] A set/pair counts as one delivered whole. E96 = 'set'.
  { name: "set", code: "E96", plural: "sets" },
];

/** The code used on a line WITHOUT a chosen unit — exactly what already happens today. */
export const DEFAULT_UNIT_CODE = "C62";

/**
 * Translates whatever sits in `artikelen.unit` / `invoice_lines` into a UN/ECE code.
 *
 * Tolerant on purpose: the field was free text for years, so the existing data holds "uur",
 * "Uur", "u", "st", "stuks", "m2" and everything in between. We still want to translate those
 * correctly — re-exporting an old invoice must not become worse than it was.
 *
 * Unknown or empty → DEFAULT_UNIT_CODE. Never a guess: an invented code is worse than the code
 * that is already there, because then the e-invoice describes something specific that is wrong.
 */
export function toUnitCode(unit: string | null | undefined): string {
  const s = (unit ?? "").trim().toLowerCase();
  if (!s) return DEFAULT_UNIT_CODE;

  // Exact name from the list (including the plural).
  for (const u of UNITS) {
    if (s === u.name.toLowerCase()) return u.code;
    if (u.plural && s === u.plural.toLowerCase()) return u.code;
  }
  // Someone who typed the CODE itself.
  const asCode = UNITS.find((u) => u.code.toLowerCase() === s);
  if (asCode) return asCode.code;

  return SYNONYMS[s] ?? DEFAULT_UNIT_CODE;
}

/**
 * The spellings that occur in free text.
 *
 * These live OUTSIDE the function so isKnownUnit() can consult them too. Inside, that second
 * function would have to duplicate the knowledge — and then one of the two eventually grows and
 * the other does not.
 */
const SYNONYMS: Readonly<Record<string, string>> = {
  "u": "HUR", "uren": "HUR", "hr": "HUR", "h": "HUR",
  "st": "C62", "st.": "C62", "stk": "C62", "stks": "C62", "x": "C62",
  "m2": "MTK", "m^2": "MTK", "vierkante meter": "MTK",
  "m": "MTR", "m1": "MTR", "meter": "MTR", "strekkende meter": "MTR",
  "kilometer": "KMT", "kilometers": "KMT",
  "kilo": "KGM", "kilogram": "KGM",
  "l": "LTR", "ltr": "LTR", "liters": "LTR",
  "dagen": "DAY", "mnd": "MON", "maanden": "MON",
  "paar": "E96",
};

/**
 * The name as it should appear on screen and on the PDF, given a quantity.
 *
 * UNKNOWN TEXT STAYS EXACTLY AS THE USER WROTE IT. That sounds obvious, but the first version
 * got it wrong and the test caught it: "rol" translates to C62 (the fallback), and looking up
 * the unit for that code yields "stuk" — so "2 rol" became "2 stuks" on screen. That is no
 * longer a rendering but a silent change to someone's invoice.
 *
 * So the question is not "which code belongs to this" but "do I KNOW this word". Only then may
 * it be replaced with the tidy spelling.
 */
export function unitLabel(unit: string | null | undefined, quantity = 1): string {
  const s = (unit ?? "").trim();
  if (!s) return "";
  if (!isKnownUnit(s)) return s;
  const u = UNITS.find((x) => x.code === toUnitCode(s));
  if (!u) return s;
  // At exactly 1 always the singular; otherwise the plural when there is one.
  return quantity === 1 ? u.name : (u.plural ?? u.name);
}

/**
 * Does the app know this unit, or is it free text from the past?
 *
 * Mind the trap that sat here: "toUnitCode() !== C62" is NOT a good check, because 'stuk' is a
 * perfectly known unit that yields exactly C62. The answer must come from the question "is this
 * word anywhere in my list?", not from the outcome of the translation.
 */
export function isKnownUnit(unit: string | null | undefined): boolean {
  const s = (unit ?? "").trim().toLowerCase();
  if (!s) return false;
  if (s in SYNONYMS) return true;
  return UNITS.some(
    (u) =>
      u.name.toLowerCase() === s ||
      u.plural?.toLowerCase() === s ||
      u.code.toLowerCase() === s,
  );
}
