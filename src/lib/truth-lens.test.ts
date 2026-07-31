// [TRUTH-LENS] Pure test for truth-lens.ts — run: npx tsx src/lib/truth-lens.test.ts
import { resolveWindow, parseLens, ALL_TIME_FLOOR, ALL_TIME_CEILING, type Lens } from "./truth-lens";

let passed = 0, failed = 0;
function check(name: string, cond: boolean) {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name}`); }
}

/** A stand-in for URLSearchParams, so the tests never build a real request. */
const sp = (o: Record<string, string> = {}) => ({ get: (k: string) => o[k] ?? null });
const win = (lens: Lens, today: string, o?: Record<string, string>) => resolveWindow(lens, today, sp(o));

console.log("— lens parsing —");
{
  check("a known lens passes through", parseLens("ytd") === "ytd");
  check("an unknown lens falls back to this-quarter", parseLens("../../etc/passwd") === "this-quarter");
  check("null falls back to this-quarter", parseLens(null) === "this-quarter");
}

console.log("\n— quarter windows are the whole tax period —");
{
  const q3 = win("this-quarter", "2026-07-31");
  check("Q3 starts 1 July", q3.start === "2026-07-01");
  check("Q3 ends 30 September (not today)", q3.end === "2026-09-30");
  check("Q3 carries quarter/year for filing + the aangifte link", q3.quarter === 3 && q3.year === 2026);
  check("a running quarter is live", q3.isLiveWindow === true);

  // Leap-year February: the quarter end must come from real calendar math, not a lookup.
  const q1leap = win("this-quarter", "2028-02-10");
  check("Q1 2028 ends 31 March", q1leap.end === "2028-03-31");
  const q2 = win("this-quarter", "2026-04-01");
  check("Q2 ends 30 June (30-day month)", q2.end === "2026-06-30");
}

console.log("\n— last-quarter, including the year wrap —");
{
  const lq = win("last-quarter", "2026-07-31");
  check("in Q3 the previous quarter is Q2 2026", lq.quarter === 2 && lq.year === 2026);
  check("Q2 2026 is over → not live", lq.isLiveWindow === false);

  const wrap = win("last-quarter", "2026-01-15");
  check("in Q1 the previous quarter is Q4 of LAST year", wrap.quarter === 4 && wrap.year === 2025);
  check("…and its window is 2025-10-01 → 2025-12-31", wrap.start === "2025-10-01" && wrap.end === "2025-12-31");
}

console.log("\n— the day a quarter closes —");
{
  const last = win("this-quarter", "2026-09-30");
  check("on the last day the quarter is still live", last.isLiveWindow === true);
  const firstOfNext = win("last-quarter", "2026-10-01");
  check("one day later, Q3 is a closed period", firstOfNext.quarter === 3 && firstOfNext.isLiveWindow === false);
}

console.log("\n— THE INVARIANT: kwartaal ⊆ jaar ⊆ alles —");
{
  // Checked on the awkward days: a quarter boundary, a year boundary, and mid-quarter.
  for (const today of ["2026-01-01", "2026-03-31", "2026-07-31", "2026-10-01", "2026-12-31"]) {
    const q = win("this-quarter", today);
    const yr = win("ytd", today);
    const all = win("all", today);
    check(
      `${today}: quarter ⊆ year`,
      yr.start <= q.start && yr.end >= q.end,
    );
    check(
      `${today}: year ⊆ alles`,
      all.start <= yr.start && all.end >= yr.end,
    );
    // The old bug in one assertion: a sale dated inside the quarter but after today was counted in
    // the quarter and dropped from the year. If the year still ends at today, this fails.
    check(
      `${today}: nothing in the quarter can fall outside the year`,
      q.end <= yr.end,
    );
  }
}

console.log("\n— 'Alles' really means everything —");
{
  const all = win("all", "2026-07-31");
  check("floor is the app's earliest bookkeeping year", all.start === ALL_TIME_FLOOR);
  check("no cap at today — a future-dated invoice is still inside 'Alles'", all.end === ALL_TIME_CEILING);
  check("'Alles' contains a date years ahead", "2031-04-04" <= all.end);
  check("always live", all.isLiveWindow === true);
}

console.log("\n— [NAMED-QUARTER] any historical quarter is reachable —");
{
  const q1 = win("quarter", "2026-07-31", { year: "2024", quarter: "1" });
  check("Q1 2024 resolves to its own window", q1.start === "2024-01-01" && q1.end === "2024-03-31");
  check("…and carries year/quarter, so filing works on it", q1.year === 2024 && q1.quarter === 1);
  check("a long-closed quarter is not live", q1.isLiveWindow === false);

  // A named quarter must be byte-identical to the relative lens pointing at the same period —
  // otherwise the same quarter could show two different windows depending on how you got there.
  const rel = win("this-quarter", "2026-07-31");
  const named = win("quarter", "2026-07-31", { year: "2026", quarter: "3" });
  check("named Q3 2026 == the this-quarter lens", named.start === rel.start && named.end === rel.end);
  check("…including the live flag", named.isLiveWindow === rel.isLiveWindow);

  // Never invent a window from input we could not parse.
  check("quarter 0 falls back to the current quarter", win("quarter", "2026-07-31", { year: "2026", quarter: "0" }).quarter === 3);
  check("quarter 5 falls back", win("quarter", "2026-07-31", { year: "2026", quarter: "5" }).quarter === 3);
  check("year 1999 falls back", win("quarter", "2026-07-31", { year: "1999", quarter: "2" }).year === 2026);
  check("missing params fall back", win("quarter", "2026-07-31").quarter === 3);
  check("garbage falls back", win("quarter", "2026-07-31", { year: "abc", quarter: "x" }).quarter === 3);
  check("'quarter' is an accepted lens name", parseLens("quarter") === "quarter");
}

console.log("\n— year lens —");
{
  const past = win("year", "2026-07-31", { year: "2024" });
  check("a past year is the full calendar year", past.start === "2024-01-01" && past.end === "2024-12-31");
  check("a past year is NOT live", past.isLiveWindow === false);
  check("ytd and year agree for the current year", win("ytd", "2026-07-31").end === win("year", "2026-07-31", { year: "2026" }).end);
  check("out-of-range years are clamped, never NaN", win("year", "2026-07-31", { year: "1200" }).year === 2000);
  check("garbage falls back to the current year", win("year", "2026-07-31", { year: "abc" }).year === 2026);
}

console.log("\n— custom range —");
{
  const c = win("custom", "2026-07-31", { from: "2026-02-01", to: "2026-02-28" });
  check("honours from/to", c.start === "2026-02-01" && c.end === "2026-02-28");
  check("a closed past range is not live", c.isLiveWindow === false);
  const rev = win("custom", "2026-07-31", { from: "2026-06-30", to: "2026-01-01" });
  check("a reversed range is swapped, never empty", rev.start === "2026-01-01" && rev.end === "2026-06-30");
  const bad = win("custom", "2026-07-31", { from: "31-07-2026", to: "not-a-date" });
  check("malformed dates fall back to Jan 1 → today", bad.start === "2026-01-01" && bad.end === "2026-07-31");
  check("a custom lens never offers filing (no quarter)", bad.quarter === undefined);
}

console.log("\n— [TZ] the Amsterdam day decides the quarter, and the caller supplies it —");
{
  // 1 July 00:30 Amsterdam is still 30 June in UTC. The route now passes amsterdamToday(), so this
  // module must simply trust the string it is given — proving the boundary moves with the input.
  check("30 June → Q2", win("this-quarter", "2026-06-30").quarter === 2);
  check("1 July  → Q3", win("this-quarter", "2026-07-01").quarter === 3);
  check("31 Dec  → Q4 2026", win("this-quarter", "2026-12-31").year === 2026);
  check("1 Jan   → Q1 2027", win("this-quarter", "2027-01-01").year === 2027);
}

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
