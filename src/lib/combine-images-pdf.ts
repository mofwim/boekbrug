// src/lib/combine-images-pdf.ts
// [MULTI-PAGE] Combine several photos/images — the PAGES of ONE invoice — into a single
// multi-page PDF, in the BROWSER, before upload. The owner explicitly says "these belong
// together" (they tapped the multi-page flow), so there is no guessing: N images in → 1 PDF
// out → /api/intake reads all pages and extracts ONE invoice (the existing multi-page path).
//
// Quality discipline (mirrors src/lib/image-to-pdf.ts on the server): a JPG/PNG is embedded
// as its ORIGINAL bytes — no re-compression, full fidelity for the 7-year bewaarplicht. Only a
// format pdf-lib can't embed natively (HEIC from an iPhone, WebP, GIF) is routed through a
// canvas → JPEG so it still lands in the PDF instead of being dropped. Each page is wrapped on
// its own A4 sheet, centered and scaled to fit, exactly like the single-image server path — so
// a page opens uniformly and can carry the "Betaald op" stamp later.
//
// [MULTI-PAGE-FIT] …but that lossless embed had NO size bound, while /api/intake refuses
// anything over 10 MB (MAX_BYTES). A modern phone photo is 3–5 MB, so THREE pages already
// produced a PDF the server rejected — and the sheet then re-offered the same pages, so the
// retry failed forever. Worse, the failure was arbitrary: a HEIC page went through toJpegBytes
// (bounded to 2500px) and stayed small, so the very same invoice combined fine on an iPhone
// and never on an Android. The combiner now guarantees a file the server accepts:
//   attempt 0 — everything LOSSLESS when the originals already fit (the common 2–4 page case,
//               where the quality discipline above costs nothing);
//   attempt 1+ — re-encode every page through progressively tighter bounds, measuring the REAL
//               saved PDF each time (a PNG can inflate when pdf-lib re-encodes it to Flate, so
//               only the produced bytes can be trusted, never the input sizes).
// Only when even the tightest tier overflows do we fail — and then with a reason that names the
// actual problem (too many pages) instead of a bare "Bestand te groot".
//
// Pure-ish + deterministic: same inputs → same PDF. No network, no AI. Throws only on a truly
// undecodable file so the caller can fall back to uploading the images individually.

import { PDFDocument, type PDFImage } from "pdf-lib";
// [INTAKE-IMG-NORMALIZE] jpg/png sniff + canvas → JPEG re-encode live in one shared client
// module, so the single-file upload path and this multi-page combine agree byte-for-byte on
// which images are embedded losslessly vs re-encoded. Never duplicated.
import {
  isJpg,
  isPng,
  toJpegBytes,
  MAX_EDGE,
  DEFAULT_QUALITY,
  MAX_INTAKE_UPLOAD_BYTES,
  type JpegBounds,
} from "./image-normalize-client";

// A4 in PDF points, matching image-to-pdf.ts so single- and multi-page invoices look identical.
const A4_W = 595.28;
const A4_H = 841.89;
const MARGIN = 20;

// [MULTI-PAGE-FIT] Leave headroom under the server cap for the PDF's own structure (xref,
// page objects) and for multipart overhead, so a build we accept here is not refused there.
const FIT_RATIO = 0.85;

// [MULTI-PAGE-FIT] The escalation ladder, loosest first. Tier 0 is exactly what a single
// picked photo already gets on the normal upload path (A4@300dpi, q0.92), so a 2–3 page
// invoice keeps the quality the single-page flow has always produced. The tighter tiers only
// ever apply to page counts that cannot fit otherwise — a legible page beats a refused upload.
const TIERS: JpegBounds[] = [
  { maxEdge: MAX_EDGE, quality: DEFAULT_QUALITY },
  { maxEdge: 2000, quality: 0.85 },
  { maxEdge: 1600, quality: 0.78 },
];

/** How ONE page is put on the sheet: its untouched bytes, or a re-encode at these bounds. */
type PagePlan = "original" | JpegBounds;

async function embedOnePage(doc: PDFDocument, file: File, plan: PagePlan): Promise<void> {
  let img: PDFImage;
  if (plan === "original") {
    const raw = new Uint8Array(await file.arrayBuffer());
    try {
      // Lossless path: embed the ORIGINAL bytes for a baseline JPG/PNG (no re-compression).
      if (isJpg(raw)) img = await doc.embedJpg(raw);
      else if (isPng(raw)) img = await doc.embedPng(raw);
      else img = await doc.embedJpg(await toJpegBytes(file)); // WebP/HEIC/GIF → JPEG
    } catch {
      // pdf-lib rejects some valid files (a PROGRESSIVE JPEG — common from phone cameras —
      // or an interlaced/16-bit PNG). Re-encode via canvas to a baseline JPEG so the page is
      // still included instead of failing the whole combine. Slight re-compression, but a
      // present page beats a dropped invoice.
      img = await doc.embedJpg(await toJpegBytes(file));
    }
  } else {
    // A bounded tier — always through the canvas, so every page shares one predictable size.
    img = await doc.embedJpg(await toJpegBytes(file, plan));
  }

  const maxW = A4_W - MARGIN * 2;
  const maxH = A4_H - MARGIN * 2;
  const scale = Math.min(maxW / img.width, maxH / img.height, 1);
  const w = img.width * scale;
  const h = img.height * scale;
  const page = doc.addPage([A4_W, A4_H]);
  page.drawImage(img, { x: (A4_W - w) / 2, y: (A4_H - h) / 2, width: w, height: h });
}

/** Build the whole document at one plan. Throws naming the page that could not be decoded. */
async function buildPdf(files: File[], plan: PagePlan): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < files.length; i++) {
    try {
      await embedOnePage(doc, files[i], plan); // sequential: one image in memory at a time
    } catch {
      // Abort the WHOLE combine on any unreadable page — never ship a PDF that silently drops
      // a page. Name the page so the owner knows which photo to redo.
      throw new Error(`Pagina ${i + 1} kon niet worden verwerkt — maak er een duidelijkere foto van.`);
    }
  }
  return doc.save();
}

/**
 * Combine `files` (in order) into ONE multi-page PDF, one image per page.
 * Returns a `File` (application/pdf) ready to POST to /api/intake as a single invoice.
 *
 * The result is GUARANTEED to fit `maxBytes` (the server's own cap by default) or the call
 * throws — it never hands back a file the upload will refuse.
 *
 * Throws if the list is empty, a file cannot be decoded at all, or the pages cannot be made
 * to fit even at the tightest quality tier.
 */
export async function combineImagesToPdf(
  files: File[],
  outName = "factuur-meerdere-paginas.pdf",
  maxBytes = MAX_INTAKE_UPLOAD_BYTES,
): Promise<File> {
  if (!files.length) throw new Error("Geen pagina's om te combineren.");

  const fits = Math.floor(maxBytes * FIT_RATIO);

  // Attempt 0 — fully lossless, but only when the originals plausibly fit. Skipping this when
  // they clearly don't saves one wasted full-resolution build on a big batch.
  const originalTotal = files.reduce((sum, f) => sum + f.size, 0);
  const plans: PagePlan[] = originalTotal <= fits ? ["original", ...TIERS] : [...TIERS];

  let bytes: Uint8Array | null = null;
  for (const plan of plans) {
    // A decode failure names its page and is FATAL at every tier — a tighter re-encode cannot
    // rescue a photo the browser could not read, so retrying would only repeat the same error.
    const built = await buildPdf(files, plan);
    if (built.byteLength <= fits) {
      bytes = built;
      break;
    }
    bytes = built; // keep the smallest so far; the loop ends on the tightest tier
  }

  if (!bytes || bytes.byteLength > maxBytes) {
    const mb = (maxBytes / 1024 / 1024).toFixed(0);
    throw new Error(
      `Deze ${files.length} pagina's passen samen niet in één factuur (max ${mb} MB). ` +
        `Voeg minder pagina's tegelijk toe, of splits de factuur.`,
    );
  }

  // Copy into a fresh ArrayBuffer so the File is backed by a plain ArrayBuffer (not a
  // possibly-shared Uint8Array view), which some browsers require for a clean upload.
  const ab = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(ab).set(bytes);
  return new File([ab], outName, { type: "application/pdf" });
}
