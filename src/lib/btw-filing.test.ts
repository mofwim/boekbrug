// [TRUTH-FILED] Pure test for btw-filing.ts — run: npx tsx src/lib/btw-filing.test.ts
import { computeFilingDivergence, SUPPLETIE_THRESHOLD, type FilingFigures } from "./btw-filing";

let passed = 0, failed = 0;
function check(name: string, cond: boolean) {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name}`); }
}

const base: FilingFigures = { omzet: 10000, kosten: 4000, btwVerschuldigd: 2100, btwVoorbelasting: 840, btwSaldo: 1260 };

console.log("— no change → not flagged —");
{
  const d = computeFilingDivergence(base, { ...base });
  check("changed is false when identical", d.changed === false);
  check("no suppletie", d.needsSuppletie === false);
  check("all deltas zero", d.btwSaldoDelta === 0 && d.omzetDelta === 0);
}

console.log("— rounding noise is ignored —");
{
  const d = computeFilingDivergence(base, { ...base, btwSaldo: base.btwSaldo + 0.004 });
  check("a sub-cent move is NOT a change", d.changed === false);
}

console.log("— small change (≤ €1.000) → change, no suppletie —");
{
  // A €200 late purchase invoice: voorbelasting +42, saldo −42.
  const current = { ...base, kosten: 4200, btwVoorbelasting: 882, btwSaldo: 1218 };
  const d = computeFilingDivergence(base, current);
  check("changed is true", d.changed === true);
  check("btwSaldoDelta = −42", d.btwSaldoDelta === -42);
  check("voorbelasting delta = +42", d.btwVoorbelastingDelta === 42);
  check("kosten delta = +200", d.kostenDelta === 200);
  check("NOT a suppletie (≤ €1.000)", d.needsSuppletie === false);
}

console.log("— large change (> €1.000) → suppletie required —");
{
  // A forgotten €6.000 sales invoice surfaces after filing: verschuldigd +1260, saldo +1260.
  const current = { ...base, omzet: 16000, btwVerschuldigd: 3360, btwSaldo: 2520 };
  const d = computeFilingDivergence(base, current);
  check("changed is true", d.changed === true);
  check("btwSaldoDelta = +1260", d.btwSaldoDelta === 1260);
  check("needsSuppletie true (> €1.000)", d.needsSuppletie === true);
}

console.log("— exactly at the threshold is NOT a suppletie (rule is 'more than') —");
{
  const current = { ...base, btwSaldo: base.btwSaldo + SUPPLETIE_THRESHOLD };
  const d = computeFilingDivergence(base, current);
  check("delta = 1000", d.btwSaldoDelta === 1000);
  check("exactly €1.000 → no suppletie", d.needsSuppletie === false);
  const over = computeFilingDivergence(base, { ...base, btwSaldo: base.btwSaldo + 1000.01 });
  check("€1.000,01 → suppletie", over.needsSuppletie === true);
}

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
