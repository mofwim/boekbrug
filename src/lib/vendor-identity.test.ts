// src/lib/vendor-identity.test.ts
// [BTW-NUMMER-BEWAARD] Pure node test — run: npx tsx --test src/lib/vendor-identity.test.ts

import test from "node:test";
import assert from "node:assert/strict";

import { checkVendorBtw, supplierBtwForInvoice } from "./vendor-identity";

test("[BTW-NUMMER-BEWAARD] a well-formed supplier VAT number becomes storable, normalised", () => {
  // The whole point of this helper: something that can be written to invoices.client_btw_number,
  // which is the column buildForeignPurchases classifies. Normalised the way every other reader
  // in this file normalises, so the same number from two documents is the same string.
  assert.equal(supplierBtwForInvoice("NL 123.456.789 B01"), "NL123456789B01");
  assert.equal(supplierBtwForInvoice("de123456789"), "DE123456789");
  assert.equal(supplierBtwForInvoice("BE 0123.456.749"), "BE0123456749");
});

test("[BTW-NUMMER-BEWAARD] a malformed number is refused, not stored", () => {
  // A wrong VAT number on the EU-purchase listing is a correction letter. A missing one leaves the
  // invoice where it already was — an ordinary cost the accountant still sees. So the refusal is
  // the cheaper error, and the printed value is not lost: it stays in _vendor_btw_printed, where
  // the invoice-checks row already tells the owner their supplier printed something wrong.
  assert.equal(supplierBtwForInvoice("zie bijlage"), null);
  assert.equal(supplierBtwForInvoice("NL12345"), null, "an NL number of the wrong length");
  assert.equal(supplierBtwForInvoice("US123456789"), null, "a prefix that is not an EU member state");
  assert.equal(supplierBtwForInvoice(null), null);
  assert.equal(supplierBtwForInvoice(""), null);
  assert.equal(supplierBtwForInvoice(undefined, null), null);
});

test("[BTW-NUMMER-BEWAARD] the printed value wins, and the NL-filtered one is the fallback", () => {
  // ai.ts keeps TWO values: `_vendor_btw_printed` (whatever the document said) and `vendor_btw`
  // (only a well-formed NL id, because that one may become a supplier KEY). The printed one is the
  // richer source — it is the only one that can carry a German or Belgian number at all — so it is
  // tried first, and the NL one covers a path that never carried field_confidence.
  assert.equal(supplierBtwForInvoice("FR12345678901", "NL123456789B01"), "FR12345678901");
  assert.equal(supplierBtwForInvoice("onleesbaar", "NL123456789B01"), "NL123456789B01",
    "a malformed printed value falls through to the one that passed ai.ts's own filter");
  assert.equal(supplierBtwForInvoice(null, "NL123456789B01"), "NL123456789B01");
});

test("[BTW-NUMMER-BEWAARD] the helper agrees with the shape authority it is built on", () => {
  // One verdict, not two: the helper stores exactly what checkVendorBtw calls 'ok'. If those ever
  // disagree, an invoice screen and a fiscal listing would disagree about the same number.
  for (const raw of ["NL123456789B01", "DE123456789", "EL123456789", "XI123456789",
                     "zie bijlage", "NL999", "US123456789", "", "  "]) {
    const stored = supplierBtwForInvoice(raw);
    assert.equal(stored !== null, checkVendorBtw(raw) === "ok", `disagreement on "${raw}"`);
  }
});
