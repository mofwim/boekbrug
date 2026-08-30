// [KASSA-OMZETRAPPORT] Run: npx tsx --test src/lib/pos-omzet-report.test.ts
//
// The fixture is the owner's real Z-report, laid out by pdf-text-matrix from the PDF his POS
// prints. Most of what follows is about REFUSING: this produces a day of turnover that feeds the
// BTW return, so a report it half-understands must yield nothing rather than a plausible day.

import { test } from "node:test";
import assert from "node:assert/strict";
import { parsePosOmzetReport, type Cell } from "./pos-omzet-report";

/** The real report, verbatim as pdf-text-matrix lays it out. */
const REAL: Cell[][] = [
  ["KIWI FOOD MARKET"],
  ["Verdiplein 13"],
  ["5049 NM TILBURG"],
  ["OMZET", "VAN 29/08/2026"],
  ["Document:", "Aantal:", "Omzet Incl:", "Netto Omzet:"],
  ["Kassabonnen :", "175", "2.794,31", "2.560,14"],
  ["Verkoop facturen:", "0", "0,00", "0,00"],
  ["TOTAAL:", "175", "2.794,31", "2.560,14"],
  ["Basis Incl:", "Basis Excl:", "BTW bedrag"],
  ["Belastbaar Basis %", "0,00", "Beltegoed", "0,00", "0,00", "0,00"],
  ["Omzet met BTW", "%", "0,00", "Statiegeld", "2,70", "2,70", "0,00"],
  ["Omzet met BTW", "%", "9,00", "Laag", "2.750,89", "2.523,75", "227,14"],
  ["Omzet met BTW", "%", "21,00", "Hoog", "40,72", "33,65", "7,07"],
  ["Gem. bedrag kassabonnen:", "15,97"],
];

test("the real report becomes one day of turnover", () => {
  const { day, refusal } = parsePosOmzetReport(REAL);
  assert.equal(refusal, null);
  assert.ok(day);
  assert.equal(day.turnover_date, "2026-08-29");
  assert.equal(day.base_0, 2.7);
  assert.equal(day.base_9, 2523.75);
  assert.equal(day.base_21, 33.65);
  assert.equal(day.btw_9, 227.14);
  assert.equal(day.btw_21, 7.07);
  assert.equal(day.total_incl, 2794.31);
});

test("the day reconciles with itself — bases plus btw equal the printed total", () => {
  const { day } = parsePosOmzetReport(REAL);
  assert.ok(day);
  const sum = day.base_0 + day.base_9 + day.base_21 + day.btw_9 + day.btw_21;
  // total_incl is nullable on DailyTurnover (a sheet may omit it); this report always states it,
  // and asserting that it is present is part of asserting the report was understood.
  assert.equal(typeof day.total_incl, "number", "the report states its own total");
  assert.ok(Math.abs(sum - (day.total_incl as number)) < 0.005, `${sum} ≠ ${day.total_incl}`);
});

test("the payment split is never invented", () => {
  // This report does not carry it. pin_amount decides which bank payouts get suppressed as
  // already-counted, so a guessed value here double-counts or hides a day's card takings.
  const { day } = parsePosOmzetReport(REAL);
  assert.equal(day?.pin_amount, null);
  assert.equal(day?.cash_amount, null);
  assert.equal(day?.other_amount, null);
});

test("a rate whose own arithmetic fails is refused, and the disagreement is named", () => {
  // 2.523,75 + 227,14 = 2.750,89. One digit off and the row is not a rate we understood.
  const broken = REAL.map((r) => (r[0] === "Omzet met BTW" && r[2] === "9,00"
    ? ["Omzet met BTW", "%", "9,00", "Laag", "2.750,89", "2.523,75", "227,99"] : r));
  const { day, refusal, detail } = parsePosOmzetReport(broken);
  assert.equal(day, null);
  assert.equal(refusal, "rate_math_failed");
  assert.ok(detail, "the caller can say which figures disagreed");
});

test("rates that do not add up to the report's own total are refused", () => {
  const broken = REAL.map((r) => (r[0] === "TOTAAL:" ? ["TOTAAL:", "175", "9.999,99", "2.560,14"] : r));
  const { day, refusal, detail } = parsePosOmzetReport(broken);
  assert.equal(day, null);
  assert.equal(refusal, "total_mismatch");
  assert.equal(detail?.expected, 9999.99);
  assert.equal(detail?.found, 2794.31);
});

test("a different file is refused as a different file, not as broken data", () => {
  const grootboek: Cell[][] = [
    ["KASBOEK"], ["Rekening Nr:", "570000"],
    ["Datum", "Naam", "Omschrijving", "Ontvangen", "Uitgaven"],
    ["29/08/26", "Totaal van de kassa", "Totaal Kontant", "280,95", "0,00"],
  ];
  assert.equal(parsePosOmzetReport(grootboek).refusal, "not_this_report");
  assert.equal(parsePosOmzetReport([]).refusal, "not_this_report");
});

test("the report header without a readable date is not this report", () => {
  const undated = REAL.map((r) => (r[0] === "OMZET" ? ["OMZET", "VAN ??"] : r));
  assert.equal(parsePosOmzetReport(undated).refusal, "not_this_report");
});

test("an impossible date is refused rather than normalised into a real one", () => {
  const impossible = REAL.map((r) => (r[0] === "OMZET" ? ["OMZET", "VAN 31/02/2026"] : r));
  assert.equal(parsePosOmzetReport(impossible).refusal, "not_this_report");
});

test("a report with the header but no rate rows says exactly that", () => {
  const noRates = REAL.filter((r) => r[0] !== "Omzet met BTW");
  assert.equal(parsePosOmzetReport(noRates).refusal, "no_rate_rows");
});

test("Dutch thousands and decimals are read as printed", () => {
  const big = REAL.map((r) => (r[0] === "Omzet met BTW" && r[2] === "9,00"
    ? ["Omzet met BTW", "%", "9,00", "Laag", "12.750,89", "11.698,06", "1.052,83"] : r))
    .map((r) => (r[0] === "TOTAAL:" ? ["TOTAAL:", "175", "12.794,31", "2.560,14"] : r));
  const { day, refusal } = parsePosOmzetReport(big);
  assert.equal(refusal, null, "11.698,06 + 1.052,83 = 12.750,89");
  assert.equal(day?.base_9, 11698.06);
  assert.equal(day?.total_incl, 12794.31);
});
