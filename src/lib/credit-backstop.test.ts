// [CREDIT-BACKSTOP] Pure node test — run: npx tsx src/lib/credit-backstop.test.ts
// Locks the fix for the expondo "Factuurcorrectie — Full return" case: a document with a
// negative printed total is treated as a creditnota so its amount is KEPT (not dropped to
// €0 by the positive-only num() filter). A normal positive invoice is never mis-flagged.
import { shouldTreatAsCreditNote } from "./ai";

let passed = 0, failed = 0;
function check(name: string, cond: boolean) {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name}`); }
}

console.log("\n— a negative total is treated as a creditnota even when untagged —");
check("expondo Full return: incl -1123.14, untagged → credit", shouldTreatAsCreditNote(false, -1123.14, -1123.14) === true);
check("negative ex only → credit", shouldTreatAsCreditNote(undefined, null, -50) === true);
check("already tagged credit stays credit", shouldTreatAsCreditNote(true, -4.84, -4.00) === true);

console.log("\n— a normal positive invoice is NOT mis-flagged —");
check("positive incl → not credit", shouldTreatAsCreditNote(false, 1210, 1000) === false);
// [HUNT-F2] a positive printed total wins even if ex was mis-read negative (discount line).
check("positive incl + negative ex (misread) → NOT credit", shouldTreatAsCreditNote(false, 11, -10) === false);
check("zero total, untagged → not credit", shouldTreatAsCreditNote(false, 0, 0) === false);
check("missing amounts, untagged → not credit", shouldTreatAsCreditNote(false, null, null) === false);
check("NaN/Infinity are ignored (not treated as negative)", shouldTreatAsCreditNote(false, Infinity, NaN) === false);

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
