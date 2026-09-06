// src/lib/bank-quoted-invoice.test.ts
// [AL-GEBOEKT] The four production lines from the screenshot, and the traps around them.
// Run: npx tsx --test src/lib/bank-quoted-invoice.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import { settledOnly, quotedSettledInvoice, quotedInvoiceSet, type QuotedInvoiceRow } from "./bank-quoted-invoice";

const inv = (o: Partial<QuotedInvoiceRow> & { id: string }): QuotedInvoiceRow => ({
  invoice_number: null, total_inc_btw: null, status: "received", client_name: null,
  accountant_status: null, ...o,
});

// The rows exactly as production holds them.
const ECHT: QuotedInvoiceRow[] = [
  inv({ id: "a", invoice_number: "2919045", total_inc_btw: 797.86, status: "paid", client_name: "HVO Meat" }),
  inv({ id: "b", invoice_number: "2034382", total_inc_btw: 1056.87, status: "paid", client_name: "CAN Vleesgroothandel B.V." }),
  inv({ id: "c", invoice_number: "263591", total_inc_btw: 803.26, status: "paid", client_name: "GROOTHANDEL M.H. BAL V.O.F." }),
  inv({ id: "d", invoice_number: "FAC-2601629", total_inc_btw: 811.4, status: "paid", client_name: "NAR FOOD B.V." }),
  // …and the invoices the screen wrongly offered instead: same suppliers, still open.
  inv({ id: "w1", invoice_number: "3420623", total_inc_btw: 2449.64, status: "received", client_name: "HVO Meat" }),
  inv({ id: "w2", invoice_number: "264218", total_inc_btw: 820.29, status: "received", client_name: "BALKIP B.V." }),
];
const INDEX = settledOnly(ECHT);

test("[AL-GEBOEKT] each of the four reported payments names its settled invoice", () => {
  const gevallen = [
    { amount: -797.86, description: "USTD//2919045/", nummer: "2919045", partij: "HVO Meat" },
    { amount: -1056.87, description: "USTD//2034382/", nummer: "2034382", partij: "CAN Vleesgroothandel B.V." },
    { amount: -803.26, description: "USTD//263591/", nummer: "263591", partij: "GROOTHANDEL M.H. BAL V.O.F." },
    { amount: -811.4, description: "USTD//FAC-2601629/", nummer: "FAC-2601629", partij: "NAR FOOD B.V." },
  ];
  for (const g of gevallen) {
    const r = quotedSettledInvoice({ amount: g.amount, reference: null, description: g.description }, INDEX);
    assert.ok(r, `${g.nummer}: niet herkend, en dit is precies de regel uit de schermafbeelding`);
    assert.equal(r.invoiceNumber, g.nummer);
    assert.equal(r.clientName, g.partij);
    assert.equal(r.amountAgrees, true, `${g.nummer}: het bedrag komt tot op de cent overeen`);
  }
});

test("[AL-GEBOEKT] an OPEN invoice is never called already booked", () => {
  // De matcher kan hem gewoon aanbieden; hier iets zeggen zou een werkende keuze wegnemen.
  const r = quotedSettledInvoice({ amount: -2449.64, reference: null, description: "USTD//3420623/" }, INDEX);
  assert.equal(r, null);
});

test("[AL-GEBOEKT] an unknown number stays unknown", () => {
  // Dat is het gebied van reference_not_in_administration, en die weigert zelf al te beschuldigen
  // zonder open facturen van dezelfde partij.
  assert.equal(quotedSettledInvoice({ amount: -100, reference: null, description: "USTD//99999999/" }, INDEX), null);
  assert.equal(quotedSettledInvoice({ amount: -100, reference: null, description: "huur september" }, INDEX), null);
  assert.equal(quotedSettledInvoice({ amount: -100, reference: null, description: null }, INDEX), null);
});

test("[AL-GEBOEKT] the reference is read from both fields", () => {
  // Vier productieregels dragen hem in `description`; een SEPA-batch vult `reference`.
  const r = quotedSettledInvoice({ amount: -797.86, reference: "2919045", description: null }, INDEX);
  assert.ok(r && r.invoiceNumber === "2919045");
});

test("[AL-GEBOEKT] a payment that does NOT agree on amount is still named, but says so", () => {
  // Een deelbetaling of een tweede termijn op een al geboekte factuur: melden, maar niet beweren
  // dat het dezelfde euro's zijn. De zin op het scherm hangt aan dit onderscheid.
  const r = quotedSettledInvoice({ amount: -500, reference: null, description: "USTD//2919045/" }, INDEX);
  assert.ok(r);
  assert.equal(r.amountAgrees, false);
});

test("[AL-GEBOEKT] a draft or queued invoice is not 'already booked'", () => {
  // 'draft' is niet klaar en 'processing' heeft zijn eigen antwoord ([CIRKEL] linkt naar de
  // verificatiestap). Ze horen in EXCLUDED_STATUSES van de matcher, maar niet hier — dit scherm
  // zou anders zeggen dat een concept al betaald is.
  const idx = settledOnly([
    inv({ id: "x", invoice_number: "500001", total_inc_btw: 100, status: "draft" }),
    inv({ id: "y", invoice_number: "500002", total_inc_btw: 100, status: "processing" }),
  ]);
  assert.equal(quotedSettledInvoice({ amount: -100, reference: null, description: "USTD//500001/" }, idx), null);
  assert.equal(quotedSettledInvoice({ amount: -100, reference: null, description: "USTD//500002/" }, idx), null);
});

test("[AL-GEBOEKT] an accountant-locked invoice is reported apart", () => {
  // 'verwerkt' sluit het kwartaal: de vraag is dicht, maar de oplossing loopt via de boekhouder en
  // niet via een dubbele betaling. Aparte vlag, want aparte zin.
  const idx = settledOnly([
    inv({ id: "z", invoice_number: "600001", total_inc_btw: 250, status: "received", accountant_status: "verwerkt" }),
  ]);
  const r = quotedSettledInvoice({ amount: -250, reference: null, description: "USTD//600001/" }, idx);
  assert.ok(r);
  assert.equal(r.lockedByAccountant, true);
});

test("[AL-GEBOEKT] a settled duplicate is never masked by an open one with the same number", () => {
  // Twee rijen, één nummer: als de open rij wint blijft de kiezer staan en is de fout terug.
  const idx = settledOnly([
    inv({ id: "p", invoice_number: "700001", total_inc_btw: 40, status: "paid" }),
    inv({ id: "q", invoice_number: "700001", total_inc_btw: 40, status: "received" }),
  ]);
  const r = quotedSettledInvoice({ amount: -40, reference: null, description: "USTD//700001/" }, idx);
  assert.ok(r, "de betaalde rij moet gevonden worden, ook met een open naamgenoot ernaast");
  assert.equal(r.invoiceId, "p");
});

// ── [SOM-KLOPT] ────────────────────────────────────────────────────────────────────────────────
// Both cases below are production rows, not invented ones. They are the two screenshots that
// opened this task, and the arithmetic in them is the whole rule.


const alMalika = [
  { id: "a", invoice_number: "2601695", total_inc_btw: 162.19, status: "paid", client_name: "Al-Malika Bakkerij B.V." },
  { id: "b", invoice_number: "2601826", total_inc_btw: 148.68, status: "paid", client_name: "Al-Malika Bakkerij B.V." },
  { id: "c", invoice_number: "2601291", total_inc_btw: 155.43, status: "paid", client_name: "Al-Malika Bakkerij B.V." },
];

test("[SOM-KLOPT] three named invoices that add up to the payment ARE the answer", () => {
  // € 466,30 out, description "2601695, 2601826, 2601291". 162,19 + 148,68 + 155,43 = 466,30.
  // The screen offered a chooser of three and a card about one of them saying the amount did not
  // agree. Nothing was missing from the administration; the question had simply not been asked
  // over the whole set.
  const set = quotedInvoiceSet(
    { amount: -466.3, reference: null, description: "2601695, 2601826, 2601291" },
    alMalika,
  );
  assert.ok(set, "the payment names three settled invoices — this may not answer null");
  assert.equal(set!.settled.length, 3);
  assert.equal(Math.round(set!.total! * 100) / 100, 466.3);
  assert.equal(set!.coversPayment, true, "the sum is exact to the cent; the payment is explained");
  assert.deepEqual(set!.unknownNumbers, [], "every named number was found");
});

test("[SOM-KLOPT] one named invoice at the exact amount is equally the answer", () => {
  // Royal Food Center, € 1.955,90, description "2600999". The banner said this number "staat niet
  // in je administratie" directly above a card naming that very invoice.
  const set = quotedInvoiceSet(
    { amount: -1955.9, reference: null, description: "2600999" },
    [{ id: "r", invoice_number: "2600999", total_inc_btw: 1955.9, status: "paid", client_name: "Royal Food Center V.o.F" }],
  );
  assert.equal(set?.coversPayment, true);
  assert.equal(set?.settled.length, 1);
});

test("[SOM-KLOPT] a partial set says so instead of reading as complete", () => {
  // Two of the three entered, one not. This is the common real case, and dressing it up as
  // "settled" would book a payment against invoices that do not account for it.
  const set = quotedInvoiceSet(
    { amount: -466.3, reference: null, description: "2601695, 2601826, 2601291" },
    alMalika.slice(0, 2),
  );
  assert.equal(set?.coversPayment, false, "two invoices cannot cover a three-invoice payment");
  assert.deepEqual(set?.unknownNumbers, ["2601291"], "the missing number must be named");
});

test("[SOM-KLOPT] a creditnota subtracts, because that is what the supplier did with it", () => {
  // Invoice 900,00 minus creditnota 100,00, settled in one transfer of 800,00 naming both.
  // Adding the credit note would total 1000,00 and report a mismatch on the one arrangement
  // where the owner has done everything right.
  const set = quotedInvoiceSet(
    { amount: -800, reference: null, description: "9001 9002" },
    [
      { id: "f", invoice_number: "9001", total_inc_btw: 900, status: "paid", client_name: "X" },
      { id: "c", invoice_number: "9002", total_inc_btw: 100, status: "paid", client_name: "X", invoice_type: "creditnota" },
    ],
  );
  assert.equal(set?.total, 800);
  assert.equal(set?.coversPayment, true);
});

test("[SOM-KLOPT] a corrected invoice is counted once, not twice", () => {
  // A corrected invoice keeps the supplier's number and the old row is archived. Both rows are
  // 'settled', so a naive sum counts the same bill twice and turns a matching payment into a
  // mismatch — production holds exactly this pair on 2601291.
  const set = quotedInvoiceSet(
    { amount: -155.43, reference: null, description: "2601291" },
    [
      { id: "new", invoice_number: "2601291", total_inc_btw: 155.43, status: "paid", client_name: "Al-Malika Bakkerij B.V." },
      { id: "old", invoice_number: "2601291", total_inc_btw: 128.4, status: "archived", client_name: "Al-Malika Bakkerij B.V." },
    ],
  );
  assert.equal(set?.total, 155.43, "the archived predecessor must not be added a second time");
  assert.equal(set?.coversPayment, true);
  assert.equal(set?.settled.length, 2, "…but both rows are still shown, so the owner sees why");
});

test("[SOM-KLOPT] a bare year in a description is never reported as a missing invoice", () => {
  // "Huur juli 2026" would otherwise put 2026 in unresolvedNumbers on every rent payment, and
  // coversPayment would then be false on a set that is in fact complete.
  const set = quotedInvoiceSet(
    { amount: -162.19, reference: null, description: "Betaling 2601695 termijn 2026" },
    [alMalika[0]],
  );
  assert.deepEqual(set?.unknownNumbers, []);
  assert.equal(set?.coversPayment, true);
});

test("[SOM-KLOPT] naming nothing settled answers null, leaving the matcher alone", () => {
  assert.equal(quotedInvoiceSet({ amount: -50, reference: null, description: "huur" }, alMalika), null);
});

test("[SOM-KLOPT] a named invoice that is still OPEN is a candidate, not a missing one", () => {
  // The bug in the first version of this module, caught by the render test one layer up. A payment
  // names three invoices; two are booked and the third is in the administration and still open.
  // Reporting that third one as "staat nog niet in je administratie" is the same false accusation
  // this whole task started from, and taking the chooser away would strand a payment that has a
  // perfectly good invoice waiting to be linked.
  const set = quotedInvoiceSet(
    { amount: -466.3, reference: null, description: "2601695, 2601826, 2601291" },
    [
      alMalika[0], alMalika[1],
      { ...alMalika[2], status: "received" }, // open
    ],
  );
  assert.equal(set?.settled.length, 2);
  assert.equal(set?.open.length, 1, "the open invoice belongs in its own bucket");
  assert.equal(set?.open[0].invoiceNumber, "2601291");
  assert.deepEqual(set?.unknownNumbers, [], "it is NOT missing — it is right there, open");
  assert.equal(set?.coversPayment, true, "and it still counts toward the total, which adds up");
  assert.equal(set?.fullySettled, false,
    "…but the question is not closed: that open invoice still has to be linked, so the chooser " +
      "must stay. fullySettled is what decides that, never coversPayment on its own");
});

test("[SOM-KLOPT] everything named and booked, nothing else: then there is truly nothing to choose", () => {
  const set = quotedInvoiceSet(
    { amount: -466.3, reference: null, description: "2601695, 2601826, 2601291" },
    alMalika,
  );
  assert.equal(set?.fullySettled, true);
  assert.equal(set?.coversPayment, true);
});

// ── [CREDIT-TEKEN] The credit note that was summed as a bill ──────────────────────────────────
//
// Aardappelgroothandel Altena, one debit of € 170,27, description "2034 26700644 26700603".
// 26700644 is an invoice of € 306,27 and 26700603 is a creditnota of € 136,00: 306,27 − 136,00 is
// exactly the payment. The card said "Samen € 442,27, en deze betaling is € 170,27" and sent the
// owner looking for a bill that does not exist — because the creditnota reached this module through
// the OPEN invoice read, whose select never named invoice_type.
//
// The rows below are production's own, and the FIRST case deliberately leaves invoice_type out:
// that is how the row actually arrived, and the sum has to come out right anyway.

const ALTENA_ZONDER_TYPE: QuotedInvoiceRow[] = [
  inv({ id: "f", invoice_number: "26700644", total_inc_btw: 306.27, status: "paid", client_name: "Aardappelgroothandel Altena B.V." }),
  // Stored −136,00, as production holds it. No invoice_type — exactly what the old select returned.
  inv({ id: "c1", invoice_number: "26700603", total_inc_btw: -136, status: "received", client_name: "Aardappelgroothandel Altena B.V." }),
];

test("[CREDIT-TEKEN] the stored minus alone settles the sum — no invoice_type needed", () => {
  const set = quotedInvoiceSet(
    { amount: -170.27, reference: null, description: "2034 26700644 26700603" },
    ALTENA_ZONDER_TYPE,
  );
  assert.equal(set?.total, 170.27,
    "the creditnota was added instead of subtracted — the € 442,27 from the screenshot");
  assert.equal(set?.coversPayment, true, "306,27 − 136,00 IS the payment; the card must say so");
  assert.equal(set?.totalUnknownReason, null);
  // [CENT] And not 170.26999999999998: the running sum is float arithmetic.
  assert.equal(String(set?.total), "170.27", "the total reaches the screen unrounded");
});

test("[CREDIT-TEKEN] and with the type present it lands on the same number", () => {
  const met = ALTENA_ZONDER_TYPE.map((r) =>
    r.invoice_number === "26700603" ? { ...r, invoice_type: "creditnota" } : { ...r, invoice_type: "factuur" });
  const set = quotedInvoiceSet({ amount: -170.27, reference: null, description: "26700644 26700603" }, met);
  assert.equal(set?.total, 170.27, "the two witnesses must never disagree about the answer");
  assert.equal(set?.coversPayment, true);
});

test("[CREDIT-TEKEN] a creditnota with no minus and no type is still a credit by its type alone", () => {
  // The mirror of the case above: the owner ticked "dit is een creditnota" and the amount is
  // negative in the row. Either half is enough — that rule is creditStance's, not this file's.
  const set = quotedInvoiceSet(
    { amount: -170.27, reference: null, description: "26700644 26700603" },
    [
      inv({ id: "f", invoice_number: "26700644", total_inc_btw: 306.27, status: "paid", invoice_type: "factuur" }),
      inv({ id: "c1", invoice_number: "26700603", total_inc_btw: -136, status: "received", invoice_type: "creditnota" }),
    ],
  );
  assert.equal(set?.total, 170.27);
});

test("[CREDIT-TEKEN] typed 'creditnota' with positive money still subtracts, and says so per row", () => {
  // The app contradicting itself: the kind says credit, the money says debt. asCreditAmounts is
  // this product's standing answer for that state and it flips the amounts, so this module must
  // reach the SAME conclusion rather than invent a third one. What it may not do is print the
  // stored +136,00 next to a total that used −136,00 — hence isCredit on the row.
  const set = quotedInvoiceSet(
    { amount: -170.27, reference: null, description: "26700644 26700603" },
    [
      inv({ id: "f", invoice_number: "26700644", total_inc_btw: 306.27, status: "paid", invoice_type: "factuur" }),
      inv({ id: "c1", invoice_number: "26700603", total_inc_btw: 136, status: "received", invoice_type: "creditnota" }),
    ],
  );
  assert.equal(set?.total, 170.27, "a document typed 'creditnota' subtracts whatever its sign says");
  assert.equal(set?.coversPayment, true);
  const credit = [...(set?.settled ?? []), ...(set?.open ?? [])].find((q) => q.invoiceNumber === "26700603");
  assert.equal(credit?.isCredit, true, "the row must carry the sign the sum used, or nobody can check it");
  assert.equal(credit?.amount, 136, "…while amount stays what the administration actually holds");
  const factuur = set?.settled.find((q) => q.invoiceNumber === "26700644");
  assert.equal(factuur?.isCredit, false, "…and an ordinary invoice is not marked as one");
});

test("[NO-SILENT-EMPTY] an unreadable amount is its own reason, not the creditnota one", () => {
  const set = quotedInvoiceSet(
    { amount: -170.27, reference: null, description: "26700644 26700603" },
    [
      inv({ id: "f", invoice_number: "26700644", total_inc_btw: null, status: "paid", invoice_type: "factuur" }),
      inv({ id: "c1", invoice_number: "26700603", total_inc_btw: -136, status: "received", invoice_type: "creditnota" }),
    ],
  );
  assert.equal(set?.total, null);
  assert.equal(set?.totalUnknownReason, "amount", "the two silences need two different sentences");
});

// [NEGATIEVE CONTROLE] Every assertion above still passes if the sign is flipped the WRONG way for
// ordinary invoices, or if the module simply never produces a total. These two pin the other side.
test("[CREDIT-TEKEN] an ordinary invoice still counts POSITIVE", () => {
  const set = quotedInvoiceSet(
    { amount: -306.27, reference: null, description: "26700644" },
    [inv({ id: "f", invoice_number: "26700644", total_inc_btw: 306.27, status: "paid", invoice_type: "factuur" })],
  );
  assert.equal(set?.total, 306.27, "abs/negate got swapped: every normal payment now reads as a credit");
  assert.equal(set?.coversPayment, true);
});

test("[CREDIT-TEKEN] two credit notes subtract twice, not once", () => {
  const set = quotedInvoiceSet(
    { amount: -34.27, reference: null, description: "26700644 26700603 26700604" },
    [
      inv({ id: "f", invoice_number: "26700644", total_inc_btw: 306.27, status: "paid" }),
      inv({ id: "c1", invoice_number: "26700603", total_inc_btw: -136, status: "received" }),
      inv({ id: "c2", invoice_number: "26700604", total_inc_btw: -136, status: "received" }),
    ],
  );
  assert.equal(set?.total, 34.27);
  assert.equal(set?.coversPayment, true);
});
