// [BANK-IDENTITY] Pure node test — run: npx tsx src/lib/bank-identity.test.ts
import {
  classifyBankTransaction,
  needsDocument,
  counterpartKey,
  suggestIdentity,
  isPosPayoutDescription,
  bestSimilarMemory,
  type TxIdentity,
  type MemoryEntry,
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

console.log("\n— [FINDING-1] acquirer coverage matches ACQUIRER_VENDOR_RE (no missed double-count) —");
// These acquirers were in the fee-dedup regex but NOT the classifier, so their daily payout
// fell to the sign-based 'omzet' fallback and was double-counted on top of the till takings.
eq("Rabo OmniKassa payout credit", "Rabo OmniKassa", "afrekening periode 27", 2086.65, "pos_income");
eq("Worldline payout credit", "Worldline", "settlement", 1540.0, "pos_income");
eq("Nets payout credit", "Nets", "uitbetaling", 733.2, "pos_income");
eq("Buckaroo payout credit", "Buckaroo", "uitbetaling webshop", 410.0, "pos_income");
eq("Equens payout credit", "Equens", "CTAP afrekening", 999.9, "pos_income");
eq("Paysquare payout credit", "Paysquare", "afrekening", 512.0, "pos_income");
eq("Klarna payout credit", "Klarna", "uitbetaling", 305.5, "pos_income");
// The CREDIT gate must hold: a purchase AT one of these terminals (a DEBIT) is a cost, not takings.
eq("Worldline DEBIT (a purchase) is not takings", "Worldline", "betaalautomaat", -12.5, "unknown");
check("isPosPayoutDescription matches an acquirer name (for the omzet-mistap safety net)",
  isPosPayoutDescription("Rabo OmniKassa afrekening periode") === true);
check("isPosPayoutDescription is false for a non-acquirer transfer",
  isPosPayoutDescription("overboeking webshop bestelling 8842") === false);

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

console.log("\n— confident flag (governs safe bulk-apply) —");
check("memory match is confident",
  suggestIdentity("Shell", "brandstof", -60, "kosten").confident === true);
check("pattern match (tax) is confident",
  suggestIdentity("Belastingdienst", "BTW", -1200).confident === true);
check("pattern match (transfer) is confident",
  suggestIdentity(null, "Opname Geldautomaat", -100).confident === true);
check("pattern match (pos_income) is confident",
  suggestIdentity("ING DD&C", "Afrek.", 842.15).confident === true);
check("kosten fallback is NOT confident (never auto-apply)",
  suggestIdentity("Bol.com", "iDEAL", -49.99).confident === false);
check("omzet fallback is NOT confident (never auto-apply)",
  suggestIdentity("Onbekend", "overboeking", 250).confident === false);

console.log("\n— bestSimilarMemory (learn from a look-alike counterpart) —");
{
  const mem: MemoryEntry[] = [
    { key: "jansen", category: "kosten" },
    { key: "belastingdienst", category: "tax" },
    { key: "albert heijn", category: "kosten" },
  ];
  // Subset: the new name contains the whole memorized name → score 1.0.
  const h1 = bestSimilarMemory("jansen groothandel amsterdam", mem);
  check("subset match borrows the category", h1?.category === "kosten" && h1?.matchedKey === "jansen");
  // Superset the other way: memorized "albert heijn", new "albert heijn" + store no. → contained.
  const h2 = bestSimilarMemory("albert heijn 1234", mem);
  check("longer memorized name still matches on containment", h2?.category === "kosten");
  // No shared token at all → null.
  check("no overlap → null", bestSimilarMemory("gamma bouwmarkt", mem) === null);
  // Only a generic tussenvoegsel shared → null (no distinctive token).
  const genMem: MemoryEntry[] = [{ key: "van der berg", category: "kosten" }];
  check("shared tussenvoegsel only → null", bestSimilarMemory("van der meer", genMem) === null);
  // A distinctive shared surname DOES match despite the tussenvoegsel.
  check("distinctive surname overlap matches", bestSimilarMemory("van der berg holding", genMem)?.category === "kosten");
  // Ambiguous: two equally-similar memories disagree on category → suggest nothing.
  const ambMem: MemoryEntry[] = [
    { key: "amsterdam transport", category: "kosten" },
    { key: "amsterdam catering", category: "omzet" },
  ];
  check("equally-similar but conflicting categories → null", bestSimilarMemory("amsterdam handel", ambMem) === null);
  // An exact key is NOT a similarity hit (that path is exact-memory).
  check("exact key is excluded from similarity", bestSimilarMemory("jansen", [{ key: "jansen", category: "kosten" }]) === null);
  // Empty / null key → null.
  check("null key → null", bestSimilarMemory(null, mem) === null);

  // [REVIEW-FIX #1] An acquirer/PSP name is noise, not a distinctive identity token: two
  // unrelated shops settled via the same processor must NOT be matched on the processor name.
  check("worldline-prefixed unrelated shops don't match on the PSP name",
    bestSimilarMemory(counterpartKey("WORLDLINE*JANSEN"), [{ key: counterpartKey("WORLDLINE*PIETERSEN") ?? "", category: "kosten" }]) === null);
  check("a bare OmniKassa memory doesn't match every OmniKassa merchant",
    bestSimilarMemory(counterpartKey("OMNIKASSA ACME CATERING"), [{ key: counterpartKey("OMNIKASSA") ?? "x", category: "kosten" }]) === null);

  // [REVIEW-FIX #2] Duplicate tokens must never push the score above 1.0 and defeat the
  // ambiguity guard. "Jansen Jansen Advocaten" (kosten) vs "Jansen Bakkerij" (omzet) for query
  // "Jansen" is a genuine disagreeing tie → suggest nothing.
  const dupMem: MemoryEntry[] = [
    { key: "jansen jansen advocaten", category: "kosten" },
    { key: "jansen bakkerij", category: "omzet" },
  ];
  const dupHit = bestSimilarMemory("jansen", dupMem);
  check("duplicate tokens can't defeat the disagreeing-category guard", dupHit === null);
  check("score never exceeds 1.0", (bestSimilarMemory("jansen", [{ key: "jansen jansen advocaten", category: "kosten" }])?.score ?? 0) <= 1.0);

  // [REVIEW-FIX #3] A shared first name is not a business match.
  check("shared first name only → null",
    bestSimilarMemory("pieter bakker", [{ key: "pieter jansen", category: "kosten" }]) === null);
  check("shared SURNAME still matches (first name ignored, surname carries it)",
    bestSimilarMemory("pieter bakker", [{ key: "jan bakker", category: "kosten" }])?.category === "kosten");
}

console.log("\n— KEY_NOISE mirrors the POS acquirer list (no drift) —");
{
  // Every acquirer/PSP name the classifier recognises must also be stripped by counterpartKey,
  // or it re-enters as a false similarity token. Assert the specific ones the review flagged.
  for (const acq of ["worldline", "paysquare", "equens", "nets", "omnikassa"]) {
    check(`'${acq}' is stripped from the counterpart key`, counterpartKey(`${acq} WINKEL`) === "winkel");
  }
}

console.log("\n— suggestIdentity with a similar hit (review-only, never confident) —");
{
  const hit = { category: "kosten", matchedKey: "jansen", score: 1 };
  const s = suggestIdentity("Jansen Groothandel", "iDEAL", -320, null, hit);
  check("similar borrows the category", s.category === "kosten");
  check("similar source is 'similar'", s.source === "similar");
  check("similar is NEVER confident (never auto-applied)", s.confident === false);
  check("similar carries the look-alike key", s.similarTo === "jansen");
  // Exact memory still wins over a similar hit.
  const s2 = suggestIdentity("Jansen Groothandel", "iDEAL", -320, "prive", hit);
  check("exact memory beats similar", s2.source === "memory" && s2.category === "prive");
  // A confident pattern still beats a similar hit.
  const s3 = suggestIdentity("Belastingdienst", "BTW", -1200, null, hit);
  check("pattern (tax) beats similar", s3.source === "ai" && s3.category === "tax");
  // No similar hit → the plain sign fallback is unchanged.
  const s4 = suggestIdentity("Bol.com", "iDEAL", -49.99, null, null);
  check("no similar → sign fallback unchanged", s4.category === "kosten" && s4.confident === false && s4.source === "ai");
}

console.log("\n— [ATM-NARROW] 'opname' is not a cash word on its own —");
{
  // A recording session is a real, deductible cost. Classified 'transfer' it left the P&L AND
  // the voorbelasting, and applyLearnedBankCategories spread that verdict to every later line
  // from the same supplier.
  check("'Opname videoclip juni' is not a transfer",
    classifyBankTransaction("Studio Zuid", "Opname videoclip juni", -1210) !== "transfer");
  check("...it stays 'unknown' so it is reviewed, not hidden",
    classifyBankTransaction("Studio Zuid", "Opname videoclip juni", -1210) === "unknown");
  check("'Opname studio' likewise",
    classifyBankTransaction(null, "Opname studio Amsterdam", -450) === "unknown");
  // The real cash withdrawals must still be caught — they always name the machine or the cash.
  check("CONTROL geldautomaat is still a transfer",
    classifyBankTransaction(null, "Geldautomaat Kalverstraat", -100) === "transfer");
  check("CONTROL 'Geldopname' is still a transfer",
    classifyBankTransaction(null, "Geldopname pas 003", -50) === "transfer");
  check("CONTROL 'GEA' is still a transfer", classifyBankTransaction(null, "GEA NR:00123", -60) === "transfer");
  check("CONTROL 'Contante opname' is still a transfer",
    classifyBankTransaction(null, "Contante opname balie", -200) === "transfer");
  check("CONTROL savings withdrawal is still a transfer (TRANSFER_RE, not ATM_RE)",
    classifyBankTransaction(null, "Opname spaarrekening", -1000) === "transfer");
}

console.log("\n— [FEE-DEBIT-ONLY] interest RECEIVED is not a bank cost —");
{
  // 'fee' maps to PNL_ROLE 'kosten'. A credit landing there moves the result twice the wrong
  // way: the income is missing and an expense is invented.
  check("creditrente received is not classified as a fee",
    classifyBankTransaction(null, "Creditrente spaardeel", 45.2) !== "fee");
  check("...it stays 'unknown' rather than guessed into a category",
    classifyBankTransaction(null, "Creditrente spaardeel", 45.2) === "unknown");
  check("a bare 'rente' credit likewise",
    classifyBankTransaction(null, "Rente 2e kwartaal", 12.5) === "unknown");
  // Real bank costs are debits and must be untouched — they are deductible.
  check("CONTROL bankkosten (debit) is still a fee",
    classifyBankTransaction(null, "Bankkosten Zakelijk", -12.5) === "fee");
  check("CONTROL debetrente (debit) is still a fee",
    classifyBankTransaction(null, "Debetrente rood staan", -8.4) === "fee");
  check("CONTROL maandpakket (debit) is still a fee",
    classifyBankTransaction(null, "Maandpakket zakelijk", -14.95) === "fee");
  check("CONTROL a credit that is a POS payout is still income (order unchanged)",
    classifyBankTransaction("Mollie", "Afrek. 2026-06-30", 812.4) === "pos_income");
  check("CONTROL a fee-looking credit still needs no document",
    needsDocument(null, "Creditrente spaardeel", 45.2) === false);
}

console.log("\n— [TEKEN-EERST] een geheugen-hit is alleen zelfverzekerd als het teken meewerkt —");
{
  // 'omzet' onthouden en een AFSCHRIJVING zien: dit is een andere beweging dan de onthouden —
  // blind toepassen boekt omzet += een negatief bedrag, stil. Suggestie blijft, zekerheid niet.
  check("omzet-geheugen op een debet is nooit zelfverzekerd", suggestIdentity("Sligro", null, -250, "omzet").confident === false);
  check("…maar de suggestie zelf blijft staan", suggestIdentity("Sligro", null, -250, "omzet").category === "omzet");
  check("omzet-geheugen op een credit wél", suggestIdentity("Klant B.V.", null, 250, "omzet").confident === true);
  check("kosten-geheugen op een debet wél", suggestIdentity("Sligro", null, -250, "kosten").confident === true);
  check("kosten-geheugen op een BIJschrijving niet", suggestIdentity("Sligro", null, 250, "kosten").confident === false);
  // Andere categorieën (prive, transfer, …) kennen geen tekenregel: beide kanten komen echt voor.
  check("transfer-geheugen kent geen tekenregel", suggestIdentity("Eigen rekening", null, -100, "transfer").confident === true);
}

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
