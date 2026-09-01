// src/lib/bank-waiting-reason.test.ts
// [WAAROM-WACHT-BANK] Rows that hit the branches — an empty pool agrees with every judgement.

import test from "node:test";
import assert from "node:assert/strict";
import { judgeBankWait, type WaitingBankLine } from "./bank-waiting-reason";
import type { InvoiceForMatching } from "./bank-matching";

function factuur(over: Partial<InvoiceForMatching> = {}): InvoiceForMatching {
  return {
    id: "i1", invoice_number: "2026001", total_inc_btw: 121, amount_paid: 0,
    invoice_date: "2026-08-01", due_date: "2026-08-31", client_name: "Hano Groothandel B.V.",
    direction: "incoming", status: "received", accountant_status: null,
    vendor_iban: "NL91ABNA0417164300", ...over,
  };
}
function regel(over: Partial<WaitingBankLine> = {}): WaitingBankLine {
  return {
    amount: -121, counterpartName: "Hano Groothandel B.V.",
    counterpartIban: "NL91ABNA0417164300", reference: null, description: "", ...over,
  };
}

test("[WAAROM-WACHT-BANK] a quoted number nowhere in the administration is named first", () => {
  // De enige reden hier waarvan het antwoord "de factuur ontbreekt" is in plaats van "kies er
  // één" — en de eigenaar is de enige die dat kan oplossen. Daarom vóór alle andere.
  const r = judgeBankWait(
    regel({ reference: "26702781", amount: -450 }),
    [factuur({ invoice_number: "2026001", total_inc_btw: 450 })],
  );
  assert.equal(r, "reference_not_in_administration",
    "even with an invoice at exactly this amount, a quoted unknown number is the better answer");
});

test("[WAAROM-WACHT-BANK] a quoted number that IS known is not a missing invoice", () => {
  const r = judgeBankWait(
    regel({ reference: "2026001", amount: -999 }),
    [factuur({ invoice_number: "2026001", total_inc_btw: 121 })],
  );
  assert.notEqual(r, "reference_not_in_administration");
});

test("[WAAROM-WACHT-BANK] silence in the payment text is not a missing invoice", () => {
  // Geen kenmerk betekent dat de bank niets meestuurde, niet dat er een factuur ontbreekt.
  const r = judgeBankWait(regel({ reference: null, amount: -121 }), [factuur()]);
  assert.notEqual(r, "reference_not_in_administration");
});

test("[WAAROM-WACHT-BANK] two open invoices at this exact amount is a choice, not a mystery", () => {
  const r = judgeBankWait(regel({ amount: -121 }), [
    factuur({ id: "a", invoice_number: "A1", total_inc_btw: 121 }),
    factuur({ id: "b", invoice_number: "B1", total_inc_btw: 121 }),
  ]);
  assert.equal(r, "several_invoices_this_amount");
});

test("[WAAROM-WACHT-BANK] a known party with nothing at this amount says exactly that", () => {
  const r = judgeBankWait(regel({ amount: -75 }), [factuur({ total_inc_btw: 121 })]);
  assert.equal(r, "counterparty_has_no_open_invoice_this_amount");
});

test("[WAAROM-WACHT-BANK] the remaining balance decides, not the printed total", () => {
  // Een tweede termijn van € 60,50 op een factuur van € 121 waarvan de helft al betaald is: het
  // bedrag KLOPT. Zou dit op het gedrukte totaal rekenen, dan zou het scherm de eigenaar naar een
  // ontbrekende factuur sturen die er gewoon is.
  const r = judgeBankWait(
    regel({ amount: -60.5 }),
    [factuur({ total_inc_btw: 121, amount_paid: 60.5 })],
  );
  assert.notEqual(r, "counterparty_has_no_open_invoice_this_amount",
    "the matcher targets the remaining balance, and this sentence must agree with the matcher");
});

test("[WAAROM-WACHT-BANK] an unknown counterparty is said apart from an empty administration", () => {
  // Twee verschillende antwoorden: "deze partij ken ik niet" en "er staat helemaal niets open".
  // Een lege administratie is geen uitspraak over déze tegenpartij.
  assert.equal(
    judgeBankWait(regel({ counterpartName: "Woningstichting", counterpartIban: "NL02RABO0123456789", amount: -800 }), [factuur()]),
    "counterparty_unknown_here",
  );
  assert.equal(judgeBankWait(regel({ amount: -800 }), []), "nothing_open_at_all");
});

test("[WAAROM-WACHT-BANK] the IBAN identifies the party even when the name does not", () => {
  const r = judgeBankWait(
    regel({ counterpartName: "HANO GROOTH BV INZ", amount: -75 }),
    [factuur({ client_name: "Iets Heel Anders", vendor_iban: "NL91ABNA0417164300" })],
  );
  assert.equal(r, "counterparty_has_no_open_invoice_this_amount",
    "the same account number is identity; a bank feed mangles names and never mangles IBANs");
});

test("[WAAROM-WACHT-BANK] a line with no amount is judged not at all", () => {
  assert.equal(judgeBankWait(regel({ amount: null }), [factuur()]), null,
    "an invented explanation on a money screen is worse than the blank the owner already had");
});

test("[WAAROM-WACHT-BANK] a party WITH an invoice at this amount gets no sentence from here", () => {
  // Eén open factuur van deze partij, exact dit bedrag, en tóch niet gekoppeld: dan weigerde de
  // matcher op iets wat deze module niet ziet. Zwijgen is dan het eerlijke antwoord.
  const r = judgeBankWait(regel({ amount: -121 }), [factuur({ total_inc_btw: 121 })]);
  assert.equal(r, null);
});
