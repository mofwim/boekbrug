// [OVER-DATUM] Pure node test — run: npx tsx src/lib/overdue.test.ts
import { overdueDays } from "./overdue";

let passed = 0, failed = 0;
function check(name: string, cond: boolean) {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name}`); }
}

const TODAY = "2026-07-26";

console.log("\n— a bill past its due date is late by whole days —");
{
  check("1 day late", overdueDays("2026-07-25", TODAY) === 1);
  check("11 days late", overdueDays("2026-07-15", TODAY) === 11);
  check("across a month boundary", overdueDays("2026-06-30", TODAY) === 26);
  check("across a year boundary", overdueDays("2025-07-26", TODAY) === 365);
}

console.log("\n— not late is null, never 0 or a negative number —");
{
  check("due TODAY is not late", overdueDays(TODAY, TODAY) === null);
  check("due tomorrow is not late", overdueDays("2026-07-27", TODAY) === null);
  check("due far in the future is not late", overdueDays("2027-01-01", TODAY) === null);
}

console.log("\n— no due date means UNKNOWN, never an assumed term —");
{
  check("null → null", overdueDays(null, TODAY) === null);
  check("undefined → null", overdueDays(undefined, TODAY) === null);
  check("empty string → null", overdueDays("", TODAY) === null);
}

console.log("\n— a malformed or impossible date is unknown, not a wild verdict —");
{
  check("Dutch DD-MM-YYYY is not accepted as ISO", overdueDays("25-07-2026", TODAY) === null);
  check("garbage → null", overdueDays("gisteren", TODAY) === null);
  check("month 13 → null", overdueDays("2026-13-01", TODAY) === null);
  check("31 February → null", overdueDays("2026-02-31", TODAY) === null);
  check("unpadded day → null", overdueDays("2026-7-5", TODAY) === null);
  check("a bad today → null", overdueDays("2026-07-01", "not-a-day") === null);
}

console.log("\n— a timestamp is tolerated: only the date part decides —");
{
  check("timestamp 1 day late", overdueDays("2026-07-25T23:59:59Z", TODAY) === 1);
  check("timestamp due today is not late", overdueDays("2026-07-26T00:00:00Z", TODAY) === null);
}

console.log("\n— DST cannot shift the count (Europe/Amsterdam switches 2026-03-29) —");
{
  // 2026-03-28 → 2026-03-30 spans the spring-forward night; the answer must be whole days.
  check("across the DST switch stays exact", overdueDays("2026-03-28", "2026-03-30") === 2);
  check("across the autumn switch stays exact", overdueDays("2026-10-24", "2026-10-26") === 2);
}

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
