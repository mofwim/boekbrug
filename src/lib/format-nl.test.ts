// [TZ] Pure node test — run: npx tsx src/lib/format-nl.test.ts
import { amsterdamToday, amsterdamMidnightUtc, formatDateNL } from "./format-nl";

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

console.log("\n— [TZ] amsterdamMidnightUtc: the owner's day boundary, as a UTC instant —");
{
  check("a summer day begins at 22:00 UTC the evening before (CEST, +02:00)",
    amsterdamMidnightUtc("2026-07-15").toISOString() === "2026-07-14T22:00:00.000Z");
  check("a winter day begins at 23:00 UTC the evening before (CET, +01:00)",
    amsterdamMidnightUtc("2026-01-15").toISOString() === "2026-01-14T23:00:00.000Z");
  // The two clocks must agree with each other: the instant this returns IS midnight of that day
  // on the one Amsterdam clock, and one millisecond earlier is still the day before.
  check("the boundary lands exactly on the named day",
    amsterdamToday(amsterdamMidnightUtc("2026-03-29")) === "2026-03-29");
  check("one millisecond before the boundary is still yesterday",
    amsterdamToday(new Date(amsterdamMidnightUtc("2026-03-29").getTime() - 1)) === "2026-03-28");
  // 2026-03-29 is the DST-switch day and 2026-10-25 the switch back — the boundary itself is
  // unaffected (the jump happens at 02:00/03:00 local), which is exactly the claim in the module.
  check("the day AFTER the spring switch starts at 22:00 UTC",
    amsterdamMidnightUtc("2026-03-30").toISOString() === "2026-03-29T22:00:00.000Z");
  check("the day AFTER the autumn switch starts at 23:00 UTC",
    amsterdamMidnightUtc("2026-10-26").toISOString() === "2026-10-25T23:00:00.000Z");
}

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
