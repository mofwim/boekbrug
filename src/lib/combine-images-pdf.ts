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
// Pure-ish + deterministic: same inputs → same PDF. No network, no AI. Throws only on a truly
// undecodable file so the caller can fall back to uploading the images individually.

import { PDFDocument, type PDFImage } from "pdf-lib";
// [INTAKE-IMG-NORMALIZE] jpg/png sniff + canvas → JPEG re-encode live in one shared client
// module, so the single-file upload path and this multi-page combine agree byte-for-byte on
// which images are embedded losslessly vs re-encoded. Never duplicated.
import { isJpg, isPng, toJpegBytes } from "./image-normalize-client";

// A4 in PDF points, matching image-to-pdf.ts so single- and multi-page invoices look identical.
const A4_W = 595.28;
const A4_H = 841.89;
const MARGIN = 20;

async function embedOnePage(doc: PDFDocument, file: File): Promise<void> {
  const raw = new Uint8Array(await file.arrayBuffer());
  let img: PDFImage;
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

  const maxW = A4_W - MARGIN * 2;
  const maxH = A4_H - MARGIN * 2;
  const scale = Math.min(maxW / img.width, maxH / img.height, 1);
  const w = img.width * scale;
  const h = img.height * scale;
  const page = doc.addPage([A4_W, A4_H]);
  page.drawImage(img, { x: (A4_W - w) / 2, y: (A4_H - h) / 2, width: w, height: h });
}

/**
 * Combine `files` (in order) into ONE multi-page PDF, one image per page.
 * Returns a `File` (application/pdf) ready to POST to /api/intake as a single invoice.
 * Throws if the list is empty or a file cannot be decoded at all.
 */
export async function combineImagesToPdf(files: File[], outName = "factuur-meerdere-paginas.pdf"): Promise<File> {
  if (!files.length) throw new Error("Geen pagina's om te combineren.");
  const doc = await PDFDocument.create();
  for (let i = 0; i < files.length; i++) {
    try {
      await embedOnePage(doc, files[i]); // sequential: one image in memory at a time
    } catch {
      // Abort the WHOLE combine on any unreadable page — never ship a PDF that silently drops
      // a page. Name the page so the owner knows which photo to redo.
      throw new Error(`Pagina ${i + 1} kon niet worden verwerkt — maak er een duidelijkere foto van.`);
    }
  }
  const bytes = await doc.save();
  // Copy into a fresh ArrayBuffer so the File is backed by a plain ArrayBuffer (not a
  // possibly-shared Uint8Array view), which some browsers require for a clean upload.
  const ab = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(ab).set(bytes);
  return new File([ab], outName, { type: "application/pdf" });
}
