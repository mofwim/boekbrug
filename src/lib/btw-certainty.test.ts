// [BTW-CERTAINTY] Pure test — run: npx tsx src/lib/btw-certainty.test.ts
import { assessBtwCertainty } from "./btw-certainty";

let passed = 0, failed = 0;
function check(name: string, cond: boolean) {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name}`); }
}
const near = (a: number, b: number) => Math.abs(a - b) < 0.02;

console.log("— every euro rated → the figure stands on its own —");
{
  const r = assessBtwCertainty({ btwSaldo: 1260, omzet: 10000, cashOmzetZonderBtw: 0 });
  check("level exact", r.level === "exact");
  check("nothing unrated", r.unrated === 0 && r.unratedShare === 0);
  check("no missing BTW", r.minMissingBtw === 0);
}

console.log("\n— a cent of rounding noise is not an omission —");
{
  const r = assessBtwCertainty({ btwSaldo: 1260, omzet: 10000, cashOmzetZonderBtw: 0.004 });
  check("still exact", r.level === "exact");
}

console.log("\n— THE REAL ACCOUNT: all revenue unrated, saldo shown as a refund —");
{
  // The screenshot that prompted this: omzet € 44.255,02, none of it rated, voorbelasting
  // € 2.779,58, so the screen said "BTW terug te ontvangen € 2.779,58".
  const r = assessBtwCertainty({ btwSaldo: -2779.58, omzet: 44255.02, cashOmzetZonderBtw: 44255.02 });
  check("level sign-could-flip", r.level === "sign-could-flip");
  check("share is 100%", near(r.unratedShare, 1));
  // 44255.02 × 9/109 = 3654.08 — already more than the €2.779,58 'refund', at the LOWEST rate.
  check("min missing BTW ≈ € 3.654,08", near(r.minMissingBtw, 3654.08));
  check("…which exceeds the refund, hence the flip", r.minMissingBtw > 2779.58);
}

console.log("\n— a refund that survives the worst case stays a refund —");
{
  // €500 unrated → at 9% that hides at most €41,28. A €5.000 refund is not in danger.
  const r = assessBtwCertainty({ btwSaldo: -5000, omzet: 80000, cashOmzetZonderBtw: 500 });
  check("level incomplete, not sign-could-flip", r.level === "incomplete");
  check("min missing BTW ≈ € 41,28", near(r.minMissingBtw, 41.28));
}

console.log("\n— exactly at the boundary —");
{
  // Pick an unrated amount whose 9% content is exactly the refund: x × 9/109 = 100 → x = 1211.11
  const r = assessBtwCertainty({ btwSaldo: -100, omzet: 5000, cashOmzetZonderBtw: 1211.11 });
  check("covering the refund exactly still flips (>=)", r.level === "sign-could-flip");
  const under = assessBtwCertainty({ btwSaldo: -100, omzet: 5000, cashOmzetZonderBtw: 1200 });
  check("just under does not", under.level === "incomplete");
}

console.log("\n— when you already OWE, unrated revenue only makes you owe more —");
{
  // A positive saldo cannot flip sign by adding BTW owed, so it is 'incomplete', never a flip.
  const r = assessBtwCertainty({ btwSaldo: 2100, omzet: 10000, cashOmzetZonderBtw: 10000 });
  check("level incomplete", r.level === "incomplete");
  check("but the gap is still reported", r.minMissingBtw > 0 && near(r.unratedShare, 1));
}

console.log("\n— degenerate inputs never throw or divide by zero —");
{
  const noOmzet = assessBtwCertainty({ btwSaldo: 0, omzet: 0, cashOmzetZonderBtw: 0 });
  check("no omzet at all → exact, share 0", noOmzet.level === "exact" && noOmzet.unratedShare === 0);
  // Unrated revenue with a zero omzet total should not produce Infinity/NaN.
  const weird = assessBtwCertainty({ btwSaldo: -10, omzet: 0, cashOmzetZonderBtw: 100 });
  check("unrated but omzet 0 → share is 0, not NaN", weird.unratedShare === 0);
  // €100 gross hides at most €8,26 at 9% — less than the €10 refund, so the refund survives the
  // worst case and this is 'incomplete'. The share being unknown never forces the stronger verdict:
  // the flip test is about EUROS, not about proportion.
  check("…and it is flagged, but only as incomplete", weird.level === "incomplete");
  check("…while still reporting the gap", weird.minMissingBtw > 0);
  // A negative cashOmzetZonderBtw (refund-heavy period) is clamped, never a negative bound.
  const neg = assessBtwCertainty({ btwSaldo: 500, omzet: 1000, cashOmzetZonderBtw: -50 });
  check("negative unrated is clamped to 0 → exact", neg.level === "exact" && neg.unrated === 0);
  // NaN in must not become NaN out.
  const nan = assessBtwCertainty({ btwSaldo: NaN, omzet: NaN, cashOmzetZonderBtw: NaN });
  check("NaN in → exact, all zeros out", nan.level === "exact" && nan.minMissingBtw === 0);
}

console.log("\n— the share is capped at 1 even if unrated exceeds omzet —");
{
  // Possible when refunds pull omzet down while the unrated nudge only counts positives.
  const r = assessBtwCertainty({ btwSaldo: 10, omzet: 100, cashOmzetZonderBtw: 500 });
  check("share never exceeds 100%", r.unratedShare === 1);
}

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
