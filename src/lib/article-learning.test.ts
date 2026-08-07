// [ARTIKEL-LEREN] Run: npx tsx --test src/lib/article-learning.test.ts
//
// The load-bearing tests here are the ones about NOT acting: an archived description that stays
// archived, and a catalog price that survives a cheaper invoice. Both are cases where doing the
// obvious thing (learn everything, keep it fresh) quietly overrules a decision the owner made on
// purpose, and neither would produce an error to explain itself.

import { test } from "node:test";
import assert from "node:assert/strict";
import { planCatalogLearning, articleKey, documentTeachesCatalog } from "./article-learning";
import type { CatalogEntry, LearnableLine } from "./article-learning";

const line = (over: Partial<LearnableLine> = {}): LearnableLine => ({
  description: "Consult", unit_price: 80, btw_rate: 21, unit: "uur", ...over,
});
const entry = (over: Partial<CatalogEntry> = {}): CatalogEntry => ({
  id: "a1", description: "Consult", usage_count: 3, active: true, ...over,
});

test("the first invoice teaches the catalog", () => {
  const plan = planCatalogLearning([line()], []);
  assert.equal(plan.toInsert.length, 1);
  assert.deepEqual(plan.toInsert[0], {
    description: "Consult", unit_price: 80, btw_rate: 21, unit: "uur",
  });
  assert.equal(plan.toBump.length, 0, "nothing to bump on an empty catalog");
});

test("a description the catalog already holds is bumped, not inserted again", () => {
  const plan = planCatalogLearning([line()], [entry()]);
  assert.deepEqual(plan.toInsert, [], "a second row with the same words is not a second article");
  assert.deepEqual(plan.toBump, [{ id: "a1", usage_count: 3 }], "the picker learns the ordering");
});

test("an existing article's price survives a cheaper invoice", () => {
  // The owner's catalog says 95; this invoice charges 80 as a favour. Rewriting the catalog here
  // would put the favour price on every later invoice — a price change nobody asked for, arriving
  // through a convenience feature. The plan carries no price for an existing article at all.
  const plan = planCatalogLearning([line({ unit_price: 80 })], [entry({ usage_count: 0 })]);
  assert.deepEqual(plan.toInsert, []);
  assert.deepEqual(plan.toBump, [{ id: "a1", usage_count: 0 }]);
  assert.ok(
    !JSON.stringify(plan).includes("unit_price"),
    "the plan must not carry a price for an article that already exists — no path can rewrite it",
  );
});

test("an archived description is left alone: no insert, no bump, no revival", () => {
  // Archiving is the owner saying "stop offering me this". Re-learning it from the next invoice
  // that mentions it makes that button do nothing, with no error to explain why.
  const plan = planCatalogLearning([line()], [entry({ active: false })]);
  assert.deepEqual(plan.toInsert, [], "no duplicate row that quietly undoes the archiving");
  assert.deepEqual(plan.toBump, [], "and no bump on a row the picker will not show");
});

test("when one description exists twice, the active row is the one bumped", () => {
  // There is no uniqueness on description, so both can exist. Bumping the archived one would raise
  // a counter nobody can see while the row the picker DOES offer stays at zero.
  const plan = planCatalogLearning(
    [line()],
    [entry({ id: "archived", active: false, usage_count: 99 }), entry({ id: "live", usage_count: 1 })],
  );
  assert.deepEqual(plan.toBump, [{ id: "live", usage_count: 1 }]);
});

test("the same description twice on one invoice is one article and one bump", () => {
  const twice = [line({ description: "Consult" }), line({ description: "consult" })];
  assert.equal(planCatalogLearning(twice, []).toInsert.length, 1, "two lines, one new article");
  assert.equal(planCatalogLearning(twice, [entry()]).toBump.length, 1, "and one bump, not two");
});

test("matching folds case, accents and repeated spaces, like the picker does", () => {
  assert.equal(articleKey("  Café   Advies "), articleKey("cafe advies"));
  const plan = planCatalogLearning(
    [line({ description: "CAFÉ  advies" })],
    [entry({ description: "Cafe advies" })],
  );
  assert.deepEqual(plan.toInsert, [], "a fold difference is not a new article");
  assert.equal(plan.toBump.length, 1);
});

test("a blank description teaches nothing and is counted", () => {
  const plan = planCatalogLearning([line({ description: "   " }), line()], []);
  assert.equal(plan.skipped, 1);
  assert.equal(plan.toInsert.length, 1, "the real line is still learned");
});

test("a rate the catalog cannot hold is skipped rather than written and rejected later", () => {
  const plan = planCatalogLearning([line({ btw_rate: 6 })], []);
  assert.deepEqual(plan.toInsert, []);
  assert.equal(plan.skipped, 1, "counted, so the numbers still add up across layers");
});

test("a negative price is skipped", () => {
  const plan = planCatalogLearning([line({ unit_price: -5 })], []);
  assert.deepEqual(plan.toInsert, []);
  assert.equal(plan.skipped, 1);
});

test("the price is rounded to cents, like every other money write in this app", () => {
  const plan = planCatalogLearning([line({ unit_price: 33.333 })], []);
  assert.equal(plan.toInsert[0].unit_price, 33.33);
});

test("an empty unit becomes null, so the column means 'none' rather than ''", () => {
  assert.equal(planCatalogLearning([line({ unit: "  " })], []).toInsert[0].unit, null);
  assert.equal(planCatalogLearning([line({ unit: null })], []).toInsert[0].unit, null);
});

test("the per-invoice cap is reported, never silently applied", () => {
  const many = Array.from({ length: 30 }, (_, i) => line({ description: `Regel ${i}` }));
  const plan = planCatalogLearning(many, [], { maxNewPerInvoice: 25 });
  assert.equal(plan.toInsert.length, 25);
  assert.equal(plan.dropped, 5, "the caller can only log what the plan tells it was left out");
});

test("bumps are not capped — they cost no rows and keep the ordering honest", () => {
  const catalog = Array.from({ length: 30 }, (_, i) => entry({ id: `a${i}`, description: `Regel ${i}` }));
  const lines = catalog.map((c) => line({ description: c.description }));
  const plan = planCatalogLearning(lines, catalog, { maxNewPerInvoice: 2 });
  assert.equal(plan.toBump.length, 30);
  assert.equal(plan.dropped, 0, "nothing was left out — every line was already known");
});

test("a creditnota does not teach the catalog; an invoice and a quote do", () => {
  assert.equal(documentTeachesCatalog("factuur"), true);
  assert.equal(documentTeachesCatalog("offerte"), true);
  assert.equal(documentTeachesCatalog("creditnota"), false, "a correction is not work anyone sells");
});
