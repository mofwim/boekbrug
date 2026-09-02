// src/lib/grounded-substitute.test.ts
// [GEGROND-STAAT-IN] The one door this change opens, and the many it must leave shut.
//
// This is a MONEY gate being widened, so the tests are written the other way round from usual:
// most of them assert that something still REFUSES. The single passing case is the one measured in
// production — the reader knew everything, flagged nothing, and had no per-amount score.

import test from "node:test";
import assert from "node:assert/strict";
import { moneyGroundedInText } from "./amount-grounding";
import { shouldAutoAdvanceInvoice, type AutoAdvanceSignals } from "./auto-advance";

// ── De getuige ────────────────────────────────────────────────────────────────

const drieGevonden = { _grounding: { totalIncBtw: "found", totalExBtw: "found", btwAmount: "found" } };

test("[GEGROND-STAAT-IN] all three printed in the text is the only yes", () => {
  assert.equal(moneyGroundedInText(drieGevonden), true);
  assert.equal(moneyGroundedInText({ _grounding: { ...drieGevonden._grounding, source: "text" } }), true,
    "an explicit 'text' source is the same as none — that is what those rows were");
});

test("[GEGROND-STAAT-IN] two of three is not the witness this door asks for", () => {
  // Het totaal alleen is de vorm die verdictBlocksAutoBooking weegt om te WEIGEREN. Om door te
  // laten wordt de sterkste vorm gevraagd, want de vraag is de omgekeerde.
  for (const ontbreekt of ["totalIncBtw", "totalExBtw", "btwAmount"]) {
    const g = { ...drieGevonden._grounding, [ontbreekt]: "absent" };
    assert.equal(moneyGroundedInText({ _grounding: g }), false, `${ontbreekt} absent must not pass`);
    const u = { ...drieGevonden._grounding, [ontbreekt]: "unreadable" };
    assert.equal(moneyGroundedInText({ _grounding: u }), false, `${ontbreekt} unreadable must not pass`);
  }
});

test("[GEGROND-STAAT-IN] OCR is corroboration, never a stand-in — that would be the model vouching for itself", () => {
  assert.equal(moneyGroundedInText({ _grounding: { ...drieGevonden._grounding, source: "ocr" } }), false,
    "the OCR witness is a model from the same family as the extractor; letting it replace the " +
    "model's own score is the exact circularity amount-grounding.ts exists to break");
});

test("[GEGROND-STAAT-IN] an unknown witness is not a stronger one", () => {
  assert.equal(moneyGroundedInText({ _grounding: { ...drieGevonden._grounding, source: "iets-nieuws" } }), false);
});

test("[GEGROND-STAAT-IN] nothing, rubbish and a missing check all answer no", () => {
  for (const x of [null, undefined, "kapot", 7, {}, { _grounding: null }, { _grounding: "x" }, { _grounding: {} }]) {
    assert.equal(moneyGroundedInText(x), false);
  }
});

// ── De poort ──────────────────────────────────────────────────────────────────
//
// Een factuur zoals de 55 die in productie zijn gemeten: alles gelezen, niets gevlagd, GEEN
// bedragscore, en het document draagt zijn eigen drie bedragen.

function factuur(over: Partial<AutoAdvanceSignals> = {}): AutoAdvanceSignals {
  return {
    is_invoice: true, is_statement: false, is_reminder: false, is_credit_note: false,
    document_kind: "invoice", invoice_type: "factuur",
    confidence: 0.82, // boven MIN_OVERALL (0.7), ONDER VERY_HIGH_OVERALL (0.9) — dit is de knik
    totalIncBtw: 121, btwRate: 21,
    totalGrounding: "found", totalPlacement: "anchored",
    moneyGroundedInText: true,
    health: {
      total_ex_btw: 100, btw_amount: 21, total_inc_btw: 121,
      invoice_date: "2026-08-20", invoice_number: "F-9001", invoice_type: "factuur",
      // Geen `amount`-sleutel: precies de 182 rijen uit de meting.
      field_confidence: { vendor: 0.97, invoice_number: 0.94, invoice_date: 0.98 },
    },
    ...over,
  };
}

test("[GEGROND-STAAT-IN] the measured case now books itself, and says which door it came through", () => {
  const d = shouldAutoAdvanceInvoice(factuur());
  assert.equal(d.advance, true);
  assert.equal(d.reason, "clean_grounded_in_document",
    "a booking that leaned on the document instead of a score must be countable afterwards");
});

test("[GEGROND-STAAT-IN] without the document evidence the same invoice still waits", () => {
  // Dit is de stand van gisteren, en hij moet ONVERANDERD zijn.
  const d = shouldAutoAdvanceInvoice(factuur({ moneyGroundedInText: false }));
  assert.equal(d.advance, false);
  assert.equal(d.reason, "no_amount_confidence_and_overall_not_very_high");
  assert.equal(shouldAutoAdvanceInvoice(factuur({ moneyGroundedInText: null })).advance, false);
  assert.equal(shouldAutoAdvanceInvoice(factuur({ moneyGroundedInText: undefined })).advance, false,
    "every existing caller that passes nothing must behave exactly as it did");
});

test("[GEGROND-STAAT-IN] the witness never overrules a money score that IS present and low", () => {
  // 0,75 met opzet: BOVEN de 0,7-controlelijn van classifyImportHealth en ONDER de 0,8-lat van deze
  // poort. Zo raakt de weigering precies de lat die dit bestand bewaakt, in plaats van door de
  // gezondheidscontrole ervóór te worden opgevangen — die zou hem ook tegenhouden, maar dan bewijst
  // de test iets anders dan wat er staat.
  const d = shouldAutoAdvanceInvoice(factuur({
    health: { ...factuur().health, field_confidence: { vendor: 0.97, invoice_number: 0.94, invoice_date: 0.98, amount: 0.75 } },
  }));
  assert.equal(d.advance, false);
  assert.equal(d.reason, "amount_confidence_below_high_bar",
    "a stronger witness may replace an ABSENT score, never a present one that failed");

  // En ver onder de lijn houdt de gezondheidscontrole hem al tegen — óók goed, en het vastleggen
  // waard: twee onafhankelijke poorten weigeren hier, niet één.
  const diep = shouldAutoAdvanceInvoice(factuur({
    health: { ...factuur().health, field_confidence: { vendor: 0.97, invoice_number: 0.94, invoice_date: 0.98, amount: 0.5 } },
  }));
  assert.equal(diep.advance, false);
  assert.equal(diep.reason, "needs_review");
});

test("[GEGROND-STAAT-IN] the overall confidence floor still stands under this door", () => {
  const d = shouldAutoAdvanceInvoice(factuur({ confidence: 0.5 }));
  assert.equal(d.advance, false);
  assert.equal(d.reason, "overall_confidence_missing_or_low");
  assert.equal(shouldAutoAdvanceInvoice(factuur({ confidence: null })).advance, false,
    "fail-closed on a missing overall confidence is untouched");
});

test("[GEGROND-STAAT-IN] every other refusal still refuses, with the document fully grounded", () => {
  // Als één van deze doorlaat, is er een gat geopend dat niemand heeft aangevraagd.
  const gevallen: Array<[string, Partial<AutoAdvanceSignals>, string]> = [
    ["een creditnota", { is_credit_note: true }, "creditnota"],
    ["een rekeningoverzicht", { is_statement: true }, "statement"],
    ["een herinnering", { is_reminder: true }, "reminder"],
    ["geen factuur", { is_invoice: false }, "not_invoice"],
    ["een doorgedrukte dubbele", { forcedDuplicate: true }, "forced_duplicate"],
    ["een totaal dat niet in de tekst staat", { totalGrounding: "absent" }, "total_not_in_document_text"],
    ["een totaal op de verkeerde plek", { totalPlacement: "present" }, "total_not_where_a_total_is_printed"],
    ["een tegengesproken btw-verdeling", { btwContradictsDocument: true }, "btw_contradicts_printed_split"],
    ["een tegensprekende e-factuur", { eInvoiceContradicts: true }, "e_invoice_contradicts_read"],
  ];
  for (const [wat, over, reden] of gevallen) {
    const d = shouldAutoAdvanceInvoice(factuur(over));
    assert.equal(d.advance, false, `${wat} mag nooit vanzelf boeken, ook niet volledig gegrond`);
    assert.equal(d.reason, reden, `${wat}: verkeerde reden`);
  }
});

test("[GEGROND-STAAT-IN] a broken breakdown still refuses, however well printed", () => {
  // De rekenpoort is het tweede been onder deze deur: drie gedrukte getallen die NIET optellen
  // bewijzen niets. classifyImportHealth vangt dat, en dat moet zo blijven.
  const d = shouldAutoAdvanceInvoice(factuur({
    health: { ...factuur().health, total_ex_btw: 100, btw_amount: 21, total_inc_btw: 999 },
  }));
  assert.equal(d.advance, false);
  assert.equal(d.reason, "needs_review");
});

test("[GEGROND-STAAT-IN] a weak vendor/date/number score still refuses", () => {
  // Zelfde reden voor 0,75: tussen de controlelijn en de lat van deze poort.
  const d = shouldAutoAdvanceInvoice(factuur({
    health: { ...factuur().health, field_confidence: { vendor: 0.75, invoice_number: 0.94, invoice_date: 0.98 } },
  }));
  assert.equal(d.advance, false);
  assert.equal(d.reason, "field_confidence_below_high_bar");

  const diep = shouldAutoAdvanceInvoice(factuur({
    health: { ...factuur().health, field_confidence: { vendor: 0.4, invoice_number: 0.94, invoice_date: 0.98 } },
  }));
  assert.equal(diep.advance, false);
  assert.equal(diep.reason, "needs_review");
});

test("[GEGROND-STAAT-IN] a zero BTW without an explicit 0% rate still refuses", () => {
  const d = shouldAutoAdvanceInvoice(factuur({
    btwRate: null,
    health: { ...factuur().health, total_ex_btw: 121, btw_amount: 0, total_inc_btw: 121 },
  }));
  assert.equal(d.advance, false);
  assert.equal(d.reason, "zero_btw_not_explicit_zero_rate");
});
