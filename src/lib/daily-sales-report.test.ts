// [DAGVERKOPEN-PDF] Pure test — run: npx tsx src/lib/daily-sales-report.test.ts
import { looksLikeDailySalesReport, parseDailySalesReport } from "./daily-sales-report";

let passed = 0, failed = 0;
function check(name: string, cond: boolean) {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name}`); }
}

// The REAL Kiwi "OMZET VAN 01/04/2026" report text (extracted by unpdf, verbatim).
const REAL = `KIWI FOOD MARKET Verdiplein 13 5049 NM TILBURG OMZET VAN 01/04/2026 Netto Omzet:Document: Aantal: Omzet Incl: Kassabonnen : 156 1.895,16 1.738,34 Verkoop facturen: 0 0,00 0,00 Aankoopbonnen: 0 0,00 0,00 0,00Terugbetalingsbonnen: 0 0,00 Kredietnota's : 0 0,00 0,00 TOTAAL: 156 1.895,16 1.738,34 Belastbaar Basis % 0,00 0,00 Omzet met BTW % 0,00 2,70 Omzet met BTW % 9,00 1.886,58 Omzet met BTW % 21,00 5,88 Gem. bedrag kassabonnen: 12,15 Max. bedrag kassabonnen: 83,24 Min. bedrag kassabonnen: 0,50 Aantal verkochte artikelen: 510,60 Gemiddeld verkoopprijs : 3,71 Kadeau cheque : 0 0,00 0,00 0,00 0,00Aantal geannuleerde Artikelen 0,00 0,00 155,77 1,02 Beltegoed Statiegeld Laag Hoog Basis Incl: BTW bedragBasis Excl: 0,00 2,70 1.730,81 4,86`;

console.log("\n— marker —");
check("real report → looksLikeDailySalesReport true", looksLikeDailySalesReport(REAL));
check("an invoice text → false", !looksLikeDailySalesReport("Factuur 12345 Trimex International €723,19 BTW 21%"));
check("null/empty → false", !looksLikeDailySalesReport(null) && !looksLikeDailySalesReport(""));

console.log("\n— parse the REAL report —");
{
  const { row, warnings } = parseDailySalesReport(REAL);
  check("date parsed to ISO 2026-04-01", row?.turnover_date === "2026-04-01");
  check("no warnings (per-rate sum matches TOTAAL to the cent)", warnings.length === 0);
  // 9%: gross 1886,58 → net 1730,81 + btw 155,77 (both verbatim in the report).
  check("base_9 = 1730.81 (net of 9% gross)", row?.base_9 === 1730.81);
  check("btw_9 = 155.77", row?.btw_9 === 155.77);
  // 21%: gross 5,88 → net 4,86 + btw 1,02.
  check("base_21 = 4.86", row?.base_21 === 4.86);
  check("btw_21 = 1.02", row?.btw_21 === 1.02);
  // 0%: 2,70 net, no BTW.
  check("base_0 = 2.70", row?.base_0 === 2.7);
  check("total_incl = 1895.16 (sum of per-rate gross)", row?.total_incl === 1895.16);
  check("no payment split on a daily report (pin/cash null)", row?.pin_amount === null && row?.cash_amount === null);
  // Net + BTW must reconcile to the gross total (the money-truth cross-check).
  const netPlusBtw = (row!.base_0 + row!.base_9 + row!.base_21 + row!.btw_9 + row!.btw_21);
  check("net + BTW ≈ total_incl (reconciles to the cent)", Math.abs(netPlusBtw - (row!.total_incl ?? 0)) < 0.05);
}

console.log("\n— guards —");
{
  const { row, warnings } = parseDailySalesReport("KIWI OMZET VAN 02/04/2026 (geen tarieven hier)");
  check("no per-rate lines → row null + warning", row === null && warnings.length > 0);
}
{
  // A per-rate/TOTAAL mismatch → a warning (caller won't auto-book).
  const bad = "OMZET VAN 03/04/2026 TOTAAL: 10 999,99 900,00 Omzet met BTW % 21,00 100,00";
  const { row, warnings } = parseDailySalesReport(bad);
  check("TOTAAL mismatch → row present but a warning is raised", row !== null && warnings.length > 0);
}
{
  const { row } = parseDailySalesReport("no date, no omzet");
  check("garbage text → row null", row === null);
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
