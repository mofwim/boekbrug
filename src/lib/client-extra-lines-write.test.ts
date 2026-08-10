// [KLANT-EXTRA] Pure node test — run: npx tsx --test src/lib/client-extra-lines-write.test.ts
//
// The property that matters: two cosmetic address lines may never cost an owner the invoice they
// just typed. PostgREST rejects the WHOLE ROW when a payload names a column the schema does not
// have, so on a database where the migration is still open, saving would fail entirely.

import { test } from "node:test";
import assert from "node:assert/strict";

import { extraLineFields, writeWithExtraLines, copyExtraLinesOnto } from "./client-extra-lines-write";

const UNKNOWN = { code: "PGRST204", message: "Could not find the 'client_extra_line1' column" };

test("[KLANT-EXTRA] empty lines are stored as NULL, not as an empty string", () => {
  assert.deepEqual(extraLineFields("", "   "), { client_extra_line1: null, client_extra_line2: null });
  assert.deepEqual(extraLineFields(null, undefined), { client_extra_line1: null, client_extra_line2: null });
  assert.deepEqual(
    extraLineFields(" t.a.v. Jansen ", "PO-114"),
    { client_extra_line1: "t.a.v. Jansen", client_extra_line2: "PO-114" },
  );
});

test("[KLANT-EXTRA] the ordinary path writes the fields once and reports them written", async () => {
  const seen: Record<string, unknown>[] = [];
  const r = await writeWithExtraLines(
    async (extra) => { seen.push(extra); return { data: { id: "inv-1" }, error: null } },
    { client_extra_line1: "t.a.v. Jansen", client_extra_line2: null },
  );
  assert.equal(seen.length, 1, "no retry when nothing went wrong");
  assert.deepEqual(seen[0], { client_extra_line1: "t.a.v. Jansen", client_extra_line2: null });
  assert.equal(r.linesWritten, true);
  assert.deepEqual(r.data, { id: "inv-1" });
});

test("[KLANT-EXTRA] an unknown column costs the two lines, never the invoice", async () => {
  // The whole point. Before the migration is applied the first attempt is rejected outright, and
  // the owner must still end up with a saved invoice.
  const seen: Record<string, unknown>[] = [];
  const r = await writeWithExtraLines(
    async (extra) => {
      seen.push(extra);
      return Object.keys(extra).length > 0
        ? { data: null, error: UNKNOWN }
        : { data: { id: "inv-1" }, error: null };
    },
    { client_extra_line1: "t.a.v. Jansen", client_extra_line2: "PO-114" },
  );
  assert.equal(seen.length, 2, "it must retry");
  assert.deepEqual(seen[1], {}, "…and the retry must carry NO extra fields");
  assert.equal(r.error, null, "the invoice was saved");
  assert.deepEqual(r.data, { id: "inv-1" });
  assert.equal(r.linesWritten, false, "…and the caller can tell the lines did not land");
});

test("[KLANT-EXTRA] the SECOND column being unknown is caught too", async () => {
  // A half-applied migration is a real state — ADD COLUMN runs per column.
  let calls = 0;
  const r = await writeWithExtraLines(
    async (extra) => {
      calls++;
      return Object.keys(extra).length > 0
        ? { data: null, error: { code: "PGRST204", message: "Could not find the 'client_extra_line2' column" } }
        : { data: { id: "inv-2" }, error: null };
    },
    { client_extra_line1: null, client_extra_line2: "PO-114" },
  );
  assert.equal(calls, 2);
  assert.equal(r.linesWritten, false);
  assert.equal(r.error, null);
});

test("[KLANT-EXTRA] any OTHER error is returned as-is, never retried", async () => {
  // Retrying a constraint violation or a permission error without two fields would turn a real
  // failure into a confusing partial success — and the caller would report a saved invoice that
  // was never saved.
  for (const err of [
    { code: "23505", message: "duplicate key value violates unique constraint" },
    { code: "42501", message: "new row violates row-level security policy" },
    { code: "", message: "fetch failed" },
  ]) {
    let calls = 0;
    const r = await writeWithExtraLines(
      async () => { calls++; return { data: null, error: err } },
      { client_extra_line1: "x", client_extra_line2: null },
    );
    assert.equal(calls, 1, `${err.code} must not be retried`);
    assert.equal(r.error, err, "the real error must reach the caller unchanged");
    assert.equal(r.linesWritten, true, "…and it must not be reported as a missing column");
  }
});

test("[KLANT-EXTRA] a failure on the RETRY is reported, not swallowed", async () => {
  // If the write fails for a second, genuine reason, the caller must see it — otherwise the screen
  // says the invoice was saved and it was not.
  const real = { code: "23505", message: "duplicate key" };
  const r = await writeWithExtraLines(
    async (extra) => (Object.keys(extra).length > 0
      ? { data: null, error: UNKNOWN }
      : { data: null, error: real }),
    { client_extra_line1: "x", client_extra_line2: null },
  );
  assert.equal(r.error, real);
  assert.equal(r.data, null);
});

// ── copyExtraLinesOnto: carrying the lines onto a creditnota, a duplicate, a recurring copy ────

test("[KLANT-EXTRA] nothing to copy runs no query at all", async () => {
  // The normal state of almost every invoice. It must not cost a round-trip, and it is not a
  // failure — reporting false here would make every ordinary creditnota look like a problem.
  let calls = 0;
  const ok = await copyExtraLinesOnto(async () => { calls++; return { error: null } }, { });
  assert.equal(calls, 0);
  assert.equal(ok, true);
});

test("[KLANT-EXTRA] the lines are carried onto the new document, cleaned", async () => {
  let seen: Record<string, unknown> | null = null;
  const ok = await copyExtraLinesOnto(
    async (f) => { seen = f; return { error: null } },
    { client_extra_line1: "  t.a.v. mevrouw Jansen ", client_extra_line2: "" },
  );
  assert.equal(ok, true);
  assert.deepEqual(seen, { client_extra_line1: "t.a.v. mevrouw Jansen", client_extra_line2: null });
});

test("[KLANT-EXTRA] a failed copy is reported as failed, never as done", async () => {
  // The creditnota itself already exists at this point. The honest outcome is "the document is
  // there, the two lines are not" — claiming success would hide it from the log that says which
  // migration is still open.
  const ok = await copyExtraLinesOnto(
    async () => ({ error: { message: "Could not find the 'client_extra_line1' column" } }),
    { client_extra_line1: "t.a.v. Jansen" },
  );
  assert.equal(ok, false);
});

test("[KLANT-EXTRA] a thrown query cannot take the calling route down with it", async () => {
  // This runs AFTER the creditnota was created. An exception escaping here would turn a created
  // document into a 500, and the owner would try again and mint a second one.
  const ok = await copyExtraLinesOnto(
    async () => { throw new Error("connection reset") },
    { client_extra_line2: "PO-114" },
  );
  assert.equal(ok, false);
});
