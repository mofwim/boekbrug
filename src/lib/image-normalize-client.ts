// src/lib/image-normalize-client.ts
// [INTAKE-IMG-NORMALIZE] Browser-side: make any picked image a format the invoice
// reader can ACTUALLY read, BEFORE it is uploaded. The reader (Claude) reads only
// jpeg/png/webp/gif; an iPhone HEIC/HEIF (and a scanner BMP/TIFF) reaches it as an
// "unsupported type" → confidence 0 → the real invoice is silently filed away as an
// unreadable document and its voorbelasting is lost. We convert those here so every
// photographed invoice is read, whatever the phone/OS produced.
//
// Quality discipline (a 7-year bewaarplicht tax doc): a baseline JPG/PNG that already
// fits the upload cap is passed through UNCHANGED — no re-compression. We re-encode
// ONLY when we must: an unreadable format, OR an image so large it would be rejected
// by the 10 MB cap (bounding the long edge to A4@300dpi loses nothing legible and
// rescues a photo that would otherwise be refused outright).
//
// Client-only: uses createImageBitmap / <canvas>. Shared by the single-file upload
// path (UploadClient) AND the multi-page combine (combine-images-pdf) so both agree
// on exactly which bytes reach the reader — one source of truth, never duplicated.

/** Baseline JPEG SOI marker (FF D8 FF). */
export function isJpg(b: Uint8Array): boolean {
  return b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
}

/** PNG 8-byte signature. */
export function isPng(b: Uint8Array): boolean {
  return (
    b.length >= 8 &&
    b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 &&
    b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a
  );
}

/**
 * The intake upload cap: the largest request body the PLATFORM will carry.
 *
 * [UPLOAD-PLAFOND] This was 10 MB, "mirroring /api/intake's server-side MAX_BYTES" — the app's own
 * limit. But the app's limit is not the one that bites. A Vercel function's request body is capped
 * by the platform at roughly 4.5 MB, and that rejection happens BEFORE any of our code runs: no
 * JSON, no server sentence, just a bare 413. So every surface here was compressing files down to a
 * size it believed was fine, handing them to a platform that refused them, and then telling the
 * owner to go and split the PDF themselves. Reported from a phone, on a three-page supplier
 * invoice, with the two pages already picked and the sheet still open.
 *
 * 4 MB, not 4.5: a multipart body carries boundaries, field names and headers on top of the file,
 * and a proxy may add its own. Half a megabyte of headroom costs nothing — an invoice that needs
 * the last 500 KB to be legible does not exist — and buys the difference between "it uploaded" and
 * a refusal the owner cannot act on.
 *
 * The number is a best estimate of somebody else's limit, and it is deliberately NOT the only
 * defence: upload-fit.ts retries a 413 with a harder squeeze, so if this value is ever wrong in
 * the wrong direction the app recovers by measurement instead of by assumption.
 *
 * The server keeps its own 10 MB MAX_BYTES. That is not dead code — it guards the paths a browser
 * does not walk (the e-mail intake, a future direct-to-storage upload), where the platform limit
 * does not apply.
 */
export const MAX_INTAKE_UPLOAD_BYTES = 4 * 1024 * 1024;

// A full-resolution phone photo (12–48 MP) drawn onto a canvas can EXCEED the mobile
// canvas area limit (iOS Safari ≈ 16.7 MP); over that, the browser does not always
// throw — it can yield an all-WHITE canvas, so toBlob returns a valid-but-blank JPEG
// and the page embeds silently unreadable. Bounding the long edge keeps the canvas
// well under the limit so the draw is real, and it keeps the AI read sane. A4 at
// 300 dpi ≈ 2480×3508, so 2500 loses nothing legible.
export const MAX_EDGE = 2500;

/** Default JPEG quality — high enough that a re-encode stays legible for OCR/AI. */
export const DEFAULT_QUALITY = 0.92;

/** Bounds for ONE re-encode. Defaults reproduce the original behaviour exactly. */
export interface JpegBounds {
  maxEdge?: number;
  quality?: number;
}

// Decode any browser-displayable image (WebP/HEIC/GIF/BMP/TIFF/…) and re-encode as
// JPEG so both the reader and pdf-lib can handle it. Only used when the bytes are NOT
// already a baseline JPG/PNG that fits the cap (those pass through losslessly).
//
// [MULTI-PAGE-FIT] `bounds` lets the multi-page combiner re-encode a page TIGHTER than
// the default when N pages must together fit one upload cap. Omitted → the exact
// defaults every existing caller already relied on (MAX_EDGE, quality 0.92).
export async function toJpegBytes(file: File, bounds?: JpegBounds): Promise<Uint8Array> {
  const maxEdge = Math.max(1, Math.round(bounds?.maxEdge ?? MAX_EDGE));
  const quality = Math.min(1, Math.max(0.3, bounds?.quality ?? DEFAULT_QUALITY));
  const bitmap = await createImageBitmap(file);
  try {
    let w = bitmap.width;
    let h = bitmap.height;
    const longEdge = Math.max(w, h);
    if (longEdge > maxEdge) {
      const k = maxEdge / longEdge;
      w = Math.max(1, Math.round(w * k));
      h = Math.max(1, Math.round(h * k));
    }
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("canvas 2d context unavailable");
    ctx.drawImage(bitmap, 0, 0, w, h); // scaled draw into the bounded canvas
    const blob: Blob = await new Promise((resolve, reject) =>
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("canvas toBlob failed"))), "image/jpeg", quality),
    );
    // A byte-trivial blob means the encode produced nothing real — refuse it rather
    // than embed an empty page (belt-and-braces on top of the size bound above).
    if (blob.size < 256) throw new Error("canvas produced an empty image");
    return new Uint8Array(await blob.arrayBuffer());
  } finally {
    bitmap.close();
  }
}

/** True when a name/type looks like a raster image we might need to normalize. Covers
 *  the HEIC/HEIF an iPhone produces (often with an EMPTY mime on desktop/Files), plus
 *  webp/gif/bmp/tiff — anything the invoice reader or pdf-lib can't take as-is. */
export function looksLikeImage(file: File): boolean {
  return (
    file.type.startsWith("image/") ||
    /\.(jpe?g|png|webp|heic|heif|gif|bmp|tiff?)$/i.test(file.name)
  );
}

/** Swap (or add) a `.jpg` extension. `bon.heic` → `bon.jpg`, `bon` → `bon.jpg`. */
function toJpgName(fileName: string): string {
  const dot = fileName.lastIndexOf(".");
  const stem = dot > 0 ? fileName.slice(0, dot) : fileName;
  return `${stem}.jpg`;
}

/**
 * Normalize ONE picked file for upload:
 *   - Not an image (PDF / XML / bank / spreadsheet) → returned UNCHANGED (handled elsewhere).
 *   - A baseline JPG/PNG within `maxBytes` → returned UNCHANGED (lossless — the tax doc's
 *     original bytes are preserved and the server wraps them into a PDF).
 *   - Anything else image-ish (HEIC/HEIF/WebP/GIF/BMP/TIFF, or an OVERSIZED JPG/PNG that
 *     would trip the cap) → re-encoded to a bounded JPEG so it is BOTH readable and small
 *     enough to accept.
 *
 * Never throws: on any decode failure the ORIGINAL file is returned (server behaviour is
 * then exactly today's — the file is stored, never lost), so normalization can only help.
 */
export async function normalizeImageForUpload(file: File, maxBytes: number): Promise<File> {
  if (!looksLikeImage(file)) return file;
  try {
    const head = new Uint8Array(await file.slice(0, 8).arrayBuffer());
    const baseline = isJpg(head) || isPng(head);
    if (baseline && file.size <= maxBytes) return file; // lossless passthrough
    const jpeg = await toJpegBytes(file);
    // Copy into a fresh ArrayBuffer so the File is backed by a plain buffer (some
    // browsers require this for a clean multipart upload).
    const ab = new ArrayBuffer(jpeg.byteLength);
    new Uint8Array(ab).set(jpeg);
    return new File([ab], toJpgName(file.name), { type: "image/jpeg" });
  } catch {
    return file; // undecodable → keep original; the server still stores it, never lost
  }
}
