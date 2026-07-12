// [CASH-LEDGER] Pure node test — run: npx tsx src/lib/cash.test.ts
import { computeCashBalance, isCashCategory } from "./cash";

let passed = 0;
let failed = 0;
function check(name: string, cond: boolean) {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name}`); }
}

console.log("\n— computeCashBalance —");
check("empty ledger → 0", computeCashBalance([]) === 0);
check("in adds, out subtracts",
  computeCashBalance([
    { direction: "in", amount: 100 },   // cash sale
    { direction: "out", amount: 30 },    // cash expense
    { direction: "out", amount: 50 },    // storting (deposit to bank)
  ]) === 20);
check("withdrawal (opname) raises the drawer",
  computeCashBalance([
    { direction: "in", amount: 200 },    // opname from bank
    { direction: "out", amount: 75 },
  ]) === 125);
check("null amount treated as 0",
  computeCashBalance([{ direction: "in", amount: null }, { direction: "in", amount: 40 }]) === 40);
check("can go negative (over-recorded expenses surface a real error)",
  computeCashBalance([{ direction: "out", amount: 10 }]) === -10);

console.log("\n— isCashCategory —");
check("accepts a real category", isCashCategory("omzet") && isCashCategory("transfer"));
check("rejects junk", !isCashCategory("pos_income") && !isCashCategory("x") && !isCashCategory(null));

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
