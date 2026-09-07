// [AANSLAG] Run: npx tsx --test src/lib/tax-letter.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { effectiveTaxKind, isTaxKind, isTaxOfficeName, taxLetterBooking, taxLetterWithheldFromCosts } from "./tax-letter";

test("[AANSLAG] income tax and Zvw are private, btw is a settlement, only MRB is a cost", () => {
  assert.equal(taxLetterBooking("inkomstenbelasting"), "prive");
  assert.equal(taxLetterBooking("zorgverzekeringswet"), "prive");
  assert.equal(taxLetterBooking("omzetbelasting"), "settlement");
  assert.equal(taxLetterBooking("motorrijtuigenbelasting"), "kosten");
  assert.equal(taxLetterBooking("overig"), "unknown");
});

test("[AANSLAG] the tax office is recognised by name, including the OCR spelling with a space", () => {
  for (const n of ["Belastingdienst", "BELASTINGDIENST/CENTRALE ADMINISTRATIE", "Belasting dienst Apeldoorn", "Ministerie van Financiën Belastingdienst", "Belastingsdienst", "Rijksbelastingdienst"]) {
    assert.ok(isTaxOfficeName(n), n);
  }
  for (const n of ["Belastingadviseur Jansen", "Sligro", null, "", "Gemeente Belastingen Rotterdam"]) {
    assert.ok(!isTaxOfficeName(n), String(n));
  }
});

test("[AANSLAG] a row with no stored kind from the tax office is 'overig' — withheld, never a cost", () => {
  assert.equal(effectiveTaxKind({ client_name: "Belastingdienst" }), "overig");
  assert.ok(taxLetterWithheldFromCosts({ client_name: "Belastingdienst" }));
  assert.equal(effectiveTaxKind({ client_name: "Sligro" }), null);
  assert.ok(!taxLetterWithheldFromCosts({ client_name: "Sligro" }));
});

test("[AANSLAG] a stored kind wins over the name, and MRB stays a cost", () => {
  assert.equal(effectiveTaxKind({ client_name: "Belastingdienst", tax_kind: "motorrijtuigenbelasting" }), "motorrijtuigenbelasting");
  assert.ok(!taxLetterWithheldFromCosts({ client_name: "Belastingdienst", tax_kind: "motorrijtuigenbelasting" }));
  assert.ok(taxLetterWithheldFromCosts({ client_name: "Belastingdienst", tax_kind: "inkomstenbelasting" }));
  // A garbage kind is not a kind.
  assert.ok(!isTaxKind("loonbelasting "));
  assert.equal(effectiveTaxKind({ client_name: "Sligro", tax_kind: "nonsense" }), null);
});
