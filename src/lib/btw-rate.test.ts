// [HUNT-A/B] Pure node test — run: npx tsx src/lib/btw-rate.test.ts
// Locks the blended-rate snap: a mixed 9%+0%-statiegeld invoice reads as 9% (rubriek 1b),
// not a bogus 8% (which fell through to rubriek 1c), while clean invoices are untouched.
import { nearestLegalRate } from "./btw-rate";

let passed = 0, failed = 0;
function check(name: string, cond: boolean) {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name}`); }
}

console.log("\n— clean legal rates are unchanged —");
check("21 → 21", nearestLegalRate(21) === 21);
check("9 → 9", nearestLegalRate(9) === 9);
check("0 → 0", nearestLegalRate(0) === 0);

console.log("\n— blended statiegeld rates snap to the true legal rate —");
check("8 (9%+statiegeld) → 9", nearestLegalRate(8) === 9);   // Elegance: 199.74/2364.90
check("19 (21%+statiegeld) → 21", nearestLegalRate(19) === 21);
check("7 → 9", nearestLegalRate(7) === 9);
check("15 → 21", nearestLegalRate(15) === 21);

console.log("\n— ties bias UP (folding 0% only lowers the blend, true rate is higher) —");
check("4.5 → 9 (not 0)", nearestLegalRate(4.5) === 9);
check("15 → 21 (tie 9/21)", nearestLegalRate(15) === 21);

console.log("\n— degenerate inputs are safe —");
check("NaN → 0", nearestLegalRate(NaN) === 0);
check("negative → 0", nearestLegalRate(-5) === 0);
check("above 21 → 21", nearestLegalRate(30) === 21);

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
