// src/lib/bank-quoted-invoice.test.ts
// [AL-GEBOEKT] The four production lines from the screenshot, and the traps around them.
// Run: npx tsx --test src/lib/bank-quoted-invoice.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import { settledOnly, quotedSettledInvoice, type QuotedInvoiceRow } from "./bank-quoted-invoice";

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
