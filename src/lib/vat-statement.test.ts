// [BTW-VERKLARING] Pure node test — run: npx tsx --test src/lib/vat-statement.test.ts
//
// Two properties carry this file. The document must EXPLAIN a zero it can explain, and it must
// stay SILENT about one it cannot — because a fabricated legal ground on a customer's invoice is
// worse than the silence it would replace.

import { test } from "node:test";
import assert from "node:assert/strict";

import { vatStatement, cleanVatNote, MAX_NOTE_LENGTH } from "./vat-statement";

const base = { invoiceType: "factuur", btwAmount: 0 };

// ── what it explains ──────────────────────────────────────────────────────────────────────────

test("[BTW-VERKLARING] a KOR invoice says so", () => {
  // The app holds this as a fact (profiles.kor_active), so it does not need to be told.
  assert.equal(
    vatStatement({ ...base, korActive: true }),
    "Geen btw in rekening gebracht: kleineondernemersregeling (KOR).",
  );
});

test("[BTW-VERKLARING] an exempt line is named, with the owner's own ground when they wrote one", () => {
  // The app knows THAT it is exempt, never WHICH exemption — art. 11 has a provision per trade.
  const lines = [{ vat_treatment: "exempt" }];
  assert.equal(
    vatStatement({ ...base, lines, note: "Vrijgesteld van btw op grond van artikel 11-1-o Wet OB (onderwijs)." }),
    "Vrijgesteld van btw op grond van artikel 11-1-o Wet OB (onderwijs).",
  );
});

test("[BTW-VERKLARING] an exempt line without a note still says the true part", () => {
  // Incomplete, but not false — and a great deal more than the nothing a customer could read
  // before. Guessing a provision would be the one worse outcome.
  assert.equal(vatStatement({ ...base, lines: [{ vat_treatment: "exempt" }] }), "Vrijgesteld van btw.");
});

test("[BTW-VERKLARING] plain 0% carries the owner's note when there is one", () => {
  assert.equal(
    vatStatement({ ...base, note: "0% btw: uitvoer buiten de EU." }),
    "0% btw: uitvoer buiten de EU.",
  );
});

// ── what it refuses to say ────────────────────────────────────────────────────────────────────

test("[BTW-VERKLARING] plain 0% with no note stays SILENT, on purpose", () => {
  // Export, intra-EU goods and several services are all 0%, and nothing stored says which. A
  // fabricated ground on a customer's invoice is worse than none.
  assert.equal(vatStatement(base), null);
});

test("[BTW-VERKLARING] an invoice that DOES charge btw explains nothing", () => {
  // The per-rate rows already say what was charged. A "no btw" sentence beside EUR 21,00 of btw
  // would be flatly wrong.
  assert.equal(vatStatement({ ...base, btwAmount: 21, korActive: true }), null);
  assert.equal(vatStatement({ ...base, btwAmount: -21, korActive: true }), null, "and on a creditnota");
  // A rounding crumb is not btw.
  assert.notEqual(vatStatement({ ...base, btwAmount: 0.001, korActive: true }), null);
});

test("[BTW-VERKLARING] it never speaks over the reverse-charge sentence", () => {
  // icp.ts derives that from the customer's EU VAT number and it is the one zero the app can
  // PROVE. Two sentences giving different reasons for one zero is worse than either alone.
  assert.equal(vatStatement({ ...base, korActive: true, reverseChargeStated: true }), null);
  assert.equal(
    vatStatement({ ...base, lines: [{ vat_treatment: "exempt" }], reverseChargeStated: true }), null,
  );
});

test("[BTW-VERKLARING] a quote carries no btw statement, same boundary as icp.ts", () => {
  // The two must not disagree about what a pro forma may say.
  for (const t of ["pro_forma", "offerte"]) {
    assert.equal(vatStatement({ ...base, invoiceType: t, korActive: true }), null, t);
  }
  assert.notEqual(vatStatement({ ...base, invoiceType: "creditnota", korActive: true }), null);
});

test("[BTW-VERKLARING] KOR outranks an exempt line rather than stacking with it", () => {
  // The scheme covers the whole business. A second sentence about an art. 11 exemption beside it
  // would contradict the first.
  const s = vatStatement({ ...base, korActive: true, lines: [{ vat_treatment: "exempt" }], note: "iets anders" });
  assert.match(s ?? "", /kleineondernemersregeling/);
  assert.doesNotMatch(s ?? "", /iets anders/);
});

test("[BTW-VERKLARING] only the literal flag counts as exempt", () => {
  // The same hardening every other reader of this column applies: no stray value may create an
  // exemption that moves revenue out of the aangifte.
  for (const v of ["Exempt", "vrijgesteld", "true", "", null, undefined]) {
    assert.equal(
      vatStatement({ ...base, lines: [{ vat_treatment: v as string }] }), null,
      `${JSON.stringify(v)} must not read as exempt`,
    );
  }
});

// ── the note is free text on its way to a customer's document ─────────────────────────────────

test("[BTW-VERKLARING] the note is normalised to one bounded line", () => {
  assert.equal(cleanVatNote("  Vrijgesteld  \n op grond van   art. 11 "), "Vrijgesteld op grond van art. 11");
  assert.equal(cleanVatNote(null), "");
  assert.equal(cleanVatNote("   "), "");
  const long = cleanVatNote("x".repeat(500));
  assert.equal(long.length, MAX_NOTE_LENGTH, "a pasted essay cannot run off the page");
});

test("[BTW-VERKLARING] a whitespace-only note is no note", () => {
  // Otherwise an owner who cleared the field would ship an invoice with a blank explanation line
  // where the honest fallback belongs.
  assert.equal(vatStatement({ ...base, lines: [{ vat_treatment: "exempt" }], note: "   " }), "Vrijgesteld van btw.");
  assert.equal(vatStatement({ ...base, note: "  \n " }), null);
});

// ── [BTW-VERKLARING-GEMENGD] An invoice can charge btw AND carry an exempt line ────────────────
//
// The zero-btw short-circuit stood above everything, and for the two questions below it that is
// right: "why is there no btw at all" only has an answer when there is no btw at all. It is the
// wrong question for an exempt LINE, which is a fact about that line and not about the total.
//
// Measured on a rendered PDF: a caterer's invoice with EUR 500 of food at 9% plus a EUR 500
// food-safety course exempt under art. 11 carried EUR 45 of btw, so the guard returned null and
// the page said nothing about the exempt half — while the all-exempt invoice beside it was
// correct. Art. 35a lid 1 sub k asks for the reference on the invoice that carries the exempt
// supply, not only on invoices that carry nothing else.

const CATERER = [{ vat_treatment: null }, { vat_treatment: "exempt" }];

test("[BTW-VERKLARING] an invoice that charges btw AND has an exempt line still names it", () => {
  const s = vatStatement({ invoiceType: "factuur", btwAmount: 45, lines: CATERER });
  assert.ok(s, "the exempt half must be referenced even though the other half is taxed");
  assert.match(s!, /vrijgesteld van btw/i);
});

test("[BTW-VERKLARING] …and says it is about PART of the amount, not all of it", () => {
  // A bare "Vrijgesteld van btw." above a total containing EUR 45 of btw reads as a claim about
  // the whole document, and a bookkeeper would be right to disbelieve one of the two.
  const s = vatStatement({ invoiceType: "factuur", btwAmount: 45, lines: CATERER })!;
  assert.equal(s, "Een deel van dit bedrag is vrijgesteld van btw.");
  // …and with no note it is ONE sentence. Gluing the fallback onto the scope clause produced
  // "…is vrijgesteld van btw: vrijgesteld van btw.", which is how a template reads unrendered.
  assert.doesNotMatch(s, /vrijgesteld van btw.*vrijgesteld van btw/i);

  // The owner's own ground is carried into the longer sentence rather than replaced by it.
  const met = vatStatement({
    invoiceType: "factuur", btwAmount: 45, lines: CATERER,
    note: "Vrijgesteld op grond van artikel 11 lid 1 sub o Wet OB (onderwijs).",
  })!;
  assert.match(met, /^Een deel van dit bedrag is vrijgesteld van btw: /);
  assert.match(met, /artikel 11 lid 1 sub o/, "the owner's wording survives, it is the true part");
});

test("[BTW-VERKLARING] a wholly exempt invoice keeps the short sentence", () => {
  // The regression risk of the change: the ordinary all-exempt case must not acquire the longer
  // wording, because there no part of it is taxed.
  assert.equal(
    vatStatement({ invoiceType: "factuur", btwAmount: 0, lines: [{ vat_treatment: "exempt" }] }),
    "Vrijgesteld van btw.",
  );
});

test("[BTW-VERKLARING] charging btw with NO exempt line still explains nothing", () => {
  // The branch that was there before must keep its meaning: the per-rate rows say what was
  // charged, and there is nothing to add.
  assert.equal(vatStatement({ invoiceType: "factuur", btwAmount: 210, lines: [{ vat_treatment: null }] }), null);
  assert.equal(
    vatStatement({ invoiceType: "factuur", btwAmount: 210, lines: [{ vat_treatment: null }], note: "Iets" }),
    null,
    "a note explains why there is no btw — it may not appear on an invoice that charges it",
  );
});

test("[BTW-VERKLARING] KOR still outranks an exempt line, in both directions", () => {
  // KOR is the regime of the whole business. Under it nothing is charged for a different reason
  // entirely, and two grounds for one zero is what this module exists to prevent.
  assert.match(
    vatStatement({ invoiceType: "factuur", btwAmount: 0, korActive: true, lines: CATERER })!,
    /kleineondernemersregeling/,
  );
  // A KOR invoice cannot carry btw (checkKorInvoice refuses it before a number is minted), so this
  // combination is a contradiction — and it must not produce a sentence claiming both.
  const s = vatStatement({ invoiceType: "factuur", btwAmount: 45, korActive: true, lines: CATERER });
  assert.equal(s, null, "a contradiction is answered with silence, never with two claims");
});

test("[BTW-VERKLARING] a quote with a mixed line set still states nothing", () => {
  assert.equal(vatStatement({ invoiceType: "offerte", btwAmount: 45, lines: CATERER }), null);
  assert.equal(vatStatement({ invoiceType: "pro_forma", btwAmount: 45, lines: CATERER }), null);
});
