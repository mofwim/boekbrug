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
