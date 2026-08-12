import test from "node:test";
import assert from "node:assert/strict";
import {
  counterYearFor,
  invoiceDateWindow,
  invoiceNumberYearPattern,
  issuedInCounterYear,
} from "./numbering-lock";
import { amsterdamYear, amsterdamToday } from "./format-nl";

// ─── [NUMMER-JAAR] The year the OWNER is in, not the year the server is in ───────────────────────

test("[NUMMER-JAAR] the first hour of the Dutch new year is the NEW year", () => {
  // 31 December 2026, 23:30 UTC = 1 January 2027, 00:30 in Amsterdam. This is the whole bug: for
  // that hour `new Date().getFullYear()` says 2026, so the number is drawn from the closed 2026
  // counter and printed with 2026 on an invoice the owner dates 2027.
  const midnightish = new Date("2026-12-31T23:30:00Z");
  assert.equal(midnightish.getUTCFullYear(), 2026, "the server really is still in the old year");
  assert.equal(amsterdamYear(midnightish), 2027, "…and the owner really is not");
  assert.equal(amsterdamToday(midnightish), "2027-01-01", "the sibling helper agrees on the day");
});

test("[NUMMER-JAAR] the last hour of the old year is still the old year", () => {
  // The other side of the same boundary — 22:30 UTC is 23:30 in Amsterdam, still 31 December.
  // Without this, a fix that simply added an hour everywhere would look correct.
  const stillDecember = new Date("2026-12-31T22:30:00Z");
  assert.equal(amsterdamYear(stillDecember), 2026);
  assert.equal(amsterdamToday(stillDecember), "2026-12-31");
});

test("[NUMMER-JAAR] summer time does not move the year", () => {
  // CEST is UTC+2. Mid-year the offset is irrelevant to the YEAR, and it must stay irrelevant —
  // a helper that got this wrong would shift every number by a year, not by an hour.
  assert.equal(amsterdamYear(new Date("2027-06-30T23:30:00Z")), 2027);
  assert.equal(amsterdamYear(new Date("2027-01-01T00:30:00Z")), 2027);
});

// ─── [NUMMER-SLOT] Which counter a template draws from ───────────────────────────────────────────

test("[NUMMER-SLOT] a {year} template resets yearly; one without it is continuous", () => {
  assert.equal(counterYearFor("{year}{seq}", 2027), 2027, "the product default");
  assert.equal(counterYearFor("{seq}-{year}", 2027), 2027, "045-2027");
  assert.equal(counterYearFor("F{year}-{seq}", 2027), 2027);
  // No token: one run for all time, keyed by the 0 sentinel. The lock then applies no year window,
  // which is why continuous numbering never had the mismatch this module fixes.
  assert.equal(counterYearFor("{seq}", 2027), 0);
  assert.equal(counterYearFor("INV-{seq}", 2027), 0);
});

// ─── [NUMMER-SLOT] The lock's two witnesses ──────────────────────────────────────────────────────

test("[NUMMER-SLOT] an ordinary invoice, dated the day it went out, locks its year", () => {
  assert.equal(issuedInCounterYear("2027-03-14", "20270007", 2027), true);
});

test("[NUMMER-SLOT] a BACK-DATED invoice still locks the counter it drew from", () => {
  // The bug in one line: December work invoiced on 4 January is dated 28 December, but its number
  // came from the 2027 counter. The date witness says nothing; the NUMBER says 2027.
  assert.equal(issuedInCounterYear("2026-12-28", "20270001", 2027), true,
    "a 2027 number is a 2027 witness whatever date the owner typed");
  // And the date witness alone is exactly what used to be asked — it is false here, which is why
  // the second witness had to exist at all.
  const { from, to } = invoiceDateWindow(2027);
  assert.equal("2026-12-28" >= from && "2026-12-28" <= to, false,
    "the old, date-only question answers 'nothing issued yet' on this row");
});

test("[NUMMER-SLOT] a POST-dated invoice locks both years, never neither", () => {
  // Numbered in December 2026, dated 3 January 2027. The 2026 counter really was drawn from (the
  // number says so) and the 2027 date window really does contain it. Both lock — the union can
  // only add.
  assert.equal(issuedInCounterYear("2027-01-03", "20260099", 2026), true, "by its number");
  assert.equal(issuedInCounterYear("2027-01-03", "20260099", 2027), true, "by its date");
});

test("[NUMMER-SLOT] a custom template's year is found wherever it sits", () => {
  for (const number of ["045-2027", "2027-045", "045/2027", "INV-045-2027", "F2027-045"]) {
    assert.equal(issuedInCounterYear("2026-12-20", number, 2027), true, number);
  }
});

test("[NUMMER-SLOT] a row with no number is no witness — a draft has consumed nothing", () => {
  // The route also filters `invoice_number is not null`, but the rule belongs here too: a draft
  // dated inside the year must never freeze a series that has not started.
  assert.equal(issuedInCounterYear("2027-03-14", null, 2027), false);
  assert.equal(issuedInCounterYear("2027-03-14", "", 2027), false);
  assert.equal(issuedInCounterYear("2027-03-14", "   ", 2027), false);
});

test("[NUMMER-SLOT] a different year's invoice does not lock this one", () => {
  // The whole point of the year window: a fresh year is a fresh series, and reshaping one that has
  // not started is legitimate. Over-locking is the safe direction, but it may not be the DEFAULT.
  assert.equal(issuedInCounterYear("2026-05-01", "20260045", 2027), false);
  assert.equal(issuedInCounterYear(null, "20260045", 2027), false);
  assert.equal(issuedInCounterYear(undefined, "20260045", 2027), false);
});

test("[NUMMER-SLOT] the known over-match locks MORE, which is the recoverable direction", () => {
  // Invoice 2027 of the year 2026 reads "2026-2027". Asked about 2027 it answers yes, and that is
  // wrong-but-safe: the owner waits or writes to support. Documented rather than hidden — the
  // opposite error puts a second document on a number that already went out.
  assert.equal(issuedInCounterYear("2026-11-02", "2026-2027", 2027), true);
});

test("[NUMMER-SLOT] a timestamp in the date column is read as its day, not as a Date", () => {
  // Postgres may hand back 'YYYY-MM-DD' or a full timestamp depending on the column type. Slicing
  // to ten characters compares ISO strings directly — no Date object, so no timezone can enter a
  // decision that is supposed to be about the owner's calendar.
  assert.equal(issuedInCounterYear("2027-01-01T00:00:00+01:00", "20270001", 2027), true);
  assert.equal(issuedInCounterYear("2026-12-31T23:59:59Z", "20270001", 2026), true, "by its date");
});

test("[NUMMER-SLOT] the SQL pattern matches every shape the formatter can produce", () => {
  const pattern = invoiceNumberYearPattern(2027);
  assert.equal(pattern, "%2027%");
  // A pattern anchored on either side would miss the templates that put the year in the middle or
  // at the end — which is most of them.
  const like = (s: string) => new RegExp("^" + pattern.replace(/%/g, ".*") + "$").test(s);
  for (const n of ["20270001", "045-2027", "2027-045", "INV-045-2027", "F2027-045"]) {
    assert.equal(like(n), true, n);
  }
  assert.equal(like("20260001"), false, "and it does not match another year");
});
