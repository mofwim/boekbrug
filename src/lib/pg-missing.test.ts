// [DEPLOY-SAFE] Pure node test — run: npx tsx --test src/lib/pg-missing.test.ts
//
// The point of these two functions is the NEGATIVE case: a timeout, a 414 or a permission error
// must never read as "that table/column isn't there yet", because that is what turns a failed
// read into a confident wrong answer.
import { test } from "node:test";
import assert from "node:assert/strict";

import { isMissingRelation, isMissingColumn } from "./pg-missing";

test("een ontbrekende tabel wordt herkend", () => {
  assert.equal(isMissingRelation('relation "public.bank_tx_invoices" does not exist'), true);
  assert.equal(isMissingRelation("Could not find the table 'public.foo' in the schema cache"), true);
  assert.equal(isMissingRelation("PGRST205"), true);
  assert.equal(isMissingRelation("42P01"), true);
});

test("een ontbrekende kolom wordt herkend — op code én op tekst", () => {
  assert.equal(isMissingColumn("", "42703"), true);
  assert.equal(isMissingColumn("", "PGRST204"), true);
  assert.equal(isMissingColumn('column "vat_scheme" does not exist'), true);
  assert.equal(isMissingColumn("Could not find the 'vat_scheme' column of 'profiles' in the schema cache"), true);
});

test("een MISLUKTE lees is geen ontbrekende migratie — de hele reden dat dit bestaat", () => {
  for (const msg of [
    "canceling statement due to statement timeout",
    "Request URI Too Long",
    "permission denied for table profiles",
    "connection reset by peer",
    "JWT expired",
    "",
  ]) {
    assert.equal(isMissingRelation(msg), false, `relation: ${msg}`);
    assert.equal(isMissingColumn(msg), false, `column: ${msg}`);
  }
});

test("een ontbrekende TABEL telt niet als een ontbrekende KOLOM", () => {
  // De kolomtest is bewust smaller: hij mag niet meeliften op de brede 'does not exist'.
  assert.equal(isMissingColumn("PGRST205"), false);
  assert.equal(isMissingColumn("schema cache"), false);
});

test("een timeout met een code erbij blijft een timeout", () => {
  assert.equal(isMissingColumn("canceling statement due to statement timeout", "57014"), false);
});
