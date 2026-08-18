// [DOORLOPEND] Run: npx tsx --test src/lib/invoice-continuity.test.ts
//
// This check speaks to an owner about a legal obligation, and it will be quoted at an accountant.
// Both ways of being wrong are expensive and they are opposites: a missed gap is a boekencontrole
// finding nobody saw coming, and a false gap is a tool that scared someone about an administration
// that was fine — after which he stops reading it, including the time it is right.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  checkContinuity,
  readNumber,
  totalUnaccounted,
  type SeriesFormat,
} from "./invoice-continuity";

/** The product default: 20260001. */
const DEFAULT_FACTUUR: SeriesFormat = { type: "factuur", template: "{year}{seq}", padding: 4 };
const CREDITNOTA: SeriesFormat = { type: "creditnota", template: "CR-{year}{seq}", padding: 4 };
const FORMATS = [DEFAULT_FACTUUR, CREDITNOTA];

const factuur = (n: string) => ({ invoice_number: n, invoice_type: "factuur" });

// ─── The rule that keeps this from crying wolf ───────────────────────────────────────

test("[DOORLOPEND] a series starts at the owner's first invoice, never at 1", () => {
  // A zzp'er moving to BoekBrug mid-year starts at 45 because his previous package ended at 44.
  // Counting from 1 greets him with forty-four missing invoices on his first day, about records
  // that are not in this administration at all — and a tool that is wrong the first time it speaks
  // is one nobody reads the second time.
  const report = checkContinuity({
    invoices: [factuur("20260045"), factuur("20260046"), factuur("20260047")],
    formats: FORMATS,
  });
  assert.equal(report.series.length, 1);
  assert.deepEqual(report.series[0].missing, []);
  assert.equal(report.series[0].first, 45);
  assert.equal(report.clean, true, "an unbroken imported series must read as clean");
});

// ─── The gap it exists to find ───────────────────────────────────────────────────────

test("[DOORLOPEND] a burned number in the middle is found and named", () => {
  // The counter moved and the invoice was never written — a PDF that failed to render, a send that
  // threw. Nothing is wrong with the app afterwards and nothing logs it.
  const report = checkContinuity({
    invoices: [factuur("20260001"), factuur("20260002"), factuur("20260004")],
    formats: FORMATS,
  });
  assert.deepEqual(report.series[0].missing, [3]);
  assert.equal(report.clean, false);
});

test("[DOORLOPEND] a gap at the END is found, which a hole-scan alone cannot see", () => {
  // THE ONE THAT MATTERS MOST. The likeliest failure of all is the last send, and there is no hole:
  // the highest invoice is 2 and nothing sits above it to make a hole out of. Every tool that only
  // reads the invoices is structurally blind to this. The counter is the only witness.
  const report = checkContinuity({
    invoices: [factuur("20260001"), factuur("20260002")],
    formats: FORMATS,
    counters: [{ type: "factuur", year: 2026, last_seq: 3 }],
  });
  assert.deepEqual(report.series[0].missing, [], "there is no hole — that is the point");
  assert.equal(report.series[0].burnedAtEnd, 1, "and yet one number was allocated and never used");
  assert.equal(report.clean, false);
});

test("[DOORLOPEND] a counter that agrees with the invoices reports nothing", () => {
  const report = checkContinuity({
    invoices: [factuur("20260001"), factuur("20260002")],
    formats: FORMATS,
    counters: [{ type: "factuur", year: 2026, last_seq: 2 }],
  });
  assert.equal(report.series[0].burnedAtEnd, 0);
  assert.equal(report.clean, true);
});

// ─── What it does when it cannot tell ────────────────────────────────────────────────

test("[DOORLOPEND] an unread counter is null, and never a comfortable zero", () => {
  // "0 nummers zoekgeraakt" over a counter we could not read is a green verdict on a check that did
  // not run. Null says which half is missing.
  const report = checkContinuity({
    invoices: [factuur("20260001")],
    formats: FORMATS,
    counters: null,
  });
  assert.equal(report.series[0].burnedAtEnd, null);
  assert.equal(totalUnaccounted(report), null, "a total over a half-finished check is a wrong number with a decimal point");
  // clean stays true for the half we DID check — the screen is expected to say which half that was.
  assert.equal(report.clean, true);
});

test("[DOORLOPEND] a number in an unknown format is neither a gap nor silently dropped", () => {
  // Imported history, or a template the owner changed halfway. Calling it a gap invents a problem;
  // dropping it understates the series. It is its own answer, and it makes the verdict honest
  // rather than green: we cannot call a series unbroken while holding numbers we could not place.
  const report = checkContinuity({
    invoices: [factuur("20260001"), factuur("2026/0002"), factuur("20260003")],
    formats: FORMATS,
  });
  assert.deepEqual(report.unreadable, ["2026/0002"]);
  assert.deepEqual(report.series[0].missing, [2], "the hole its absence leaves is still reported");
  assert.equal(report.clean, false);
  assert.equal(totalUnaccounted(report), null, "with an unreadable number in hand, no total is honest");
});

test("[DOORLOPEND] an unreadable number alone is enough to withhold a green verdict", () => {
  // Isolated on purpose. The case above has a hole AND an unreadable number, so `clean` is false
  // for two reasons and would stay false with the unreadable rule deleted — a test that proves
  // nothing about the thing it is named after. Here there is no hole at all: 1 and 2 run unbroken,
  // and the only reason to withhold the green verdict is the number we could not place.
  //
  // Withholding it is the point. An unreadable number might BE a number from this series in an
  // older format, in which case the series is longer than we can see; calling it unbroken would be
  // a claim about invoices we never read.
  const report = checkContinuity({
    invoices: [factuur("20260001"), factuur("20260002"), factuur("2026/0009")],
    formats: FORMATS,
  });
  assert.deepEqual(report.series[0].missing, [], "there is no hole here");
  assert.deepEqual(report.unreadable, ["2026/0009"]);
  assert.equal(report.clean, false, "a number we could not place must stop the green verdict on its own");
});

// ─── The series are separate, and getting that wrong invents gaps ────────────────────

test("[DOORLOPEND] creditnota's numbers are a series of their own", () => {
  // invoice_counters is keyed (user_id, year, type), so the two series run independently. Reading a
  // creditnota into the factuur series would invent a hole in one and hide one in the other.
  const report = checkContinuity({
    invoices: [
      factuur("20260001"),
      factuur("20260002"),
      { invoice_number: "CR-20260001", invoice_type: "creditnota" },
    ],
    formats: FORMATS,
  });
  assert.equal(report.series.length, 2);
  assert.deepEqual(report.series.map((s) => s.type), ["creditnota", "factuur"]);
  assert.equal(report.clean, true, "two healthy series must not read as one broken one");
});

test("[DOORLOPEND] a year change starts a new series rather than a 9000-number gap", () => {
  // 20260007 → 20270001 is a yearly reset, not a hole of nine thousand.
  const report = checkContinuity({
    invoices: [factuur("20260006"), factuur("20260007"), factuur("20270001")],
    formats: FORMATS,
  });
  assert.equal(report.series.length, 2);
  assert.deepEqual(report.series.map((s) => s.year), [2026, 2027]);
  assert.equal(report.clean, true);
});

test("[DOORLOPEND] a type we do not check is left alone", () => {
  // A pro forma is not a fiscal document and has no place in the doorlopende reeks. It must not be
  // read into one, and it must not turn up as unreadable either — it was never ours to judge.
  const report = checkContinuity({
    invoices: [factuur("20260001"), { invoice_number: "PF-20260001", invoice_type: "pro_forma" }],
    formats: FORMATS,
  });
  assert.equal(report.series.length, 1);
  assert.deepEqual(report.unreadable, []);
  assert.equal(report.clean, true);
});

// ─── Reading the owner's own format ──────────────────────────────────────────────────

test("[DOORLOPEND] the sequence is recovered whichever side of the year it sits on", () => {
  // Both are real formats in this app, and swapping the two captures would read the YEAR as the
  // sequence — producing a series numbered 2026, 2026, 2026 and a report full of nonsense.
  assert.deepEqual(readNumber("045-2026", { type: "factuur", template: "{seq}-{year}", padding: 3 }), { year: 2026, seq: 45 });
  assert.deepEqual(readNumber("2026-045", { type: "factuur", template: "{year}-{seq}", padding: 3 }), { year: 2026, seq: 45 });
  assert.deepEqual(readNumber("20260045", DEFAULT_FACTUUR), { year: 2026, seq: 45 });
  // A continuous series has no year at all.
  assert.deepEqual(readNumber("2764283", { type: "factuur", template: "{seq}", padding: 7 }), { year: null, seq: 2764283 });
});

test("[DOORLOPEND] a counter that outgrew its padding is still read", () => {
  // Padded to 3 and now past a thousand: "1200" must read as 1200, not fail to match and land on
  // the unreadable pile — which would put every invoice after the thousandth into limbo.
  const format: SeriesFormat = { type: "factuur", template: "{seq}-{year}", padding: 3 };
  assert.deepEqual(readNumber("1200-2026", format), { year: 2026, seq: 1200 });
});

test("[DOORLOPEND] the literal parts of a template are matched literally", () => {
  // A dot, deliberately. The first version of this test used "INV-{seq}/{year}" — and "-" and "/"
  // mean nothing special in a pattern, so it passed just as happily with the escaping removed
  // entirely. A separator that IS a metacharacter is the only kind that tests escaping: unescaped,
  // "." matches any character, and "045x2026" is quietly filed as invoice 45.
  const format: SeriesFormat = { type: "factuur", template: "{seq}.{year}", padding: 3 };
  assert.deepEqual(readNumber("045.2026", format), { year: 2026, seq: 45 });
  assert.equal(readNumber("045x2026", format), null, "the dot is a dot, not a wildcard");

  // And the ordinary case, with the separators an owner is likelier to type.
  const plain: SeriesFormat = { type: "factuur", template: "INV-{seq}/{year}", padding: 3 };
  assert.deepEqual(readNumber("INV-045/2026", plain), { year: 2026, seq: 45 });
});

test("[DOORLOPEND] a total is only given when both halves of the check ran", () => {
  const both = checkContinuity({
    invoices: [factuur("20260001"), factuur("20260003")],
    formats: FORMATS,
    counters: [{ type: "factuur", year: 2026, last_seq: 4 }],
  });
  // One hole (2) plus one burned at the end (4 allocated, 3 issued).
  assert.equal(totalUnaccounted(both), 2);
});
