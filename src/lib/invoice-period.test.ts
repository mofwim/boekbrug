// [PERIODE] Pure node test — run: npx tsx --test src/lib/invoice-period.test.ts
//
// De randen zijn het punt: januari terug naar december, Q1 terug naar Q4 van vorig jaar, februari
// in een schrikkeljaar, en een factuur zonder datum die in geen enkele periode valt.
import { test } from "node:test";
import assert from "node:assert/strict";

import { resolveInvoicePeriod, isInPeriod, INVOICE_PERIODS } from "./invoice-period";

const TODAY = "2026-07-31"; // een donderdag in Q3

test("alles heeft geen grenzen — en dat is iets anders dan hele ruime grenzen", () => {
  const w = resolveInvoicePeriod("all", TODAY);
  assert.equal(w.start, null);
  assert.equal(w.end, null);
  // Zonder ondergrens kan geen enkele oude factuur per ongeluk buiten de lijst vallen.
  assert.equal(isInPeriod("2015-03-02", w), true);
  assert.equal(isInPeriod(null, w), true);
});

test("deze maand loopt van de eerste tot de laatste dag", () => {
  const w = resolveInvoicePeriod("this-month", TODAY);
  assert.deepEqual([w.start, w.end, w.label], ["2026-07-01", "2026-07-31", "juli 2026"]);
  assert.equal(isInPeriod("2026-07-01", w), true);
  assert.equal(isInPeriod("2026-07-31", w), true);
  assert.equal(isInPeriod("2026-06-30", w), false);
  assert.equal(isInPeriod("2026-08-01", w), false);
});

test("vorige maand in JANUARI is december van het jaar ervoor", () => {
  const w = resolveInvoicePeriod("last-month", "2026-01-15");
  assert.deepEqual([w.start, w.end, w.label], ["2025-12-01", "2025-12-31", "december 2025"]);
});

test("dit kwartaal en vorig kwartaal", () => {
  assert.deepEqual(
    [resolveInvoicePeriod("this-quarter", TODAY).start, resolveInvoicePeriod("this-quarter", TODAY).end],
    ["2026-07-01", "2026-09-30"],
  );
  assert.equal(resolveInvoicePeriod("this-quarter", TODAY).label, "Q3 2026");
  const vorig = resolveInvoicePeriod("last-quarter", TODAY);
  assert.deepEqual([vorig.start, vorig.end, vorig.label], ["2026-04-01", "2026-06-30", "Q2 2026"]);
});

test("vorig kwartaal in Q1 is Q4 van het jaar ervoor", () => {
  const w = resolveInvoicePeriod("last-quarter", "2026-02-09");
  assert.deepEqual([w.start, w.end, w.label], ["2025-10-01", "2025-12-31", "Q4 2025"]);
});

test("elk kwartaal eindigt op de juiste laatste dag", () => {
  const eind = [1, 2, 3, 4].map((q) => resolveInvoicePeriod("this-quarter", `2026-${String((q - 1) * 3 + 1).padStart(2, "0")}-05`).end);
  assert.deepEqual(eind, ["2026-03-31", "2026-06-30", "2026-09-30", "2026-12-31"]);
});

test("februari klopt in een schrikkeljaar én daarbuiten", () => {
  assert.equal(resolveInvoicePeriod("this-month", "2024-02-10").end, "2024-02-29");
  assert.equal(resolveInvoicePeriod("this-month", "2026-02-10").end, "2026-02-28");
  // 2100 is géén schrikkeljaar (deelbaar door 100, niet door 400) — de eeuwregel.
  assert.equal(resolveInvoicePeriod("this-month", "2100-02-10").end, "2100-02-28");
  assert.equal(resolveInvoicePeriod("this-month", "2000-02-10").end, "2000-02-29");
});

test("dit jaar en vorig jaar", () => {
  assert.deepEqual(
    [resolveInvoicePeriod("this-year", TODAY).start, resolveInvoicePeriod("this-year", TODAY).end],
    ["2026-01-01", "2026-12-31"],
  );
  assert.equal(resolveInvoicePeriod("last-year", TODAY).label, "2025");
});

test("een factuur zonder datum valt in geen enkele periode — zichtbaar, niet stilletjes", () => {
  // Hem overal meetellen zou hem in elke maand tonen; hem hier weglaten is een keuze die het
  // scherm hardop meldt (de regel onder de periodekiezer telt ze).
  const maand = resolveInvoicePeriod("this-month", TODAY);
  assert.equal(isInPeriod(null, maand), false);
  assert.equal(isInPeriod(undefined, maand), false);
  assert.equal(isInPeriod("", maand), false);
});

test("een tijdstempel wordt op zijn DAG beoordeeld, niet op zijn uur", () => {
  const maand = resolveInvoicePeriod("this-month", TODAY);
  assert.equal(isInPeriod("2026-07-31T23:30:00Z", maand), true);
  assert.equal(isInPeriod("2026-08-01T00:30:00Z", maand), false);
});

test("het menu biedt elke periode precies één keer aan", () => {
  const ids = INVOICE_PERIODS.map((p) => p.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(ids[0], "all", "Alles staat vooraan: dat is het gedrag van vandaag");
});
