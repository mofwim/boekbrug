// [BOEK-016] Pure node test for bank-matching.ts — run: npx tsx bank-matching.test.ts
import type { BankTransaction } from "./bank-parser";
import {
  matchTransactions,
  nameSimilarity,
  referenceMatches,
  amountMatches,
  dateProximityScore,
  isEligible,
  isFullyCovered,
  coveredReferenceNumbers,
  dedupeCandidates,
  isPartialPaymentHint,
  isSafeAutoConfirm,
  scorePair,
  normalizeIban,
  ibanMatches,
  DEFAULT_OPTIONS,
  type InvoiceForMatching,
  type MatchCandidate,
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
check("processing (verify queue) invoice excluded — never auto-paid before it's verified",
  !isEligible(tx({}), inv({ status: "processing" })));
check("archived invoice excluded",
  !isEligible(tx({}), inv({ status: "archived" })));
check("zero-amount transaction excluded",
  !isEligible(tx({ amount: 0 }), inv({})));
check("valid outgoing+credit is eligible",
  isEligible(tx({ amount: 1210 }), inv({})));
// [BANK-MATCH-ARREARS] Grace widened 3 → 10 days so a bill-in-arrears / SEPA incasso
// (charged on the 1st, invoice dated a few days later) still surfaces as a candidate.
check("incasso 4 days before the invoice date is STILL eligible (arrears grace)",
  isEligible(tx({ amount: -323.68, date: "2026-06-01" }),
             inv({ direction: "incoming", total_inc_btw: 323.68, invoice_date: "2026-06-05" })));
check("payment 8 days before the invoice date is eligible (within 10-day grace)",
  isEligible(tx({ amount: -100, date: "2026-06-02" }),
             inv({ direction: "incoming", total_inc_btw: 100, invoice_date: "2026-06-10" })));
check("payment 16 days before the invoice date is NOT eligible (previous month's bill)",
  !isEligible(tx({ amount: -100, date: "2026-05-30" }),
              inv({ direction: "incoming", total_inc_btw: 100, invoice_date: "2026-06-15" })));

// [M7-CREDITNOTA] A creditnota (negative total) reverses the money direction of its settlement.
console.log("\n— creditnota refunds (M7) —");
check("supplier creditnota (incoming, −total) refunded as money IN (credit) IS eligible",
  isEligible(tx({ amount: 100, date: "2026-06-10" }),
             inv({ direction: "incoming", total_inc_btw: -100, invoice_date: "2026-06-05" })));
check("our creditnota (outgoing, −total) refunded as money OUT (debit) IS eligible",
  isEligible(tx({ amount: -100, date: "2026-06-10" }),
             inv({ direction: "outgoing", total_inc_btw: -100, invoice_date: "2026-06-05" })));
check("creditnota still guarded: incoming creditnota with a DEBIT is NOT eligible",
  !isEligible(tx({ amount: -100, date: "2026-06-10" }),
              inv({ direction: "incoming", total_inc_btw: -100, invoice_date: "2026-06-05" })));
check("creditnota still guarded: outgoing creditnota with a CREDIT is NOT eligible",
  !isEligible(tx({ amount: 100, date: "2026-06-10" }),
              inv({ direction: "outgoing", total_inc_btw: -100, invoice_date: "2026-06-05" })));
check("a normal invoice is unchanged by the creditnota rule (credit → outgoing)",
  isEligible(tx({ amount: 100 }), inv({ direction: "outgoing", total_inc_btw: 100 })));
check("amountMatches: a +50 refund matches a −50 creditnota (magnitude)",
  amountMatches(50, -50, 0.02));
check("amountMatches: a −50 refund matches a −50 creditnota (magnitude)",
  amountMatches(-50, -50, 0.02));

// [BANK-IBAN] The counterpart's bank account is a strong, supplier-specific identity:
// a bare amount can collide across suppliers, a full IBAN cannot. With an EXACT amount it
// reaches auto-confirm; alone (wrong amount) it stays a weak, human-reviewed candidate.
console.log("\n— IBAN matching (BANK-IBAN) —");
check("normalizeIban strips spaces/dots + upper-cases",
  normalizeIban("nl91 abna 0417.1643 00") === "NL91ABNA0417164300");
check("normalizeIban rejects junk too short to be an IBAN (< 15)",
  normalizeIban("NL91") === "");
check("normalizeIban rejects an 8-char BIC (not a real IBAN)",
  normalizeIban("INGBNL2A") === "");
check("normalizeIban keeps a real 18-char NL IBAN",
  normalizeIban("NL91ABNA0417164300").length === 18);
check("normalizeIban of null/empty → ''",
  normalizeIban(null) === "" && normalizeIban(undefined) === "" && normalizeIban("") === "");
check("ibanMatches: same account, different formatting → true",
  ibanMatches("NL91 ABNA 0417 1643 00", "nl91abna0417164300"));
check("ibanMatches: different accounts → false",
  !ibanMatches("NL91ABNA0417164300", "NL02RABO0123456789"));
check("ibanMatches: a missing side never matches (no match on absence)",
  !ibanMatches(null, "NL91ABNA0417164300") && !ibanMatches("NL91ABNA0417164300", null));

// scorePair: incoming (purchase) invoice, no reference in the statement, but the debit
// carries the supplier's IBAN AND the exact amount → high confidence, 'iban'+'amount' signals.
{
  const t = tx({ amount: -723.19, date: "2026-06-10", reference: null, counterpartName: "Trimex International",
                 counterpartIban: "NL91 ABNA 0417 1643 00" });
  const i = inv({ id: "T", direction: "incoming", total_inc_btw: 723.19, invoice_date: "2026-06-08",
                  vendor_iban: "nl91abna0417164300", client_name: "Trimex" });
  const s = scorePair(t, i, DEFAULT_OPTIONS);
  check("scorePair IBAN + exact amount → confidence ≥ auto (0.7)", s.confidence >= 0.7);
  check("scorePair IBAN + amount → signals include 'iban' and 'amount'",
    s.signals.includes("iban") && s.signals.includes("amount"));
}
// scorePair: same supplier IBAN but the WRONG amount (a different invoice of theirs) →
// capped weak (≤ 0.35). A same-supplier invoice of another amount must never auto-pay.
{
  const t = tx({ amount: -999.00, date: "2026-06-10", reference: null,
                 counterpartIban: "NL91ABNA0417164300" });
  const i = inv({ id: "T2", direction: "incoming", total_inc_btw: 723.19, invoice_date: "2026-06-08",
                  vendor_iban: "NL91ABNA0417164300" });
  const s = scorePair(t, i, DEFAULT_OPTIONS);
  check("scorePair IBAN alone (wrong amount) → capped weak (≤ 0.35)", s.confidence <= 0.35);
}

// matchTransactions integration: a supplier debit with the invoice's IBAN + exact amount and
// no reference → 'auto' AND isSafeAutoConfirm true (the app books it without a human tap).
{
  const r = matchTransactions(
    [tx({ amount: -723.19, date: "2026-06-10", reference: null, counterpartName: "Trimex International",
          counterpartIban: "NL91ABNA0417164300" })],
    [inv({ id: "T", direction: "incoming", total_inc_btw: 723.19, invoice_date: "2026-06-08",
           vendor_iban: "NL91ABNA0417164300", client_name: "Trimex" }),
     inv({ id: "OTHER", direction: "incoming", total_inc_btw: 55.00, invoice_date: "2026-06-08",
           vendor_iban: "NL02RABO0123456789", client_name: "Andere" })]
  );
  const m = r.matches[0];
  check("IBAN + amount, no reference → auto on the right invoice",
    m.outcome === "auto" && m.best?.invoiceId === "T");
  check("IBAN + amount → isSafeAutoConfirm true (books without a tap)", isSafeAutoConfirm(m));
}
// Safety: two same-supplier, same-amount unpaid invoices (same IBAN) → a genuine tie →
// 'choice', never a wrong auto-pay. IBAN can't disambiguate identical bills; the human picks.
{
  const r = matchTransactions(
    [tx({ amount: -100.00, date: "2026-06-10", reference: null,
          counterpartIban: "NL91ABNA0417164300" })],
    [inv({ id: "P1", invoice_number: "A-100", direction: "incoming", total_inc_btw: 100.00, invoice_date: "2026-06-05",
           vendor_iban: "NL91ABNA0417164300" }),
     inv({ id: "P2", invoice_number: "A-101", direction: "incoming", total_inc_btw: 100.00, invoice_date: "2026-06-06",
           vendor_iban: "NL91ABNA0417164300" })]
  );
  const m = r.matches[0];
  check("two identical same-IBAN invoices → choice (a tie is never auto-paid)",
    m.outcome === "choice" && !isSafeAutoConfirm(m));
}
// Safety: IBAN + amount but the payment reference explicitly says 'deelbetaling' (instalment) →
// never a one-tap auto (the amount is only part of the bill).
{
  const r = matchTransactions(
    [tx({ amount: -723.19, date: "2026-06-10", reference: null, description: "1e termijn deelbetaling",
          counterpartIban: "NL91ABNA0417164300" })],
    [inv({ id: "T", direction: "incoming", total_inc_btw: 723.19, invoice_date: "2026-06-08",
           vendor_iban: "NL91ABNA0417164300" })]
  );
  check("IBAN + amount but flagged deelbetaling → not a safe auto-confirm",
    !isSafeAutoConfirm(r.matches[0]));
}

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

// 1b. [QF3] Reference match with the WRONG amount must NOT auto-mark the invoice paid.
{
  const r = matchTransactions(
    // €50 payment quoting invoice 001-2026 (€1210) — a partial/mis-referenced payment.
    [tx({ amount: 50, reference: "001-2026", counterpartName: "ONBEKEND" })],
    [inv({ id: "A", total_inc_btw: 1210 })]
  );
  const m = r.matches[0];
  check("wrong-amount reference → NOT auto (human choice)", m.outcome !== "auto");
  check("wrong-amount reference → still listed as a candidate", (m.candidates?.length ?? 0) > 0);
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
  // Regression: two space-separated numbers must NOT fuse and hide a real match.
  check("'1001' matches in '12345 1001' (numbers not fused)", referenceMatches(t("12345 1001"), "1001") === true);
  check("year-based '2026-014' matches next to another number", referenceMatches(t("ordernr 99 2026-014"), "2026-014") === true);
  check("hyphenated number matches its printed form", referenceMatches(t("betaling 2026-014 voldaan"), "2026-014") === true);
  check("still rejects a fragment inside a longer fused number", referenceMatches(t("betaling 992026014"), "2026014") === false);
  // [TRUST-MATCH-ALNUM] alphanumeric invoice numbers get the same digit-boundary guard.
  check("'MF26' does NOT match 'MF260' (next sequence number)", referenceMatches(t("betaling MF260"), "MF26") === false);
  check("'MF26' matches exact 'MF26'", referenceMatches(t("betaling MF26 voldaan"), "MF26") === true);
  check("'F2026-01' does NOT match 'F2026-011'", referenceMatches(t("ref F2026011"), "F2026-01") === false);
  check("'F2026-01' matches its printed form", referenceMatches(t("betaling F2026-01"), "F2026-01") === true);
  // A printed letter PREFIX on a numeric invoice number still matches (INV2050 ⊃ 2050).
  check("numeric '2050' still matches inside 'INV2050' (letter prefix ok)", referenceMatches(t("ref INV2050"), "2050") === true);
  check("'INV2050' does NOT match 'INV20500'", referenceMatches(t("ref INV20500"), "INV2050") === false);
}

// [BANK-PSP-MATCH] The HorecaRama case: a PSP (Mollie) debit whose remittance carries a
// transaction hash + order number — NOT the invoice number — must still find the real
// invoice by amount + counterpart. The engine already does; the bug was in the UI (a
// >1 reference-fragment count forced the multi-invoice slot view, which hid this
// amount-matched candidate). This locks the engine behaviour the UI fix relies on.
console.log("\n— [BANK-PSP-MATCH] a PSP payment with a junk reference still matches the real invoice by amount —");
{
  const r = matchTransactions(
    [tx({
      amount: -914.76, // incoming supplier invoice → money out (debit)
      date: "2026-05-27",
      reference: "8152314131466030 72802",
      description: "a54208441c0a8afc8fb6e9eec515c17 8152314131466030 Order ORD 72802 horecarama.nl HorecaRama",
      counterpartName: "HorecaRama via Stichting Mollie Payments",
    })],
    [inv({
      id: "hr-82910",
      invoice_number: "82910",
      total_inc_btw: 914.76,
      invoice_date: "2026-05-27",
      due_date: "2026-06-10",
      client_name: "HorecaRama BV",
      direction: "incoming",
      status: "received",
    })],
  );
  const m = r.matches[0];
  check("the real invoice IS a candidate (not 'none')", m.outcome !== "none" && m.candidates.length >= 1);
  check("candidate is invoice 82910", m.candidates.some((c) => c.invoiceNumber === "82910"));
  check("it matched on amount (not reference)", m.candidates[0]?.signals.includes("amount") === true && !m.candidates[0]?.signals.includes("reference"));
}

console.log("\n— [BANK-SLOT-PERSIST] coveredReferenceNumbers reports the paid subset —");
{
  const paid = new Set(["26302050"]); // only the first invoice of the batch is paid
  const covered = coveredReferenceNumbers("26302050, 26302362", paid);
  check("returns the paid reference number", covered.length === 1 && covered[0] === "26302050");
  check("does not report the still-open number", !covered.includes("26302362"));
  check("both paid → both covered", coveredReferenceNumbers("26302050, 26302362", new Set(["26302050", "26302362"])).length === 2);
  check("none paid → empty", coveredReferenceNumbers("26302050, 26302362", new Set<string>()).length === 0);
  // Consistency with isFullyCovered: covered==refNumbers ⇔ fully covered.
  check("covered-all agrees with isFullyCovered", isFullyCovered("26302050, 26302362", new Set(["26302050", "26302362"])) === true);
}

console.log("\n— [BANK-DEDUP-CANDIDATES] a duplicate invoice is collapsed, a collision is not —");
{
  const cand = (invoiceId: string, invoiceNumber: string | null, amount: number | null, confidence: number): MatchCandidate =>
    ({ invoiceId, invoiceNumber, amount, invoiceDate: "2026-05-06", confidence, signals: ["amount"], reason: "" });
  // famzfood: same number (different whitespace) + same amount → one candidate kept (highest conf).
  const deduped = dedupeCandidates([
    cand("a", "26 / 3958", 630.15, 0.9),
    cand("b", "26/3958", 630.15, 0.7),
  ]);
  check("same number+amount collapses to ONE", deduped.length === 1);
  check("keeps the higher-confidence one", deduped[0].invoiceId === "a");
  // Same number but DIFFERENT amount (a mere collision) → both kept, nothing hidden.
  check("same number, different amount → both kept",
    dedupeCandidates([cand("a", "INV1", 100, 0.9), cand("b", "INV1", 200, 0.8)]).length === 2);
  // No usable number → never collapsed.
  check("null-number candidates are never collapsed",
    dedupeCandidates([cand("a", null, 100, 0.9), cand("b", null, 100, 0.8)]).length === 2);
}

console.log("\n— [BANK-DEDUP-CANDIDATES] matchTransactions shows a duplicate invoice once —");
{
  const r = matchTransactions(
    [tx({ amount: -630.15, date: "2026-05-06", counterpartName: "famzfood", reference: "26 3958" })],
    [
      inv({ id: "d1", invoice_number: "26 / 3958", total_inc_btw: 630.15, direction: "incoming", client_name: "famzfood", invoice_date: "2026-05-06" }),
      inv({ id: "d2", invoice_number: "26/3958", total_inc_btw: 630.15, direction: "incoming", client_name: "famzfood", invoice_date: "2026-05-06" }),
    ],
  );
  check("only one candidate is offered (not the duplicate twice)", r.matches[0].candidates.length === 1);
}

console.log("\n— [BANK-PARTIAL] instalment references are detected and kept out of auto —");
{
  check("'Tweede deel factuur 26302050' → partial", isPartialPaymentHint("Tweede deel factuur 26302050") === true);
  check("'2e termijn' → partial", isPartialPaymentHint("betaling 2e termijn") === true);
  check("'deelbetaling' → partial", isPartialPaymentHint("deelbetaling order 99") === true);
  check("'aanbetaling' → partial", isPartialPaymentHint("aanbetaling project") === true);
  check("a normal payment is NOT partial", isPartialPaymentHint("betaling factuur 2026-014 voldaan") === false);
  check("'termijnen' inside a word does not falsely fire", isPartialPaymentHint("kortermijnlening") === false);

  // scorePair: a reference + exact amount would be 0.97 auto, but an instalment marker
  // caps it to a human choice (<= 0.6), so it never one-taps the invoice fully paid.
  const partial = scorePair(
    tx({ amount: -500, reference: "26302050", description: "Tweede deel factuur 26302050" }),
    inv({ invoice_number: "26302050", total_inc_btw: 500, direction: "incoming", status: "received" }),
    DEFAULT_OPTIONS,
  );
  check("instalment ref caps confidence below auto (0.7)", partial.confidence <= 0.6);
  check("a clean full payment still reaches auto", scorePair(
    tx({ amount: -500, reference: "26302050", description: "betaling 26302050" }),
    inv({ invoice_number: "26302050", total_inc_btw: 500, direction: "incoming", status: "received" }),
    DEFAULT_OPTIONS,
  ).confidence >= DEFAULT_OPTIONS.autoConfidence);
}

console.log("\n— [BANK-CHOICE-NOCLAIM] an ambiguous choice does not steal a candidate from another tx —");
{
  // Two €500 "Jansen" credits, two €500 "Jansen" invoices → each tx matches both by
  // amount+counterpart (a genuine ambiguous choice). Neither may claim, so BOTH keep both
  // options for the owner to resolve — no false "geen factuur", no forced auto.
  const r = matchTransactions(
    [
      tx({ amount: 500, date: "2026-02-12", counterpartName: "Jansen BV" }),
      tx({ amount: 500, date: "2026-02-13", counterpartName: "Jansen BV" }),
    ],
    [
      inv({ id: "x", invoice_number: "JAN-1", total_inc_btw: 500, direction: "outgoing", client_name: "Jansen BV", invoice_date: "2026-02-01" }),
      inv({ id: "y", invoice_number: "JAN-2", total_inc_btw: 500, direction: "outgoing", client_name: "Jansen BV", invoice_date: "2026-02-02" }),
    ],
  );
  check("first tx is a choice (not forced auto)", r.matches[0].outcome === "choice");
  check("second tx is NOT 'none' (candidate wasn't stolen)", r.matches[1].outcome !== "none");
  check("both txns keep both candidates", r.matches[0].candidates.length === 2 && r.matches[1].candidates.length === 2);
}

console.log("\n— [BANK-AUTO-CONFIRM] only a near-certain single match is safe to auto-book —");
{
  const safe = matchTransactions(
    [tx({ amount: 1210, reference: "001-2026" })],
    [inv({ invoice_number: "001-2026", total_inc_btw: 1210 })],
  );
  check("reference + exact amount, single invoice → safe", isSafeAutoConfirm(safe.matches[0]) === true);

  // Amount + counterpart only (no invoice number in the statement) → NOT safe to auto-book.
  const amountOnly = matchTransactions(
    [tx({ amount: 1210, date: "2026-02-12", counterpartName: "Jansen BV" })],
    [inv({ invoice_number: "X-9", total_inc_btw: 1210, client_name: "Jansen BV", invoice_date: "2026-02-01" })],
  );
  check("amount+counterpart only → NOT safe (no reference)", isSafeAutoConfirm(amountOnly.matches[0]) === false);

  // A multi-invoice batch (two reference numbers) → NOT safe (needs allocation).
  const multi = matchTransactions(
    [tx({ amount: 1210, reference: "001-2026, 002-2026" })],
    [
      inv({ id: "a", invoice_number: "001-2026", total_inc_btw: 700 }),
      inv({ id: "b", invoice_number: "002-2026", total_inc_btw: 510 }),
    ],
  );
  check("multi-invoice batch → NOT safe", isSafeAutoConfirm(multi.matches[0]) === false);

  // Reference + amount BUT flagged an instalment → NOT safe (stays human).
  const instalment = matchTransactions(
    [tx({ amount: 1210, reference: "001-2026", description: "2e termijn factuur 001-2026" })],
    [inv({ invoice_number: "001-2026", total_inc_btw: 1210 })],
  );
  check("instalment reference → NOT safe", isSafeAutoConfirm(instalment.matches[0]) === false);

  // Reference without a matching amount (a €50 quote of a €500 invoice) → choice → NOT safe.
  const wrongAmount = matchTransactions(
    [tx({ amount: 50, reference: "001-2026" })],
    [inv({ invoice_number: "001-2026", total_inc_btw: 500 })],
  );
  check("reference but wrong amount → NOT safe", isSafeAutoConfirm(wrongAmount.matches[0]) === false);
}

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);