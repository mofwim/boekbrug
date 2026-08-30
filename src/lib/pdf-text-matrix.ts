// src/lib/pdf-text-matrix.ts
// [PDF-ALS-BLAD] A PDF's text laid back out as the table it was printed from. Pure, no I/O.
// Run: npx tsx --test src/lib/pdf-text-matrix.test.ts
//
// ── WHY ──────────────────────────────────────────────────────────────────────────────────────
//
// A shop's bookkeeper sends the grootboek as PDF, and the POS prints its Z-report as PDF. The app
// reads neither: sheetBytesToMatrix refuses them by format ([GEEN-SPREADSHEET]) and the owner is
// told to go ask for an Excel version — of a file he already has, that already contains every
// figure the import needs. The goal this product was started on is that the owner uploads what he
// has and the app deals with it, so "ask your supplier for a different file" is the fallback, not
// the answer.
//
// ── WHY THIS IS NOT GUESSWORK, WHICH IT VERY EASILY COULD BE ─────────────────────────────────
//
// The obvious approach is to take the extracted text and split it up. That approach is how a
// wrong number gets into someone's books. unpdf's merged text for the real grootboek reads:
//
//     "Datum UitgavenOntvangenNaam Omschrijving 570000Rekening Nr: … 29/08/26 0,00280,95Totaal…"
//
// Columns are jammed against each other with no separator: "0,00280,95" is two amounts, and any
// rule for splitting it is a guess about money. So this module never sees that string.
//
// It works from the POSITIONS instead. Every text item in a PDF carries its own x/y, and the
// report was printed as a table, so the table is still there in the coordinates:
//
//     y=620   x72 Datum | x154 Naam | x267 Omschrijving | x382 Ontvangen | x452 Uitgaven
//     y=602   x64 29/08/26 | x114 Totaal van de kassa | … | x410 280,95 | x484 0,00
//
// Grouping by y and sorting by x reconstructs the rows and columns the printer used. Nothing is
// inferred about what a number MEANS — that stays with parseLedgerSheet and the turnover
// normaliser, which already refuse anything they do not recognise (verified: handed PDF noise
// they returned null, not a figure). This only hands them a table instead of a blob.
//
// ── THE ONE JUDGEMENT IT DOES MAKE ───────────────────────────────────────────────────────────
//
// Which items share a line. "Datum:" sits at y=771 and its value at y=772 — the same visual row,
// one point apart, because the printer nudged the baseline. So rows are grouped within a
// tolerance. Too tight splits a row in two; too loose merges a header into the line beneath it.
// The default is deliberately small (3pt): a merged row is a table with columns that do not line
// up, which the downstream parsers reject outright, while a split row loses a cell quietly.
// Failing loudly is the survivable direction here, as everywhere else on this path.

/** One piece of text as a PDF reports it: the string and where it was drawn. */
export interface PdfTextItem {
  str: string;
  /** Distance from the left edge, in points. */
  x: number;
  /** Distance from the BOTTOM edge, in points — a PDF's origin is bottom-left. */
  y: number;
}

/** A cell, in the shape the sheet parsers already consume. */
export type PdfCell = string;

/**
 * Points within which two items count as the same printed line.
 *
 * Small on purpose — see the header. Real reports separate their rows by 14–22pt, so 3 is far
 * below anything that could merge two genuine rows, and just enough for a nudged baseline.
 */
export const ROW_TOLERANCE_PT = 3;

/**
 * Lay the items back out as rows and columns.
 *
 * Rows come out top-to-bottom (descending y, because a PDF counts from the bottom) and cells
 * left-to-right, which is the order every sheet parser in this app expects.
 */
export function pdfItemsToMatrix(
  items: readonly PdfTextItem[],
  rowTolerance: number = ROW_TOLERANCE_PT,
): PdfCell[][] {
  const kept = items.filter((i) => typeof i.str === "string" && i.str.trim().length > 0);
  if (kept.length === 0) return [];

  // Tallest first: a row is anchored by the first item that opens it, and later items join the
  // row whose anchor they are within tolerance of. Anchoring rather than clustering keeps the
  // grouping stable — a long column of items drifting 1pt each would otherwise chain together
  // into one row that spans the page.
  const byY = [...kept].sort((a, b) => b.y - a.y);
  const rows: { anchor: number; items: PdfTextItem[] }[] = [];
  for (const item of byY) {
    const row = rows.find((r) => Math.abs(r.anchor - item.y) <= rowTolerance);
    if (row) row.items.push(item);
    else rows.push({ anchor: item.y, items: [item] });
  }

  return rows.map((r) =>
    r.items
      .sort((a, b) => a.x - b.x)
      .map((i) => i.str.trim())
      .filter((s) => s.length > 0),
  );
}
