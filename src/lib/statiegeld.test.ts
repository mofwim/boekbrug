// [STATIEGELD] Pure node test — run: npx tsx src/lib/statiegeld.test.ts
// Locks the reconciliation for deposit (statiegeld/emballage) invoices. The fix is that the
// extractor returns total_ex_btw INCLUSIVE of the 0%-BTW statiegeld base, so
// total_ex_btw + btw_amount = total_inc_btw holds and the arithmetic gate stops raising a
// false "excl + BTW ≠ totaal" on a perfectly correct drinks-wholesale invoice.
import { evaluateArithmetic } from "./safecore";

let passed = 0, failed = 0;
function check(name: string, cond: boolean) {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name}`); }
}

// Real Elegance Brands invoice: goods 2219.10 @ 9% (BTW 199.74) + statiegeld 145.80 @ 0%,
// printed total 2564.64.
console.log("\n— a statiegeld invoice reconciles when ex INCLUDES the 0% deposit base —");
{
  const v = evaluateArithmetic({ totalExBtw: 2364.90, btwAmount: 199.74, totalIncBtw: 2564.64 });
  check("no arithmetic flag (2364.90 + 199.74 = 2564.64)", v.ok === true);
}

console.log("\n— the OLD goods-only ex was the bug: it trips the sum check —");
{
  const v = evaluateArithmetic({ totalExBtw: 2219.10, btwAmount: 199.74, totalIncBtw: 2564.64 });
  check("goods-only ex → sum_mismatch (this is what the fix removes)", v.ok === false && (v.flags ?? []).includes("sum_mismatch"));
}

console.log("\n— a genuine mismatch (not explained by a deposit) still flags —");
{
  // total is LESS than ex+btw — a real inconsistency, must never be masked.
  const v = evaluateArithmetic({ totalExBtw: 1000, btwAmount: 210, totalIncBtw: 900 });
  check("total below ex+BTW still flags", v.ok === false && (v.flags ?? []).includes("sum_mismatch"));
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
