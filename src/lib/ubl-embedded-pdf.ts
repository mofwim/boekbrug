// src/lib/ubl-embedded-pdf.ts
// [XML-PDF] The human-readable invoice that is sitting INSIDE an e-factuur. Pure, no I/O.
// Run: npx tsx --test src/lib/ubl-embedded-pdf.test.ts
//
// ── THE BUG THIS EXISTS FOR ──
//
// Reported with a screenshot of a browser tab. The owner pressed "Bekijk factuur" on invoice
// 26702771 (Aardappelgroothandel Altena, € 350,07) and got a wall of raw XML — namespaces,
// CustomizationID, a base64 blob running off the screen. Nothing was broken and nothing was lost:
// the file stored for that invoice IS the UBL, because the supplier sent a UBL, and `pdf_url`
// pointed straight at it.
//
// But that base64 blob running off the screen is the invoice. Peppol carries the printable
// document inside the XML, in cac:AdditionalDocumentReference/cac:Attachment/
// cbc:EmbeddedDocumentBinaryObject, and nothing in this codebase read that element — grep for it
// and this file is the only hit. So the app held the PDF the whole time and showed the envelope.
//
// Two rows in production today. That number is the reason this is worth doing NOW rather than
// later: e-facturering becomes mandatory for Dutch B2B, every supplier that switches sends this
// shape, and each one arrives as a page of XML in front of an entrepreneur who wanted to check an
// amount. The failure is silent — the invoice books correctly, the totals are right, and only the
// person trying to LOOK at it ever finds out.
//
// ── WHAT IT KEEPS, AND WHAT IT REPLACES ──
//
// The XML stays. It is the machine evidence: the signed original, the thing an accountant and the
// Belastingdienst are entitled to, and the only artefact that can prove what the supplier actually
// sent. Only the DOCUMENT THE OWNER OPENS changes. That is the same division this codebase draws
// everywhere else — the client may edit any field the machine read, and the machine's evidence is
// immutable.
//
// ── WHY IT IS SUSPICIOUS OF ITS OWN INPUT ──
//
// The base64 comes from outside and lands in browser-visible storage, so a lie here is a file the
// app serves under its own name:
//   · mimeCode must SAY application/pdf, and the decoded bytes must START with %PDF. Either alone
//     is trusting a stranger: a wrong mimeCode is an honest supplier bug, and matching bytes with
//     a wrong label would still open correctly, so both must agree before anything is stored.
//   · a ceiling on the decoded size, because a base64 blob costs nothing to write and this is
//     unattended intake.
//   · exactly ONE attachment is taken — the first that qualifies. An e-factuur may carry a
//     delivery note and a specification too, and "the invoice" is not a pile.

/** The printable document found inside an e-factuur, ready to be stored as it is. */
export interface EmbeddedPdf {
  /** Decoded bytes. Already checked to begin with %PDF. */
  bytes: Buffer;
  /** The filename the supplier gave it, when they gave one. Never trusted as a path. */
  filename: string | null;
}

/** 20 MB decoded. A printed invoice is a few hundred kB; this is a ceiling, not a target. */
export const MAX_EMBEDDED_PDF_BYTES = 20 * 1024 * 1024;

/**
 * Read the embedded PDF out of a UBL/CII e-invoice, or null when there is none to read.
 *
 * Null is the normal answer for a great many valid e-invoices — carrying the PDF is optional — so
 * it means "this one has none", never "something went wrong". The caller keeps the XML either way.
 */
export function extractEmbeddedPdf(xml: string): EmbeddedPdf | null {
  if (typeof xml !== "string" || xml.length === 0) return null;

  // Namespace prefixes vary by sender (cbc:, ram:, or none at all), so the tag is matched on its
  // local name. The attributes are read off the same opening tag rather than from the surrounding
  // block: a document with two attachments would otherwise be able to lend one element's mimeCode
  // to another element's bytes.
  const re = /<(?:[A-Za-z0-9_.-]+:)?EmbeddedDocumentBinaryObject\b([^>]*)>([\s\S]*?)<\/(?:[A-Za-z0-9_.-]+:)?EmbeddedDocumentBinaryObject>/g;

  for (const m of xml.matchAll(re)) {
    const attrs = m[1] ?? "";
    const mime = /\bmimeCode\s*=\s*["']([^"']+)["']/i.exec(attrs)?.[1]?.trim().toLowerCase();
    // The label must say PDF. An unlabelled or differently-labelled blob is left alone even when
    // its bytes would pass: guessing at the type of an untrusted file is how a store starts
    // serving something other than what it claims.
    if (mime !== "application/pdf") continue;

    const b64 = (m[2] ?? "").replace(/\s+/g, "");
    if (b64.length === 0) continue;
    // A cheap ceiling BEFORE decoding — base64 is 4 characters per 3 bytes, so this bounds the
    // allocation instead of discovering the size after it has been made.
    if ((b64.length / 4) * 3 > MAX_EMBEDDED_PDF_BYTES) continue;
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(b64)) continue;

    let bytes: Buffer;
    try {
      bytes = Buffer.from(b64, "base64");
    } catch {
      continue;
    }
    // And the bytes must agree with the label. Both checks, always: either one on its own is
    // taking a stranger's word for what a file is.
    if (bytes.length === 0 || bytes.length > MAX_EMBEDDED_PDF_BYTES) continue;
    if (bytes.subarray(0, 5).toString("latin1") !== "%PDF-") continue;

    return { bytes, filename: safeFilename(/\bfilename\s*=\s*["']([^"']+)["']/i.exec(attrs)?.[1]) };
  }
  return null;
}

/**
 * The supplier's filename, reduced to something safe to put in a storage key.
 *
 * Never used as a path. Directory separators and traversal segments are stripped rather than
 * rejected, because a slightly odd name is not a reason to lose the invoice — but a name that
 * reaches the storage layer with a `../` in it is a different kind of file altogether.
 */
function safeFilename(raw: string | undefined): string | null {
  if (!raw) return null;
  const cleaned = raw.replace(/[\\/]/g, "_").replace(/\.{2,}/g, ".").replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 120);
  return cleaned.length > 0 ? cleaned : null;
}
