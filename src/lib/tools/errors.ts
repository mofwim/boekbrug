// src/lib/tools/errors.ts
// [PDF-TOOLS] What a tool says when something goes wrong.
//
// The engines raise a CODE and the numbers that belong to it; the screen does
// the wording. Two reasons, and neither is decoration:
//
//   · a message written into the engine would be Dutch in a library whose file
//     names, identifiers and comments are English (AGENTS.md), and it would be
//     the wrong language the moment one of these tools gets an /en twin, as the
//     calculators already have;
//   · the same failure is worded differently depending on where it happened —
//     "this file is not a PDF" is more useful in a drop zone than in a page
//     list, and the engine cannot know which it is in.
//
// The Dutch a visitor reads lives in MESSAGES below, next to nothing else, so
// there is one place to look when a sentence is wrong.

export type ToolErrorCode =
  | "pdfLocked"
  | "pdfUnreadable"
  | "pdfEmpty"
  | "notAPdf"
  | "notAnImage"
  | "imageUnreadable"
  | "tooLarge"
  | "noPages"
  | "allDropped"
  | "badImage"
  | "noImages"
  | "nothingSelected"
  | "encodeFailed"
  | "canvasBlocked";

export interface ToolErrorDetails {
  name?: string;
  n?: number;
  max?: number;
  [key: string]: string | number | undefined;
}

export class ToolError extends Error {
  readonly code: ToolErrorCode;
  readonly details: ToolErrorDetails;

  constructor(code: ToolErrorCode, details: ToolErrorDetails = {}) {
    super(code);
    this.name = "ToolError";
    this.code = code;
    this.details = details;
  }
}

/** Raise a coded failure. Returns `never` so callers can `return fail(...)`. */
export function fail(code: ToolErrorCode, details: ToolErrorDetails = {}): never {
  throw new ToolError(code, details);
}

// Dutch on the screen — see the note at the top of this file, and AGENTS.md.
const MESSAGES: Record<ToolErrorCode, (d: ToolErrorDetails) => string> = {
  pdfLocked: (d) => `${d.name ?? "Dit bestand"} heeft een wachtwoord. Haal dat er eerst af.`,
  pdfUnreadable: (d) => `${d.name ?? "Dit bestand"} kon niet gelezen worden. Is het wel een PDF?`,
  pdfEmpty: (d) => `${d.name ?? "Dit bestand"} bevat geen pagina's.`,
  notAPdf: (d) => `${d.name ?? "Dit bestand"} is geen PDF.`,
  notAnImage: (d) => `${d.name ?? "Dit bestand"} is geen afbeelding.`,
  imageUnreadable: (d) => `${d.name ?? "Deze afbeelding"} kon niet geopend worden.`,
  tooLarge: (d) => `${d.name ?? "Dit bestand"} is te groot (maximaal ${d.max ?? 100} MB).`,
  noPages: () => "Er bleven geen pagina's over.",
  allDropped: () => "Je hebt alle pagina's weggegooid — er blijft niets over om op te slaan.",
  badImage: (d) => `${d.name ?? "Deze afbeelding"} kon niet in de PDF gezet worden.`,
  noImages: () => "Er zaten geen afbeeldingen in dit document.",
  nothingSelected: () => "Je hebt nog niets gekozen.",
  encodeFailed: () => "Het opslaan lukte niet. Probeer een ander formaat.",
  canvasBlocked: () =>
    "Je browser blokkeert het tekenen van afbeeldingen. Staat er een privacy-extensie aan?",
};

/**
 * Turn whatever was thrown into a sentence somebody can read.
 *
 * Anything without a code is shown as it came: a browser's own message about a
 * broken file is more use than a shrug, even when it is in English.
 */
export function describeError(err: unknown): string {
  if (err instanceof ToolError) return MESSAGES[err.code](err.details);
  if (err instanceof Error && err.message) return err.message;
  return "Er ging iets mis.";
}
