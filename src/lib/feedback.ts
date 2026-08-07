// src/lib/feedback.ts
// [FEEDBACK] What counts as a usable problem report. Pure, no I/O.
// Run: npx tsx --test src/lib/feedback.test.ts
//
// WHY THIS EXISTS AT ALL
// This codebase is built so nothing fails silently: the skipped-import panel admits what could not
// be read, the bank screen says when a line may keep coming back, a failed lookup refuses instead
// of answering "niets". All of that honesty stops at the screen. The owner is told something went
// wrong and there is no way for that to reach anyone who can fix it — so the app's own reports of
// trouble are, from the outside, indistinguishable from silence.
//
// The screenshot is not decoration. The most useful report is the one the owner cannot describe
// ("er staat iets roods"), and a picture carries what a sentence loses.
//
// WHAT THIS MODULE REFUSES, AND WHY EACH REFUSAL IS ITS OWN SENTENCE
// A form that answers one blank "ongeldig" for every problem makes the owner guess. Each rule here
// returns what is wrong with THIS message, in Dutch, because the person reading it is already
// having a bad enough time to be writing to us.

import { sniffReadableMime } from "./detect-file";

/** Long enough to say something, short enough that no one can post a novel into the table. */
export const FEEDBACK_MIN_CHARS = 4;
export const FEEDBACK_MAX_CHARS = 4000;

/**
 * 5 MB of decoded image. A phone screenshot is well under this; the cap exists so one report
 * cannot fill the bucket, and it is checked on the DECODED bytes because base64 is ~33% larger and
 * a limit on the string would be a different (and wrong) number.
 */
export const FEEDBACK_MAX_IMAGE_BYTES = 5 * 1024 * 1024;

/** Only what a browser will show back. The type is decided by the BYTES, never by what was sent. */
const ALLOWED_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

export interface FeedbackInput {
  message: string;
  /** The page the owner was on. Recorded, not asked for — see normalizeFeedbackPath. */
  path: string | null;
  image: { bytes: Buffer; mimeType: string } | null;
}

export type FeedbackParse =
  | { ok: true; value: FeedbackInput }
  | { ok: false; error: string };

/**
 * The path the report came from, reduced to something safe to store and useful to read.
 *
 * Kept because it is the single most valuable field and the one an owner should never have to
 * type: "welke pagina?" is a question they answer wrong under stress, and the app already knows.
 *
 * A query string is dropped whole. It is where this app puts ids and focus targets, and a report
 * about a screen does not need to carry them into a table that is read by a human later.
 */
export function normalizeFeedbackPath(raw: unknown): string | null {
  const s = typeof raw === "string" ? raw.trim() : "";
  if (!s.startsWith("/")) return null; // never an absolute URL: this is OUR page, not a link out
  const clean = s.split("?")[0].split("#")[0];
  return clean.slice(0, 200) || null;
}

/**
 * Validate a raw request body into something worth storing.
 *
 * The image is decoded and SNIFFED. A client-declared type is a claim, and this file ends up in a
 * bucket the owner's other documents live in — accepting "image/png" for whatever bytes arrived is
 * how something that is not an image gets stored under an owner's folder with a trustworthy name.
 */
export function parseFeedback(raw: unknown): FeedbackParse {
  if (!raw || typeof raw !== "object") return { ok: false, error: "Ongeldige gegevens." };
  const r = raw as Record<string, unknown>;

  const message = typeof r.message === "string" ? r.message.trim() : "";
  if (message.length < FEEDBACK_MIN_CHARS) {
    return { ok: false, error: "Schrijf even kort wat er misging — dan kunnen we er iets mee." };
  }
  if (message.length > FEEDBACK_MAX_CHARS) {
    return { ok: false, error: `Dit bericht is te lang (max ${FEEDBACK_MAX_CHARS} tekens).` };
  }

  const path = normalizeFeedbackPath(r.path);

  if (r.image == null || r.image === "") {
    return { ok: true, value: { message, path, image: null } };
  }
  if (typeof r.image !== "string") return { ok: false, error: "De afbeelding kon niet worden gelezen." };

  // Accept a data: URL as well as bare base64 — a browser FileReader hands over the former, and
  // refusing it would make the caller strip a prefix that we can just as easily ignore here.
  const base64 = r.image.includes(",") && r.image.slice(0, 32).includes("base64")
    ? r.image.slice(r.image.indexOf(",") + 1)
    : r.image;

  let bytes: Buffer;
  try {
    bytes = Buffer.from(base64, "base64");
  } catch {
    return { ok: false, error: "De afbeelding kon niet worden gelezen." };
  }
  if (bytes.length === 0) return { ok: false, error: "De afbeelding kon niet worden gelezen." };
  if (bytes.length > FEEDBACK_MAX_IMAGE_BYTES) {
    return { ok: false, error: "De afbeelding is te groot (max 5 MB)." };
  }

  const sniffed = sniffReadableMime(bytes);
  if (!sniffed || !ALLOWED_IMAGE_TYPES.has(sniffed)) {
    // Named, not blanket-refused: "ongeldig bestand" over a PDF someone dragged in tells them
    // nothing, and they will try the same thing again.
    return { ok: false, error: "Stuur een afbeelding mee (png, jpg, webp of gif) — geen ander bestand." };
  }

  return { ok: true, value: { message, path, image: { bytes, mimeType: sniffed } } };
}

/** The extension for a sniffed image type — the stored name should match its real content. */
export function feedbackImageExtension(mimeType: string): string {
  switch (mimeType) {
    case "image/png": return "png";
    case "image/webp": return "webp";
    case "image/gif": return "gif";
    default: return "jpg";
  }
}
