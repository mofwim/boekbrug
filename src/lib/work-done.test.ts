// src/lib/work-done.test.ts — run: npx tsx src/lib/work-done.test.ts
// [WERK-GEDAAN] The counts below are the live administration's own, measured while this was built.
import { workDoneLedger, estimateMinutes, estimateEuros, type WorkDoneCounts } from "./work-done";

let failed = 0;
function check(name: string, ok: boolean) {
  if (!ok) { console.error(`FAIL ${name}`); failed++; } else { console.log(`ok   ${name}`); }
}
function eq(name: string, got: unknown, want: unknown) {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  check(`${name}${g === w ? "" : `  (got ${g}, want ${w})`}`, g === w);
}

/** Kiwi Food, all of 2026 so far. Every number came out of the production database. */
const ECHT: WorkDoneCounts = {
  invoicesFromEmail: 317,
  invoicesAutoVerified: 227,
  tillDaysImported: 91,
  bankLinesCategorised: 24,
  bankLinesMatched: 23,
  duplicatesCaught: 10,
};

// ── The ledger ────────────────────────────────────────────────────────────────
{
  const l = workDoneLedger("2026", ECHT);
  eq("the period is carried, never dropped", l.period, "2026");
  eq("every action is counted", l.total, 317 + 227 + 91 + 24 + 23 + 10);
  eq("biggest first", l.lines.map((x) => x.count), [317, 227, 91, 24, 23, 10]);
  eq("and the first line reads as Dutch", l.lines[0].sentence, "317 facturen uit de e-mail gehaald");
}
{
  // A client with no till is not a client the app failed — that row simply does not exist.
  const l = workDoneLedger("Q2 2026", { ...ECHT, tillDaysImported: 0, duplicatesCaught: 0 });
  check("a zero is not a line", !l.lines.some((x) => x.count === 0));
  check("and the zero rows are gone entirely", l.lines.length === 4);
}
{
  const l = workDoneLedger("augustus 2026", {
    invoicesFromEmail: 1, invoicesAutoVerified: 1, bankLinesCategorised: 1,
    bankLinesMatched: 1, tillDaysImported: 1, duplicatesCaught: 1,
  });
  // Dutch, at n = 1. The plural placeholder this codebase spent a day removing must not come back.
  for (const line of l.lines) {
    check(`singular reads as Dutch: ${line.sentence}`, !/\(|\)/.test(line.sentence));
  }
  eq("one invoice, singular", l.lines[0].sentence.includes("1 factuur"), true);
}
{
  const leeg = workDoneLedger("Q3 2026", {
    invoicesFromEmail: 0, invoicesAutoVerified: 0, bankLinesCategorised: 0,
    bankLinesMatched: 0, tillDaysImported: 0, duplicatesCaught: 0,
  });
  eq("a quiet period is zero, and says nothing else", leeg.total, 0);
  eq("with no lines at all", leeg.lines.length, 0);
}
// Negative or fractional counts are a caller bug; they must not become a claim.
{
  const l = workDoneLedger("2026", { ...ECHT, invoicesFromEmail: -5, bankLinesMatched: 2.7 });
  check("a negative count never lands in the total", !l.lines.some((x) => x.count < 0));
  check("a fractional count is truncated, not rounded up", l.lines.some((x) => x.count === 2));
}

// ── [DE WEIGERING] No minutes without the office's own figure ─────────────────
//
// This is the property the whole file exists for. An invented minute is a number an accountant
// disproves in an afternoon, and then nothing else here is believed either.
{
  const l = workDoneLedger("2026", ECHT);
  eq("no rate → no minutes", estimateMinutes(l, null), null);
  eq("undefined → no minutes", estimateMinutes(l, undefined), null);
  eq("zero is not a rate", estimateMinutes(l, 0), null);
  eq("a negative rate is not a rate", estimateMinutes(l, -3), null);
  eq("NaN is not a rate", estimateMinutes(l, Number.NaN), null);
  eq("Infinity is not a rate", estimateMinutes(l, Number.POSITIVE_INFINITY), null);

  // With the office's own number, the arithmetic is plain and theirs.
  eq("their 2 minutes × our 692 actions", estimateMinutes(l, 2), 1384);
  eq("half a minute is allowed — it is their figure", estimateMinutes(l, 0.5), 346);

  eq("no rate → no euros either", estimateEuros(l, null, 30), null);
  eq("minutes but no hourly rate → no euros", estimateEuros(l, 2, null), null);
  eq("both supplied → their arithmetic", estimateEuros(l, 2, 30), Math.round((1384 / 60) * 30 * 100) / 100);
}
// [NEGATIEVE CONTROLE] Every refusal above also passes if estimateMinutes always returns null.
{
  const l = workDoneLedger("2026", ECHT);
  check("a supplied rate really does produce a number", estimateMinutes(l, 1) !== null);
  check("and a supplied pair really does produce euros", estimateEuros(l, 1, 30) !== null);
}

console.log(failed === 0 ? "\nwork-done: all green" : `\nwork-done: ${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);
