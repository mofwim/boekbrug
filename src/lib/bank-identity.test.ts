// [BANK-IDENTITY] Pure node test — run: npx tsx src/lib/bank-identity.test.ts
import {
  classifyBankTransaction,
  needsDocument,
  counterpartKey,
  suggestIdentity,
  type TxIdentity,
} from "./bank-identity";

let passed = 0;
let failed = 0;
function check(name: string, cond: boolean) {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name}`); }
}
// name, desc, amount, expected identity
function eq(name: string, cp: string | null, desc: string | null, amount: number, want: TxIdentity) {
  const got = classifyBankTransaction(cp, desc, amount);
  check(`${name} → ${want}${got === want ? "" : ` (got ${got})`}`, got === want);
}

console.log("\n— identity classification —");
eq("Belastingdienst BTW", "Belastingdienst", "Betaling BTW Q1 2026", -1200, "tax");
eq("Belastingdienst refund (credit)", "Belastingdienst", "Teruggaaf", 340, "tax");
eq("Savings transfer", "Oranje Spaarrekening", "naar mijn spaarrekening", -500, "transfer");
eq("Own account (eigen rekening)", null, "Overboeking naar eigen rekening", -250, "transfer");
eq("ATM cash withdrawal (GEA)", null, "GEA Betaalpas Opname Geldautomaat Amsterdam", -100, "transfer");
eq("Private withdrawal", null, "Prive opname", -800, "prive");
eq("Bank fees", "ING Bank", "Kosten betaalrekening", -1.9, "fee");
eq("POS payout (ING DD&C) credit", "ING DD&C", "Afrek. transacties", 842.15, "pos_income");
eq("SumUp payout credit", "SUMUP PAYOUT", "SumUp", 210.5, "pos_income");

console.log("\n— the tricky ones (correctness the old POS heuristic got wrong) —");
// A "betaalautomaat" DEBIT is a card PURCHASE — a real cost that needs a receipt,
// NOT card takings. The old inline isPos() excluded it → under-counted documenting.
eq("Betaalautomaat DEBIT is a purchase, not takings", null, "Betaalautomaat 12:34 Albert Heijn 1456", -23.90, "unknown");
eq("Plain card purchase at a shop", "Shell Nederland", "Betaalpas 09:12 Shell 4471", -68.40, "unknown");
eq("Normal supplier debit (no invoice yet)", "Bol.com", "iDEAL bestelling", -49.99, "unknown");
eq("Incoming customer payment", "Jansen BV", "Factuur 2026-014", 605, "unknown");

console.log("\n— needsDocument (what 'nog te documenteren' should count) —");
check("supplier debit without doc → needs bon",
  needsDocument("Shell Nederland", "Betaalpas Shell", -68.40) === true);
check("betaalautomaat purchase → needs bon (fixed)",
  needsDocument(null, "Betaalautomaat Albert Heijn", -23.90) === true);
check("tax payment → no bon needed",
  needsDocument("Belastingdienst", "BTW Q1", -1200) === false);
check("savings transfer → no bon needed",
  needsDocument("Oranje Spaarrekening", "naar spaar", -500) === false);
check("ATM withdrawal → no bon needed",
  needsDocument(null, "Opname Geldautomaat", -100) === false);
check("private withdrawal → no bon needed",
  needsDocument(null, "Prive opname", -800) === false);
check("bank fee → no bon needed",
  needsDocument("ING Bank", "Bankkosten", -1.9) === false);
check("any income (credit) → never needs a bon",
  needsDocument("Klant BV", "betaling", 500) === false);
check("POS payout credit → never needs a bon",
  needsDocument("ING DD&C", "Afrek.", 842.15) === false);

console.log("\n— counterpartKey (memory key) —");
check("strips PSP prefix + suffix (SUMUP *JANSEN → jansen)", counterpartKey("SUMUP *JANSEN") === "jansen");
check("strips legal suffix (KPN B.V. → kpn)", counterpartKey("KPN B.V.") === "kpn");
check("multi-word merchant kept (Albert Heijn 1456 → albert heijn 1456)", counterpartKey("Albert Heijn 1456") === "albert heijn 1456");
check("null name → null key", counterpartKey(null) === null);
check("noise-only name → null key", counterpartKey("CCV*") === null);

console.log("\n— suggestIdentity —");
check("memory always wins",
  suggestIdentity("Shell", "brandstof", -60, "kosten").source === "memory");
check("memory category is returned",
  suggestIdentity("Shell", "brandstof", -60, "prive").category === "prive");
check("classifier used when no memory (Belastingdienst → tax)",
  suggestIdentity("Belastingdienst", "BTW", -1200).category === "tax");
check("unexplained debit → kosten",
  suggestIdentity("Bol.com", "iDEAL", -49.99).category === "kosten" &&
  suggestIdentity("Bol.com", "iDEAL", -49.99).source === "ai");
check("unexplained credit → omzet",
  suggestIdentity("Onbekend", "overboeking", 250).category === "omzet");
check("transfer beats the kosten fallback",
  suggestIdentity(null, "Opname Geldautomaat", -100).category === "transfer");

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
