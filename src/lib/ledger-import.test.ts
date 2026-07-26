// [LEDGER] Pure node test — run: npx tsx src/lib/ledger-import.test.ts
// Fixtures are the REAL structure of Kiwi's accounting-package exports:
//   RAP_FIN_bank.xlsx → OVERZICHT / Rekening 550100 = the PIN ledger
//   RAP_FIN.xlsx      → KASBOEK  / Rekening 570000 = the cash (kas) ledger
// These are the bookkeeper's per-day GROSS totals ("Totaal PIN Kaart van …",
// "Totaal Kontant van …"). They are corner 3's cross-check: an independent
// confirmation that the till's gross PIN/cash equals what the bookkeeper booked.
import { parseLedgerSheet, ledgerDailyTotals, type Cell } from "./ledger-import";

let passed = 0, failed = 0;
function check(name: string, cond: boolean) {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name}`); }
}
const near = (a: number, b: number, t = 0.02) => Math.abs(a - b) <= t;

// Verbatim from RAP_FIN_bank.xlsx (the PIN ledger).
const PIN_SHEET: Cell[][] = [
  ["KIWI FOOD MARKET", null, null, null, "Datum:", "2026-07-14", null, null, null],
  ["Verdiplein 13", null, null, null, null, null, null, null, null],
  ["5049 NM TILBURG", null, null, null, null, null, null, null, null],
  [null, null, null, "OVERZICHT", null, null, null, null, null],
  [null, null, null, null, 1, null, null, "/", 0],
  ["Rekening Nr:", null, "550100", null, null, null, null, null, null],
  ["Periode van", null, "2026-07-03", "2026-07-03", "Voorgaande Saldo:", 342065.71988, null, null, null],
  ["Datum", "Naam", "Omschrijving", "Ontvangen", "Uitgaven", null, null, null, null],
  ["2026-07-03", "Totaal van de kassa", "Totaal PIN Kaart van 03/07/2026", 2086.650005, 0, null, null, null, null],
  [null, null, null, "TOTALEN:", 0, null, null, null, null],
  [null, null, null, "Nieuw Saldo:", "EUR", null, null, null, null],
];

// Verbatim from RAP_FIN.xlsx (the cash ledger).
const CASH_SHEET: Cell[][] = [
  ["KIWI FOOD MARKET", null, null, null, "Datum:", "2026-07-14", null, null, null],
  ["Verdiplein 13", null, null, null, null, null, null, null, null],
  ["5049 NM TILBURG", null, null, null, null, null, null, null, null],
  [null, null, null, "KASBOEK", null, null, null, null, null],
  [null, null, null, null, 1, null, null, "/", 0],
  ["Rekening Nr:", null, "570000", null, null, null, null, null, null],
  ["Periode van", null, "2026-07-03", "2026-07-03", "Voorgaande Saldo:", 49624.210021, null, null, null],
  ["Datum", "Naam", "Omschrijving", "Ontvangen", "Uitgaven", null, null, null, null],
  ["2026-07-03", "Totaal van de kassa", "Totaal Kontant van 03/07/2026", 216.449997, 0, null, null, null, null],
  [null, null, null, "TOTALEN:", 0, null, null, null, null],
  [null, null, null, "Nieuw Saldo:", "EUR", null, null, null, null],
];

console.log("\n— parseLedgerSheet (real PIN ledger, OVERZICHT/550100) —");
{
  const { ledger, warnings } = parseLedgerSheet(PIN_SHEET);
  check("ledger returned", ledger !== null);
  check("account nr 550100", ledger?.accountNr === "550100");
  check("title OVERZICHT", ledger?.title === "OVERZICHT");
  check("kind = pin (PIN Kaart lines)", ledger?.kind === "pin");
  check("opening balance ≈ 342065.72", near(ledger!.openingBalance!, 342065.72, 0.01));
  check("one data entry", ledger?.entries.length === 1);
  const e = ledger!.entries[0];
  check("entry date 2026-07-03", e.date === "2026-07-03");
  check("entry received ≈ 2086.65 (matches till gross PIN)", near(e.received, 2086.65));
  check("entry spent 0", e.spent === 0);
  check("description carries 'PIN Kaart'", /PIN Kaart/i.test(e.description ?? ""));
  check("TOTALEN / Nieuw Saldo rows skipped", ledger?.entries.length === 1);
  check("clean sheet → no warnings", warnings.length === 0);
}

console.log("\n— parseLedgerSheet (real cash ledger, KASBOEK/570000) —");
{
  const { ledger } = parseLedgerSheet(CASH_SHEET);
  check("account nr 570000", ledger?.accountNr === "570000");
  check("title KASBOEK", ledger?.title === "KASBOEK");
  check("kind = cash (Kontant lines)", ledger?.kind === "cash");
  check("received ≈ 216.45 (matches till gross cash)", near(ledger!.entries[0].received, 216.45));
}

console.log("\n— ledgerDailyTotals sums per day —");
{
  const multi: Cell[][] = [
    ["Rekening Nr:", null, "550100", null, null],
    ["Datum", "Naam", "Omschrijving", "Ontvangen", "Uitgaven"],
    ["2026-07-03", "kassa", "Totaal PIN Kaart van 03/07/2026", 1000, 0],
    ["2026-07-03", "correctie", "PIN correctie", 50, 10],
    ["2026-07-04", "kassa", "Totaal PIN Kaart van 04/07/2026", 800, 0],
    [null, null, null, "TOTALEN:", 0],
  ];
  const { ledger } = parseLedgerSheet(multi);
  check("3 entries parsed", ledger?.entries.length === 3);
  const totals = ledgerDailyTotals(ledger!);
  check("2026-07-03 received summed = 1050", near(totals.get("2026-07-03")!.received, 1050));
  check("2026-07-03 spent summed = 10", near(totals.get("2026-07-03")!.spent, 10));
  check("2026-07-04 received = 800", near(totals.get("2026-07-04")!.received, 800));
}

console.log("\n— robustness —");
{
  check("no ledger header → null + warning",
    (() => { const r = parseLedgerSheet([["foo", "bar"], ["x", "y"]]); return r.ledger === null && r.warnings.some((w) => w.code === "no_ledger"); })());
  check("bank-kind detected from account/title",
    (() => {
      const r = parseLedgerSheet([
        ["Rekening Nr:", null, "100000"], [null, null, null, "BANK"],
        ["Datum", "Naam", "Omschrijving", "Ontvangen", "Uitgaven"],
        ["2026-07-03", "ING", "Overboeking", 500, 0],
      ]);
      return r.ledger?.kind === "bank";
    })());
  check("a 'betaling'/'levering' description does NOT mislabel as bank (ing substring)",
    (() => {
      const r = parseLedgerSheet([
        ["Rekening Nr:", null, "610000"],
        ["Datum", "Naam", "Omschrijving", "Ontvangen", "Uitgaven"],
        ["2026-07-03", "leverancier", "Levering goederen betaling", 0, 500],
      ]);
      return r.ledger?.kind === "other";
    })());
  check("a real ING bank line still classifies as bank",
    (() => {
      const r = parseLedgerSheet([
        ["Rekening Nr:", null, "100000"],
        ["Datum", "Naam", "Omschrijving", "Ontvangen", "Uitgaven"],
        ["2026-07-03", "ING", "Overboeking", 500, 0],
      ]);
      return r.ledger?.kind === "bank";
    })());
  check("NL number strings parse in amounts",
    near(parseLedgerSheet([
      ["Rekening Nr:", null, "570000"],
      ["Datum", "Naam", "Omschrijving", "Ontvangen", "Uitgaven"],
      ["2026-07-03", "kassa", "Totaal Kontant", "1.234,56", "0"],
    ]).ledger!.entries[0].received, 1234.56));
}

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
