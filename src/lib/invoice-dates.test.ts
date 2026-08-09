// [FACTUUR-DATUMS] Pure node test — run: npx tsx --test src/lib/invoice-dates.test.ts

import { test } from "node:test";
import assert from "node:assert/strict";

import { checkInvoiceDates, isIsoDate } from "./invoice-dates";

test("[FACTUUR-DATUMS] a due date before the invoice date is refused", () => {
  // cron/reminders derives the reminder tier from due_date, so this invoice is past due the moment
  // it is issued — the customer gets the bill and the reminder for it on the same day.
  const r = checkInvoiceDates({ invoiceDate: "2026-08-08", dueDate: "2026-08-01" });
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.equal(r.code, "due_before_invoice");
});

test("[FACTUUR-DATUMS] the message names BOTH dates, in Dutch order", () => {
  // An owner looking at one field cannot see which of the two they mistyped.
  const r = checkInvoiceDates({ invoiceDate: "2026-08-08", dueDate: "2026-08-01" });
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.match(r.error, /01-08-2026/, "the due date");
  assert.match(r.error, /08-08-2026/, "…and the invoice date");
  assert.match(r.error, /herinnering/, "…and what actually goes wrong, not just 'ongeldig'");
});

test("[FACTUUR-DATUMS] the same day is fine — betaling bij ontvangst is a real term", () => {
  assert.equal(checkInvoiceDates({ invoiceDate: "2026-08-08", dueDate: "2026-08-08" }).ok, true);
});

test("[FACTUUR-DATUMS] a later due date is the ordinary case and untouched", () => {
  assert.equal(checkInvoiceDates({ invoiceDate: "2026-08-08", dueDate: "2026-09-07" }).ok, true);
  assert.equal(checkInvoiceDates({ invoiceDate: "2026-12-31", dueDate: "2027-01-30" }).ok, true,
    "…across a year boundary, where a naive comparison would trip");
});

test("[FACTUUR-DATUMS] a missing or unusable date is somebody else's refusal", () => {
  // The send route already enforces a real invoice_date before minting a number. Two differently
  // worded complaints about one mistake help nobody.
  for (const args of [
    { invoiceDate: null, dueDate: "2026-08-01" },
    { invoiceDate: "2026-08-08", dueDate: null },
    { invoiceDate: "", dueDate: "" },
    { invoiceDate: "gisteren", dueDate: "2026-08-01" },
    { invoiceDate: "2026-08-08", dueDate: "08-08-2026" },
  ]) {
    assert.equal(checkInvoiceDates(args).ok, true, JSON.stringify(args));
  }
});

test("[FACTUUR-DATUMS] a date that does not exist is not a date", () => {
  // 2026-02-30 rolls over to 2 March in a naive parse, which would make it compare as LATER than
  // an invoice dated 1 March — a refusal that silently does not fire.
  assert.equal(isIsoDate("2026-02-30"), false);
  assert.equal(isIsoDate("2026-13-01"), false);
  assert.equal(isIsoDate("2026-00-10"), false);
  assert.equal(isIsoDate("2026-2-10"), false, "unpadded is not the stored shape");
  assert.equal(isIsoDate("2026-02-28"), true);
  assert.equal(isIsoDate("2028-02-29"), true, "a real leap day");
  assert.equal(isIsoDate("2026-02-29"), false, "…and a fake one");
});

test("[FACTUUR-DATUMS] a timestamp suffix is not silently accepted", () => {
  // These columns are DATE. Anything carrying a time came from somewhere that does not understand
  // that, and comparing it lexically against a bare date would be a coin flip.
  assert.equal(isIsoDate("2026-08-08T00:00:00Z"), false);
});
