// [BTW-SUM-FIX] Pure node test — run: npx tsx src/lib/btw-sum-fix.test.ts
// Locks the Enka Horeca case: a mixed-rate summary block (9% and 21% rows, each with its own
// grondslag on the left and its own BTW on the right) was mis-summed into btw = 995,90 over a
// printed excl of 3.413,92 and a printed total of 3.819,82 — a 29% rate, impossible in NL, so
// the invoice sat held with "excl + BTW ≠ totaal; ongeldig BTW-tarief (29%)" and no way forward.
// The two printed anchors differ by exactly the true BTW (405,90 = 233,20 + 172,70), a legal 12%
// blend — so the mis-summed figure is the one that gets replaced, and only when it is provably
// impossible while the replacement is provably plausible.
import { fixMisSummedBtw } from "./ai";

let passed = 0, failed = 0;
function check(name: string, cond: boolean) {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name}`); }
}
const near = (a: number | undefined, b: number) => a !== undefined && Math.abs(a - b) < 0.01;

console.log("\n— Enka Horeca: a mis-summed mixed-rate BTW is recovered from the printed anchors —");
{
  const r = fixMisSummedBtw(3413.92, 995.90, 3819.82);
  check("btw 995,90 (29%) → 405,90", near(r.btw, 405.90));
  check("reported as derived", r.derived === true);
  check("the identity holds again", near((r.btw ?? 0) + 3413.92, 3819.82));
  check("the recovered rate is a legal blend (12%)", Math.round(((r.btw ?? 0) / 3413.92) * 100) === 12);
}

console.log("\n— it only fires on a PROVABLY impossible stated BTW —");
{
  // The reader missed the 9% row entirely: btw = 172,70 → 5%, a perfectly legal rate. The sum is
  // wrong, but we cannot tell whether the BTW, the excl or the total is the bad number — so we
  // must NOT guess. SAFECORE keeps holding it and the human decides.
  const missedRow = fixMisSummedBtw(3413.92, 172.70, 3819.82);
  check("plausible-but-inconsistent BTW is left alone", near(missedRow.btw, 172.70) && missedRow.derived === false);
  // A wrong EXCL (not a wrong BTW) makes the stated rate impossible too — but then the difference
  // between the anchors is impossible as well (282%), so the repair correctly refuses.
  const wrongEx = fixMisSummedBtw(1000, 405.90, 3819.82);
  check("a wrong excl is not 'repaired' into a fabricated BTW", near(wrongEx.btw, 405.90) && wrongEx.derived === false);
}

console.log("\n— a consistent invoice is never touched —");
{
  check("correct 3413.92/405.90/3819.82 unchanged", fixMisSummedBtw(3413.92, 405.90, 3819.82).derived === false);
  check("plain 100/21/121 unchanged", fixMisSummedBtw(100, 21, 121).derived === false);
  check("a legit 0%-BTW invoice unchanged", fixMisSummedBtw(403, 0, 403).derived === false);
  // Within the 0.02 rounding tolerance the gate already allows — not a contradiction.
  check("cent-level rounding drift is not a contradiction", fixMisSummedBtw(100, 21, 121.01).derived === false);
}

console.log("\n— structural guards —");
{
  check("missing values pass through", fixMisSummedBtw(undefined, 995.90, 3819.82).derived === false);
  check("NaN passes through", fixMisSummedBtw(NaN, 995.90, 3819.82).derived === false);
  check("a ~zero base gives no rate to reason about", fixMisSummedBtw(0, 500, 3819.82).derived === false);
  // A BTW that would run against its own base is a different document, not a bad sum.
  check("a sign-flipped derivation is refused", fixMisSummedBtw(1000, 500, 900).derived === false);
}

console.log("\n— the derived figure is rounded to the cent (dedup keys compare exact totals) —");
{
  const r = fixMisSummedBtw(33.33, 20, 37.036666666);
  check("derived BTW has at most 2 decimals", r.derived === true && Math.round((r.btw ?? 0) * 100) === (r.btw ?? 0) * 100);
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
