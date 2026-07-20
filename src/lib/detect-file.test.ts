// [DETECT] Pure node test — run: npx tsx src/lib/detect-file.test.ts
import { looksLikeSpreadsheetBinary, detectSheetKind, looksLikeEftReceipt, looksLikeBankStatementFile } from "./detect-file";
import type { Cell } from "./turnover-import";

let passed = 0, failed = 0;
function check(name: string, cond: boolean) {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name}`); }
}

console.log("\n— looksLikeSpreadsheetBinary —");
{
  check("xlsx (PK zip) detected", looksLikeSpreadsheetBinary(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x14])));
  check("old .xls (OLE2) detected", looksLikeSpreadsheetBinary(new Uint8Array([0xd0, 0xcf, 0x11, 0xe0])));
  check("MT940 text NOT flagged as spreadsheet", !looksLikeSpreadsheetBinary(Buffer.from(":20:STARTUMS\n:25:NL..")));
  check("CAMT xml NOT flagged", !looksLikeSpreadsheetBinary(Buffer.from("<?xml version=\"1.0\"?><Document>")));
}

console.log("\n— detectSheetKind —");
{
  const turnover: Cell[][] = [
    ["Datum", "Omzet incl.", "BTW", "Netto Omzet", " Base TC 9 %", "Contant", "PIN"],
    ["2026-02-01", 2144.23],
  ];
  check("POS Z-report → turnover", detectSheetKind(turnover) === "turnover");

  const ledger: Cell[][] = [
    ["KIWI FOOD MARKET", null, null, null, "Datum:", "2026-07-14"],
    [null, null, null, "OVERZICHT"],
    ["Rekening Nr:", null, "550100"],
    ["Datum", "Naam", "Omschrijving", "Ontvangen", "Uitgaven"],
    ["2026-07-03", "kassa", "Totaal PIN Kaart", 2086.65, 0],
  ];
  check("grootboek export → ledger", detectSheetKind(ledger) === "ledger");

  const ledgerNoRek: Cell[][] = [
    ["Datum", "Naam", "Omschrijving", "Ontvangen", "Uitgaven"],
    ["2026-07-03", "kassa", "Totaal Kontant", 216.45, 0],
  ];
  check("ledger detected from Ontvangen/Uitgaven header alone", detectSheetKind(ledgerNoRek) === "ledger");

  check("random sheet → unknown", detectSheetKind([["foo", "bar"], ["x", "y"]]) === "unknown");
}

console.log("\n— looksLikeEftReceipt —");
{
  check("EFT receipt text detected",
    looksLikeEftReceipt("KIWI FOOD\nTOTALEN RAPPORT\nEFT TOTALEN\nBETALING: 130 1546,46\nEquens CTAP"));
  check("a normal invoice is NOT an EFT receipt",
    !looksLikeEftReceipt("Factuur 2026-001\nSligro\nTotaal incl. BTW 50,88"));
  check("empty → false", !looksLikeEftReceipt(""));
}

console.log("\n— looksLikeBankStatementFile (email→bank surfacing) —");
{
  // Accountant-grade formats: extension alone is decisive.
  check("MT940 .sta detected", looksLikeBankStatementFile("NL91ABNA_20260401.sta"));
  check("MT940 .940 detected", looksLikeBankStatementFile("mutaties.940"));
  check("CAMT .camt detected", looksLikeBankStatementFile("statement.camt"));
  check("CAMT .053 extension detected", looksLikeBankStatementFile("bank.053"));

  // Ambiguous containers: only with a statement hint in the name.
  check("CAMT.053 xml (name says camt) detected", looksLikeBankStatementFile("camt053_NL12INGB_2026Q1.xml"));
  check("rekeningafschrift csv detected", looksLikeBankStatementFile("rekeningafschrift-april.csv"));
  check("transacties csv detected", looksLikeBankStatementFile("transacties_2026.csv"));

  // Must NOT fire — otherwise a real invoice is mislabelled a bankafschrift.
  check("UBL e-invoice .xml NOT flagged", looksLikeBankStatementFile("factuur-2026-001.xml") === false);
  check("generic report.csv NOT flagged (too broad)", looksLikeBankStatementFile("report.csv") === false);
  check("a PDF invoice NOT flagged (handled by classifier)", looksLikeBankStatementFile("factuur.pdf") === false);
  check("an image receipt NOT flagged", looksLikeBankStatementFile("bonnetje.jpg") === false);
  check("empty/undefined → false", looksLikeBankStatementFile("") === false && looksLikeBankStatementFile(undefined) === false);
  // A vendor whose name merely contains 'statement' as a substring of a PDF is still not matched (wrong ext).
  check("statement in a .pdf name NOT flagged (ext gate)", looksLikeBankStatementFile("statement-of-work.pdf") === false);
}

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
