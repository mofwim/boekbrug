// [TURNOVER-IMPORT] Pure node test — run: npx tsx src/lib/turnover-import.test.ts
// Grid + values are the REAL feb.xls (a live store Z-report), so the normalizer is
// proven against production data, not a mock.
import { normalizeTurnoverSheet, type Cell } from "./turnover-import";

let passed = 0, failed = 0;
function check(name: string, cond: boolean) {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name}`); }
}
const near = (a: number, b: number, t = 0.02) => Math.abs(a - b) <= t;

// Real feb.xls: note the DUPLICATE "Base TC 0 %" header and that the per-rate columns are
// GROSS (they sum to "Omzet incl.", not "Netto Omzet").
const HEADER: Cell[] = [
  "Datum", "Omzet incl.", "BTW", "Netto Omzet",
  " Base TC 0 %", " Base TC 0 %", " Base TC 9 %", " Base TC 21 %",
  "Contant", "PIN", "Betaling_3", "Betaling_4", "Betaling_5",
];
// Row for 2026-02-01, verbatim from the file.
const DAY1: Cell[] = [
  "2026-02-01", 2144.230225, 177.650269, 1966.579956,
  0.0, 4.2, 2128.710225, 11.32,
  173.950001, 1970.280013, 0.0, 0.0, 0.0,
];
const DAY2: Cell[] = [
  "2026-02-02", 1950.910034, 161.400024, 1789.51001,
  0.0, 1.5, 1944.340034, 5.07,
  299.949989, 1650.959995, 0.0, 0.0, 0.0,
];

console.log("\n— normalizeTurnoverSheet (real feb.xls) —");
{
  const { rows, warnings } = normalizeTurnoverSheet([HEADER, DAY1, DAY2]);
  check("finds both data rows", rows.length === 2);
  const d = rows[0];
  check("date parsed", d.turnover_date === "2026-02-01");
  check("total_incl = Omzet incl.", near(d.total_incl!, 2144.23));

  // GROSS detection: per-rate cols summed to Omzet incl → divide out BTW.
  //   9% gross 2128.71 → net 1952.94, btw 175.77 ; 21% gross 11.32 → net 9.36, btw 1.96
  check("gross-per-rate detected → 9% net base derived", near(d.base_9, 2128.710225 / 1.09));
  check("9% BTW derived", near(d.btw_9, 2128.710225 - 2128.710225 / 1.09));
  check("21% net base derived", near(d.base_21, 11.32 / 1.21));
  check("21% BTW derived", near(d.btw_21, 11.32 - 11.32 / 1.21));
  check("both 0% columns summed into base_0", near(d.base_0, 4.2));

  // Internal identity the normalizer guarantees: net + BTW ≈ gross.
  const gross = d.base_0 + d.base_9 + d.base_21 + d.btw_9 + d.btw_21;
  check("net + BTW reconstructs Omzet incl.", near(gross, 2144.23, 0.05));

  // Payment split straight through.
  check("cash_amount = Contant", near(d.cash_amount!, 173.95));
  check("pin_amount = PIN", near(d.pin_amount!, 1970.28));
  check("other_amount = Σ Betaling_* (0 here)", d.other_amount === 0);

  // The real row ties out on both identities → zero warnings.
  check("a self-consistent real day imports with no warnings", warnings.length === 0);
}

console.log("\n— net-per-rate file (arithmetic detection flips) —");
{
  // A different POS whose "Base" columns really ARE net (sum to Netto Omzet).
  const H: Cell[] = ["Datum", "Omzet incl.", "Netto Omzet", "Base TC 0 %", "Base TC 9 %", "Base TC 21 %", "Contant", "PIN"];
  const R: Cell[] = ["2026-03-01", 109, 100, 0, 100, 0, 9, 100];
  const { rows } = normalizeTurnoverSheet([H, R]);
  check("net detected → base taken as-is (100), BTW added (9)", near(rows[0].base_9, 100) && near(rows[0].btw_9, 9));
}

console.log("\n— validation surfaces a bad row, never silent —");
{
  const H: Cell[] = ["Datum", "Omzet incl.", "Netto Omzet", "Base TC 9 %", "Contant", "PIN"];
  const BAD: Cell[] = ["2026-03-02", 1000, 917, 800 /*gross9*/, 100, 100 /* pay 200 ≠ 1000 */];
  const { rows, warnings } = normalizeTurnoverSheet([H, BAD]);
  check("row still imported", rows.length === 1);
  check("payment-mismatch warning raised", warnings.some((w) => w.code === "payment_total_mismatch"));
}

console.log("\n— robustness —");
{
  check("no header → warning, no rows",
    (() => { const r = normalizeTurnoverSheet([["foo", "bar"], ["x", "y"]]); return r.rows.length === 0 && r.warnings.some((w) => w.code === "no_header"); })());
  check("DD-MM-YYYY dates parse",
    normalizeTurnoverSheet([["Datum", "Omzet incl.", "Base TC 9 %"], ["01-02-2026", 109, 109]])[
      "rows"
    ][0].turnover_date === "2026-02-01");
  check("NL number strings parse",
    near(normalizeTurnoverSheet([["Datum", "Omzet incl.", "Base TC 9 %"], ["2026-02-01", "1.089,00", "1.089,00"]]).rows[0].total_incl!, 1089));
}

console.log("\n— AUDIT FIX: a net-only sheet is not mistaken for gross —");
{
  // No "Netto" column; the per-rate value (1000) is the NET base, gross is 1090.
  const H: Cell[] = ["Datum", "Omzet incl.", "Base TC 9 %"];
  const R: Cell[] = ["2026-05-01", 1090, 1000];
  const { rows } = normalizeTurnoverSheet([H, R]);
  check("net base kept as-is (not divided as if gross)", Math.abs((rows[0]?.base_9 ?? 0) - 1000) < 0.5);
  check("BTW derived on top of the net base (≈90)", Math.abs((rows[0]?.btw_9 ?? 0) - 90) < 0.5);
}

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
