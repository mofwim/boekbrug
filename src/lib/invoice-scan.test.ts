// [INVOICE-SCAN] Pure node test — run: npx tsx --test src/lib/invoice-scan.test.ts
//
// The scan answers a question nobody could answer before: how many booked invoices are wrong, and
// which quarters do they touch. Two properties make that answer trustworthy:
//   1. it counts each wrong invoice ONCE, even when two gates fire on it — otherwise the report
//      says more invoices are broken than exist, and the owner cannot reconcile it with the list;
//   2. it stays silent on everything correct. A scan that cries wolf over an exempt pension
//      premium or a supplier's ordinary invoice is worse than no scan: it gets ignored.
import { test } from "node:test";
import assert from "node:assert/strict";

import { scanInvoices, scanFindingIds, type ScanRow } from "./invoice-scan";

/** A correct 9% invoice — the shape most rows have. */
const ok = (over: Partial<ScanRow> = {}): ScanRow => ({
  id: "ok", invoice_number: "RE0801378", client_name: "Wholesaler",
  invoice_date: "2026-03-12", invoice_type: "factuur",
  total_ex_btw: 800, btw_amount: 72, total_inc_btw: 872, ...over,
});

test("a clean set produces nothing — and says how many it looked at", () => {
  const scan = scanInvoices([ok({ id: "a" }), ok({ id: "b" }), ok({ id: "c" })]);
  assert.equal(scan.total, 0);
  assert.deepEqual(scan.quarters, []);
  // scanned matters: without it "0 findings" is indistinguishable from "nothing was read".
  assert.equal(scan.scanned, 3);
});

test("an exempt invoice (pension premium) is not a finding", () => {
  // 266.62 / 0 / 266.62 — no btw at all, and entirely correct.
  const scan = scanInvoices([ok({ id: "p", total_ex_btw: 266.62, btw_amount: 0, total_inc_btw: 266.62 })]);
  assert.equal(scan.total, 0);
});

test("the real credit notes are found, and the ordinary invoice beside them is not", () => {
  const rows = [
    ok({ id: "cr1", invoice_number: "CR0300343", client_name: "Sweets", invoice_date: "2026-02-17", total_ex_btw: 47.52, btw_amount: 4.28, total_inc_btw: 51.8 }),
    ok({ id: "cr2", invoice_number: "CR0300510", client_name: "Sweets", invoice_date: "2026-03-12", total_ex_btw: 22.25, btw_amount: 2, total_inc_btw: 24.25 }),
    ok({ id: "re", invoice_number: "RE0801378", client_name: "Sweets", invoice_date: "2026-03-12", total_ex_btw: 799.45, btw_amount: 71.95, total_inc_btw: 871.4 }),
  ];
  const scan = scanInvoices(rows);
  assert.equal(scan.total, 2);
  assert.deepEqual(scan.findings.map((f) => f.id), ["cr1", "cr2"]);
  assert.ok(scan.findings.every((f) => f.kind === "credit_suspect"));
  // Both in Q1 2026, and the amount standing wrong is their sum.
  assert.equal(scan.quarters.length, 1);
  assert.equal(scan.quarters[0].quarter, "2026-Q1");
  assert.equal(scan.quarters[0].creditSuspect, 2);
  assert.equal(scan.quarters[0].amount, 76.05);
});

test("[ONCE] an invoice that trips two gates is counted once, on the most certain one", () => {
  // A credit note stored positive AND with a broken breakdown. Reporting it twice would make the
  // total larger than the number of wrong invoices, and the owner could never reconcile the report
  // with what the list shows.
  const scan = scanInvoices([
    ok({ id: "both", invoice_type: "creditnota", invoice_number: "CR1", client_name: "X",
         total_ex_btw: 100, btw_amount: 9, total_inc_btw: 200 }),
  ]);
  assert.equal(scan.total, 1);
  assert.equal(scan.findings[0].kind, "sign_conflict", "the certain verdict wins over the suspicion");
});

test("the four broken breakdowns are found", () => {
  const rows = [
    ok({ id: "meat", client_name: "Meat", invoice_number: "2033161", invoice_date: "2026-02-21", total_ex_btw: 985.87, btw_amount: 88.73, total_inc_btw: 1078.46 }),
    ok({ id: "sweets", client_name: "Sweets2", invoice_number: "2026070769", invoice_date: "2026-07-30", total_ex_btw: 1722.54, btw_amount: 144.95, total_inc_btw: 1843.49 }),
    ok({ id: "horeca", client_name: "Horeca", invoice_number: "26710525", invoice_date: "2026-07-03", total_ex_btw: 3413.92, btw_amount: 995.9, total_inc_btw: 3819.82 }),
    ok({ id: "clean", client_name: "Clean", invoice_number: "1", invoice_date: "2026-07-03" }),
  ];
  const scan = scanInvoices(rows);
  assert.deepEqual(scan.findings.map((f) => f.id), ["meat", "sweets", "horeca"]);
  assert.ok(scan.findings.every((f) => f.kind === "arithmetic"));
  // Two quarters, newest first — Q3 holds two of them, Q1 one.
  assert.deepEqual(scan.quarters.map((q) => q.quarter), ["2026-Q3", "2026-Q1"]);
  assert.equal(scan.quarters[0].arithmetic, 2);
  assert.equal(scan.quarters[1].arithmetic, 1);
});

test("[RATE-GATE] a breakdown that adds up perfectly and is still impossible", () => {
  // The potato wholesaler. Stored 26.00 + 13.42 = 39.42 — the sum reconciles to the cent, so the
  // arithmetic gate alone stays silent on it. What betrays the row is the RATE: 13.42 over 26.00 is
  // 52%, and no Dutch rate or blend of 0/9/21 reaches that. On paper the invoice carries a returned
  // container of -408.00 that never made it into the stored ex-btw.
  //
  // This is the whole reason the scan checks two gates instead of one. Found by running the scan
  // against the real rows rather than by reasoning about it — the first version reported five of
  // the six wrong invoices and looked complete.
  const scan = scanInvoices([
    ok({ id: "alt", client_name: "Potatoes", invoice_number: "614132", invoice_date: "2026-03-05",
         total_ex_btw: 26.0, btw_amount: 13.42, total_inc_btw: 39.42 }),
  ]);
  assert.equal(scan.total, 1);
  assert.equal(scan.findings[0].kind, "arithmetic");
});

test("[RATE-GATE] 21 percent exactly is not impossible", () => {
  // The gate must fire ABOVE the highest Dutch rate, not at it. An ordinary 21% invoice is the most
  // common shape in the whole set; flagging it would bury every real finding under noise.
  const scan = scanInvoices([ok({ id: "hi", total_ex_btw: 100, btw_amount: 21, total_inc_btw: 121 })]);
  assert.equal(scan.total, 0);
});

test("[RATE-GATE] a credit note is judged on magnitude, not sign", () => {
  // A properly stored credit note has all three amounts negative. Its rate is (-9)/(-100) = 9%, and
  // reading that as a negative percentage — or comparing signed values against a positive ceiling —
  // would let every credit note through one gate and every returned-goods line through the other.
  // Magnitude ratio, the same choice safecore and the confirm modal make.
  const scan = scanInvoices([
    ok({ id: "cn", invoice_type: "creditnota", invoice_number: "CN9", client_name: "Sweets",
         total_ex_btw: -100, btw_amount: -9, total_inc_btw: -109 }),
    ok({ id: "re2", invoice_number: "RE9", client_name: "Sweets" }),
  ]);
  assert.equal(scan.total, 0, "a correctly booked credit note is not a finding");
});

test("a row with only a total is not a contradiction", () => {
  // Both ex and btw absent = the breakdown was never read. The intake gate says that in its own
  // words; counting it here as "wrong amounts" would send the owner looking for an error that is
  // really a missing reading.
  const scan = scanInvoices([ok({ id: "x", total_ex_btw: null, btw_amount: null, total_inc_btw: 500 })]);
  assert.equal(scan.total, 0);
});

test("an undated invoice belongs to no quarter, and sorts last", () => {
  const scan = scanInvoices([
    ok({ id: "dated", client_name: "A", invoice_number: "1", invoice_date: "2026-07-03", total_ex_btw: 100, btw_amount: 9, total_inc_btw: 200 }),
    ok({ id: "undated", client_name: "B", invoice_number: "2", invoice_date: null, total_ex_btw: 100, btw_amount: 9, total_inc_btw: 200 }),
  ]);
  assert.equal(scan.total, 2);
  assert.deepEqual(scan.quarters.map((q) => q.quarter), ["2026-Q3", null]);
});

test("the credit signal needs the WHOLE set, not a filtered one", () => {
  // Requirement 2 of creditnota-signal: the evidence is that the supplier ALSO uses another prefix.
  // Hand the scan only the CR rows and it must stay silent — exactly why the screen feeds it every
  // row rather than the filtered view.
  const onlyCr = [
    ok({ id: "cr1", invoice_number: "CR1", client_name: "S", total_inc_btw: 51.8, total_ex_btw: 47.52, btw_amount: 4.28 }),
    ok({ id: "cr2", invoice_number: "CR2", client_name: "S", total_inc_btw: 24.25, total_ex_btw: 22.25, btw_amount: 2 }),
  ];
  assert.equal(scanInvoices(onlyCr).total, 0);
});

test("the ids come back so the screen can show exactly those rows", () => {
  const scan = scanInvoices([
    ok({ id: "bad", client_name: "A", invoice_number: "1", total_ex_btw: 100, btw_amount: 9, total_inc_btw: 200 }),
    ok({ id: "good", client_name: "A", invoice_number: "2" }),
  ]);
  const ids = scanFindingIds(scan);
  assert.equal(ids.has("bad"), true);
  assert.equal(ids.has("good"), false);
  assert.equal(ids.size, 1);
});

test("an empty list is an empty report, not a crash", () => {
  const scan = scanInvoices([]);
  assert.deepEqual(scan, { findings: [], quarters: [], total: 0, scanned: 0 });
});
