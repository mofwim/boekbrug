// src/lib/document-preview.ts
// [DOC-GEEN-BLADZIJDE] Can this document be shown as a page, and if not, what should be said?
// Pure, no I/O. Run: npx tsx --test src/lib/document-preview.test.ts
//
// WHAT WAS ON THE SCREEN
// The document sheet renders an <img> for a photo, and puts everything else in an <iframe>. For a
// pdf that is right. For a UBL e-invoice it means the browser renders the SOURCE, so an owner
// opening an incoming invoice on their phone got:
//
//     <?xml version="1.0" encoding="UTF-8"?>
//     <Invoice xmlns:qdt="urn:oasis:names:specification:ubl:schema:xsd:QualifiedDatatypes-2"
//     xmlns:ccts="urn:oasis:names:specification:ubl:schema:xsd:CoreComponentParameters-2"
//     …
//
// — a wall of namespace declarations, in a dark frame, under a panel of tidy amounts. Nothing about
// it is wrong exactly; it is simply not a document, and it is the last thing a zzp'er needs to see
// while checking whether an invoice is right.
//
// It is also unnecessary. This app already READS these files (ubl-invoice.ts extracts the
// money-truth from UBL, and the bank importers read MT940 and CAMT.053), and the sheet already
// shows what it read directly above the frame. So the frame has nothing left to add.
//
// WHAT REPLACES IT
// A sentence: this is a machine-readable file, it has no page, what we read from it is above, and
// the source is one tap away if you want it. The "Openen in nieuw tabblad" button stays exactly
// where it was — the raw file is not hidden, it is just no longer the default view.
//
// WHY THE EXTENSION AND NOT THE CONTENT TYPE
// The same reason the file route already gives: the storage bucket carries no content type we can
// trust, and the path is what we have. Guessing wrong here costs a sentence, never a wrong file.

export type PreviewKind =
  /** A photographed receipt. Renders anywhere in an <img>. */
  | "image"
  /** A page. The <iframe> is right for this. */
  | "pdf"
  /** Machine-readable: no page exists to show. */
  | "structured"
  /** Unknown. Still framed, because a frame is the better guess for something unrecognised. */
  | "other";

const IMAGE = /\.(jpe?g|png|webp|heic|heif|gif|bmp|tiff?)$/;
const PDF = /\.pdf$/;

/**
 * Formats with no visual page, and what to call each one.
 *
 * Ordered: the more specific bank formats are tested before the bare `.xml`, because a CAMT.053
 * statement is also an xml file and calling it an e-invoice would be worse than saying nothing.
 */
const STRUCTURED: readonly (readonly [RegExp, string])[] = [
  [/\.(mt940|sta|940)$/, "een bankafschrift (MT940)"],
  [/\.(camt|053)$/, "een bankafschrift (CAMT.053)"],
  [/\.ubl$/, "een e-factuur (UBL)"],
  [/\.xml$/, "een XML-bestand — meestal een e-factuur (UBL) of een bankafschrift"],
  [/\.csv$/, "een CSV-bestand"],
  [/\.(txt|text)$/, "een tekstbestand"],
  [/\.eml$/, "een e-mailbestand"],
  [/\.p7m$/, "een digitaal ondertekend bestand"],
];

/** What kind of thing is this, judged from its name. */
export function previewKind(fileName: string | null | undefined): PreviewKind {
  const lower = String(fileName ?? "").toLowerCase();
  if (IMAGE.test(lower)) return "image";
  if (PDF.test(lower)) return "pdf";
  if (STRUCTURED.some(([re]) => re.test(lower))) return "structured";
  return "other";
}

/** The Dutch name of the format, or null when this is not a structured file. */
export function structuredFormatLabel(fileName: string | null | undefined): string | null {
  const lower = String(fileName ?? "").toLowerCase();
  return STRUCTURED.find(([re]) => re.test(lower))?.[1] ?? null;
}

/**
 * What the sheet says where the page would have been.
 *
 * Dutch: read by the entrepreneur (AGENTS.md). It says three things, and all three are needed —
 * what the file is, why there is nothing to look at, and that the reading is right there above it.
 * Leaving the last one out would turn an explanation into an apology.
 */
export function noPageNotice(fileName: string | null | undefined): string {
  const label = structuredFormatLabel(fileName) ?? "een bestand zonder bladzijde";
  return (
    `Dit is ${label}. Zo'n bestand is voor de computer geschreven en heeft geen bladzijde om te ` +
    "tonen. Wat wij eruit gelezen hebben, staat hierboven. Wil je toch de brontekst zien, open het " +
    "bestand dan in een nieuw tabblad."
  );
}
