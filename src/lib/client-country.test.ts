// [KLANT-LAND] Pure node test — run: npx tsx --test src/lib/client-country.test.ts
//
// The load-bearing test is the first one of the guard block: an invoice to a Dutch customer, or to
// a customer with no recorded country, is untouched by every line of this. Most owners never sell
// abroad, and a false refusal on the one irreversible button is worse than the deficiency.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  checkEuZeroRatedInvoice,
  countryNameNl,
  isEuMemberState,
  isOtherEuMemberState,
  normalizeCountry,
} from "./client-country";

test("[KLANT-LAND] the stored code is two upper-case letters, or nothing", () => {
  assert.equal(normalizeCountry(" de "), "DE");
  assert.equal(normalizeCountry("nl"), "NL");
  assert.equal(normalizeCountry("EL"), "GR", "the VAT prefix Greece uses becomes the country code");
  for (const raw of ["", " ", "Duitsland", "D", "DEU", "1A", null, undefined, 12, {}]) {
    assert.equal(normalizeCountry(raw), null, `${JSON.stringify(raw)} is not a country code`);
  }
});

test("[KLANT-LAND] member states, and member states other than the Netherlands", () => {
  assert.equal(isEuMemberState("NL"), true);
  assert.equal(isEuMemberState("de"), true);
  assert.equal(isEuMemberState("GB"), false, "the United Kingdom left");
  assert.equal(isEuMemberState("CH"), false);
  assert.equal(isEuMemberState(null), false);
  assert.equal(isOtherEuMemberState("NL"), false);
  assert.equal(isOtherEuMemberState("BE"), true);
  assert.equal(isOtherEuMemberState("US"), false);
});

test("[KLANT-LAND] the document prints a Dutch name, or the code when it has none", () => {
  assert.equal(countryNameNl("DE"), "Duitsland");
  assert.equal(countryNameNl("gb"), "Verenigd Koninkrijk");
  assert.equal(countryNameNl("XK"), "XK");
  assert.equal(countryNameNl(null), "");
});

// ── the guard ────────────────────────────────────────────────────────────────────────────────

const zero = { btw_rate: 0, vat_treatment: null };
const taxed = { btw_rate: 21, vat_treatment: null };
const exempt = { btw_rate: 0, vat_treatment: "exempt" };
const base = { invoiceType: "factuur", korActive: false, clientBtwNumber: "", lines: [zero] };

test("[KLANT-LAND] a Dutch customer, or one with no recorded country, is never refused", () => {
  assert.deepEqual(checkEuZeroRatedInvoice({ ...base, clientCountry: "NL" }), { ok: true });
  assert.deepEqual(checkEuZeroRatedInvoice({ ...base, clientCountry: null }), { ok: true });
  assert.deepEqual(checkEuZeroRatedInvoice({ ...base, clientCountry: "" }), { ok: true });
  // Outside the EU there is no intra-Community supply to prove; export has its own rules.
  assert.deepEqual(checkEuZeroRatedInvoice({ ...base, clientCountry: "GB" }), { ok: true });
});

test("[KLANT-LAND] a 0% factuur to a business in another member state without its btw-id is refused", () => {
  const r = checkEuZeroRatedInvoice({ ...base, clientCountry: "DE" });
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.equal(r.code, "eu_nul_zonder_btw_nummer");
  assert.equal(r.country, "DE");
  assert.match(r.error, /klant in Duitsland \(EU\)/);
  assert.match(r.error, /btw-nummer/);
  assert.match(r.error, /particulier, reken dan Nederlandse btw/, "both ways out are named");
});

test("[KLANT-LAND] with the customer's btw-id, with btw charged, exempt, KOR or a quote: untouched", () => {
  assert.deepEqual(checkEuZeroRatedInvoice({ ...base, clientCountry: "DE", clientBtwNumber: "DE 123 456 789" }), { ok: true });
  assert.deepEqual(checkEuZeroRatedInvoice({ ...base, clientCountry: "DE", lines: [taxed, zero] }), { ok: true });
  assert.deepEqual(checkEuZeroRatedInvoice({ ...base, clientCountry: "DE", lines: [exempt] }), { ok: true });
  assert.deepEqual(checkEuZeroRatedInvoice({ ...base, clientCountry: "DE", korActive: true }), { ok: true });
  assert.deepEqual(checkEuZeroRatedInvoice({ ...base, clientCountry: "DE", invoiceType: "offerte" }), { ok: true });
  assert.deepEqual(checkEuZeroRatedInvoice({ ...base, clientCountry: "DE", invoiceType: "pro_forma" }), { ok: true });
  // Nothing to judge on a header-only row.
  assert.deepEqual(checkEuZeroRatedInvoice({ ...base, clientCountry: "DE", lines: [] }), { ok: true });
  assert.deepEqual(checkEuZeroRatedInvoice({ ...base, clientCountry: "DE", lines: null }), { ok: true });
});

test("[KLANT-LAND] a creditnota of such an invoice is judged the same way", () => {
  const r = checkEuZeroRatedInvoice({ ...base, clientCountry: "BE", invoiceType: "creditnota" });
  assert.equal(r.ok, false);
});
