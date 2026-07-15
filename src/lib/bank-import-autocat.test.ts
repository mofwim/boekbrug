// [BANK-AUTOCAT] Pure node test — run: npx tsx src/lib/bank-import-autocat.test.ts
// mapToRows must auto-assign the structural identities at import (esp. pos_income for a
// retail store's card settlements) so they reach the result without manual coding, while
// leaving genuine business lines null for the owner to code.
import { mapToRows } from "./bank-import";
import type { BankTransaction } from "./bank-parser";

let passed = 0, failed = 0;
function check(name: string, cond: boolean) {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name}`); }
}
const tx = (p: Partial<BankTransaction>): BankTransaction => ({
  date: "2026-01-02", amount: 100, currency: "EUR", description: "", counterpartName: null,
  counterpartIban: null, reference: null, transactionId: null, rawLine: "", ...p,
});

console.log("\n— mapToRows auto-categorization —");
{
  // The REAL Kiwi settlement line — a credit — must become pos_income.
  const rows = mapToRows([
    tx({ amount: 1868.79, description: "AFREK. BETAALAUTOMAAT MAES REFNR. F9Q3BH DAT. 20260101/6001 AANT. 129 MREFNR. KFM" }),
    tx({ amount: -54.9, description: "Sligro Food Group betaling", counterpartName: "Sligro" }), // real cost → stays null
    tx({ amount: -21.0, description: "Kosten Zakelijke rekening maandpakket" }),                 // fee
    tx({ amount: -1200, description: "Betaling Belastingdienst BTW" }),                          // tax
    tx({ amount: -500, description: "Overboeking naar eigen spaarrekening" }),                   // transfer
  ], "USER");

  check("AFREK. BETAALAUTOMAAT credit → pos_income", rows[0].category === "pos_income");
  check("a real supplier debit stays null (owner codes kosten/omzet)", rows[1].category === null);
  check("bank maandpakket → fee", rows[2].category === "fee");
  check("Belastingdienst → tax", rows[3].category === "tax");
  check("spaarrekening overboeking → transfer", rows[4].category === "transfer");

  // A terminal DEBIT (paying AT a terminal) must NOT be pos_income — it's a purchase.
  const debit = mapToRows([tx({ amount: -12.5, description: "BETAALAUTOMAAT Albert Heijn" })], "U");
  check("a terminal DEBIT is not pos_income (stays null → a purchase)", debit[0].category === null);
}

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
