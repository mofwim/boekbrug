// [TZ] Pure node test — run: npx tsx src/lib/format-nl.test.ts
import { amsterdamToday, formatDateNL } from "./format-nl";

let passed = 0, failed = 0;
function check(name: string, cond: boolean) {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name}`); }
}

console.log("\n— [TZ] the hour that used to cost a fiscal year —");
{
  // Winter, UTC+1. 00:30 in Amsterdam on 1 January is 23:30 UTC on 31 December.
  check("just after midnight on New Year is 1 January, not 31 December",
    amsterdamToday(new Date("2026-12-31T23:30:00.000Z")) === "2027-01-01");
  check("…and the old UTC expression really would have said 31 December",
    new Date("2026-12-31T23:30:00.000Z").toISOString().slice(0, 10) === "2026-12-31");

  // Summer, UTC+2. 01:30 in Amsterdam on 1 July is 23:30 UTC on 30 June.
  check("just after midnight on a QUARTER boundary is 1 July, not 30 June",
    amsterdamToday(new Date("2026-06-30T23:30:00.000Z")) === "2026-07-01");
  check("…and at 00:30 UTC+2 too (the summer offset is a full two hours)",
    amsterdamToday(new Date("2026-06-30T22:30:00.000Z")) === "2026-07-01");
}

console.log("\n— [TZ] the rest of the day is unchanged —");
{
  check("midday is simply today", amsterdamToday(new Date("2026-07-15T12:00:00.000Z")) === "2026-07-15");
  check("late evening has not rolled over yet", amsterdamToday(new Date("2026-07-15T21:59:00.000Z")) === "2026-07-15");
  check("22:00 UTC in summer IS already tomorrow in Amsterdam",
    amsterdamToday(new Date("2026-07-15T22:00:00.000Z")) === "2026-07-16");
  check("23:00 UTC in winter is already tomorrow",
    amsterdamToday(new Date("2026-01-15T23:00:00.000Z")) === "2026-01-16");
  check("the shape is always ISO yyyy-mm-dd", /^\d{4}-\d{2}-\d{2}$/.test(amsterdamToday()));
}

console.log("\n— formatDateNL stays timezone-proof for date-only strings —");
{
  check("a date-only string is reformatted by string surgery", formatDateNL("2026-06-12") === "12-06-2026");
  check("null renders as an em dash", formatDateNL(null) === "—");
}

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
