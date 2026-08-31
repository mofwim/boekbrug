// [KAS-ZACHT] Pure node test — run: npx tsx --test src/lib/cash-live.test.ts
//
// The rule itself, without a database: does a removed movement get filtered out, and — the half that
// matters more — does the app still work when the column is not there yet?
//
// That second question is not hypothetical. Code ships before a migration is applied by hand, and the
// reads this filter touches are the drawer balance, the kasboek, the readiness verdict and the filing
// gate. Filtering on a column PostgREST does not know refuses the whole read, so getting this wrong
// does not degrade the feature — it takes the owner's entire cash administration off every screen at
// once, which is far worse than the problem soft delete solves.

import { test } from "node:test";
import assert from "node:assert/strict";

import { onlyLiveCash, cashSoftDeleteSupported } from "./cash-live";

/** A builder stub that records what was asked of it. */
function fakeQuery() {
  const calls: Array<[string, unknown]> = [];
  const q = {
    calls,
    is(column: string, value: null) { calls.push([column, value]); return q; },
  };
  return q;
}

test("[KAS-ZACHT] with the column, the reader asks for live rows only", () => {
  const q = fakeQuery();
  const out = onlyLiveCash(q, true);
  assert.deepEqual(q.calls, [["deleted_at", null]]);
  assert.equal(out, q, "the same builder comes back, so .order()/.range() still chain");
});

test("[KAS-ZACHT] without the column, NOTHING is filtered", () => {
  // The deploy window. A filter here would fail the read, and these reads are the drawer balance, the
  // kasboek, readiness and the filing gate — the app would lose its cash administration everywhere at
  // once. Untouched means "behaves exactly as the day before this shipped".
  const q = fakeQuery();
  const out = onlyLiveCash(q, false);
  assert.deepEqual(q.calls, [], "not one filter may be applied before the migration lands");
  assert.equal(out, q);
});

test("[KAS-ZACHT] the filter is IS NULL, matching the partial index", () => {
  // `deleted_at IS NULL` and not `not.is(deleted_at, null)`: live is the default state, and the
  // migration's partial index is built on exactly this predicate — a different spelling would read
  // the same rows and use none of it.
  const q = fakeQuery();
  onlyLiveCash(q, true);
  assert.deepEqual(q.calls[0], ["deleted_at", null]);
});

test("[KAS-ZACHT] an ABSENT column answers NO, and stays re-checkable", async () => {
  // This assertion used to cover two failure shapes with one answer — "an error from PostgREST and
  // a thrown read both mean we cannot rely on it, never assume it is there". The first half stands
  // and is kept. The second half is now the opposite, and that is a deliberate reversal, so here is
  // the argument.
  //
  // The two failures do not mean the same thing. 42703 is the database saying the column is not
  // there; a thrown read is the database being unwell, which says nothing about the schema. And the
  // two wrong answers do not cost the same:
  //
  //   a wrong NO  → no filter is applied, so every soft-deleted cash movement returns to omzet,
  //                 kosten, the drawer, readiness and the aangifte — silently, and the DELETE door
  //                 becomes a hard delete;
  //   a wrong YES → `.is("deleted_at", null)` on a database without the column fails the read, and
  //                 the page or the aangifte says so.
  //
  // On a book whose cardinal sin is a confident wrong number, loud beats silent. And the window the
  // old answer protected is closed: cash_entries.deleted_at exists in production, so a NO from a
  // timeout can only be wrong now. The deploy safety itself is untouched — a real 42703 still
  // answers NO, which is the case below and the case the migration window actually produces.
  let calls = 0;
  const absent = {
    from() { return this; },
    select() { return this; },
    limit() { calls++; return Promise.resolve({ error: { message: '42703 column "deleted_at" does not exist' } }); },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
  assert.equal(await cashSoftDeleteSupported(absent), false);

  // A NEGATIVE answer must not be cached: a server instance that started before the migration would
  // otherwise keep the old behaviour until it happened to restart, which is how a feature silently
  // stays off in production for a week. (The positive answer IS cached — same trade throughout.)
  assert.equal(await cashSoftDeleteSupported(absent), false);
  assert.equal(calls, 2, "it asked again rather than trusting the earlier no");
});

test("[KAS-ZACHT] a read that merely FAILED does not un-remove the drawer", async () => {
  // The other half of the reversal, asserted rather than implied. A thrown read and a timeout are
  // the database being unwell; answering NO to them is what put removed cash back into the books.
  const throwing = {
    from() { return this; },
    select() { return this; },
    limit(): never { throw new Error("network"); },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
  assert.equal(await cashSoftDeleteSupported(throwing), true, "a network failure was read as an absent column");

  const timingOut = {
    from() { return this; },
    select() { return this; },
    limit() { return Promise.resolve({ error: { code: "57014", message: "canceling statement due to statement timeout" } }); },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
  assert.equal(await cashSoftDeleteSupported(timingOut), true, "a statement timeout was read as an absent column");
});
