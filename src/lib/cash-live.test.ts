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

test("[KAS-ZACHT] a failed probe answers NO, and stays re-checkable", async () => {
  // Two failure shapes, one answer. An error from PostgREST (the column does not exist) and a thrown
  // read both mean "we cannot rely on it", never "assume it is there".
  let calls = 0;
  const erroring = {
    from() { return this; },
    select() { return this; },
    limit() { calls++; return Promise.resolve({ error: { message: '42703 column "deleted_at" does not exist' } }); },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
  assert.equal(await cashSoftDeleteSupported(erroring), false);
  const throwing = {
    from() { return this; },
    select() { return this; },
    limit() { calls++; throw new Error("network"); },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
  assert.equal(await cashSoftDeleteSupported(throwing), false);

  // A NEGATIVE answer must not be cached: a server instance that started before the migration would
  // otherwise keep the old behaviour until it happened to restart, which is how a feature silently
  // stays off in production for a week. (The positive answer IS cached — same trade as
  // cashInstalmentsSupported.)
  assert.equal(await cashSoftDeleteSupported(erroring), false);
  assert.equal(calls, 3, "it asked again rather than trusting the earlier no");
});
