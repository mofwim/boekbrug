// src/lib/image-to-pdf.ts
// [INTAKE-IMG-PDF] Convert an uploaded IMAGE (JPG/PNG) to a one-page PDF at the
// moment of upload — WhatsApp's "process once, at ingest" idea, but WITHOUT the
// quality loss (we wrap, we never re-compress: pdf-lib.embedJpg/embedPng embeds
// the original image bytes as-is inside the PDF).
//
// Why here and not in the closing package:
//   - Upload is ONE file at a time → peak memory is a single image, never
//     hundreds in parallel. The package's old batch-convert memory risk simply
//     never arises.
//   - Every invoice then lives as a PDF from day one, so the package just copies
//     and stamps — no conversion at download time. (The package keeps its own
//     image→PDF fallback for the handful of legacy images already in Storage.)
//
// Quality: an invoice is a 7-year bewaarplicht tax document. We do NOT down-scale
// or re-encode — the image is embedded at full fidelity, only wrapped in a PDF
// page so it opens uniformly and can carry the payment stamp later.
//
// Pure-ish + best-effort: on any failure the ORIGINAL bytes are returned
// unchanged, so a conversion problem never blocks an upload.

import { PDFDocument } from "pdf-lib";

/** Real kind from leading bytes (magic numbers) — more reliable than a filename
 *  extension or a client-supplied mime, which can be wrong or empty. */
type ImageKind = "jpg" | "png" | "other";

function sniffImageKind(bytes: Uint8Array): ImageKind {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "jpg"; // JPEG SOI
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 &&
    bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a
  ) return "png"; // PNG signature
  return "other";
}

/** Swap (or add) a `.pdf` extension on a filename. `bon.jpg` → `bon.pdf`,
 *  `bon` → `bon.pdf`, `bon.JPG` → `bon.pdf`. */
function toPdfName(fileName: string): string {
  const dot = fileName.lastIndexOf(".");
  const stem = dot > 0 ? fileName.slice(0, dot) : fileName;
  return `${stem}.pdf`;
}

export interface ConvertedUpload {
  buffer: Buffer;
  fileName: string;
  fileType: string;
  /** true when we actually wrapped an image into a PDF; false = passthrough. */
  converted: boolean;
}

/**
 * If `buffer` is a JPG/PNG image, wrap it into a single A4 PDF page (centered,
 * scaled to fit a margin, no re-compression) and return the PDF with a `.pdf`
 * name and `application/pdf` type. Anything else (already a PDF, or non-image)
 * passes through unchanged. Never throws.
 */
export async function maybeImageToPdf(
  buffer: Buffer,
  mimeType: string,
  fileName: string
): Promise<ConvertedUpload> {
  const passthrough: ConvertedUpload = { buffer, fileName, fileType: mimeType, converted: false };

  const kind = sniffImageKind(new Uint8Array(buffer));
  if (kind === "other") return passthrough; // PDF or non-image → leave as-is

  try {
    const doc = await PDFDocument.create();
    const bytes = new Uint8Array(buffer);
    const img = kind === "png" ? await doc.embedPng(bytes) : await doc.embedJpg(bytes);

    const A4_W = 595.28;
    const A4_H = 841.89;
    const margin = 20;
    const maxW = A4_W - margin * 2;
    const maxH = A4_H - margin * 2;
    const scale = Math.min(maxW / img.width, maxH / img.height, 1);
    const w = img.width * scale;
    const h = img.height * scale;

    const page = doc.addPage([A4_W, A4_H]);
    page.drawImage(img, { x: (A4_W - w) / 2, y: (A4_H - h) / 2, width: w, height: h });

    const pdfBytes = await doc.save();
    return {
      buffer: Buffer.from(pdfBytes),
      fileName: toPdfName(fileName),
      fileType: "application/pdf",
      converted: true,
    };
  } catch {
    // Corrupt/unsupported image → keep the original so the upload still succeeds.
    return passthrough;
  }
}