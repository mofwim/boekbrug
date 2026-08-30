// [BANK-IDENTITY] The single mapping from a bank category into the profit & loss, under test.
// Run: npx tsx --test src/lib/bank-categories.test.ts
//
// This module is small and it is the last word on where a confirmed bank line lands: revenue,
// cost, or nowhere. Its own header explains why it exists — the same list once lived in four
// places and disagreed, "exactly how a category silently vanishes from a money total".
//
// The file records two regressions that already happened, and both overstated what the owner
// earned:
//   · pos_income was dropped from revenue (M-5) — card takings that were not counted as omzet;
//   · fee was excluded from costs — deductible Dutch bank charges left out, so profit read high.
//
// A comment cannot fail. These assertions can.

import { test } from "node:test";
import assert from "node:assert/strict";

import type { BankCategory } from "./bank-categories";
import {
  SELECTABLE_CATEGORIES,
  ALLOWED_CATEGORIES,
  PNL_ROLE,
  EXCLUDED_CATEGORIES,
  categoryLabel,
  pnlRole,
} from "./bank-categories";

test("[BANK-IDENTITY] every category the owner can pick has a place in the P&L", () => {
  // The invariant that matters most here. A selectable category with no role is money the owner
  // deliberately classified and the result engine then skipped — it leaves the books without
  // anyone choosing that, and nothing on screen says so.
  for (const c of SELECTABLE_CATEGORIES) {
    assert.ok(
      pnlRole(c.key) !== undefined,
      `"${c.key}" is offered in the picker but has no P&L role — money classified as this vanishes`,
    );
  }
});

test("[BANK-IDENTITY] card takings are revenue", () => {
  // Regression M-5, named in the source. pos_income is the till/PSP payout; dropping it
  // understates omzet and therefore the BTW owed on it.
  assert.equal(pnlRole("pos_income"), "omzet");
  assert.equal(pnlRole("omzet"), "omzet");
});

test("[BANK-IDENTITY] bank charges are a cost, not an exclusion", () => {
  // [BANKKOSTEN-DEDUCTIBLE] in the source: excluding these "systematically OVERSTATED profit".
  // They are deductible and VAT-exempt (art. 11 lid 1-i Wet OB), so they belong in kosten.
  assert.equal(pnlRole("fee"), "kosten");
  assert.equal(pnlRole("kosten"), "kosten");
});

test("[BANK-IDENTITY] transfers, private and tax never touch the result", () => {
  // Each of these would be double-counted or invented money if it reached the P&L: a transfer is
  // the same euro twice, a private withdrawal is not a cost, and tax is a settlement of money
  // already counted.
  for (const key of ["transfer", "prive", "tax"]) {
    assert.equal(pnlRole(key), "excluded", `${key} reached the profit & loss`);
  }
});

test("[BANK-IDENTITY] EXCLUDED_CATEGORIES is exactly what the role map excludes", () => {
  // It is derived from PNL_ROLE so it cannot drift — this asserts the derivation, because the
  // readiness deep-link uses this list to show the owner which lines were auto-excluded. A list
  // that disagreed with the mapping would point at the wrong lines.
  const keys = Object.keys(PNL_ROLE) as BankCategory[];
  const fromRoles = keys.filter((k) => PNL_ROLE[k] === "excluded").sort();
  assert.deepEqual([...EXCLUDED_CATEGORIES].sort(), fromRoles);
});

test("[BANK-IDENTITY] an unknown or absent category has no role, so a caller skips it", () => {
  // The contract the source states: "An unrecognised / null value has no role, so callers skip it
  // rather than guess." Guessing here would put unclassified money into omzet or kosten.
  for (const v of [null, undefined, "", "unknown", "nonsense", "Omzet", "OMZET"]) {
    assert.equal(pnlRole(v), undefined, `${JSON.stringify(v)} was given a P&L role`);
  }
});

test("[BANK-IDENTITY] 'unknown' is deliberately not a storable category", () => {
  // The type excludes it and the vocabulary must too: it is a transient classifier state. If it
  // became storable, lines would sit in the books with a role nobody defined.
  // The cast is the point of the test: "unknown" is not a BankCategory, and the runtime set
  // must agree with the type rather than quietly carrying it.
  assert.equal(ALLOWED_CATEGORIES.has("unknown" as BankCategory), false);
  assert.equal(ALLOWED_CATEGORIES.size, SELECTABLE_CATEGORIES.length);
});

test("[BANK-IDENTITY] the picker and the history hint use the same words", () => {
  // [BANK-COUNTERPART-HISTORY]: a second label list is how "Zakelijke kost" and "Kosten" end up
  // naming one thing on one screen. Every selectable key must render its own label.
  for (const c of SELECTABLE_CATEGORIES) {
    assert.equal(categoryLabel(c.key), c.label);
  }
});

test("[BANK-IDENTITY] an unknown key still renders as something, never as blank", () => {
  // A label is never worth a crash, and a bare key is at least honest about what is stored.
  assert.equal(categoryLabel("een_toekomstige_waarde"), "een_toekomstige_waarde");
  assert.equal(categoryLabel(null), "");
  assert.equal(categoryLabel(undefined), "");
  assert.equal(categoryLabel(""), "");
});
