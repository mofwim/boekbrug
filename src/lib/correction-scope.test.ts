// [KENMERK-NA-BETALING] Pure node test — run: npx tsx --test src/lib/correction-scope.test.ts

import { test } from "node:test";
import assert from "node:assert/strict";

import { isMoneyFreeCorrection, MONEY_FREE_CORRECTION_FIELDS } from "./correction-scope";

test("[KENMERK-NA-BETALING] the betaalkenmerk alone passes once money is settled", () => {
  assert.equal(isMoneyFreeCorrection({ payment_reference: "26710525" }), true);
  // Clearing it is a correction too.
  assert.equal(isMoneyFreeCorrection({ payment_reference: "" }), true);
});

test("[KENMERK-NA-BETALING] anything that touches money, its period or its keys does not", () => {
  const geweigerd = [
    { total_inc_btw: 100 },
    { total_ex_btw: 100, btw_amount: 21, total_inc_btw: 121 },
    { is_credit_note: true },
    { invoice_date: "2026-07-03" },   // picks the BTW quarter
    { invoice_number: "26710525" },   // the key the payment was linked on
    { client_name: "Enka Horeca B.V." },
    { vendor_iban: "NL61INGB0116981407" }, // what the fraud check compares against
    { btw_rows: [] },
    { due_date: "2026-08-02" },
  ];
  for (const body of geweigerd) {
    assert.equal(isMoneyFreeCorrection(body), false, `${JSON.stringify(body)} slipped past the guard`);
  }
});

test("[KENMERK-NA-BETALING] the kenmerk smuggled in beside a money field is still refused", () => {
  // The dangerous shape: one allowed field used as cover for one that is not.
  assert.equal(isMoneyFreeCorrection({ payment_reference: "x", total_inc_btw: 1 }), false);
  assert.equal(isMoneyFreeCorrection({ payment_reference: "x", invoice_date: "2026-01-01" }), false);
});

test("[KENMERK-NA-BETALING] nothing to do is not a reason to pass a guard", () => {
  for (const leeg of [{}, null, undefined, [], "payment_reference", 42]) {
    assert.equal(isMoneyFreeCorrection(leeg), false, `${JSON.stringify(leeg)} was treated as a correction`);
  }
});

test("[KENMERK-NA-BETALING] the list is an ALLOWLIST — a new field is refused by default", () => {
  // A field added to the route tomorrow must not slip through because nobody updated this file.
  assert.deepEqual([...MONEY_FREE_CORRECTION_FIELDS], ["payment_reference"]);
  assert.equal(isMoneyFreeCorrection({ some_new_field: "x" }), false);
});
