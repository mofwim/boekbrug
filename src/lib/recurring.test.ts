// [HERHAAL] Pure node test — run: npx tsx src/lib/recurring.test.ts
import {
  nextOccurrence,
  planOccurrence,
  firstRunAfter,
  anchorDayOf,
  termDaysOf,
  daysInMonth,
  addDays,
  daysBetween,
  isCadence,
  DEFAULT_TERM_DAYS,
  STALE_OCCURRENCE_DAYS,
  type Schedule,
} from "./recurring";

let passed = 0, failed = 0;
function check(name: string, cond: boolean) {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name}`); }
}

console.log("\n— the month-end trap: the anchor is kept, never the clamped result —");
{
  // A business that bills on the 31st must run 31 Jan → 28 Feb → 31 Mar. Stepping a month from
  // the CLAMPED 28 Feb gives 28 March, and every future invoice date silently moves.
  const a = nextOccurrence("2026-01-31", "monthly", 31);
  check("31 Jan → 28 Feb (2026 is not a leap year)", a === "2026-02-28");
  const b = nextOccurrence(a, "monthly", 31);
  check("…and 28 Feb → 31 Mar, NOT 28 Mar", b === "2026-03-31");
  const c = nextOccurrence(b, "monthly", 31);
  check("…31 Mar → 30 Apr (April has 30)", c === "2026-04-30");
  const d = nextOccurrence(c, "monthly", 31);
  check("…30 Apr → 31 May: the series recovers, it never degrades", d === "2026-05-31");
}
{
  check("29 Jan → 29 Feb in a leap year", nextOccurrence("2028-01-29", "monthly", 29) === "2028-02-29");
  check("30 Jan → 29 Feb in a leap year (clamped)", nextOccurrence("2028-01-30", "monthly", 30) === "2028-02-29");
  check("February has 29 days in 2028", daysInMonth(2028, 2) === 29);
  check("…and 28 in 2026", daysInMonth(2026, 2) === 28);
}

console.log("\n— the four cadences —");
{
  check("weekly is plain +7 days", nextOccurrence("2026-05-04", "weekly", 4) === "2026-05-11");
  check("weekly crosses a month", nextOccurrence("2026-05-28", "weekly", 28) === "2026-06-04");
  check("monthly", nextOccurrence("2026-05-08", "monthly", 8) === "2026-06-08");
  check("monthly crosses a year", nextOccurrence("2026-12-08", "monthly", 8) === "2027-01-08");
  check("quarterly", nextOccurrence("2026-01-15", "quarterly", 15) === "2026-04-15");
  check("quarterly crosses a year", nextOccurrence("2026-11-15", "quarterly", 15) === "2027-02-15");
  check("yearly", nextOccurrence("2026-03-01", "yearly", 1) === "2027-03-01");
  check("yearly from a leap day lands on the 28th", nextOccurrence("2028-02-29", "yearly", 29) === "2029-02-28");
  check("a junk date is returned untouched, never guessed", nextOccurrence("later", "monthly", 1) === "later");
  check("cadence validation", isCadence("monthly") && !isCadence("daily") && !isCadence(7));
}

console.log("\n— one occurrence per run, never a burst —");
{
  const s: Schedule = { next_run_date: "2026-05-08", cadence: "monthly", anchor_day: 8, active: true };
  check("not due yet → wait", planOccurrence(s, "2026-05-07").kind === "wait");
  const due = planOccurrence(s, "2026-05-08");
  check("due today → generate for today", due.kind === "generate" && due.date === "2026-05-08");
  check("…and the schedule moves exactly ONE occurrence", due.kind === "generate" && due.nextRunDate === "2026-06-08");

  // The cron was down for two months. It must not produce two invoices in one run.
  const late = planOccurrence(s, "2026-07-08");
  check("a missed month generates ONE, dated on its own occurrence", late.kind === "generate" && late.date === "2026-05-08");
  check("…and advances one step, so the gap heals a day at a time", late.kind === "generate" && late.nextRunDate === "2026-06-08");
}
{
  // A schedule nobody has watched for months is not a forgotten invoice.
  const dormant: Schedule = { next_run_date: "2026-01-08", cadence: "monthly", anchor_day: 8, active: true };
  const r = planOccurrence(dormant, "2026-06-01");
  check("an occurrence older than the staleness limit is SKIPPED, not invoiced", r.kind === "skip");
  check("…and it still advances, so the schedule catches up silently", r.kind === "skip" && r.nextRunDate === "2026-02-08");
  check("the limit is 90 days", STALE_OCCURRENCE_DAYS === 90);
  // Just inside the limit still generates.
  const edge = planOccurrence({ next_run_date: "2026-03-08", cadence: "monthly", anchor_day: 8 }, "2026-06-05");
  check("89 days late still produces the invoice", edge.kind === "generate");
}
{
  check("a paused schedule does nothing",
    planOccurrence({ next_run_date: "2026-05-08", cadence: "monthly", anchor_day: 8, active: false }, "2026-06-01").kind === "done");
  const ended = planOccurrence(
    { next_run_date: "2026-07-08", cadence: "monthly", anchor_day: 8, active: true, ends_on: "2026-06-30" },
    "2026-07-08",
  );
  check("past its end date → done", ended.kind === "done" && ended.reason === "ended");
  const beforeEnd = planOccurrence(
    { next_run_date: "2026-06-08", cadence: "monthly", anchor_day: 8, active: true, ends_on: "2026-06-30" },
    "2026-06-08",
  );
  check("the last occurrence before the end date still runs", beforeEnd.kind === "generate");
  check("an unusable date waits rather than guessing",
    planOccurrence({ next_run_date: "soon", cadence: "monthly", anchor_day: 8 }, "2026-06-01").kind === "wait");
}

console.log("\n— starting a schedule from the invoice it repeats —");
{
  check("monthly from an invoice of the 8th bills the 8th", firstRunAfter("2026-05-08", "monthly") === "2026-06-08");
  check("…never the same day again (the source is already invoiced)", firstRunAfter("2026-05-08", "monthly") > "2026-05-08");
  check("weekly starts a week later", firstRunAfter("2026-05-08", "weekly") === "2026-05-15");
  check("quarterly starts three months later", firstRunAfter("2026-05-08", "quarterly") === "2026-08-08");
  check("month-end keeps its anchor from the start", firstRunAfter("2026-01-31", "monthly") === "2026-02-28");
  check("the anchor is the source invoice's own day", anchorDayOf("2026-05-08") === 8);
  check("an unusable source date anchors on the 1st", anchorDayOf("") === 1);
}

console.log("\n— the payment term travels with the customer —");
{
  check("a 30-day customer stays on 30 days", termDaysOf("2026-05-01", "2026-05-31") === 30);
  check("a 14-day customer stays on 14", termDaysOf("2026-05-01", "2026-05-15") === 14);
  check("no due date → the Dutch default", termDaysOf("2026-05-01", null) === DEFAULT_TERM_DAYS);
  check("a due date BEFORE the invoice date is refused (never a term of 0)",
    termDaysOf("2026-05-10", "2026-05-01") === DEFAULT_TERM_DAYS);
  check("a same-day due date would make it overdue on arrival → default",
    termDaysOf("2026-05-01", "2026-05-01") === DEFAULT_TERM_DAYS);
  check("an absurd term (>1 year) falls back", termDaysOf("2026-01-01", "2030-01-01") === DEFAULT_TERM_DAYS);
}

console.log("\n— date helpers —");
{
  check("addDays crosses a month", addDays("2026-01-31", 1) === "2026-02-01");
  check("addDays crosses a year", addDays("2026-12-31", 1) === "2027-01-01");
  check("daysBetween counts forward", daysBetween("2026-05-01", "2026-05-31") === 30);
  check("daysBetween counts backward", daysBetween("2026-05-31", "2026-05-01") === -30);
  check("daysBetween on junk → null", daysBetween("x", "2026-05-01") === null);
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
