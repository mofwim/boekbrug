// [ASSURANTIE] Pure node test — run: npx tsx src/lib/assurantiebelasting.test.ts
//
// Validated against a real customer document: Univé "Overzicht van uw verzekeringen" for Kiwi
// Food Market (Detailhandel), premium € 236,29 "Inclusief € 41,01 assurantiebelasting".
import { stripAssurantiebelastingBtw } from "./ai";

let passed = 0, failed = 0;
function check(name: string, cond: boolean) {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name}`); }
}
const near = (a: number | undefined, b: number) => a !== undefined && Math.abs(a - b) < 0.005;

console.log("\n— the real Univé premium —");
{
  // The reader saw the € 41,01 as if it were BTW and split the € 236,29 accordingly.
  const r = stripAssurantiebelastingBtw(
    "Inclusief € 41,01 assurantiebelasting", 195.28, 41.01, 236.29,
  );
  check("it fires on this document", r.corrected === true);
  check("the deductible BTW becomes 0 — the € 41,01 is not voorbelasting", near(r.btw, 0));
  check("the whole paid amount folds into the cost base", near(r.ex, 236.29));
}

console.log("\n— the spelling variations a layout can produce —");
{
  check("a space between the words still matches", stripAssurantiebelastingBtw("Inclusief assurantie belasting", 100, 21, 121).corrected === true);
  check("casing does not matter", stripAssurantiebelastingBtw("ASSURANTIEBELASTING", 100, 21, 121).corrected === true);
  check("a non-breaking space still matches", stripAssurantiebelastingBtw("assurantie belasting", 100, 21, 121).corrected === true);
}

console.log("\n— what it must NOT touch —");
{
  const normal = stripAssurantiebelastingBtw("Levering van goederen, 21% BTW", 100, 21, 121);
  check("an ordinary invoice with real BTW is untouched", normal.corrected === false && near(normal.btw, 21) && near(normal.ex, 100));

  const noText = stripAssurantiebelastingBtw(null, 100, 21, 121);
  check("no text → passthrough, never a guess", noText.corrected === false && near(noText.btw, 21));

  // An insurance receipt the reader already booked at 0 BTW is correct as it stands.
  const alreadyZero = stripAssurantiebelastingBtw("Inclusief € 41,01 assurantiebelasting", 236.29, 0, 236.29);
  check("a 0-BTW insurance document is left alone — nothing to remove", alreadyZero.corrected === false);

  const tinyBtw = stripAssurantiebelastingBtw("assurantiebelasting", 236.29, 0.004, 236.29);
  check("a rounding-noise BTW is treated as zero", tinyBtw.corrected === false);
}

console.log("\n— the incl fallback —");
{
  // incl not read: fold ex + btw so the cost base is still the full amount.
  const noIncl = stripAssurantiebelastingBtw("assurantiebelasting", 195.28, 41.01, undefined);
  check("without incl, ex+btw becomes the cost base", noIncl.corrected === true && near(noIncl.ex, 236.29) && near(noIncl.btw, 0));

  // Neither incl nor ex: still zero the BTW, leave ex as-is (nothing to fold into).
  const bare = stripAssurantiebelastingBtw("assurantiebelasting", undefined, 41.01, undefined);
  check("with no base at all, the BTW is still removed from the deductible column", bare.corrected === true && near(bare.btw, 0) && bare.ex === undefined);
}

console.log("\n— asymmetry: it errs toward NOT claiming, and always flags —");
{
  // A hypothetical broker invoice that mixes real service BTW with IPT: the guard still zeroes,
  // but corrected=true means a human sees it and can restore the real part. Under-claiming is
  // recoverable; over-claiming IPT is a naheffing.
  const mixed = stripAssurantiebelastingBtw("Bemiddeling 21% BTW € 21,00 — assurantiebelasting € 41,01", 100, 62.01, 162.01);
  check("a mixed document is zeroed AND flagged for the human, never silently booked", mixed.corrected === true && near(mixed.btw, 0));
}

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
