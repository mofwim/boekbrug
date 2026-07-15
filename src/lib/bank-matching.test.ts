// [BOEK-016] Pure node test for bank-matching.ts — run: npx tsx bank-matching.test.ts
import type { BankTransaction } from "./bank-parser";
import {
  matchTransactions,
  nameSimilarity,
  referenceMatches,
  amountMatches,
  dateProximityScore,
  isEligible,
  type InvoiceForMatching,
} from "./bank-matching";

let passed = 0;
let failed = 0;
function check(name: string, cond: boolean) {
  if (cond) {
    passed++;
    console.log(`  ✓ ${name}`);
  } else {
    failed++;
    console.log(`  ✗ ${name}`);
  }
}

function tx(p: Partial<BankTransaction>): BankTransaction {
  return {
    date: "2026-02-10",
    amount: 1210,
    currency: "EUR",
    description: "",
    counterpartName: null,
    counterpartIban: null,
    reference: null,
    transactionId: null,
    rawLine: "",
    ...p,
  };
}
function inv(p: Partial<InvoiceForMatching>): InvoiceForMatching {
  return {
    id: "inv-x",
    invoice_number: "001-2026",
    total_inc_btw: 1210,
    invoice_date: "2026-02-01",
    due_date: "2026-02-15",
    client_name: "Jansen BV",
    direction: "outgoing",
    status: "sent",
    accountant_status: null,
    ...p,
  };
}

console.log("\n— unit helpers —");
check("normalizeRef finds invoice nr in noisy desc",
  referenceMatches({ reference: null, description: "Betaling factuur 001-2026 bedankt" }, "001-2026"));
check("referenceMatches rejects short number '12'",
  !referenceMatches({ reference: "12", description: "" }, "12"));
check("amountMatches exact within epsilon",
  amountMatches(-1210.0, 1210.005, 0.01));
check("amountMatches rejects different amount",
  !amountMatches(1210, 1300, 0.01));
check("dateProximity highest when same day",
  dateProximityScore("2026-02-01", "2026-02-01", null, 45) > 0.24);
check("dateProximity zero beyond window",
  dateProximityScore("2026-06-01", "2026-02-01", null, 45) === 0);
check("nameSimilarity strips legal suffix (Jansen BV ~ JANSEN)",
  nameSimilarity("JANSEN BV", "Jansen") >= 0.9);
check("nameSimilarity containment (extra words still match)",
  nameSimilarity("JANSEN BV INZAKE FACTUUR", "Jansen BV") >= 0.85);
check("nameSimilarity unrelated names ~ low",
  nameSimilarity("De Vries Bouw", "Pietersen Transport") < 0.2);
// [BANK-MATCH-PSP] processor prefixes are stripped so the merchant still matches
check("nameSimilarity strips SumUp prefix (SUMUP *JANSEN ~ Jansen BV)",
  nameSimilarity("SUMUP *JANSEN", "Jansen BV") >= 0.85);
check("nameSimilarity strips CCV prefix (CCV*De Vries ~ De Vries)",
  nameSimilarity("CCV*De Vries", "De Vries") >= 0.85);
check("nameSimilarity strips iDEAL prefix (iDEAL Bol.com ~ Bol.com)",
  nameSimilarity("iDEAL Bol.com", "Bol.com") >= 0.85);
check("nameSimilarity PSP noise doesn't fabricate a match",
  nameSimilarity("SUMUP *JANSEN", "Pietersen Transport") < 0.2);

console.log("\n— eligibility (direction / status / B.4) —");
check("credit (+) excludes incoming invoice",
  !isEligible(tx({ amount: 500 }), inv({ direction: "incoming" })));
check("debit (-) excludes outgoing invoice",
  !isEligible(tx({ amount: -500 }), inv({ direction: "outgoing" })));
check("verwerkt invoice excluded (B.4)",
  !isEligible(tx({}), inv({ accountant_status: "verwerkt" })));
check("paid invoice excluded",
  !isEligible(tx({}), inv({ status: "paid" })));
check("draft invoice excluded",
  !isEligible(tx({}), inv({ status: "draft" })));
check("zero-amount transaction excluded",
  !isEligible(tx({ amount: 0 }), inv({})));
check("valid outgoing+credit is eligible",
  isEligible(tx({ amount: 1210 }), inv({})));

console.log("\n— outcomes —");

// 1. Reference match → auto
{
  const r = matchTransactions(
    [tx({ amount: 1210, reference: "001-2026", counterpartName: "ONBEKEND" })],
    [inv({ id: "A" }), inv({ id: "B", invoice_number: "002-2026", total_inc_btw: 999 })]
  );
  const m = r.matches[0];
  check("reference match → auto", m.outcome === "auto" && m.best?.invoiceId === "A");
  check("reference match signals include 'reference'", !!m.best?.signals.includes("reference"));
}

// 2. Amount + date + counterpart → auto
{
  const r = matchTransactions(
    [tx({ amount: 1210, date: "2026-02-12", counterpartName: "JANSEN BV" })],
    [inv({ id: "A", client_name: "Jansen BV" })]
  );
  check("amount+date+counterpart → auto", r.matches[0].outcome === "auto");
}

// 3. Two same-amount invoices, unknown counterpart → choice (ambiguity)
{
  const r = matchTransactions(
    [tx({ amount: 1210, date: "2026-02-12", counterpartName: null })],
    [
      inv({ id: "A", client_name: "Jansen BV" }),
      inv({ id: "B", client_name: "De Vries", invoice_number: "002-2026" }),
    ]
  );
  const m = r.matches[0];
  check("two same-amount, no counterpart → choice", m.outcome === "choice");
  check("choice lists both candidates", m.candidates.length === 2);
}

// 4. Two same-amount invoices, counterpart distinguishes → auto for the right one
{
  const r = matchTransactions(
    [tx({ amount: 1210, date: "2026-02-12", counterpartName: "De Vries" })],
    [
      inv({ id: "A", client_name: "Jansen BV" }),
      inv({ id: "B", client_name: "De Vries", invoice_number: "002-2026" }),
    ]
  );
  const m = r.matches[0];
  check("counterpart breaks the tie → auto on B", m.outcome === "auto" && m.best?.invoiceId === "B");
}

// 5. No match (amount off, no reference) → none
{
  const r = matchTransactions(
    [tx({ amount: 77.5, date: "2026-02-12", counterpartName: "Random" })],
    [inv({ id: "A" })]
  );
  check("unrelated transaction → none", r.matches[0].outcome === "none");
}

// 6. Incoming invoice matched by a debit (negative) → auto
{
  const r = matchTransactions(
    [tx({ amount: -450, date: "2026-03-02", reference: "INK-2026-44" })],
    [inv({ id: "V", direction: "incoming", status: "received", invoice_number: "INK-2026-44", total_inc_btw: 450 })]
  );
  const m = r.matches[0];
  check("incoming debit → auto match", m.outcome === "auto" && m.best?.invoiceId === "V");
}

// 7. Aggregate counts
{
  const r = matchTransactions(
    [
      tx({ amount: 1210, reference: "001-2026" }),   // auto
      tx({ amount: 77.5, counterpartName: "X" }),     // none
    ],
    [inv({ id: "A" })]
  );
  check("aggregate counts correct", r.autoCount === 1 && r.noneCount === 1 && r.choiceCount === 0);
}

console.log("\n— [TRUST-MATCH] a short numeric invoice number must not match inside a longer number —");
{
  const t = (r: string) => ({ reference: r, description: "" });
  check("'2050' does NOT match inside '26302050' (no wrong auto-pick)", referenceMatches(t("26302050"), "2050") === false);
  check("exact '26302050' still matches", referenceMatches(t("26302050"), "26302050") === true);
  check("'2050' matches as a clean whole token", referenceMatches(t("factuur 2050 voldaan"), "2050") === true);
  check("real invoice number in description matches", referenceMatches(t("betaling 2026014"), "2026-014") === true);
  check("alphanumeric needle keeps substring match", referenceMatches(t("ref inv2050 x"), "INV2050") === true);
  check("too-short (<4) still rejected", referenceMatches(t("999"), "999") === false);
}

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);