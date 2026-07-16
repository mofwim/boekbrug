// [EX-INCL-FIX] Pure node test — run: npx tsx src/lib/ex-incl-fix.test.ts
// Locks the Art Electronics case: a supplier mislabelled the gross total as "Subtotaal", so
// extraction got ex == incl (403) with a real BTW (69.94) — impossible. The reader recovers
// the true base ex = incl − btw = 333.06, and the excl + BTW = totaal identity holds again.
import { fixExInclConfusion } from "./ai";

let passed = 0, failed = 0;
function check(name: string, cond: boolean) {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name}`); }
}
const near = (a: number | undefined, b: number) => a !== undefined && Math.abs(a - b) < 0.01;

console.log("\n— Art Electronics: ex==incl with real BTW → base recovered —");
check("ex 403 == incl 403, btw 69.94 → ex 333.06", near(fixExInclConfusion(403.00, 69.94, 403.00), 333.06));
check("recovered ex + btw = incl", near((fixExInclConfusion(403.00, 69.94, 403.00) ?? 0) + 69.94, 403.00));

console.log("\n— sign-safe on a creditnota (all negative) —");
check("ex -403 == incl -403, btw -69.94 → ex -333.06", near(fixExInclConfusion(-403.00, -69.94, -403.00), -333.06));

console.log("\n— never touches a correct or genuinely-different invoice —");
check("already correct (333.06/69.94/403) is unchanged", near(fixExInclConfusion(333.06, 69.94, 403.00), 333.06));
check("zero BTW + ex==incl is left alone (a legit 0% invoice)", near(fixExInclConfusion(403.00, 0, 403.00), 403.00));
check("a real ex≠incl mismatch is NOT rewritten", near(fixExInclConfusion(300, 69.94, 403.00), 300));
check("missing values are passed through", fixExInclConfusion(undefined, 69.94, 403.00) === undefined);

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
