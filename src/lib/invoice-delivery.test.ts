// src/lib/invoice-delivery.test.ts
// [VERSTUURD-EERLIJK] The question "did it actually go out" answered once, and tested once.

import { test } from "node:test";
import assert from "node:assert/strict";
import { deliveryFailure } from "./invoice-delivery";

test("[VERSTUURD-EERLIJK] a clean send is the only thing that may say verstuurd", () => {
  assert.equal(deliveryFailure({}), null);
  assert.equal(deliveryFailure({ invoice_number: "2026-014" } as never), null);
  assert.equal(deliveryFailure({ delivered: true }), null);
  // No body at all: res.ok already spoke, and inventing a failure here would put a recovery
  // banner over an invoice that went out fine.
  assert.equal(deliveryFailure(null), null);
  assert.equal(deliveryFailure(undefined), null);
});

test("[VERSTUURD-EERLIJK] every shape the route uses to say 'the customer got nothing'", () => {
  assert.equal(deliveryFailure({ warning: "email_failed" }), "email_failed");
  assert.equal(deliveryFailure({ warning: "pdf_failed" }), "pdf_failed");
  // The older narrow signal. Screens that only ever checked this must not regress when they
  // switch to asking here instead.
  assert.equal(deliveryFailure({ delivered: false }), "email_failed");
  // Both at once: the named cause wins, because it is the more specific of the two.
  assert.equal(deliveryFailure({ warning: "pdf_failed", delivered: false }), "pdf_failed");
});

test("[VERSTUURD-EERLIJK] each known warning is classified, including the one that is NOT a delivery failure", () => {
  // A corrected invoice the customer never received: same class — they still hold the old version.
  assert.equal(deliveryFailure({ warning: "corrected_delivery_failed" }), "email_failed");
  // And the counter-example that keeps this from being "any warning means undelivered": the draft
  // saved without its discount trail. Real problem, different screen — but the invoice went out.
  // Reporting it would put a recovery banner over a delivered invoice.
  assert.equal(deliveryFailure({ warning: "discount_not_stored" }), null);
});

test("[VERSTUURD-EERLIJK] an unrecognised warning is not silently treated as delivered", () => {
  // A warning this module has never heard of is still the route flagging something. The two
  // mistakes are not equal: "verstuurd" over a failed send loses the money, an unnecessary banner
  // costs a moment. Reading it as `null` would be the whole defect back.
  assert.equal(deliveryFailure({ warning: "something_new_in_2027" }), "email_failed");
  // An empty or non-string warning is not a warning.
  assert.equal(deliveryFailure({ warning: "" }), null);
  assert.equal(deliveryFailure({ warning: null }), null);
});
