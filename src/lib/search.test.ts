// [SMART-FILTER] Pure node test — run: npx tsx src/lib/search.test.ts
// Covers the shared in-page filter matchers: accent-fold, decimal/thousands
// amount matching (the "670,09" bug that broke past the comma), and the
// PostgREST OR-fragment builder for server-backed amount search.
import {
  foldText,
  isAmountQuery,
  amountMatchesQuery,
  rowMatchesQuery,
  amountOrConditions,
} from "./search";

let passed = 0, failed = 0;
function check(name: string, cond: boolean) {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name}`); }
}

console.log("\n— foldText —");
check("lowercases + strips diacritics", foldText("Café São") === "cafe sao");
check("null-safe", foldText(null) === "" && foldText(undefined) === "");

console.log("\n— isAmountQuery —");
check("plain digits", isAmountQuery("670") === true);
check("nl decimal", isAmountQuery("670,09") === true);
check("euro + spaces", isAmountQuery("€ 1.500,00") === true);
check("letters → not amount", isAmountQuery("factuur 2") === false);
check("empty → not amount", isAmountQuery("  ") === false);

console.log("\n— amountMatchesQuery (the reported bug: 670,09) —");
check("whole euro '670'", amountMatchesQuery(670.09, "670") === true);
check("trailing comma '670,'", amountMatchesQuery(670.09, "670,") === true);
check("past the comma, dot '670.0'", amountMatchesQuery(670.09, "670.0") === true);
check("past the comma, comma '670,0'", amountMatchesQuery(670.09, "670,0") === true);
check("full decimal '670,09'", amountMatchesQuery(670.09, "670,09") === true);
check("full decimal dot '670.09'", amountMatchesQuery(670.09, "670.09") === true);
check("no false positive '700'", amountMatchesQuery(670.09, "700") === false);
check("no false positive '671'", amountMatchesQuery(670.09, "671") === false);
check("integer boundary: '1000' ✗ 100.00", amountMatchesQuery(100.0, "1000") === false);
check("whole-euro query ✗ sub-€10 cents: '670' ✗ 6.70", amountMatchesQuery(6.7, "670") === false);
check("thousands '1500' → 1500.00", amountMatchesQuery(1500.0, "1500") === true);
check("thousands dot '1.500' → 1500.00", amountMatchesQuery(1500.0, "1.500") === true);
check("distinct decimal '1.500' ✗ 1.50", amountMatchesQuery(1.5, "1.500") === false);
check("'1,50' → 1.50", amountMatchesQuery(1.5, "1,50") === true);
// [Finding 1] amounts ≥ €1000 typed WITH the NL thousands separator, into the cents
check("thousands+decimal '1.234' → 1234.56", amountMatchesQuery(1234.56, "1.234") === true);
check("thousands+decimal '1.234,' → 1234.56", amountMatchesQuery(1234.56, "1.234,") === true);
check("thousands+decimal '1.234,5' → 1234.56", amountMatchesQuery(1234.56, "1.234,5") === true);
check("thousands+decimal '1.234,56' → 1234.56", amountMatchesQuery(1234.56, "1.234,56") === true);
check("'12.500,5' → 12500.50", amountMatchesQuery(12500.5, "12.500,5") === true);
check("'12500,5' == '12.500,5'", amountMatchesQuery(12500.5, "12500,5") === true);
check("wrong cents '1.234,7' ✗ 1234.56", amountMatchesQuery(1234.56, "1.234,7") === false);
// Mid-typing a thousands number: the DOT is ambiguous (thousands-in-progress),
// so "3.4"/"3.43" keep matching €3.431,70 as the user types.
check("dot-ambiguous '3.4' → 3431.70", amountMatchesQuery(3431.7, "3.4") === true);
check("dot-ambiguous '3.43' → 3431.70", amountMatchesQuery(3431.7, "3.43") === true);
check("dot-ambiguous '3.431' → 3431.70", amountMatchesQuery(3431.7, "3.431") === true);
// A COMMA is unambiguously decimal — "3,4" is €3,4x and must NOT match €34 / €340 / €3.431.
check("comma-strict '3,4' → 3.40", amountMatchesQuery(3.4, "3,4") === true);
check("comma-strict '3,4' ✗ 34.00", amountMatchesQuery(34.0, "3,4") === false);
check("comma-strict '3,4' ✗ 340.00", amountMatchesQuery(340.0, "3,4") === false);
check("comma-strict '3,4' ✗ 3431.70", amountMatchesQuery(3431.7, "3,4") === false);
check("negative (creditnota) '201'", amountMatchesQuery(-201.0, "201") === true);
check("negative full '201,00'", amountMatchesQuery(-201.0, "201,00") === true);
check("text query never matches amount", amountMatchesQuery(670.09, "abc") === false);
check("null amount → false", amountMatchesQuery(null, "0") === false);

console.log("\n— rowMatchesQuery (text OR amount) —");
check("empty query matches everything", rowMatchesQuery("", ["Acme"], [10]) === true);
check("accent-folded name hit", rowMatchesQuery("cafe", ["Café Zürich"], []) === true);
check("invoice number substring", rowMatchesQuery("004", ["Acme", "2026-004"], [670.09]) === true);
check("amount hit past the comma", rowMatchesQuery("670,0", ["Acme"], [670.09]) === true);
check("no match", rowMatchesQuery("zzz", ["Acme"], [670.09]) === false);
check("digit in name still matches as text", rowMatchesQuery("A1", ["Room A1"], [50]) === true);

console.log("\n— amountOrConditions (PostgREST OR builder) —");
const eq = (a: string[], b: string[]) => JSON.stringify(a) === JSON.stringify(b);
check("'670' → exact + decimals", eq(amountOrConditions("total_inc_btw", "670"), [
  "total_inc_btw::text.ilike.670", "total_inc_btw::text.ilike.670.%",
]));
check("'670,0' comma → decimal prefix only", eq(amountOrConditions("total_inc_btw", "670,0"), [
  "total_inc_btw::text.ilike.670.0%",
]));
check("'670.09' dot → decimal + thousands-ambiguous", eq(amountOrConditions("total_inc_btw", "670.09"), [
  "total_inc_btw::text.ilike.670.09%",
  "total_inc_btw::text.ilike.67009%",
]));
check("'670,09' comma → decimal only (no thousands fallback)", eq(amountOrConditions("total_inc_btw", "670,09"), [
  "total_inc_btw::text.ilike.670.09%",
]));
check("'1.500' thousands → integer forms", eq(amountOrConditions("total_inc_btw", "1.500"), [
  "total_inc_btw::text.ilike.1500", "total_inc_btw::text.ilike.1500.%",
]));
check("'1.500,50' → decimal", eq(amountOrConditions("total_inc_btw", "1.500,50"), [
  "total_inc_btw::text.ilike.1500.50%",
]));
check("comma-only → nothing", amountOrConditions("total_inc_btw", ",").length === 0);
check("letters → nothing", amountOrConditions("total_inc_btw", "abc").length === 0);
check("digits are injection-safe (only [\\d.] interpolated)",
  amountOrConditions("total_inc_btw", "6%7);drop--").every((c) => /^total_inc_btw::text\.ilike\.[\d.%]+$/.test(c)));

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
