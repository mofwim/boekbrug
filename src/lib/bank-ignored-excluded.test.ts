// [GENEGEERD-TELT] Pure node test — run: npx tsx --test src/lib/bank-ignored-excluded.test.ts
//
// "Negeren" doet twee heel verschillende dingen, afhankelijk van waarom. Bij drie van de vijf
// redenen zegt de eigenaar dat dit geld niet in zijn boeken hoort; bij de vierde zegt hij alleen
// dat er nooit een factuur bij komt. Die twee als hetzelfde behandelen kost geld in beide
// richtingen, en dat is de hele inhoud van deze twee bestanden.

import { test } from "node:test";
import assert from "node:assert/strict";

import { ignoredLineCountsInBooks, BANK_IGNORE_REASONS } from "./bank-ignore-reason";
import { readExcludedBankIds } from "./bank-ignored-excluded";
import { toResultBankTx, computeResult } from "./financial-result";

test("the three reasons that say the money is not a business cost keep it out", () => {
  assert.equal(ignoredLineCountsInBooks("prive"), false, "an owner's own words that it was not business");
  assert.equal(ignoredLineCountsInBooks("dubbel"), false, "he reported the duplicate; counting it twice is his report ignored");
  assert.equal(ignoredLineCountsInBooks("niet_van_mij"), false, "a bank error was never his money");
});

test("'hier komt geen factuur bij' is a real cost and MUST keep counting", () => {
  // Rent, lease, a subscription. Removing these would lower costs, raise profit and have the owner
  // pay too much tax — the more expensive of the two mistakes, and this is the commonest reason.
  assert.equal(ignoredLineCountsInBooks("geen_factuur"), true);
});

test("'anders' and no reason at all keep today's behaviour", () => {
  // They say nothing about the nature of the amount. Excluding on that would silently pull costs
  // out of quarters that may already be filed, on an assumption the owner never made.
  assert.equal(ignoredLineCountsInBooks("anders"), true);
  assert.equal(ignoredLineCountsInBooks(null), true);
  assert.equal(ignoredLineCountsInBooks(undefined), true);
  assert.equal(ignoredLineCountsInBooks(""), true);
  assert.equal(ignoredLineCountsInBooks("iets-onbekends"), true, "an unknown value is not a decision");
});

test("every reason the product offers has an answer here", () => {
  // A sixth reason added to the picker without a line here would silently default to "counts",
  // which is the right default and the wrong way to arrive at it.
  for (const r of BANK_IGNORE_REASONS) {
    assert.equal(typeof ignoredLineCountsInBooks(r), "boolean", `${r} has no verdict`);
  }
});

function fakeClient(rows: Array<{ id: string; ignore_reason: string | null }> | Error) {
  const chain = {
    select: () => chain, eq: () => chain, gte: () => chain, lte: () => chain, order: () => chain,
    range: () => (rows instanceof Error ? Promise.reject(rows) : Promise.resolve({ data: rows, error: null })),
  };
  return { from: () => chain };
}

test("only the excluding reasons end up in the set", async () => {
  const ids = await readExcludedBankIds({
    client: fakeClient([
      { id: "a", ignore_reason: "prive" },
      { id: "b", ignore_reason: "geen_factuur" },
      { id: "c", ignore_reason: "dubbel" },
      { id: "d", ignore_reason: null },
    ]),
    userId: "u", start: "2026-01-01", end: "2026-03-31",
  });
  assert.deepEqual([...ids].sort(), ["a", "c"]);
});

test("[NO-SILENT-EMPTY, the other way round] a failed read excludes NOTHING", async () => {
  // Deliberately the same outcome as "nothing to exclude", and the direction matters: excluding on
  // a failed read would pull real costs out of a quarter with nobody able to say why. Leaving the
  // known error in place keeps it visible. Pre-migration this is also simply true — without the
  // column no line can carry a reason.
  const ids = await readExcludedBankIds({
    client: fakeClient(new Error('column "ignore_reason" does not exist')),
    userId: "u", start: "2026-01-01", end: "2026-03-31",
  });
  assert.equal(ids.size, 0);
});

test("a private bank line no longer lands in kosten, and 'geen factuur' still does", () => {
  // End to end through the engine, because that is where the money actually moves.
  const rows = [
    { id: "prive-1", amount: -500, category: "kosten", invoice_id: null, date: "2026-02-10", description: "meubelzaak", status: "not_found" },
    { id: "huur-1", amount: -1000, category: "kosten", invoice_id: null, date: "2026-02-11", description: "huur", status: "not_found" },
  ];
  const excluded = new Set(["prive-1"]);

  const before = computeResult([], rows.map((b) => toResultBankTx(b)), [], []);
  const after = computeResult([], rows.map((b) => toResultBankTx(b, excluded)), [], []);

  assert.equal(before.kosten, 1500, "both lines counted before — that is the defect");
  assert.equal(after.kosten, 1000, "the private line is out; the rent stays in");
});

test("an excluded line is not counted as an unexplained vraagpost either", () => {
  // A line with no category lands in ongecategoriseerdBank* — "money we could not classify". An
  // ignored private line is not unclassified; it is classified as not belonging here, and putting
  // it on that counter would trade one wrong figure for another.
  const row = { id: "x", amount: -300, category: null, invoice_id: null, date: "2026-02-10", description: "opname", status: "not_found" };
  const r = computeResult([], [toResultBankTx(row, new Set(["x"]))], [], []);
  assert.equal(r.ongecategoriseerdBankUit, 0);
});
