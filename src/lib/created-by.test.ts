// [ACTING-FOR] Pure node test — run: npx tsx --test src/lib/created-by.test.ts
//
// THE BUG THIS TEST GUARDS
// `as any` silences the type checker, not the database. On an installation without the
// migration, PostgREST answered PGRST204 to every INSERT that carried created_by — and that is
// the insert by which an invoice COMES INTO EXISTENCE. tsc clean, tests green, build complete,
// and still nobody could create an invoice.

import { test } from "node:test";
import assert from "node:assert/strict";

import { isUnknownColumn, writeWithTrail, readWithTrail, UNKNOWN_COLUMN_CODES } from "./created-by";

test("the two error codes for 'I do not know that column' are recognised", () => {
  assert.deepEqual([...UNKNOWN_COLUMN_CODES], ["PGRST204", "42703"]);
  assert.equal(isUnknownColumn({ code: "PGRST204" }), true, "PostgREST: schema cache");
  assert.equal(isUnknownColumn({ code: "42703" }), true, "Postgres: undefined_column");
});

test("a DIFFERENT error is NOT read as a missing column", () => {
  // This is the dangerous side. If a unique-index violation (23505) or an RLS refusal (42501)
  // counted as "column missing" here, the row would then be rewritten without the trail — and a
  // second attempt would silently bypass the very error the first request raised.
  for (const code of ["23505", "42501", "23514", "23503", "PGRST116", "P0001"]) {
    assert.equal(isUnknownColumn({ code }), false, `${code} is not a missing column`);
  }
  assert.equal(isUnknownColumn(null), false);
  assert.equal(isUnknownColumn(undefined), false);
  assert.equal(isUnknownColumn("broken"), false);
  assert.equal(isUnknownColumn({}), false);
});

test("without an error code, only a message naming the column AND 'column' counts", () => {
  assert.equal(isUnknownColumn({ message: "Could not find the 'created_by' column of 'invoices'" }), true);
  assert.equal(isUnknownColumn({ message: "created_by mag niet leeg zijn" }), false, "no 'column'");
  assert.equal(isUnknownColumn({ message: "column foo does not exist" }), false, "different column");
});

// ── writing ───────────────────────────────────────────────────────────────────────────────────

test("normal case: one attempt, WITH the trail", async () => {
  const attempts: Array<Record<string, unknown>> = [];
  const out = await writeWithTrail(
    async (extra) => { attempts.push(extra); return { data: { id: "1" }, error: null }; },
    { created_by: "human-1" },
  );
  assert.equal(attempts.length, 1, "no second attempt when the first succeeds");
  assert.deepEqual(attempts[0], { created_by: "human-1" });
  assert.equal(out.trailWritten, true);
  assert.deepEqual(out.data, { id: "1" });
});

test("column does not exist yet: second attempt WITHOUT the trail, and the work goes through", async () => {
  // This is the whole point. Without this fallback, NO INVOICE COULD BE CREATED at all on an
  // installation with an outstanding migration.
  const attempts: Array<Record<string, unknown>> = [];
  const out = await writeWithTrail(
    async (extra) => {
      attempts.push(extra);
      if (Object.keys(extra).length > 0) return { data: null, error: { code: "PGRST204" } };
      return { data: { id: "1" }, error: null };
    },
    { created_by: "human-1" },
  );
  assert.equal(attempts.length, 2);
  assert.deepEqual(attempts[1], {}, "the second attempt does not send the trail");
  assert.equal(out.trailWritten, false, "and says honestly that the trail is missing");
  assert.deepEqual(out.data, { id: "1" }, "the work WAS done");
  assert.equal(out.error, null);
});

test("a REAL error is not papered over with a second attempt", async () => {
  // If a duplicate (23505) triggered a retry without the trail here, the protection that index
  // exists for would be silently skipped.
  let n = 0;
  const out = await writeWithTrail(
    async () => { n++; return { data: null, error: { code: "23505", message: "duplicate key" } }; },
    { created_by: "human-1" },
  );
  assert.equal(n, 1, "no second attempt");
  assert.equal(out.error.code, "23505", "the error comes back unchanged");
  assert.equal(out.trailWritten, true, "nothing was left out");
});

test("if the second attempt fails too, THAT error comes back — not an invented success", async () => {
  const out = await writeWithTrail(
    async (extra) =>
      Object.keys(extra).length > 0
        ? { data: null, error: { code: "42703" } }
        : { data: null, error: { code: "42501", message: "RLS" } },
    { created_by: "human-1" },
  );
  assert.equal(out.data, null);
  assert.equal(out.error.code, "42501");
  assert.equal(out.trailWritten, false);
});

// ── reading ───────────────────────────────────────────────────────────────────────────────────

test("reading falls back to the column list without the trail", async () => {
  const asked: string[] = [];
  const out = await readWithTrail(
    async (columns) => {
      asked.push(columns);
      if (columns.includes("created_by")) return { data: null, error: { code: "42703" } };
      return { data: { id: "1", status: "draft" }, error: null };
    },
    "id, status, created_by",
    "id, status",
  );
  assert.deepEqual(asked, ["id, status, created_by", "id, status"]);
  assert.equal(out.trailWritten, false);
  assert.deepEqual(out.data, { id: "1", status: "draft" });
});

test("and reads in one go as soon as the column is there", async () => {
  let n = 0;
  const out = await readWithTrail(
    async () => { n++; return { data: { id: "1", created_by: "human-1" }, error: null }; },
    "id, created_by",
    "id",
  );
  assert.equal(n, 1);
  assert.equal(out.trailWritten, true);
});

test("a row without created_by is never attributed to a member", async () => {
  // Closes the circle with acting-for.ts: when reading falls back to the list WITHOUT the trail,
  // created_by is undefined — and canAccessInvoice() grants a member no access on that. The
  // owner does get access, because they are only checked on sender_id. Exactly the intended
  // failure direction.
  const { canAccessInvoice, resolveActingFor } = await import("./acting-for");
  const BOSS = "b", MEMBER = "l";
  const member = resolveActingFor(MEMBER, { owner_id: BOSS, member_id: MEMBER, role: "verkoop", revoked_at: null }, 0);
  const boss = resolveActingFor(BOSS, null, 0);
  assert.equal(canAccessInvoice(member, { sender_id: BOSS }), false);
  assert.equal(canAccessInvoice(boss, { sender_id: BOSS }), true);
});
