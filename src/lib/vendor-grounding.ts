// src/lib/vendor-grounding.ts
// [GEGROND-NAAM] Is the supplier name the reader gave us actually printed on this document? Pure.
// Run: npx tsx --test src/lib/vendor-grounding.test.ts
//
// WHAT WAS MEASURED
// An invoice from BALKIP B.V. — its own letterhead, its own KVK, its own IBAN, sent from
// info@balkip.nl — was imported as "GROOTHANDEL M.H. BAL V.O.F.". A different company. Its three
// amounts were read correctly (669,57 / 60,26 / 729,83), and the app said so.
//
// Three explanations were checked and ruled out before this file was written:
//
//   · not a name match — supplierNameKey is token-exact, and "balkip" and "groothandel mh bal"
//     are different keys, so nothing could have merged them;
//   · not the supplier registry — it never overwrites what was read (see its own header: an
//     invoice whose vendor cannot be resolved "still imports with its raw client_name");
//   · not the learned reading hints — those are computed per screen for display and never reach
//     the model's prompt.
//
// So the reader produced a name that is not on the paper. That happens; a model reading a document
// is the premise of this product. What made it reach the books unchallenged is the gap this file
// closes: THE AMOUNTS HAVE A WITNESS AND THE NAME HAS NONE. amount-grounding.ts searches the
// document's own characters for each of the three figures. Nothing asked the same question about
// the name, so the one field that was wrong was the one field with no check on it.
//
// It is not a cosmetic field. invoices.client_name is the identity key four systems use through
// supplierNameKey() — and one of them is knownIbanForVendor, the IBAN-change check, which is what
// stands between the owner and a payment redirected to a stranger. A name read as a DIFFERENT
// company does not fail that check; it looks up a different supplier and passes.
//
// ── WHY THE VERDICT IS DELIBERATELY FORGIVING ──
// A great many invoices print the company name only inside a LOGO, which is an image and carries
// no characters. A read that is perfectly correct then has nothing to find, and a check that
// flagged those would produce a warning on ordinary invoices — which is how a warning stops being
// read, and this codebase has said so about three other checks already.
//
// So 'absent' is the narrow verdict, not the default. It requires all of:
//   · a text layer with enough characters that its absence means something;
//   · a name with at least one DISTINCTIVE token — a short or generic one proves nothing;
//   · not one of those distinctive tokens appearing anywhere in the text.
//
// Anything else is 'unreadable': the check could not run. Never 'found', because claiming a name
// was corroborated when it was not is the failure that made this necessary.

import { supplierNameKey, isReliableSupplierName } from "./supplier-registry";

export type VendorVerdict =
  /** A distinctive part of the name is printed in the document's own text. */
  | "found"
  /** There IS text, the name is specific enough to search for, and none of it is there. */
  | "absent"
  /** The check could not run: no text layer, or no name worth searching for. */
  | "unreadable";

/**
 * The shortest token worth searching for.
 *
 * Three characters is where a token stops being evidence: "bal", "vof", "van" and "bv" occur
 * inside ordinary Dutch words and inside other companies' names. Four is the first length at
 * which a hit means something and a miss means something.
 */
export const MIN_DISTINCTIVE_TOKEN = 4;

/**
 * The shortest text layer worth drawing a conclusion from.
 *
 * Below this, a PDF has a few stray characters rather than a document — a page number, a font
 * artefact — and "the name is not in the text" would be a statement about our extraction, not
 * about the invoice.
 */
export const MIN_TEXT_LENGTH = 200;

/** The same normalisation the registry keys on, applied to a whole document. */
function normalizeText(text: string): string {
  return ` ${text.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, " ").trim()} `;
}

/** The parts of a read name specific enough to be worth looking for. */
export function distinctiveTokens(name: string | null | undefined): string[] {
  return supplierNameKey(name)
    .split(" ")
    .filter((t) => t.length >= MIN_DISTINCTIVE_TOKEN);
}

/**
 * Does the name the reader gave us appear in the document's own text?
 *
 * A hit on ONE distinctive token is enough. The reader routinely returns a fuller or tidier form
 * than the paper prints — "Sligro Food Group B.V." for a letterhead reading "SLIGRO" — and
 * demanding the whole name would call those wrong. What this is built to catch is the other thing
 * entirely: a name with NOTHING of it on the page.
 */
export function groundVendorName(
  name: string | null | undefined,
  text: string | null | undefined,
): VendorVerdict {
  const t = String(text ?? "").trim();
  // No text layer, or too little of it to mean anything. This is the photographed-receipt case and
  // it is the ordinary one — see the header for why it may never read as a failure.
  if (t.length < MIN_TEXT_LENGTH) return "unreadable";
  // "Onbekende afzender" and friends. Searching for a placeholder proves nothing either way.
  if (!isReliableSupplierName(name)) return "unreadable";

  const tokens = distinctiveTokens(name);
  // Every token too short to be evidence — a name like "K&M BV". A miss here would say more about
  // the threshold than about the invoice.
  if (tokens.length === 0) return "unreadable";

  const haystack = normalizeText(t);
  // Whole tokens only. Substring matching would confirm "bal" inside "balans" and "totaal", which
  // is precisely the kind of false corroboration this file exists to avoid.
  return tokens.some((tok) => haystack.includes(` ${tok} `)) ? "found" : "absent";
}

/**
 * The sentence the owner reads. Dutch, per AGENTS.md — it goes on their screen.
 *
 * It names the read AND asks for the paper, because the owner is the only one who can settle it.
 * Deliberately not "this is wrong": the check cannot know that. It knows the name is not printed
 * in the text, which is a reason to look, not a verdict.
 */
export function vendorGroundingText(
  verdict: VendorVerdict,
  name: string | null | undefined,
): string | null {
  if (verdict !== "absent") return null;
  const shown = String(name ?? "").trim();
  return (
    `de naam "${shown}" staat nergens in de tekst van dit document — controleer bij welke ` +
    "leverancier deze factuur hoort"
  );
}
