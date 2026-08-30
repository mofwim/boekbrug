// src/lib/pdf-sheet.ts
// [PDF-ALS-BLAD] A PDF turned into the table it was printed from. Server-only, thin by design.
//
// The decision lives in pdf-text-matrix.ts, which is pure and tested against the real
// coordinates. This file only fetches the coordinates, so the part that can be reasoned about
// stays free of a PDF library and the part that needs one holds no logic.
//
// unpdf rather than pdfjs-dist directly, for the reason ai.ts already found in production: it
// bundles a serverless build that mocks the canvas dependency, while importing pdfjs-dist/legacy
// tries to load @napi-rs/canvas at import time and fails on Vercel.
//
// FAIL-SAFE. Any failure returns null, and the caller falls back to the refusal it would have
// given anyway ([GEEN-SPREADSHEET]: "this is a PDF, I read .xls/.xlsx/.csv"). Reading a PDF is a
// convenience on top of an honest refusal; it must never turn a clear "I cannot read this" into
// a crash, and it must never be the reason an import screen fails to answer.

import { pdfItemsToMatrix, type PdfCell, type PdfTextItem } from "./pdf-text-matrix";

/** Pages beyond this are not read. A grootboek export runs to a handful; a runaway file does not. */
export const MAX_PDF_PAGES = 50;

/**
 * The PDF's text laid out as rows and columns, or null when it cannot be read that way.
 *
 * Pages are concatenated in order, each laid out on its own: a PDF's y-coordinates restart per
 * page, so laying two pages out together would interleave their rows by height and shuffle a
 * two-page grootboek into nonsense.
 */
export async function pdfBytesToMatrix(bytes: Uint8Array): Promise<PdfCell[][] | null> {
  try {
    if (typeof window !== "undefined") return null; // server-only, like ai.ts
    const unpdf = await import("unpdf").catch(() => null);
    if (!unpdf) {
      console.warn("[PDF-ALS-BLAD] unpdf unavailable — the PDF stays unreadable");
      return null;
    }
    const doc = await unpdf.getDocumentProxy(bytes);
    const pages = Math.min(doc.numPages ?? 1, MAX_PDF_PAGES);
    const out: PdfCell[][] = [];
    for (let p = 1; p <= pages; p++) {
      const page = await doc.getPage(p);
      const content = await page.getTextContent();
      const items: PdfTextItem[] = [];
      for (const raw of content.items as { str?: string; transform?: number[] }[]) {
        const t = raw.transform;
        if (typeof raw.str !== "string" || !t || t.length < 6) continue;
        items.push({ str: raw.str, x: t[4], y: t[5] });
      }
      out.push(...pdfItemsToMatrix(items));
    }
    return out.length > 0 ? out : null;
  } catch (e) {
    console.warn("[PDF-ALS-BLAD] could not lay this PDF out as a table", e);
    return null;
  }
}
