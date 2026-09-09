// [REGEL-BEHANDELING] Pure node test — run: npx tsx --test src/lib/line-vat-treatment.test.ts
//
// One hardening for every writer of invoice_lines.vat_treatment. The literals pass, everything
// else becomes NULL: an unknown value may never claim an exemption or shift the btw onto a customer.

import { test } from "node:test";
import assert from "node:assert/strict";

import { hasReverseChargeLine, isReverseChargeLine, storedVatTreatment } from "./line-vat-treatment";

test("[REGEL-BEHANDELING] only the two literals are stored", () => {
  assert.equal(storedVatTreatment("exempt"), "exempt");
  assert.equal(storedVatTreatment("reverse_charge"), "reverse_charge");
  // 'taxed' is a legal value of the column but never written by this app: NULL is the taxed line.
  assert.equal(storedVatTreatment("taxed"), null);
  for (const raw of [null, undefined, "", " exempt", "EXEMPT", "verlegd", "reverse-charge", 0, true, {}, ["exempt"]]) {
    assert.equal(storedVatTreatment(raw), null, `${JSON.stringify(raw)} must not become a treatment`);
  }
});

test("[VERLEGD-VERKOOP] a verlegd line is recognised by its flag alone, never by its rate or text", () => {
  assert.equal(isReverseChargeLine({ vat_treatment: "reverse_charge", btw_rate: 0 }), true);
  assert.equal(isReverseChargeLine({ vat_treatment: "exempt", btw_rate: 0 }), false);
  assert.equal(isReverseChargeLine({ vat_treatment: null, btw_rate: 0 }), false);
  assert.equal(isReverseChargeLine(null), false);
  assert.equal(hasReverseChargeLine([{ btw_rate: 21 }, { vat_treatment: "reverse_charge", btw_rate: 0 }]), true);
  assert.equal(hasReverseChargeLine([{ btw_rate: 0 }, null, undefined]), false);
  assert.equal(hasReverseChargeLine(null), false);
});
