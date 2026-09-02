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

// ── De regels waarop dit de eerste keer fout ging ──────────────────────────────────────────────
//
// De eerste versie vroeg alleen "noemt de betaling een nummer, en is dat nummer onbekend". Tegen de
// productiedatabase gehouden vuurde dat op vrijwel alles: isReferenceNumberToken accepteert elk
// token van vier tekens met een cijfer erin. Deze vier regels komen letterlijk uit die database, en
// bij alle vier zou het scherm hebben gezegd "je hebt deze factuur nog niet toegevoegd" — over een
// belastingbetaling, een pensioenpremie, een waterrekening en de huur. Niet vaag: onwaar.

test("[WAAROM-WACHT-BANK] a Belastingdienst payment reference is not a missing invoice", () => {
  const r = judgeBankWait(
    regel({ counterpartName: "Belastingdienst", counterpartIban: "NL86INGB0002445588",
            reference: "2583366276601070", amount: -952 }),
    [factuur()],
  );
  assert.notEqual(r, "reference_not_in_administration",
    "a betalingskenmerk is not an invoice number, and no invoice for it will ever exist");
  assert.equal(r, "counterparty_unknown_here",
    "…and the sentence that IS true here is the one about rent, a loan or a category");
});

test("[WAAROM-WACHT-BANK] a pension fund, a water company and a landlord get the same answer", () => {
  const gevallen: Array<[string, string, string]> = [
    ["Stichting Bedrijfstakpensioenfonds", "E100732098, PN000026665", "een pensioenregeling"],
    ["Brabant Water N.V.", "610015412, 5049NM", "een klantnummer plus een postcode"],
    ["atalantix vastgoed cv", "Kiwi food market", "de huurder zijn eigen naam als kenmerk"],
    ["Joybuy", "7180154135428871, 1058102890000040830", "bestelnummers van een marktplaats"],
  ];
  for (const [naam, kenmerk, wat] of gevallen) {
    const r = judgeBankWait(
      regel({ counterpartName: naam, counterpartIban: "NL02RABO0999888777", reference: kenmerk, amount: -300 }),
      [factuur()],
    );
    assert.notEqual(r, "reference_not_in_administration",
      `${wat} (${naam}) is not an invoice number — accusing the owner of a missing invoice here is false`);
  }
});

test("[WAAROM-WACHT-BANK] but a supplier we DO hold invoices from is still named", () => {
  // De regel moet nog steeds vuren waar hij verdedigbaar is: van deze partij staan facturen open,
  // en de betaling noemt een nummer dat daar niet bij zit.
  const r = judgeBankWait(
    regel({ counterpartName: "Hano Groothandel B.V.", reference: "26702781", amount: -450 }),
    [factuur({ invoice_number: "2026001", total_inc_btw: 450 })],
  );
  assert.equal(r, "reference_not_in_administration");
});

test("[WAAROM-WACHT-BANK] a settled-up supplier stays silent rather than guessing", () => {
  // Bewust conservatief: een leverancier waarvan toevallig alles betaald is, staat niet in de open
  // pool, dus een échte ontbrekende factuur van hem blijft ongenoemd. Zwijgen is hier de goede
  // fout; een valse beschuldiging niet.
  const r = judgeBankWait(
    regel({ counterpartName: "Alles Betaald B.V.", counterpartIban: "NL02RABO0111222333",
            reference: "99887766", amount: -450 }),
    [factuur()],
  );
  assert.notEqual(r, "reference_not_in_administration");
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
