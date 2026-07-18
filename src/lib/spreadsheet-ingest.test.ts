// [SHEET-INTAKE] Pure test for spreadsheet-ingest.ts — run: npx tsx src/lib/spreadsheet-ingest.test.ts
import { planSpreadsheetIngest, ledgerKindLabel } from "./spreadsheet-ingest";
import type { Cell } from "./turnover-import";

let passed = 0, failed = 0;
function check(name: string, cond: boolean) {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name}`); }
}

// A minimal clean kassa Z-report: gross = base+btw per rate, and cash+pin = gross.
// 121 gross @21% → base 100, btw 21; paid 121 cash. Cross-checks pass → commitSafe.
const turnoverClean: Cell[][] = [
  ["Datum", "Omzet incl.", "Netto Omzet", "Base TC 21 %", "Contant", "PIN"],
  ["2026-05-01", 121, 100, 121, 121, 0],
];

// Same but the payment split doesn't add up to gross (cash+pin = 50 ≠ 121) → a warning →
// NOT commit-safe (the owner must review it in Dagomzet).
const turnoverMismatch: Cell[][] = [
  ["Datum", "Omzet incl.", "Netto Omzet", "Base TC 21 %", "Contant", "PIN"],
  ["2026-05-01", 121, 100, 121, 30, 20],
];

// A grootboek PIN export (Kiwi OVERZICHT, account 550100).
const ledgerPin: Cell[][] = [
  ["KIWI FOOD MARKET", null, null, null, "Datum:", "2026-07-17"],
  [null, null, null, "OVERZICHT"],
  ["Rekening Nr:", null, "550100"],
  ["Voorgaande Saldo", null, 1000],
  ["Datum", "Naam", "Omschrijving", "Ontvangen", "Uitgaven"],
  ["2026-04-01", "Totaal van de kassa", "Totaal PIN Kaart van 01/04/2026", 1627.31, 0],
  ["2026-04-02", "Totaal van de kassa", "Totaal PIN Kaart van 02/04/2026", 1985.38, 0],
  ["TOTALEN:", null, null, 3612.69, 0],
];

// A grootboek cash export (account 570000).
const ledgerCash: Cell[][] = [
  ["KIWI FOOD MARKET", null, null, null, "Datum:", "2026-04-07"],
  [null, null, null, "OVERZICHT"],
  ["Rekening Nr:", null, "570000"],
  ["Datum", "Naam", "Omschrijving", "Ontvangen", "Uitgaven"],
  ["2026-01-01", "Totaal van de kassa", "Totaal Kontant van 01/01/2026", 120.25, 0],
];

// A random spreadsheet that is neither → unknown (caller stores the raw file).
const unknownSheet: Cell[][] = [
  ["Artikel", "Aantal", "Prijs"],
  ["Appel", 3, 0.5],
];

console.log("\n— turnover —");
{
  const p = planSpreadsheetIngest(turnoverClean);
  check("clean Z-report → kind turnover", p.kind === "turnover");
  check("clean Z-report → 1 row", p.turnover?.rows.length === 1);
  check("clean Z-report → no warnings", p.turnover?.warnings.length === 0);
  check("clean Z-report → commitSafe true", p.turnover?.commitSafe === true);
  check("clean Z-report → base_21 100, btw_21 21", p.turnover?.rows[0].base_21 === 100 && p.turnover?.rows[0].btw_21 === 21);
}
{
  const p = planSpreadsheetIngest(turnoverMismatch);
  check("mismatch Z-report → kind turnover", p.kind === "turnover");
  check("mismatch Z-report → has a warning", (p.turnover?.warnings.length ?? 0) > 0);
  check("mismatch Z-report → commitSafe FALSE (needs review)", p.turnover?.commitSafe === false);
}

console.log("\n— ledger (witness, never money) —");
{
  const p = planSpreadsheetIngest(ledgerPin);
  check("PIN grootboek → kind ledger", p.kind === "ledger");
  check("PIN grootboek → ledger.kind pin", p.ledger?.kind === "pin");
  check("PIN grootboek → account 550100", p.ledger?.accountNr === "550100");
  check("PIN grootboek → 2 day rows", p.ledger?.rows.length === 2);
  check("PIN grootboek → first day received 1627.31", p.ledger?.rows[0].received === 1627.31);
  check("PIN grootboek → sorted ascending by date", p.ledger?.rows[0].ledger_date === "2026-04-01");
  check("ledgerKindLabel(pin) is Dutch", ledgerKindLabel("pin") === "PIN-ontvangsten");
}
{
  const p = planSpreadsheetIngest(ledgerCash);
  check("cash grootboek → ledger.kind cash", p.ledger?.kind === "cash");
  check("cash grootboek → account 570000", p.ledger?.accountNr === "570000");
  check("cash grootboek → 1 day row", p.ledger?.rows.length === 1);
}

console.log("\n— unknown —");
{
  const p = planSpreadsheetIngest(unknownSheet);
  check("random sheet → kind unknown", p.kind === "unknown");
  check("random sheet → no turnover/ledger payload", !p.turnover && !p.ledger);
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
