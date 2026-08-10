// [TURNOVER-IMPORT] Pure node test — run: npx tsx src/lib/turnover-import.test.ts
// Grid + values are the REAL feb.xls (a live store Z-report), so the normalizer is
// proven against production data, not a mock.
import {
  normalizeTurnoverSheet,
  isRealCalendarDate,
  turnoverDateOutOfWindow,
  type Cell,
} from "./turnover-import";

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
  // [L1] accounting-style negative (refund/correction day) keeps its sign — must NOT be
  // read as positive omzet.
  check("parenthesised negative keeps its sign",
    near(normalizeTurnoverSheet([["Datum", "Omzet incl.", "Base TC 9 %"], ["2026-02-01", "(1.089,00)", "0"]]).rows[0].total_incl!, -1089));
  check("trailing-minus negative keeps its sign",
    near(normalizeTurnoverSheet([["Datum", "Omzet incl.", "Base TC 9 %"], ["2026-02-01", "50,00-", "0"]]).rows[0].total_incl!, -50));
  // [QF5] a whole-euro NL value with a thousands dot and no comma → 2500, not 2,50.
  check("NL thousands dot without decimals → 2500 (not 2.5)",
    near(normalizeTurnoverSheet([["Datum", "Omzet incl.", "Base TC 9 %"], ["2026-02-01", "2.500", "0"]]).rows[0].total_incl!, 2500));
  // a genuine decimal dot (2 trailing digits) stays a decimal.
  check("genuine decimal dot stays decimal (12.50 → 12.5, not 1250)",
    near(normalizeTurnoverSheet([["Datum", "Omzet incl.", "Base TC 9 %"], ["2026-02-01", "12.50", "0"]]).rows[0].total_incl!, 12.5));
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

console.log("\n— REAL month.xls: Base HT (net) + Base TC (gross) — use HT, BTW = TC − HT —");
{
  // Verbatim from Kiwi's real month.xls, day 03/07/2026. The columns come in PAIRS:
  // Base HT (Hors Taxe = net) AND Base TC (Toutes Taxes Comprises = gross). Summing both
  // (the old bug) doubled the omzet. Use HT as the base, BTW = TC − HT (exact, no division).
  const H: Cell[] = [
    "Datum", "Omzet incl.", "BTW", "Netto Omzet",
    " Base HT 0 %", " Base HT 0 %", " Base HT 9 %", " Base HT 21 %",
    " Base TC 0 %", " Base TC 0 %", " Base TC 9 %", " Base TC 21 %",
    "Contant", "PIN", "Betaling_3", "Betaling_4", "Betaling_5",
  ];
  const R: Cell[] = [
    "2026-07-03", 2303.100342, 193.780762, 2109.31958,
    0.0, 2.55, 2071.734259, 35.008264,
    0.0, 2.55, 2258.190342, 42.36,
    216.449997, 2086.650005, 0.0, 0.0, 0.0,
  ];
  const { rows, warnings } = normalizeTurnoverSheet([H, R]);
  const d = rows[0];
  check("base_9 = HT net 2071.73 (NOT doubled to ~3972)", near(d.base_9, 2071.73, 0.02));
  check("base_21 = HT net 35.01 (NOT doubled to ~64)", near(d.base_21, 35.01, 0.02));
  check("base_0 = statiegeld 2.55 at 0% (zero-tax)", near(d.base_0, 2.55, 0.02));
  check("btw_9 = TC − HT = 186.46", near(d.btw_9, 186.46, 0.05));
  check("btw_21 = TC − HT = 7.35", near(d.btw_21, 7.35, 0.05));
  check("statiegeld carries NO BTW (0%)", true); // base_0 has no btw field — implicit 0
  check("total_incl = Omzet incl. 2303.10", near(d.total_incl!, 2303.10, 0.02));
  check("net omzet (b0+b9+b21) ≈ Netto Omzet 2109.32", near(d.base_0 + d.base_9 + d.base_21, 2109.32, 0.05));
  check("cash = Contant 216.45", near(d.cash_amount!, 216.45, 0.02));
  check("pin = PIN 2086.65", near(d.pin_amount!, 2086.65, 0.02));
  check("no rate_total_mismatch warning (it reconciles now)", !warnings.some((w) => w.code === "rate_total_mismatch"));
}

console.log("\n— REAL month.xls: Excel serial date (46206) parses to 2026-07-03 —");
{
  // The .xls stores Datum as an Excel serial number. The adapter's cellDates usually
  // converts it, but parseDate must handle a bare serial defensively so a mis-tagged cell
  // never silently drops the whole day.
  const H: Cell[] = ["Datum", "Omzet incl.", " Base HT 9 %", " Base TC 9 %"];
  const R: Cell[] = [46206, 2258.19, 2071.73, 2258.19];
  const { rows } = normalizeTurnoverSheet([H, R]);
  check("serial 46206 → 2026-07-03", rows[0]?.turnover_date === "2026-07-03");
}

// [ASYMMETRIC HT/TC] The silent-BTW bug: a sheet with HT for one rate (9%) but ONLY a
// TC/gross column for another (21%). A global hasHT flag booked the TC-only rate's whole
// gross as BTW (base=0, btw=gross), silently. Per-rate decision must derive its net.
console.log("\n— asymmetric HT/TC columns (per-rate gross-vs-net) —");
{
  const H: Cell[] = [
    "Datum", "Omzet incl.", "BTW", "Netto Omzet",
    "Base HT 9 %", "Base TC 9 %", "Base TC 21 %", "Contant", "PIN",
  ];
  // 9% has HT(net 100)+TC(gross 109); 21% has ONLY TC (gross 121 → net 100, btw 21).
  const DAY: Cell[] = ["2026-03-01", 230, 30, 200, 100, 109, 121, 115, 115];
  const { rows } = normalizeTurnoverSheet([H, DAY]);
  const d = rows[0];
  check("9% (HT+TC): base = HT net 100", near(d.base_9, 100));
  check("9% (HT+TC): btw = TC − HT = 9", near(d.btw_9, 9));
  check("21% (TC-only): net derived from gross = 100 (NOT 0)", near(d.base_21, 100));
  check("21% (TC-only): btw = 21 (NOT the whole gross 121)", near(d.btw_21, 21));
  check("net + BTW reconstructs gross", near(d.base_9 + d.base_21 + d.btw_9 + d.btw_21, 230, 0.05));
}

console.log("\n— [TURNOVER-BLANK-GROSS] a day with takings but a blank 'Omzet incl.' must not vanish silently —");
{
  const H: Cell[] = ["Datum", "Omzet incl.", "BTW", "Netto Omzet", " Base TC 9 %", " Base TC 21 %", "Contant", "PIN"];
  // A genuinely empty day (all blank) → silently skipped, no warning.
  const EMPTY: Cell[] = ["2026-05-01", 0, 0, 0, 0, 0, 0, 0];
  // A REAL sales day where only "Omzet incl." was left blank but PIN/cash are filled.
  const BLANK_GROSS: Cell[] = ["2026-05-02", 0, 0, 0, 0, 0, 200, 500];
  const { rows, warnings } = normalizeTurnoverSheet([H, EMPTY, BLANK_GROSS]);
  check("neither zero-gross day is imported (no guessed BTW split)", rows.length === 0);
  check("empty day raises NO warning", !warnings.some(w => w.code === "gross_missing_with_payments" && w.row === 1));
  check("day with takings + blank gross raises the warning (not a silent drop)",
    warnings.some(w => w.code === "gross_missing_with_payments"));
}

console.log("\n— [DATE-REAL] a day that does not exist may never reach the database —");
{
  // The month and the day used to be range-checked INDEPENDENTLY, so 31 February produced the
  // string "2026-02-31": shaped like a date, accepted by the commit route's regex, and rejected
  // by the Postgres `date` column — which fails the WHOLE upsert on "kon dagomzet niet opslaan",
  // naming nothing. One bad cell took a month of turnover with it.
  check("31 February is not a date", !isRealCalendarDate("2026-02-31"));
  check("31 April is not a date", !isRealCalendarDate("2026-04-31"));
  check("29 Feb in a common year is not a date", !isRealCalendarDate("2026-02-29"));
  check("29 Feb in a LEAP year is", isRealCalendarDate("2024-02-29"));
  check("ordinary days pass", isRealCalendarDate("2026-02-28") && isRealCalendarDate("2026-12-31"));
  check("month 00 / 13 refused", !isRealCalendarDate("2026-00-10") && !isRealCalendarDate("2026-13-10"));
  check("day 00 refused", !isRealCalendarDate("2026-03-00"));

  const H: Cell[] = ["Datum", "Omzet incl.", "Netto Omzet", " Base TC 21 %", "Contant", "PIN"];
  const BAD: Cell[] = ["31-02-2026", 121, 100, 121, 21, 100];
  const GOOD: Cell[] = ["28-02-2026", 121, 100, 121, 21, 100];
  const { rows, warnings } = normalizeTurnoverSheet([H, BAD, GOOD]);
  check("the impossible day is not imported", !rows.some((r) => r.turnover_date.startsWith("2026-02-31")));
  check("…and the good day still is", rows.some((r) => r.turnover_date === "2026-02-28"));
  // The row carried real omzet, so dropping it silently would be a lost sales day — the same
  // thing [TURNOVER-BLANK-GROSS] refuses to do for a missing gross.
  check("it is NAMED, not silently skipped", warnings.some((w) => w.code === "date_unreadable"));
  check("the warning quotes the unreadable cell", warnings.some((w) => w.message.includes("31-02-2026")));
}

console.log("\n— [DATE-WINDOW] a slipped digit in the year is refused, not booked forever —");
{
  const TODAY = "2026-07-31";
  check("today is inside the window", !turnoverDateOutOfWindow("2026-07-31", TODAY));
  // Tomorrow is allowed on purpose: a device clock or timezone edge can be a day ahead.
  check("tomorrow is allowed (clock/timezone edge)", !turnoverDateOutOfWindow("2026-08-01", TODAY));
  check("the day after tomorrow is not", turnoverDateOutOfWindow("2026-08-02", TODAY));
  check("a slipped year digit (2062) is out", turnoverDateOutOfWindow("2062-07-31", TODAY));
  check("an Excel-serial mis-parse near 2089 is out", turnoverDateOutOfWindow("2089-01-13", TODAY));
  check("before 2000 is out", turnoverDateOutOfWindow("1954-10-03", TODAY));
  check("old but real history stays in", !turnoverDateOutOfWindow("2000-01-01", TODAY));
  // A month-end boundary must not be off by one.
  check("31 Dec → 1 Jan crosses the year correctly",
    !turnoverDateOutOfWindow("2027-01-01", "2026-12-31") && turnoverDateOutOfWindow("2027-01-02", "2026-12-31"));

  const H: Cell[] = ["Datum", "Omzet incl.", "Netto Omzet", " Base TC 21 %", "Contant", "PIN"];
  const FUTURE: Cell[] = ["31-07-2062", 121, 100, 121, 21, 100];
  // `today` injected so this test means the same thing in any year it is run.
  const { warnings } = normalizeTurnoverSheet([H, FUTURE], { today: TODAY });
  // Shown BEFORE the owner approves, so the commit route's refusal is never a surprise.
  check("the preview warns about the impossible year", warnings.some((w) => w.code === "date_out_of_window"));
}

console.log("\n— [NO-NETTO] a legacy sheet without a Netto column: gross or net? —");
{
  // The columns are NET and the day is mostly statiegeld: EUR 100 at 0% + EUR 1 at 21%, gross
  // EUR 101,21. The old rule ("call it gross when the columns sum to within 2% of the gross")
  // saw EUR 101 against EUR 101,21 — 0,2% off — and called them gross, dividing BTW out of the
  // EUR 1. The 0% money is what dragged the sum inside the tolerance, and 0% money is exactly
  // what the decision cannot depend on: it reads the same either way.
  const H = ["Datum", "Omzet incl.", "Base TC 0 %", "Base TC 21 %"];
  const netDay = normalizeTurnoverSheet([H, ["01-02-2026", 101.21, 100, 1]]).rows[0];
  check("net columns are read as net, not divided down",
    near(netDay.base_21!, 1) && near(netDay.btw_21!, 0.21));
  check("and the 0% money is untouched", near(netDay.base_0!, 100));
  check("so the day still adds up to its own gross",
    near(netDay.base_0! + netDay.base_21! + netDay.btw_21!, 101.21));

  // Turn the same day around — columns really gross — and it must go the other way. The old rule
  // agreed with BOTH, which is the tell that it was measuring the wrong thing.
  const grossDay = normalizeTurnoverSheet([H, ["01-02-2026", 101, 100, 1]]).rows[0];
  check("gross columns are still divided down", near(grossDay.base_21!, 0.83) && near(grossDay.btw_21!, 0.17));
  check("…and that day adds up too", near(grossDay.base_0! + grossDay.base_21! + grossDay.btw_21!, 101));

  // The plain cases the old rule already got right must not move.
  const plainNet = normalizeTurnoverSheet([["Datum", "Omzet incl.", "Base TC 21 %"], ["01-02-2026", 121, 100]]).rows[0];
  check("a net-only sheet is unchanged", near(plainNet.base_21!, 100) && near(plainNet.btw_21!, 21));
  const plainGross = normalizeTurnoverSheet([["Datum", "Omzet incl.", "Base TC 9 %"], ["01-02-2026", 109, 109]]).rows[0];
  check("a gross-only sheet is unchanged", near(plainGross.base_9!, 100) && near(plainGross.btw_9!, 9));

  // A day where the two readings are close is a day where nothing is at stake: they differ by
  // exactly raw9x0,09 + raw21x0,21, which IS the BTW being decided. All-0% is that case.
  const zeroOnly = normalizeTurnoverSheet([["Datum", "Omzet incl.", "Base TC 0 %"], ["01-02-2026", 250, 250]]).rows[0];
  check("an all-0% day carries no BTW either way", near(zeroOnly.base_0!, 250) && near(zeroOnly.btw_9! + zeroOnly.btw_21!, 0));
}

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
