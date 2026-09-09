// [VERLEGD-VERKOOP] Pure node test — run: npx tsx --test src/lib/reverse-charge-invoice.test.ts
//
// The load-bearing test is the first one: an invoice without a verlegd line is untouched by every
// line of this module. Most owners never use the regeling, and a false refusal on the one
// irreversible button in the app is worse than the deficiency this module prevents.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  checkReverseChargeInvoice,
  domesticReverseChargeNotice,
  reverseChargeLineNumbers,
} from "./reverse-charge-invoice";

const taxed = { btw_rate: 21, vat_treatment: null };
const verlegd = { btw_rate: 0, vat_treatment: "reverse_charge" };

// ── the refusal ───────────────────────────────────────────────────────────────────────────────

test("[VERLEGD-VERKOOP] an invoice without a verlegd line passes, whatever else is missing", () => {
  assert.deepEqual(checkReverseChargeInvoice({ korActive: true, clientBtwNumber: null, lines: [taxed] }), { ok: true });
  assert.deepEqual(checkReverseChargeInvoice({ korActive: false, clientBtwNumber: "", lines: [] }), { ok: true });
  assert.deepEqual(checkReverseChargeInvoice({ korActive: false, clientBtwNumber: "", lines: null }), { ok: true });
  // The exempt flag is a different fact and asks for nothing here.
  assert.deepEqual(checkReverseChargeInvoice({ korActive: false, clientBtwNumber: "", lines: [{ btw_rate: 0, vat_treatment: "exempt" }] }), { ok: true });
});

test("[VERLEGD-VERKOOP] a verlegd invoice without the customer's btw-id is refused, naming the lines", () => {
  const r = checkReverseChargeInvoice({ korActive: false, clientBtwNumber: "  ", lines: [taxed, verlegd, verlegd] });
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.equal(r.code, "verlegd_zonder_btw_nummer");
  assert.deepEqual(r.lines, [2, 3], "1-based, the numbering the owner sees");
  assert.match(r.error, /^Regels 2, 3 verleggen de btw/);
  assert.match(r.error, /art\. 35a Wet OB/);
});

test("[VERLEGD-VERKOOP] with the customer's btw-id the same invoice goes out", () => {
  assert.deepEqual(
    checkReverseChargeInvoice({ korActive: false, clientBtwNumber: "NL 8123.45.678.B01", lines: [taxed, verlegd] }),
    { ok: true },
  );
});

test("[VERLEGD-VERKOOP] under the KOR there is nothing to shift: refused before anything else", () => {
  const r = checkReverseChargeInvoice({ korActive: true, clientBtwNumber: "NL812345678B01", lines: [verlegd] });
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.equal(r.code, "verlegd_onder_kor");
  assert.match(r.error, /Regel 1 verlegt/);
  assert.match(r.error, /KOR/);
});

test("[VERLEGD-VERKOOP] a verlegd line that charges btw contradicts itself and is refused", () => {
  const r = checkReverseChargeInvoice({
    korActive: false,
    clientBtwNumber: "NL812345678B01",
    lines: [verlegd, { btw_rate: 21, vat_treatment: "reverse_charge" }],
  });
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.equal(r.code, "verlegd_met_btw");
  assert.deepEqual(r.lines, [2], "only the line that carries btw");
});

test("[VERLEGD-VERKOOP] the line numbers are the flag's, not the rate's", () => {
  assert.deepEqual(reverseChargeLineNumbers([{ btw_rate: 0 }, verlegd, { btw_rate: 0, vat_treatment: "exempt" }]), [2]);
  assert.deepEqual(reverseChargeLineNumbers(undefined), []);
});

// ── the sentence ──────────────────────────────────────────────────────────────────────────────

test("[VERLEGD-VERKOOP] the sentence carries the words the law asks for and the customer's number", () => {
  const zin = domesticReverseChargeNotice({ lines: [taxed, verlegd], clientBtwNumber: "nl 8123.45.678-b01", invoiceType: "factuur" });
  assert.equal(zin, "Btw verlegd — artikel 12 lid 5 Wet OB 1968. BTW-nummer afnemer: NL812345678B01.");
  // A creditnota of a verlegde invoice is verlegd too.
  assert.match(domesticReverseChargeNotice({ lines: [verlegd], clientBtwNumber: "NL812345678B01", invoiceType: "creditnota" }) ?? "", /^Btw verlegd/);
});

test("[VERLEGD-VERKOOP] a legacy row without a number still gets the statutory words", () => {
  assert.equal(
    domesticReverseChargeNotice({ lines: [verlegd], clientBtwNumber: null, invoiceType: "factuur" }),
    "Btw verlegd — artikel 12 lid 5 Wet OB 1968.",
  );
});

test("[VERLEGD-VERKOOP] no sentence on a quote, under the KOR, or without a verlegd line", () => {
  assert.equal(domesticReverseChargeNotice({ lines: [verlegd], clientBtwNumber: "NL812345678B01", invoiceType: "offerte" }), null);
  assert.equal(domesticReverseChargeNotice({ lines: [verlegd], clientBtwNumber: "NL812345678B01", invoiceType: "pro_forma" }), null);
  assert.equal(domesticReverseChargeNotice({ lines: [verlegd], clientBtwNumber: "NL812345678B01", invoiceType: "factuur", korActive: true }), null);
  assert.equal(domesticReverseChargeNotice({ lines: [taxed], clientBtwNumber: "NL812345678B01", invoiceType: "factuur" }), null);
});

test("[VERLEGD-VERKOOP] what the door lets through, the document explains — and the reverse", () => {
  // The refusal and the sentence read the same flag; an invoice that passes the door always prints
  // the sentence, and one refused for a missing number would have printed it without the number.
  const lines = [verlegd];
  const passes = checkReverseChargeInvoice({ korActive: false, clientBtwNumber: "NL812345678B01", lines }).ok;
  const zin = domesticReverseChargeNotice({ lines, clientBtwNumber: "NL812345678B01", invoiceType: "factuur" });
  assert.equal(passes, true);
  assert.ok(zin && zin.includes("NL812345678B01"));
});
