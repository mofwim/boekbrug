// [DEKKING] Run: npx tsx --test src/lib/bank-coverage.test.ts
//
// Its own file rather than an addition to bank-statement-continuity.test.ts, which is one of this
// codebase's hand-rolled check() suites: mixing two harnesses in one file makes it unclear which
// failures the runner will actually report.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { findStatementGaps } from "./bank-statement-continuity";

// ─── [DEKKING] The edge the gap-scan is structurally blind to ─────────────────────────

// findStatementGaps looks BETWEEN statements, which is the same shape as the hole-scan on invoice
// numbering — and blind in the same place. An owner who uploaded only January has no gap between
// his statements: there is only one. February and March are simply not there.
//
// For the quarter package that is the most important question there is. The package delivers a
// reconciliation, and a reconciliation reads as a finished job. Over a month that was never
// imported, every line is neatly matched and none of it is true: the invoices paid in that month
// still stand open and the turnover that came in is tied to nothing.

import { coverageOfPeriod, coverageSentence } from "./bank-statement-continuity";

const stmt = (from: string, to: string, iban: string | null = "NL01BANK0123456789") => ({
  documentId: `${from}-${to}`, iban, from, to, opening: null, closing: null,
});

const Q1 = ["2026-01-01", "2026-03-31"] as const;

test("[DEKKING] a quarter with only January is reported, though no gap sits between statements", () => {
  // THE ONE THAT MATTERS. One statement cannot have a gap after it — there is nothing to have a
  // gap WITH — so the between-statements check returns clean on exactly this case.
  const only = [stmt("2026-01-01", "2026-01-31")];
  assert.deepEqual(findStatementGaps(only).issues, [], "the between-check is silent here — that is the point");

  const c = coverageOfPeriod(only, ...Q1);
  assert.equal(c.checked, true);
  assert.equal(c.complete, false);
  assert.deepEqual(c.accounts[0].missing, [{ from: "2026-02-01", to: "2026-03-31", days: 59 }]);
  assert.match(coverageSentence(c)!, /59 dagen/);
  assert.match(coverageSentence(c)!, /1-2-2026 t\/m 31-3-2026/);
});

test("[DEKKING] a quarter covered end to end says so, in one statement or in three", () => {
  const whole = coverageOfPeriod([stmt("2026-01-01", "2026-03-31")], ...Q1);
  assert.equal(whole.complete, true);
  assert.equal(coverageSentence(whole), null, "nothing to say means nothing said");

  const monthly = coverageOfPeriod(
    [stmt("2026-01-01", "2026-01-31"), stmt("2026-02-01", "2026-02-28"), stmt("2026-03-01", "2026-03-31")],
    ...Q1,
  );
  assert.equal(monthly.complete, true);
  assert.equal(monthly.accounts[0].statements, 3);
});

test("[DEKKING] a hole in the MIDDLE is found too, and named by its own days", () => {
  const c = coverageOfPeriod([stmt("2026-01-01", "2026-01-31"), stmt("2026-03-01", "2026-03-31")], ...Q1);
  assert.deepEqual(c.accounts[0].missing, [{ from: "2026-02-01", to: "2026-02-28", days: 28 }]);
});

test("[DEKKING] a statement that runs past the quarter counts only inside it", () => {
  // A statement covering December through February covers January and February OF THIS QUARTER,
  // and December is somebody else's quarter. Counting the overhang would report a quarter as
  // over-covered and hide the March that is genuinely missing.
  const c = coverageOfPeriod([stmt("2025-12-01", "2026-02-28")], ...Q1);
  assert.deepEqual(c.accounts[0].missing, [{ from: "2026-03-01", to: "2026-03-31", days: 31 }]);
});

test("[DEKKING] overlapping statements are covered, not double-counted into a gap", () => {
  // Two exports of the same weeks. That is a signal findStatementGaps reports on its own; here it
  // must simply not turn into a hole.
  const c = coverageOfPeriod(
    [stmt("2026-01-01", "2026-02-15"), stmt("2026-02-01", "2026-03-31")],
    ...Q1,
  );
  assert.deepEqual(c.accounts[0].missing, []);
  assert.equal(c.complete, true);
});

test("[DEKKING] each account answers for itself", () => {
  // One account covered all quarter, a second only January. The quarter is not covered, and the
  // sentence has to say WHICH account — otherwise the owner goes looking in the wrong bank.
  const c = coverageOfPeriod(
    [stmt("2026-01-01", "2026-03-31", "NL01BANK0123456789"), stmt("2026-01-01", "2026-01-31", "NL99RABO0000000001")],
    ...Q1,
  );
  assert.equal(c.complete, false);
  const short = c.accounts.find((a) => a.iban === "NL99RABO0000000001")!;
  assert.equal(short.missing.length, 1);
  assert.equal(c.accounts.find((a) => a.iban === "NL01BANK0123456789")!.missing.length, 0);
  assert.match(coverageSentence(c)!, /NL99RABO0000000001/);
});

test("[DEKKING] no statements at all is 'not checked', never 'not covered'", () => {
  // The two are opposites in what they ask of the owner. "We did not look" is a limitation of the
  // package; "three months are missing" is an instruction to go and fetch them.
  const none = coverageOfPeriod([], ...Q1);
  assert.equal(none.checked, false);
  assert.equal(none.complete, false, "and it is certainly not complete either");
  assert.equal(coverageSentence(none), null, "an unchecked quarter must not produce a finding");
});

// ─── The gate: both readers must actually ask ────────────────────────────────────────

test("[DEKKING] the question is asked where it can still be answered, and where it is handed over", () => {
  // Two places, and they are not redundant.
  //
  // The closing package tells the ACCOUNTANT a quarter is incomplete. By then it is a note in a
  // file: he cannot download his client's bank statement. Readiness tells the OWNER, before he
  // hands anything over, while the fix is one download from his own bank — and it BLOCKS, which
  // is the whole promise of the screen ("er is niets zoekgeraakt").
  //
  // Readiness had exactly the same blindness this function exists for: its existing check needs
  // `rows.length >= 2` because it compares statements to EACH OTHER, so an owner with one
  // statement for the quarter saw nothing at all.
  const readiness = readFileSync("src/app/api/readiness/route.ts", "utf8");
  assert.match(readiness, /coverageOfPeriod\(/, "the owner is no longer told his quarter is incomplete");
  assert.match(readiness, /bankGapMessages = \[/, "…or is told, and it reaches no verdict");
  // The filter, which is the subtle half. The neighbouring-gap query takes a 45-day margin around
  // the quarter, which is right for "which statement lies next to this gap" and wrong for
  // coverage: a yearly statement starting last January covers this quarter and falls outside that
  // margin, so the check would report a fully covered quarter as entirely missing. A false gap is
  // exactly how a check loses the trust it needs.
  assert.match(
    readiness,
    /\.lte\("period_start", end\)\s*\n\s*\.gte\("period_end", start\)/,
    "the coverage read must select statements that OVERLAP the quarter, not those starting near it",
  );

  const pkg = readFileSync("src/lib/closing-package.ts", "utf8");
  assert.match(pkg, /coverageOfPeriod\(periods, start, end\)/, "the package no longer checks coverage");
});
