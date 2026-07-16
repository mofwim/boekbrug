// [BANK-BATCH-RECONCILE] Pure node test — run: npx tsx src/lib/bank-batch-reconcile.test.ts
import { reconcileBatch, type BatchSlotInput } from "./bank-batch-reconcile";

let passed = 0, failed = 0;
function check(name: string, cond: boolean) {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name}`); }
}
const slot = (refNum: string, amount: number | null, isConfirmed = false): BatchSlotInput =>
  ({ refNum, amount, isConfirmed });

console.log("\n— the real M.H. BAL case: 3 invoices sum to the debit —");
{
  // −€2.902,60 debit; three matched invoices that add up exactly.
  const r = reconcileBatch(
    [slot("262627", 900.00), slot("262744", 1002.60), slot("262762", 1000.00)],
    -2902.60,
  );
  check("status = ties", r.status === "ties");
  check("allMatched", r.allMatched === true);
  check("matchedCount = 3", r.matchedCount === 3);
  check("total = 2902.60", Math.abs(r.total - 2902.60) < 0.005);
  check("bankAmount is the magnitude of the debit", r.bankAmount === 2902.60);
  check("diff ≈ 0", Math.abs(r.diff) < 0.005);
}

console.log("\n— a batch that does NOT add up is a mismatch, never a false tie —");
{
  // Two invoices found, both matched, but they sum to 1900 ≠ 2902.60 debit.
  const r = reconcileBatch([slot("A", 900), slot("B", 1000)], -1900.01);
  check("status = mismatch (sum 1900 vs 1900.01)", r.status === "mismatch");
  check("allMatched true (both have amounts)", r.allMatched === true);
  check("diff is reported (−0.01)", Math.abs(r.diff - -0.01) < 0.005);
}

console.log("\n— a missing invoice ⇒ incomplete, sum is not asserted —");
{
  // Third number has no invoice in the system yet (amount null) → cannot claim a tie
  // even though the two known amounts happen to sit under the debit.
  const r = reconcileBatch(
    [slot("262627", 900), slot("262744", 1002.60), slot("262762", null)],
    -2902.60,
  );
  check("status = incomplete", r.status === "incomplete");
  check("allMatched = false", r.allMatched === false);
  check("matchedCount = 2 of 3", r.matchedCount === 2 && r.slotCount === 3);
}

console.log("\n— a lone matched slot equal to the debit still ties —");
{
  const r = reconcileBatch([slot("VHF1", 83.70)], -83.70);
  check("single slot, exact → ties", r.status === "ties");
  check("matchedCount = 1", r.matchedCount === 1);
}

console.log("\n— cent precision: float sums do not spuriously break a real tie —");
{
  // 0.10 + 0.20 + 0.30 in float ≠ 0.60 exactly; cent rounding must still tie.
  const r = reconcileBatch([slot("a", 0.10), slot("b", 0.20), slot("c", 0.30)], -0.60);
  check("float-safe cents tie", r.status === "ties");
}

console.log("\n— sign independence: a positive (credit) batch reconciles too —");
{
  const r = reconcileBatch([slot("x", 500), slot("y", 250)], 750);
  check("credit +750 ties against 500+250", r.status === "ties");
  check("bankAmount = 750", r.bankAmount === 750);
}

console.log("\n— a corrupt (non-finite) amount is treated as unmatched, not a tie —");
{
  const r = reconcileBatch([slot("a", 900), slot("b", Number.NaN)], -900);
  check("NaN slot ⇒ incomplete (never silently equal)", r.status === "incomplete");
  check("matchedCount counts only the finite one", r.matchedCount === 1);
}

console.log("\n— anyConfirmed reflects slot state —");
{
  const r = reconcileBatch([slot("a", 900, true), slot("b", 1000)], -1900);
  check("anyConfirmed = true when a slot is paid", r.anyConfirmed === true);
  check("still ties (900+1000=1900)", r.status === "ties");
}

console.log("\n— an empty slot list is incomplete, not a tie —");
{
  const r = reconcileBatch([], -100);
  check("no slots ⇒ incomplete", r.status === "incomplete");
  check("allMatched = false on empty", r.allMatched === false);
}

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
