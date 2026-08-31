// [KAS-PROBE] The one read that decides whether five modules run reduced.
// Run: npx tsx --test src/lib/column-probe.test.ts
//
// Five probes were written from the same eight lines, and every one answered "the column is gone"
// to a statement timeout. What that NO switches on, per caller, is written in the module header —
// hard-deleted cash movements, un-removed soft deletes, and a reminder ladder dunning invoices the
// bank is already collecting, which is a second payment out of the owner's account.
//
// Every window is closed: all five columns exist in production. So the only thing left to get right
// is which errors mean "absent".

import { test } from "node:test";
import assert from "node:assert/strict";

import { columnIsAbsent, columnExists, resetColumnProbeCacheForTests } from "./column-probe";

// ── columnIsAbsent, the discrimination itself ───────────────────────────────

test("[KAS-PROBE] an absent column is recognised by SQLSTATE and by wording", () => {
  assert.equal(columnIsAbsent({ code: "42703", message: "whatever" }), true);
  assert.equal(columnIsAbsent({ code: "PGRST204", message: "" }), true);
  assert.equal(columnIsAbsent({ message: "column cash_entries.settlement_id does not exist" }), true);
  assert.equal(
    columnIsAbsent({ message: "Could not find the 'settlement_id' column of 'cash_entries' in the schema cache" }),
    true,
  );
});

test("[KAS-PROBE] a database that is merely unwell is not a database missing a column", () => {
  // Each of these used to return false and put a caller into its destructive reduced mode.
  for (const error of [
    { code: "57014", message: "canceling statement due to statement timeout" },
    { code: "53300", message: "remaining connection slots are reserved for non-replication superuser connections" },
    { code: "42501", message: "permission denied for table cash_entries" },
    { code: "PGRST301", message: "JWT expired" },
    { message: "TypeError: fetch failed" },
    { message: "" },
  ]) {
    assert.equal(columnIsAbsent(error), false, `"${error.message}" was read as an absent column`);
  }
  assert.equal(columnIsAbsent(null), false);
  assert.equal(columnIsAbsent(undefined), false);
});

test("[KAS-PROBE] a missing OTHER column does not answer for the one we asked about", () => {
  // The anchoring the shared version added. A probe for settlement_id must not read a complaint
  // about a different column as its own answer — that would switch cash-settle into the model that
  // hard-deletes per-instalment entries, over a column it never asked for.
  const other = { message: "column cash_entries.some_other_column does not exist" };
  assert.equal(columnIsAbsent(other, "settlement_id"), false, "another column's absence answered for ours");
  assert.equal(columnIsAbsent(other, "some_other_column"), true, "the column that IS absent was not recognised");
});

// ── columnExists, the answer a caller acts on ───────────────────────────────

function client(answer: { error: { code?: string; message: string } | null } | Error) {
  return {
    from: () => ({
      select: () => ({ limit: () => (answer instanceof Error ? Promise.reject(answer) : Promise.resolve(answer)) }),
    }),
  };
}

test("[KAS-PROBE] a clean read is yes, a genuinely absent column is no", async () => {
  resetColumnProbeCacheForTests();
  assert.equal(await columnExists(client({ error: null }), "t", "c", "why"), true);
  resetColumnProbeCacheForTests();
  assert.equal(
    await columnExists(client({ error: { code: "42703", message: "column t.c does not exist" } }), "t", "c", "why"),
    false,
  );
});

test("[KAS-PROBE] every other failure answers YES, so the caller bails instead of falling back", async () => {
  // The rule, in one assertion. YES makes the next read ask for the column and fail loudly; NO
  // makes the caller quietly do the destructive thing. Bailing costs an hour.
  resetColumnProbeCacheForTests();
  assert.equal(await columnExists(client({ error: { code: "57014", message: "statement timeout" } }), "t", "c", "why"), true);
  resetColumnProbeCacheForTests();
  assert.equal(await columnExists(client(new Error("socket hang up")), "t", "c", "why"), true);
});

test("[KAS-PROBE] a YES is cached and a failure never becomes one", async () => {
  // Caching a NO would keep an instance that started before the migration in reduced mode until it
  // restarted; caching a spurious failure would do the same for a blip. Only a real YES is durable,
  // and a cached YES must not answer for a DIFFERENT column.
  resetColumnProbeCacheForTests();
  assert.equal(await columnExists(client({ error: null }), "t", "c", "why"), true);
  // The probe is not consulted again — this client would say the column is gone.
  const gone = client({ error: { code: "42703", message: "column t.c does not exist" } });
  assert.equal(await columnExists(gone, "t", "c", "why"), true, "a proven column stopped being proven");
  assert.equal(await columnExists(gone, "t", "other", "why"), false, "one column's YES answered for another");
});

// ── The shape the kasstelsel reader actually sees ───────────────────────────
//
// fetchAllRows does `throw new Error(error.message)`, so a caller downstream of it gets an Error
// with a message and NO code. Every code-based branch above is unavailable there, and the wording
// match is the only thing standing between "the column is missing" and "the database was busy".
// kas-payment-events-fetch depends on exactly that: a wrong answer silently re-reads without
// paid_on and takes every cash instalment out of its BTW quarter.

test("[KAS-PROBE] a code-less Error from fetchAllRows is still classified correctly", () => {
  const absent = new Error("column bank_tx_invoices.paid_on does not exist");
  assert.equal(columnIsAbsent(absent, "paid_on"), true, "the wrapped absent-column error was not recognised");

  for (const message of [
    "canceling statement due to statement timeout",
    "fetch failed",
    "JSON object requested, multiple (or no) rows returned",
    "column bank_tx_invoices.some_other_column does not exist",
  ]) {
    assert.equal(
      columnIsAbsent(new Error(message), "paid_on"),
      false,
      `"${message}" would have dropped paid_on and re-dated every cash instalment`,
    );
  }
});
