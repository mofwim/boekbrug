// [BTW-ROUND] Pure node test — run: npx tsx src/lib/invoice-totals.test.ts
// The case that matters is the mixed-rate invoice: it is exactly where the old per-line rounding
// drifted a cent away from the PDF and the UBL export the same invoice ships.
import { computeInvoiceTotals, isValidBtwRate, round2, BTW_RATES } from "./invoice-totals";

let passed = 0, failed = 0;
function check(name: string, cond: boolean, detail = "") {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`); }
}
const near = (a: number, b: number) => Math.abs(a - b) < 0.0001;

console.log("\n— single rate: the simple case must not change —");
{
  const t = computeInvoiceTotals([{ line_total: 100, btw_rate: 21 }]);
  check("100 @21% → 100 / 21 / 121", near(t.total_ex_btw, 100) && near(t.btw_amount, 21) && near(t.total_inc_btw, 121));
}
{
  const t = computeInvoiceTotals([{ quantity: 3, unit_price: 25, btw_rate: 9 }]);
  check("falls back to quantity × unit_price", near(t.total_ex_btw, 75) && near(t.btw_amount, 6.75));
}
{
  const t = computeInvoiceTotals([{ line_total: 500, btw_rate: 0 }]);
  check("0% → no BTW, incl == excl", near(t.btw_amount, 0) && near(t.total_inc_btw, 500));
}

console.log("\n— mixed rates: rounded PER RATE, matching the PDF and the UBL export —");
{
  const lines = [
    { line_total: 33.33, btw_rate: 21 }, { line_total: 33.33, btw_rate: 21 },
    { line_total: 33.33, btw_rate: 21 }, { line_total: 12.15, btw_rate: 9 },
    { line_total: 12.15, btw_rate: 9 },  { line_total: 7.77,  btw_rate: 9 },
  ];
  const t = computeInvoiceTotals(lines);
  // per rate: 99.99 @21 → 21.00 (round2(20.9979)) ; 32.07 @9 → 2.89 (round2(2.8863)) ⇒ 23.89
  check("mixed-rate BTW is 23.89", near(t.btw_amount, 23.89), `got ${t.btw_amount}`);
  // The OLD per-line-then-round-once method — the one the send route calls "the old way".
  const perLine = round2(lines.reduce((s, l) => s + (l.line_total * l.btw_rate) / 100, 0));
  check("…and the old per-line method really differed (23.88)", near(perLine, 23.88) && !near(perLine, t.btw_amount),
    `old=${perLine} new=${t.btw_amount}`);
  check("incl == excl + btw, to the cent", near(t.total_inc_btw, round2(t.total_ex_btw + t.btw_amount)));
}

console.log("\n— creditnota: the sign is preserved, never flipped —");
{
  const t = computeInvoiceTotals([{ line_total: -100, btw_rate: 21 }]);
  check("negative lines → negative totals", near(t.total_ex_btw, -100) && near(t.btw_amount, -21) && near(t.total_inc_btw, -121));
}

console.log("\n— edges —");
check("no lines → zeros (the caller decides if that is allowed)",
  (() => { const t = computeInvoiceTotals([]); return t.total_ex_btw === 0 && t.btw_amount === 0 && t.total_inc_btw === 0; })());
check("a missing rate counts as 0%", near(computeInvoiceTotals([{ line_total: 50 }]).btw_amount, 0));

console.log("\n— rate validation: only what a Dutch invoice may carry —");
check("0 / 9 / 21 are valid", BTW_RATES.every(isValidBtwRate));
check("13.5 is not", !isValidBtwRate(13.5));
check("6 (a rate that no longer exists) is not", !isValidBtwRate(6));
check("a string of a valid rate still passes (form input)", isValidBtwRate("21"));
check("null / undefined / junk are not", !isValidBtwRate(null) && !isValidBtwRate(undefined) && !isValidBtwRate("abc"));

// [TARIEF-STRIKT] The header of isValidBtwRate names three values that must not pass — null,
// undefined and "" — and the guard named exactly those. That is one short of the problem: Number()
// turns " ", [] and false into 0 as well, and 0 is a REAL rate (vrijgesteld/verlegd). All three
// were accepted as a legal 0% tarief by the very function written to prevent that.
check("a blank string is not a rate", !isValidBtwRate(" ") && !isValidBtwRate("\t"));
check("an empty array is not a rate", !isValidBtwRate([]));
check("a boolean is not a rate", !isValidBtwRate(false) && !isValidBtwRate(true));
check("an object is not a rate", !isValidBtwRate({}) && !isValidBtwRate({ btw_rate: 21 }));
// …and the forms that ARE a rate still are. A form field hands over the TEXT of a number.
check("a number is a rate", isValidBtwRate(21) && isValidBtwRate(9) && isValidBtwRate(0));
check("the text of a number is a rate", isValidBtwRate("21") && isValidBtwRate("9") && isValidBtwRate("0"));

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
