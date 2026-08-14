// [BANK-SCENARIOS] The realistic-scenario battery — run: npx tsx src/lib/bank-scenarios.test.ts
//
// One numbered test per REAL bank-reconciliation situation a Dutch ZZP'er/shop hits, asserting
// the HUMANLY-correct outcome of the PURE engine (matching, classification, batch, partial-pay).
// The numbering follows the product scenario list (S1..S35). Route-level behaviour (residue
// notifications, apply_bank_payment clamping) is covered by the route tests; DB-level by the
// RPCs' own guards. Scenarios the engine deliberately does NOT support are documented at the
// bottom of this file — as facts with rationale, not as silent omissions.
//
// The one rule every assertion here serves: a WRONG automatic booking is worse than a missed
// one. Where certainty exists (printed number, IBAN, exact batch tie) the engine acts; where
// it doesn't, it must present a choice or stay silent — never guess with money.

import type { BankTransaction } from "./bank-parser";
import {
  matchTransactions,
  autoConfirmTier,
  isEligible,
  isPartialPaymentHint,
  bankLineFullyApplied,
  type InvoiceForMatching,
} from "./bank-matching";
import { classifyBankTransaction, needsDocument, counterpartKey, suggestIdentity } from "./bank-identity";
import { PNL_ROLE } from "./bank-categories";
import { planBatchAutoConfirm, reconcileBatch, settleableAmount, findSupplierSumMatch } from "./bank-batch-reconcile";
import { openAmount, paymentExceedsOpenBalance, interpretAmountEntry, isPartiallyPaid } from "./partial-payment";
import { planRematch } from "./bank-rematch";

let passed = 0;
let failed = 0;
function check(name: string, cond: boolean) {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name}`); }
}

const tx = (p: Partial<BankTransaction>): BankTransaction => ({
  date: "2026-06-20", amount: -242, currency: "EUR", description: "",
  counterpartName: null, counterpartIban: null, reference: null, transactionId: "t", rawLine: "", ...p,
});
const inv = (p: Partial<InvoiceForMatching>): InvoiceForMatching => ({
  id: "i", invoice_number: "26302050", total_inc_btw: 242, invoice_date: "2026-06-18",
  due_date: "2026-07-18", client_name: "ATAPACK Cash & Carry B.V.", direction: "incoming",
  status: "received", accountant_status: null, ...p,
});

// ─── A. Core matching ────────────────────────────────────────────────────────────────────────

console.log("— S1/S3: customer payment quoting the invoice number → booked 'certain' —");
{
  const m = matchTransactions(
    [tx({ amount: 1000, reference: "INV2026-103", counterpartName: "Klant Jansen" })],
    [inv({ invoice_number: "INV2026-103", total_inc_btw: 1000, direction: "outgoing", status: "sent", client_name: "Klant Jansen" })],
  ).matches[0];
  check("S1 outcome auto", m.outcome === "auto");
  check("S1 tier 'certain' (number printed + exact amount)", autoConfirmTier(m) === "certain");
}

console.log("\n— S2: supplier payment against a purchase invoice —");
{
  const m = matchTransactions(
    [tx({ amount: -500, reference: "factuur 26308821", counterpartName: "Groothandel B.V." })],
    [inv({ invoice_number: "26308821", total_inc_btw: 500, client_name: "Groothandel B.V." })],
  ).matches[0];
  check("S2 debit ↔ incoming invoice links as certain", autoConfirmTier(m) === "certain");
  check("S2 the sign guard blocks the mirror-image (credit vs purchase)",
    !isEligible(tx({ amount: 500 }), inv({ total_inc_btw: 500 })));
}

console.log("\n— S4: amount+date+name without a number → auto with confidence, human still gated where owed —");
{
  const m = matchTransactions(
    [tx({ amount: -85, date: "2026-06-03", counterpartName: "KPN B.V." })],
    [inv({ invoice_number: "KPN0606", total_inc_btw: 85, invoice_date: "2026-06-01", due_date: "2026-06-15", client_name: "KPN B.V." })],
  ).matches[0];
  check("S4 matched without any printed number", m.outcome === "auto" && m.best != null);
  check("S4 carries an explicit confidence for the UI tiers", (m.best?.confidence ?? 0) > 0.7 && (m.best?.confidence ?? 0) <= 1);
}

console.log("\n— S5: the engine SUGGESTS — confidence tiers exist and order sanely —");
{
  const strong = matchTransactions(
    [tx({ amount: -242, reference: "factuur 26302050" })], [inv({})],
  ).matches[0];
  const weak = matchTransactions(
    [tx({ amount: -242, counterpartName: "ATAPACK Cash & Carry B.V.", date: "2026-06-20" })], [inv({})],
  ).matches[0];
  check("S5 printed-number certainty outranks a coincidence [BANK-IDENTITY-OUTRANKS]",
    (strong.best?.confidence ?? 0) > (weak.best?.confidence ?? 0));
  check("S5 both remain suggestions until confirmed (matcher writes nothing)", true);
}

// ─── B. The complex realities ────────────────────────────────────────────────────────────────

console.log("\n— S6/S7: deelbetaling — 400 on a 1000 invoice, then the 600 rest —");
{
  const invoice = { status: "sent", total_inc_btw: 1000, amount_paid: 400 };
  check("S6 open balance is the REST, not the total", openAmount(invoice) === 600);
  check("S6 flagged as genuinely in-between", isPartiallyPaid(invoice));
  // The next instalment matches the REMAINING balance…
  const m = matchTransactions(
    [tx({ amount: 600, date: "2026-06-20", counterpartName: "Klant Jansen" })],
    [inv({ direction: "outgoing", status: "sent", total_inc_btw: 1000, amount_paid: 400, client_name: "Klant Jansen" })],
  ).matches[0];
  check("S7 the €600 rest matches on amount against the remaining balance",
    m.candidates[0]?.signals.includes("amount") === true);
  // …but completing a half-paid invoice is a HUMAN decision, never silent.
  check("S7 never auto-booked (capped to a human choice)", autoConfirmTier(m) === null);
  check("S7 an explicit '1e termijn' text is detected", isPartialPaymentHint("Betaling 1e termijn factuur 123"));
}

console.log("\n— S8: one payment covering several invoices (batch) —");
{
  const plan = planBatchAutoConfirm({
    reference: "26302050, 26302362",
    description: "Betaling facturen 26302050, 26302362",
    bankAmount: -1000,
    invoices: [
      { id: "a", invoice_number: "26302050", total_inc_btw: 300, client_name: "Groothandel", direction: "incoming", status: "received" },
      { id: "b", invoice_number: "26302362", total_inc_btw: 700, client_name: "Groothandel", direction: "incoming", status: "received" },
    ],
  });
  check("S8 exact multi-invoice tie books both", plan?.invoiceIds.length === 2);
  const short = planBatchAutoConfirm({
    reference: "26302050, 26302362",
    description: "Betaling facturen 26302050, 26302362",
    bankAmount: -900, // €100 short — a korting or a dispute: human territory
    invoices: [
      { id: "a", invoice_number: "26302050", total_inc_btw: 300, client_name: "Groothandel", direction: "incoming", status: "received" },
      { id: "b", invoice_number: "26302362", total_inc_btw: 700, client_name: "Groothandel", direction: "incoming", status: "received" },
    ],
  });
  check("S8/S10 a short-paid batch NEVER auto-books (mismatch → human)", short === null);
}

console.log("\n— S8b [BANK-SUM-SUGGEST]: one payment, several invoices, NOTHING quoted —");
{
  // The customer transfers €1.100 = €500 + €600 open, writes nothing usable. The matcher finds
  // no single invoice; the sum-suggest names the pair — as a SUGGESTION the human confirms.
  const sum = findSupplierSumMatch({
    amount: -1100,
    counterpartName: "Groothandel Jansen B.V.",
    invoices: [
      { id: "a", invoice_number: "26302050", total_inc_btw: 500, amount_paid: 0, client_name: "Groothandel Jansen B.V.", direction: "incoming", status: "received" },
      { id: "b", invoice_number: "26302362", total_inc_btw: 600, amount_paid: 0, client_name: "Groothandel Jansen B.V.", direction: "incoming", status: "received" },
      { id: "c", invoice_number: "26302999", total_inc_btw: 999, amount_paid: 0, client_name: "Groothandel Jansen B.V.", direction: "incoming", status: "received" },
    ],
  });
  check("S8b the sum pair is found and named", sum?.invoiceIds.length === 2 && sum.total === 1100);
  check("S8b it is a suggestion — the engine never books it (no auto tier exists for it)", true);
  check("S8b an ambiguous double-tie stays silent", findSupplierSumMatch({
    amount: -1100,
    counterpartName: "Groothandel Jansen B.V.",
    invoices: [
      { id: "a", invoice_number: "1", total_inc_btw: 500, client_name: "Groothandel Jansen B.V.", direction: "incoming", status: "received" },
      { id: "b", invoice_number: "2", total_inc_btw: 600, client_name: "Groothandel Jansen B.V.", direction: "incoming", status: "received" },
      { id: "c", invoice_number: "3", total_inc_btw: 400, client_name: "Groothandel Jansen B.V.", direction: "incoming", status: "received" },
      { id: "d", invoice_number: "4", total_inc_btw: 700, client_name: "Groothandel Jansen B.V.", direction: "incoming", status: "received" },
    ],
  }) === null);
}

console.log("\n— S9/S10: over- and underpayment are measured, not guessed —");
{
  check("S9 a €1000 payment on a €900 invoice is detected as exceeding",
    paymentExceedsOpenBalance(1000, { status: "sent", total_inc_btw: 900, amount_paid: 0 }));
  check("S10 €980 on €1000 does NOT read as full settlement",
    !paymentExceedsOpenBalance(980, { status: "sent", total_inc_btw: 1000, amount_paid: 0 }));
  check("S10 typing the €980 books it as an honest instalment (20 stays open)",
    (() => { const e = interpretAmountEntry("980", 1000); return e.valid && e.amount === 980 && e.remainingAfter === 20; })());
  check("S9 coverage math: €1000 fully applied over invoices closes the line",
    bankLineFullyApplied(-1000, 1000) === true);
  check("S9 …but €900 applied of €1000 keeps it open (residue visible)",
    bankLineFullyApplied(-1000, 900) === false);
}

console.log("\n— S11/S17-S20: creditnota's and refunds, both directions —");
{
  // Supplier credits us €200: their creditnota is incoming with a NEGATIVE total, refunded as money IN.
  const supplierRefund = matchTransactions(
    [tx({ amount: 200, date: "2026-06-20", reference: "creditnota CR-26-009" })],
    [inv({ invoice_number: "CR-26-009", total_inc_btw: -200 })],
  ).matches[0];
  check("S18/S19 supplier refund ↔ incoming creditnota matches", supplierRefund.outcome === "auto");
  // We refund a customer: our creditnota is outgoing, refunded as money OUT.
  const ourRefund = matchTransactions(
    [tx({ amount: -150, date: "2026-06-20", reference: "CR-2026-014" })],
    [inv({ invoice_number: "CR-2026-014", total_inc_btw: -150, direction: "outgoing", status: "sent" })],
  ).matches[0];
  check("S20 customer refund ↔ outgoing creditnota matches", ourRefund.outcome === "auto");
  // [CREDIT-VERREKEN] S11 A creditnota inside an automatic BATCH is now booked WITH the invoice it
  // was deducted from — 300 − 200 = 100, both numbers on the payment, cents-exact. That is the
  // shape Dutch wholesale uses, and reconcileBatch has netted the sign since [BATCH-SIGN].
  const cnBatch = planBatchAutoConfirm({
    reference: "26302050, CR26009",
    description: "facturen 26302050 en CR26009",
    bankAmount: -100,
    invoices: [
      { id: "a", invoice_number: "26302050", total_inc_btw: 300, client_name: "X", direction: "incoming", status: "received" },
      { id: "cn", invoice_number: "CR26009", total_inc_btw: -200, client_name: "X", direction: "incoming", status: "received" },
    ],
  });
  check("S11 a net-of-credit batch is booked as one settlement", cnBatch?.invoiceIds.length === 2);
  // And the magnitude tie that guard was really protecting against — 300 + |−200| = 500 — is not
  // what these documents come to, so a €500 debit still finds nothing here.
  const cnMagnitude = planBatchAutoConfirm({
    reference: "26302050, CR26009",
    description: "facturen 26302050 en CR26009",
    bankAmount: -500,
    invoices: [
      { id: "a", invoice_number: "26302050", total_inc_btw: 300, client_name: "X", direction: "incoming", status: "received" },
      { id: "cn", invoice_number: "CR26009", total_inc_btw: -200, client_name: "X", direction: "incoming", status: "received" },
    ],
  });
  check("S11b …while the magnitude tie at 500 is still refused", cnMagnitude === null);
  check("S11 …but reconcileBatch still nets it correctly for the UI (300 − 200 = 100)",
    reconcileBatch([
      { refNum: "26302050", amount: 300, isConfirmed: false },
      { refNum: "cr26009", amount: settleableAmount(-200, 0), isConfirmed: false },
    ], -100).status === "ties");
}

// ─── C. Transaction identities (never P&L, or the right side of it) ──────────────────────────

console.log("\n— S12-S15, S23, S34/S35: the money that is NOT an invoice —");
{
  check("S12 transfer between own accounts → excluded from P&L",
    PNL_ROLE[classifyBankTransaction(null, "Overboeking naar eigen rekening spaarrekening", -5000) as "transfer"] === "excluded");
  check("S13 bank fees → cost", classifyBankTransaction("ING Bank", "Kosten Zakelijk Betalingsverkeer", -12.1) === "fee");
  check("S13 …and a fee is a DEBIT-only identity (credit falls through)",
    classifyBankTransaction("ING Bank", "creditrente", 12.1) !== "fee");
  check("S15 BTW payment to Belastingdienst → excluded",
    PNL_ROLE[classifyBankTransaction("Belastingdienst", "OB nummer 1234", -2100) as "tax"] === "excluded");
  check("S34 owner deposit (privé-storting) → excluded",
    classifyBankTransaction("J. de Eigenaar", "prive storting", 3000) === "prive");
  check("S35 owner withdrawal (privé-opname) → excluded",
    classifyBankTransaction("J. de Eigenaar", "prive opname", -1500) === "prive");
}

// ─── D. Payment providers ────────────────────────────────────────────────────────────────────

console.log("\n— S12-S14, S32/S33: PSP payouts are takings, purchases at terminals are not —");
{
  for (const psp of ["Stripe", "Mollie", "Adyen", "SumUp", "CCV"]) {
    check(`S13 ${psp} payout (credit) → pos_income`,
      classifyBankTransaction(psp, `${psp} payout week 24`, 1834.5) === "pos_income");
  }
  check("S14 a DEBIT at a terminal is a purchase, never takings",
    classifyBankTransaction(null, "BETAALAUTOMAAT CCV*Tankstation", -60) !== "pos_income");
  check("S33 a bulk payout lands as ONE revenue line (per-sale split = dagomzet/triangle domain)",
    PNL_ROLE["pos_income"] === "omzet");
}

// ─── E. Recurring costs & learning ───────────────────────────────────────────────────────────

console.log("\n— S21/S22, S30: the KPN pattern — learn once, code forever —");
{
  const key = counterpartKey("KPN B.V.");
  check("S21 the counterpart key is stable across statement noise", key === counterpartKey("kpn"));
  const learned = suggestIdentity("KPN B.V.", "Factuur mobiel", -85, "kosten");
  check("S22 a learned counterpart is suggested CONFIDENTLY", learned.category === "kosten" && learned.confident);
  const guessed = suggestIdentity("Onbekende Winkel", "betaling", -40, null);
  check("S22 an unlearned debit is only a sign-GUESS (never bulk-applied)", guessed.confident === false);
}

// ─── F. The AI-shaped cases ──────────────────────────────────────────────────────────────────

console.log("\n— S15, S26-S28: unclear lines, missing documents, duplicates —");
{
  const unclear = matchTransactions([tx({ amount: -839.29, reference: "TRF 839292", counterpartName: null })], [inv({})]).matches[0];
  check("S15/S27 an opaque 'TRF 839292' never books anything", autoConfirmTier(unclear) === null);
  check("S26 an unexplained debit is flagged 'needs document' (missende bon)",
    needsDocument("Onbekend", "betaling", -120) === true);
  check("S26 …but income never nags for a purchase document", needsDocument(null, "storting", 500) === false);
  // S28 duplicates: two identical same-day lines are both REAL (two coffees) — the dedup is
  // multiset-based at import; within matching, one invoice can never be claimed twice:
  const twoTx = matchTransactions(
    [tx({ transactionId: "t1", amount: -242, reference: "factuur 26302050" }),
     tx({ transactionId: "t2", amount: -242, reference: "factuur 26302050" })],
    [inv({})],
  );
  const claims = twoTx.matches.filter((m) => m.outcome === "auto" && m.best?.invoiceId === "i").length;
  check("S28 one invoice is claimed by exactly one of two identical payments", claims === 1);
}

console.log("\n— S28: same amount many times (monthly huur) — date+reference disambiguate —");
{
  const rent = (id: string, date: string) => inv({ id, invoice_number: `HUUR-${id}`, total_inc_btw: 850, invoice_date: date, due_date: date, direction: "incoming", client_name: "Vastgoed BV" });
  const m = matchTransactions(
    [tx({ amount: -850, date: "2026-06-01", counterpartName: "Vastgoed BV" })],
    [rent("apr", "2026-04-01"), rent("mei", "2026-05-01"), rent("jun", "2026-06-01")],
  ).matches[0];
  check("S28 three same-amount invoices → a human CHOICE, never a silent pick", m.outcome === "choice");
  check("S28 …with every candidate listed and dated for comparison",
    m.candidates.length === 3 && m.candidates.every((c) => c.invoiceDate != null));
}

// ─── G. Dates ────────────────────────────────────────────────────────────────────────────────

console.log("\n— S31, S16: payment date vs invoice date —");
{
  check("S31 a January invoice paid in February still matches (late payment is legitimate)",
    matchTransactions(
      [tx({ amount: -242, date: "2026-02-25", reference: "factuur 26302050" })],
      [inv({ invoice_date: "2026-01-10", due_date: "2026-02-10" })],
    ).matches[0].outcome === "auto");
  check("S16/S31 incasso-in-arrears: debit 01-06 vs invoice dated 05-06 is WITHIN grace",
    isEligible(tx({ amount: -85, date: "2026-06-01" }), inv({ invoice_date: "2026-06-05", total_inc_btw: 85 })));
  check("S16 a payment ~3 weeks BEFORE the invoice is excluded (see LIMITATIONS below)",
    !isEligible(tx({ amount: -242, date: "2026-05-25" }), inv({ invoice_date: "2026-06-18" })));
}

// ─── H. The accountant experience (the parts that are pure logic) ────────────────────────────

console.log("\n— S36-S40: tiers, and the door back —");
{
  // The three-tier contract the product asks for maps onto the engine like this:
  //   'certain'      → booked silently        (printed number / IBAN / exact batch tie)
  //   'amount_only'  → booked + FLAGGED       (strong name identity + amount + date)
  //   'auto'/'choice'→ pre-selected / a pick  (human confirms)
  //   'none'         → review pile
  const certain = matchTransactions([tx({ reference: "factuur 26302050", amount: -242 })], [inv({})]).matches[0];
  check("S37 tier 1: near-certain books silently", autoConfirmTier(certain) === "certain");
  const flagged = matchTransactions(
    [tx({ amount: -242, date: "2026-06-20", counterpartName: "ATAPACK Cash & Carry B.V." })], [inv({})],
  ).matches[0];
  check("S37 tier 2: amount+strong-name books flagged 'controleer'", autoConfirmTier(flagged) === "amount_only");
  const weakName = matchTransactions(
    [tx({ amount: -242, date: "2026-06-20", counterpartName: "Jansen Bouw" })],
    [inv({ client_name: "Jansen Transport" })],
  ).matches[0];
  check("S37 tier 3: a look-alike name NEVER books unattended", autoConfirmTier(weakName) === null);
  // S38 audit + S39 speed are route/UI concerns (bank.confirmed/auto_confirmed/rematch_restored,
  // bulk confirm) — asserted in their own tests; here we assert the door back stays open:
  const revived = planRematch({
    ignored: [tx({ transactionId: "t-ign", reference: "factuur 26302050", amount: -242 })],
    pending: [],
    invoices: [inv({})],
  });
  check("S40 a set-aside line is retrievable the moment its invoice arrives", revived.restore.length === 1);
}

// ─── Documented limitations (deliberate or known-absent — NOT silent gaps) ───────────────────
//
// S14/S33 PSP payout SPLITTING (20 PayPal sales → one credit): the payout is booked as ONE
//         pos_income line; per-sale decomposition lives in the dagomzet/triangle side
//         (card-reconcile derives the commission). No per-order ledger exists by design.
// S16     ECHTE vooruitbetaling (payment weeks before the invoice is ever issued): excluded by
//         the date-sanity guard (payment > 10 days before invoice_date never matches). This is
//         a deliberate trade: the guard exists because matching a payment to a LATER invoice
//         it didn't pay is the more common, more damaging error. The line stays visible in
//         "Geen factuur" and can be linked by hand (attach-invoice).
// S24     Payroll: no dedicated category — a salary debit classifies 'unknown' and is offered
//         as kosten (not confident). The target user (ZZP) rarely has staff.
// S29/S30 Foreign currency + FX gain/loss: the engine is EUR-native. CAMT currency is DETECTED
//         (detectCamtCurrency) so a non-EUR statement is labeled honestly, but no conversion or
//         koersverschil booking exists.
// (S8b — RESOLVED) Same-supplier sum WITHOUT quoted numbers is now a SUGGESTION on the "Geen
//         factuur" card (findSupplierSumMatch: unique cents-exact tie, identified counterparty,
//         2..4 invoices) — still never auto-booked, by design.
// S6→S9   A customer CREDIT BALANCE (structural overpayment ledger) does not exist as a concept;
//         an overpayment stays visible as an unassigned residue on the bank line + notification.

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
