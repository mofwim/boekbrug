// [KASSTELSEL] Pure node test — run: npx tsx src/lib/vat-scheme.test.ts
import { getVatScheme, isVatScheme, resolveSchemeForQuarter } from "./vat-scheme";

let passed = 0, failed = 0;
function check(name: string, cond: boolean) {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name}`); }
}

console.log("\n— getVatScheme defaults safe —");
{
  check("'kas' → kas", getVatScheme("kas") === "kas");
  check("'factuur' → factuur", getVatScheme("factuur") === "factuur");
  check("null → factuur (default)", getVatScheme(null) === "factuur");
  check("undefined → factuur", getVatScheme(undefined) === "factuur");
  check("garbage → factuur", getVatScheme("xyz") === "factuur");
  check("isVatScheme guards", isVatScheme("kas") && isVatScheme("factuur") && !isVatScheme("x"));
}

console.log("\n— resolveSchemeForQuarter: factuur owner is always accrual —");
{
  check("factuur owner, any quarter → factuur", resolveSchemeForQuarter("factuur", "2026-01-01", "2026-04-01") === "factuur");
  check("factuur owner ignores since entirely", resolveSchemeForQuarter("factuur", null, "2026-01-01") === "factuur");
}

console.log("\n— resolveSchemeForQuarter: kas with an effective date (per-quarter) —");
{
  // Owner switched to kas from 2026-07-01 (Q3). Q1/Q2 stay factuur; Q3+ are kas.
  const since = "2026-07-01";
  check("Q1 (before since) → factuur (filed quarter not rewritten)", resolveSchemeForQuarter("kas", since, "2026-01-01") === "factuur");
  check("Q2 (before since) → factuur", resolveSchemeForQuarter("kas", since, "2026-04-01") === "factuur");
  check("Q3 (== since) → kas", resolveSchemeForQuarter("kas", since, "2026-07-01") === "kas");
  check("Q4 (after since) → kas", resolveSchemeForQuarter("kas", since, "2026-10-01") === "kas");
}

console.log("\n— resolveSchemeForQuarter: kas with no since applies throughout —");
{
  check("kas, no since, old quarter → kas", resolveSchemeForQuarter("kas", null, "2025-01-01") === "kas");
  check("kas, empty since → kas", resolveSchemeForQuarter("kas", undefined, "2026-01-01") === "kas");
}

console.log("\n— since with a time component is handled (sliced to date) —");
{
  check("since '2026-07-01T00:00:00' still gates on the date", resolveSchemeForQuarter("kas", "2026-07-01T00:00:00Z", "2026-04-01") === "factuur");
}

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
