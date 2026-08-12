// src/lib/upload-fit.ts
// [UPLOAD-PLAFOND] Make a file fit the upload, and recover when the platform still says no.
// =====================================================================
// Three things existed already and none of them were joined up:
//
//   · normalizeImageForUpload  — re-encodes an image down to a byte budget;
//   · compressToFit            — rewrites a PDF's embedded images down to a byte budget, leaving
//                                the text as text (pdfcompress.ts, lazily imported: it pulls in
//                                pdf-lib, which has no business in every page's bundle);
//   · MAX_INTAKE_UPLOAD_BYTES  — the budget.
//
// The budget was wrong (see image-normalize-client.ts), and the PDF compressor was wired into ONE
// screen. Everywhere else a too-large PDF met a sentence telling the owner to split it by hand —
// on a phone, which is where this app is used. "Doe het zelf maar" is not a feature.
//
// ── WHY A RETRY, WHEN THE BUDGET IS ALREADY LOWER ──
//
// The budget is an estimate of a limit that belongs to somebody else and is invisible from inside
// the app: a 413 arrives with no body, no JSON, no header naming the ceiling. An estimate can be
// wrong — a proxy in front of the function may be stricter, or the platform may change. So the
// budget is the first line and not the only one: a 413 is answered by squeezing harder and
// sending again, once. That turns a guess into a measurement, and the owner sees an upload that
// took a moment longer instead of an instruction they cannot follow.
//
// Once, not in a loop: a second 413 after a genuinely smaller file is not a size problem any more,
// and retrying a third time would only spend the owner's mobile data proving it.
// =====================================================================

import { normalizeImageForUpload, MAX_INTAKE_UPLOAD_BYTES } from './image-normalize-client'

/** What a fit attempt did, so a caller can say something true about it. */
export interface FitResult {
  file: File
  /** Did it get under the budget? A `false` here is not a refusal — it is still worth sending. */
  fits: boolean
  before: number
  after: number
  /** How it got there, for the log and for the sentence the owner reads. */
  method: 'untouched' | 'image' | 'pdf'
}

/** Is this a PDF? By type, falling back to the name — a phone's file picker is not always sure. */
export function isPdf(file: { type?: string; name?: string }): boolean {
  return file.type === 'application/pdf' || /\.pdf$/i.test(file.name ?? '')
}

/**
 * Bring a file under the upload budget: an image is re-encoded, a PDF has its images downsampled,
 * anything else is passed through.
 *
 * Never throws. A file that cannot be shrunk comes back as it was with `fits: false`, because a
 * document the owner can still send and have refused is strictly better than one this function
 * swallowed — and the caller can then say which of the two happened.
 */
export async function fitForUpload(file: File, budget = MAX_INTAKE_UPLOAD_BYTES): Promise<FitResult> {
  const before = file.size

  if (isPdf(file)) {
    if (before <= budget) return { file, fits: true, before, after: before, method: 'untouched' }
    try {
      // [PDF-LAZY] pdf-lib is ~300 KB and is needed by roughly nobody on a normal upload. Pulled
      // in only once a document is actually too big, so the common path never pays for it.
      const { compressToFit } = await import('./tools/pdfcompress')
      const r = await compressToFit(file, budget)
      return { file: r.file, fits: r.fits, before: r.before, after: r.after, method: 'pdf' }
    } catch {
      // A PDF this cannot decode is left exactly as it was — pdfcompress's own rule. Sending it
      // and letting the server judge beats refusing a document we merely failed to read.
      return { file, fits: false, before, after: before, method: 'untouched' }
    }
  }

  // Images: normalizeImageForUpload already handles "unreadable format" as well as "too big", so
  // it runs even when the file is small enough — that is what rescues a HEIC.
  try {
    const out = await normalizeImageForUpload(file, budget)
    return {
      file: out,
      fits: out.size <= budget,
      before,
      after: out.size,
      method: out === file ? 'untouched' : 'image',
    }
  } catch {
    return { file, fits: before <= budget, before, after: before, method: 'untouched' }
  }
}

/** The budget for the SECOND attempt, after the platform refused the first. */
export function retryBudget(budget = MAX_INTAKE_UPLOAD_BYTES): number {
  // Halved rather than nudged. A 413 means the real ceiling is below where we aimed, and by an
  // unknown amount — shaving 10% off would most likely earn a second 413 and a second wasted
  // upload over a mobile connection. Half is one round trip, and an invoice at 2 MB is still far
  // above what the reader needs to read it.
  return Math.max(512 * 1024, Math.floor(budget / 2))
}

/** Everything a caller needs to send a file and survive a platform refusal. */
export interface SendResult {
  response: Response
  /** The bytes actually sent — what a duplicate hash or an audit line should record. */
  sent: File
  /** True when the first attempt was refused for size and a smaller one was sent instead. */
  retried: boolean
  /**
   * What the fit achieved. Carried out so a screen can tell the two failures apart: a document we
   * could not shrink enough (offer the owner something) and one the server refused on its merits
   * (say what the server said). Without this the screen has to guess, and it guessed "too big".
   */
  fit: FitResult
}

/**
 * Send a file, fitting it first and squeezing again if the platform refuses it for size.
 *
 * `send` is injected rather than called here so this is testable without a network, and so each
 * screen keeps its own FormData shape (intake sends `source` and `force`; the kasboek sends a
 * date; /upload sends a folder).
 */
export async function sendWithFit(
  file: File,
  send: (f: File) => Promise<Response>,
  budget = MAX_INTAKE_UPLOAD_BYTES,
  // `fit` is injectable for the same reason `send` is. The real one needs a canvas or pdf-lib, so
  // in a test runner it can only ever return the file untouched — which would make the retry, the
  // whole point of this function, permanently unexercised while the suite reported green.
  fit: (f: File, b: number) => Promise<FitResult> = fitForUpload,
): Promise<SendResult> {
  const first = await fit(file, budget)
  const res = await send(first.file)
  if (res.status !== 413) return { response: res, sent: first.file, retried: false, fit: first }

  // The platform refused it for size despite our budget. Squeeze against a smaller one and send
  // once more — the second answer is the honest one, whatever it says.
  const second = await fit(first.file, retryBudget(budget))
  // Nothing was gained; a second identical upload would only cost the owner time and data.
  if (second.after >= first.after) return { response: res, sent: first.file, retried: false, fit: first }

  return { response: await send(second.file), sent: second.file, retried: true, fit: second }
}
