// [QUARTER] Pure node test — run: npx tsx src/lib/quarter.test.ts
import { lastCompletedQuarter, quarterFromParams, quarterKeyOf, quarterLabelOf, quartersPresent, matchesQuarter } from "./quarter";

let passed = 0, failed = 0;
function check(name: string, cond: boolean) {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name}`); }
}
const at = (iso: string) => new Date(`${iso}T12:00:00Z`);

console.log("\n— lastCompletedQuarter —");
check("mid-Q3 (Jul) → Q2 same year", JSON.stringify(lastCompletedQuarter(at("2026-07-13"))) === JSON.stringify({ year: 2026, quarter: 2 }));
check("mid-Q1 (Feb) → Q4 previous year", JSON.stringify(lastCompletedQuarter(at("2026-02-10"))) === JSON.stringify({ year: 2025, quarter: 4 }));
check("start of Q1 (1 Jan) → Q4 previous year", JSON.stringify(lastCompletedQuarter(at("2026-01-01"))) === JSON.stringify({ year: 2025, quarter: 4 }));
check("Q4 (Nov) → Q3 same year", JSON.stringify(lastCompletedQuarter(at("2026-11-20"))) === JSON.stringify({ year: 2026, quarter: 3 }));

console.log("\n— quarterFromParams: valid params win —");
{
  const params = new Map([["year", "2026"], ["quarter", "1"]]);
  const yq = quarterFromParams((k) => params.get(k) ?? null, at("2026-07-13"));
  check("explicit year/quarter honoured", yq.year === 2026 && yq.quarter === 1);
}

console.log("\n— quarterFromParams: missing/invalid → last completed —");
{
  const empty = quarterFromParams(() => null, at("2026-07-13"));
  check("no params → last completed (Q2 2026)", empty.year === 2026 && empty.quarter === 2);
  const bad = new Map([["year", "1999"], ["quarter", "9"]]);
  const yq = quarterFromParams((k) => bad.get(k) ?? null, at("2026-07-13"));
  check("out-of-range → last completed, never the absurd value", yq.year === 2026 && yq.quarter === 2);
}

console.log("\n— [BANK-QUARTER] quarterKeyOf / label / present / matches —");
{
  check("Jan → Q1", quarterKeyOf("2026-01-15") === "2026-Q1");
  check("Jun → Q2", quarterKeyOf("2026-06-20") === "2026-Q2");
  check("Jul → Q3", quarterKeyOf("2026-07-01") === "2026-Q3");
  check("Dec → Q4", quarterKeyOf("2026-12-31") === "2026-Q4");
  check("null → null", quarterKeyOf(null) === null);
  check("unparseable → null", quarterKeyOf("nonsense") === null);
  check("invalid month → null", quarterKeyOf("2026-13-01") === null);

  check("label 2026-Q2 → 'Q2 2026'", quarterLabelOf("2026-Q2") === "Q2 2026");

  const present = quartersPresent(["2026-06-20", "2026-06-21", "2026-02-10", null, "2025-11-01"]);
  check("distinct quarters, newest first", present.map((p) => p.key).join(",") === "2026-Q2,2026-Q1,2025-Q4");
  check("counts per quarter", present[0].count === 2 && present[1].count === 1);
  check("null dates excluded from the quarter list", !present.some((p) => p.key === null as unknown));

  check("'all' matches everything", matchesQuarter("2026-02-10", "all") === true);
  check("a Q2 payment matches Q2", matchesQuarter("2026-06-20", "2026-Q2") === true);
  check("a Q1 payment does NOT match Q2", matchesQuarter("2026-02-10", "2026-Q2") === false);
  check("a dateless row is fail-safe visible in any quarter", matchesQuarter(null, "2026-Q2") === true);
}

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
