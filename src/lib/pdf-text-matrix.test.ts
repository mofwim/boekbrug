// [PDF-ALS-BLAD] Run: npx tsx --test src/lib/pdf-text-matrix.test.ts
//
// The fixtures are the real coordinates from the owner's own files — a KASBOEK grootboek and a
// kassa-omzetrapport printed by his POS. What is being asserted is not "it parses" but that the
// table comes back the way it was PRINTED, because everything downstream trusts the columns.

import { test } from "node:test";
import assert from "node:assert/strict";
import { pdfItemsToMatrix, ROW_TOLERANCE_PT, type PdfTextItem } from "./pdf-text-matrix";

const i = (str: string, x: number, y: number): PdfTextItem => ({ str, x, y });

// The real grootboek, verbatim from the PDF's own text items.
const KASBOEK: PdfTextItem[] = [
  i("KIWI FOOD MARKET", 59, 774), i("30/08/2026", 446, 772), i("Datum:", 396, 771),
  i("Verdiplein 13", 59, 760), i("5049 NM TILBURG", 59, 746), i("KASBOEK", 265, 711),
  i("Rekening Nr:", 67, 664), i("570000", 152, 664),
  i("Periode van", 67, 642), i("29/08/2026", 129, 642), i("Tot", 198, 642), i("30/09/2026", 219, 642),
  i("Voorgaande Saldo:", 339, 642), i("65.124,25", 462, 642),
  i("Datum", 72, 620), i("Naam", 154, 620), i("Omschrijving", 267, 620), i("Ontvangen", 382, 620), i("Uitgaven", 452, 620),
  i("29/08/26", 64, 602), i("Totaal van de kassa", 114, 602), i("Totaal Kontant van 29/08/2026", 224, 602),
  i("280,95", 410, 602), i("0,00", 484, 602),
  i("TOTALEN:", 223, 584), i("280,95", 410, 584), i("0,00", 484, 584),
];

/** Find a row by its first cell. Indices would pin the fixture's shape, not the behaviour. */
function rowStarting(m: string[][], first: string): string[] {
  const row = m.find((r) => r[0] === first);
  assert.ok(row, `no row starting with ${first}`);
  return row;
}

test("the printed table comes back as rows and columns", () => {
  const m = pdfItemsToMatrix(KASBOEK);
  assert.deepEqual(rowStarting(m, "Datum"), ["Datum", "Naam", "Omschrijving", "Ontvangen", "Uitgaven"], "the header row, in print order");
  assert.deepEqual(rowStarting(m, "29/08/26"), ["29/08/26", "Totaal van de kassa", "Totaal Kontant van 29/08/2026", "280,95", "0,00"]);
  assert.deepEqual(rowStarting(m, "Rekening Nr:"), ["Rekening Nr:", "570000"]);
});

test("rows come top-to-bottom, though a PDF counts from the bottom up", () => {
  const m = pdfItemsToMatrix(KASBOEK);
  assert.equal(m[0][0], "KIWI FOOD MARKET", "highest on the page is first");
  assert.equal(m[m.length - 1][0], "TOTALEN:", "lowest is last");
});

test("a nudged baseline stays one line — 771 and 772 are the same printed row", () => {
  // "Datum:" and its value differ by a point because the printer moved the baseline. Splitting
  // them would put the label and the date on two rows and lose the pairing.
  const m = pdfItemsToMatrix(KASBOEK);
  assert.deepEqual(m[0], ["KIWI FOOD MARKET", "Datum:", "30/08/2026"]);
});

test("the two amount columns never merge — that is the whole reason for using positions", () => {
  // unpdf's merged text for this row reads "…29/08/26 0,00280,95Totaal…" with no separator.
  // Any rule for splitting "0,00280,95" is a guess about money; the coordinates are not.
  const m = pdfItemsToMatrix(KASBOEK);
  const row = rowStarting(m, "29/08/26");
  assert.equal(row[3], "280,95");
  assert.equal(row[4], "0,00");
  assert.ok(!row.some((c) => c.includes("0,00280,95")), "never one jammed cell");
});

test("the tolerance is far below a real row gap, so two rows never merge", () => {
  // Real reports separate rows by 14–22pt. 620 → 602 is 18.
  assert.ok(ROW_TOLERANCE_PT < 14, "a tolerance at or above the row pitch would fuse the table");
  const m = pdfItemsToMatrix(KASBOEK);
  assert.ok(!m.some((r) => r.includes("Datum") && r.includes("29/08/26")), "header and data stay apart");
});

test("a wide tolerance DOES fuse rows — the guard is the number, and it is checked", () => {
  const fused = pdfItemsToMatrix(KASBOEK, 30);
  assert.ok(fused.length < pdfItemsToMatrix(KASBOEK).length, "proving the parameter is load-bearing");
});

test("blank and whitespace-only items are dropped, not kept as empty cells", () => {
  const m = pdfItemsToMatrix([i("A", 10, 100), i(" ", 20, 100), i("", 30, 100), i("B", 40, 100)]);
  assert.deepEqual(m, [["A", "B"]]);
});

test("no items is an empty matrix, never a row of nothing", () => {
  assert.deepEqual(pdfItemsToMatrix([]), []);
  assert.deepEqual(pdfItemsToMatrix([i("  ", 1, 1)]), []);
});

test("the real omzet report keeps its per-rate lines separate", () => {
  // From the 315KB Z-report: three BTW rates, each on its own printed line. Fusing any two would
  // put one rate's turnover under another, which is a wrong aangifte, not a cosmetic error.
  const omzet: PdfTextItem[] = [
    i("Omzet met BTW %", 60, 400), i("0,00", 200, 400), i("2,70", 300, 400),
    i("Omzet met BTW %", 60, 386), i("9,00", 200, 386), i("2.750,89", 300, 386),
    i("Omzet met BTW %", 60, 372), i("21,00", 200, 372), i("40,72", 300, 372),
  ];
  const m = pdfItemsToMatrix(omzet);
  assert.equal(m.length, 3, "three rates, three rows");
  assert.deepEqual(m[1], ["Omzet met BTW %", "9,00", "2.750,89"]);
});
