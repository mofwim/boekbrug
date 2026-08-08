// src/lib/logo-initials.ts
// [LOGO-INITIALEN] The monogram that stands in for an uploaded logo. Pure, no I/O.
// Run: npx tsx --test src/lib/logo-initials.test.ts
//
// WHY THIS IS ITS OWN FILE
// There were two of these, and they disagreed about the same company. The invoice PDF took the
// first letter of the FIRST and the LAST word, so "Kiwi Food Market" printed KM on every document
// that left the building. The avatar in the dashboard header took every word and then cut to two,
// so the same owner saw KF at the top of the screen. One business, two monograms, neither of them
// the one a person would write — which is KFM.
//
// A monogram is a small thing until it is on a customer's invoice, and then it is the first thing
// on the page. So: one function, one answer, and a test that names the company.
//
// THE RULE, AND WHY DUTCH DECIDES IT
// The first letter of every word, up to three. A name of one word gives its first two letters.
//
// The exception is the tussenvoegsel — "van", "de", "der", "'t". Taking those literally turns
// "Bakkerij van der Berg" into BVD, which says nothing about the bakery. But they can also START
// a name ("De Bakker", "Van Gogh"), and there the word does carry the identity. Dutch spelling
// already draws that line for us: a tussenvoegsel written in lowercase is a connector between
// parts of a name, and written with a capital it opens one. So the case in the ORIGINAL text is
// the signal, and no list of company names has to be guessed at.
//
// Diacritics are folded before anything else. The PDF renders in Helvetica, which has no glyph
// for most non-Latin letters, and the old version filtered them out AFTER slicing — so "Ölhandel"
// lost its Ö and printed a bare L. Folding first turns it into O, which is the letter the owner
// would have written anyway.

/**
 * Dutch tussenvoegsels and the joining words that turn up inside company names. Only skipped when
 * they appear in LOWERCASE in the original — see the note in the header — and never when they are
 * the only thing left.
 */
const JOINERS = new Set([
  "van", "von", "de", "den", "der", "des", "het", "'t", "ten", "ter", "te", "tot",
  "op", "aan", "bij", "in", "uit", "voor", "en", "of", "the", "and",
  "da", "das", "del", "della", "di", "do", "dos", "du", "el", "la", "le", "les",
]);

/** Maximum letters in the monogram. Three fits the circle and matches how people abbreviate. */
const MAX_LETTERS = 3;

/** Fold accents to their base letter: Ö → O, é → e. Helvetica has no glyph for the originals. */
function foldDiacritics(s: string): string {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

/** Everything Helvetica can draw in a monogram. Applied per word, after folding. */
function usableChars(word: string): string {
  return foldDiacritics(word).toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/**
 * The monogram for a company (or personal) name.
 *
 * Returns "•" when there is no usable letter at all — a blank slot on an invoice looks like a
 * rendering failure, and a lone surrogate half looks worse.
 */
export function deriveInitials(name: string | null | undefined): string {
  const words = String(name ?? "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  // Lowercase joiners drop out, but never all of them: "de" on its own is still a name to someone,
  // and an empty monogram is not an improvement over an odd one.
  const meaningful = words.filter((w) => !JOINERS.has(w.toLowerCase()) || w[0] !== w[0].toLowerCase());
  const parts = meaningful.length > 0 ? meaningful : words;

  // Words that fold away to nothing (an emoji, a lone "&") must not eat one of the three slots,
  // so the filter happens before the cap rather than after it.
  const letters = parts.map(usableChars).filter(Boolean);
  if (letters.length === 0) return "•";
  if (letters.length === 1) return letters[0].slice(0, 2);
  return letters.slice(0, MAX_LETTERS).map((w) => w[0]).join("");
}
