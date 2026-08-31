// [BEWIJS-VAST] Pure node test — run: npx tsx --test src/lib/document-references.test.ts
//
// The property: a permanent delete never removes a file the boekhouding still points at, and a
// check that could not run refuses rather than reads as "clean". The second half is the one that
// needs a test, because it is invisible in production until the day it matters — supabase-js does
// not throw on a query error, it returns { count: null, error }, and `count ?? 0` then says zero
// references about a probe that never ran.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  DOCUMENT_REFERRERS,
  readDocumentReferences,
  referencesRefusal,
} from "./document-references";
import { MESSAGES } from "./i18n/messages";

/** A stand-in for the supabase client: one canned answer per `${table}.${column}`. */
function fakeClient(answers: Record<string, { count?: number | null; error?: { code?: string; message?: string } }>) {
  return {
    from(table: string) {
      return {
        select() {
          return {
            eq(column: string) {
              const a = answers[`${table}.${column}`];
              // `?? 0` here would swallow the very case one of the tests below is about: an
              // explicit null count. The fake has to be able to say "no count", or the test that
              // proves the real code refuses on it proves nothing.
              const count = a && "count" in a ? a.count ?? null : 0;
              return Promise.resolve({ count, error: a?.error ?? null });
            },
          };
        },
      };
    },
  };
}

test("a document nothing points at has no references", async () => {
  const v = await readDocumentReferences({ client: fakeClient({}), documentId: "doc-1" });
  assert.equal(v.ok, true);
  assert.ok(v.ok && v.references.length === 0);
});

test("every referrer is actually probed — a role that is never read cannot refuse anything", async () => {
  const probed: string[] = [];
  const client = {
    from(table: string) {
      return {
        select() {
          return {
            eq(column: string) {
              probed.push(`${table}.${column}`);
              return Promise.resolve({ count: 0, error: null });
            },
          };
        },
      };
    },
  };
  await readDocumentReferences({ client, documentId: "doc-1" });
  for (const r of DOCUMENT_REFERRERS) {
    assert.ok(probed.includes(`${r.table}.${r.column}`), `${r.table}.${r.column} was declared but never read`);
  }
});

test("a booking that still points at the file blocks the delete, and says which", async () => {
  const v = await readDocumentReferences({
    client: fakeClient({ "invoices.document_id": { count: 1 }, "cash_entries.document_id": { count: 3 } }),
    documentId: "doc-1",
  });
  assert.ok(v.ok);
  assert.equal(v.references.length, 2);
  assert.equal(v.references[0].count, 1);
  assert.match(v.references[0].phrase, /bewijsstuk/);
  assert.match(v.references[1].phrase, /3 kasboekregels/, "three lines is not 'een kasboekregel'");
});

test("[NO-SILENT-EMPTY] a failed probe refuses — it does not read as zero references", async () => {
  // The whole reason this returns a verdict instead of a number. supabase-js hands back
  // { count: null, error } on a timeout, and `count ?? 0` turns a check that never ran into
  // "nothing points at this file" — permission to destroy the evidence, granted by the failure.
  const v = await readDocumentReferences({
    client: fakeClient({ "cash_entries.document_id": { error: { code: "57014", message: "canceling statement due to statement timeout" } } }),
    documentId: "doc-1",
  });
  assert.equal(v.ok, false);
  assert.ok(!v.ok && /cash_entries/.test(v.failed), "the refusal must name which probe failed");
});

test("[NO-SILENT-EMPTY] a successful probe that returned no count also refuses", async () => {
  // Subtler than an error: no error, and count null. Reading that as 0 is the same permission
  // granted by a different silence.
  const v = await readDocumentReferences({
    client: fakeClient({ "invoices.document_id": { count: null } }),
    documentId: "doc-1",
  });
  assert.equal(v.ok, false);
});

test("a table that does not exist on this database is not a failure", async () => {
  // No table means no foreign key means nothing to lose. This repo deploys against half-applied
  // schemas on purpose, and treating an absent table as "check failed" would make the prullenbak
  // permanently un-emptiable there — a refusal with no defect behind it teaches owners to
  // distrust the refusals that DO have one.
  for (const code of ["42P01", "42703", "PGRST205"]) {
    const v = await readDocumentReferences({
      client: fakeClient({ "bank_statement_periods.document_id": { error: { code, message: "does not exist" } } }),
      documentId: "doc-1",
    });
    assert.equal(v.ok, true, `${code} should be treated as 'this referrer cannot exist here'`);
  }
});

test("the refusal sentence lists every reason, not just the first", async () => {
  const v = await readDocumentReferences({
    client: fakeClient({
      "invoices.document_id": { count: 1 },
      "bank_transactions.statement_document_id": { count: 12 },
      "bank_statement_periods.document_id": { count: 1 },
    }),
    documentId: "doc-1",
  });
  assert.ok(v.ok);
  const sentence = referencesRefusal(v.references);
  assert.match(sentence, /bewijsstuk/);
  assert.match(sentence, /12 banktransacties/);
  assert.match(sentence, /dekking/);
  assert.match(sentence, / en /, "the last reason is joined with 'en', not left dangling on a comma");
});

test("[TAAL] every referrer's two keys are in the catalogue", () => {
  // The screen renders these keys. t() returns the KEY when it does not know one, so a missing
  // entry here shows an owner `prul.ref.dagstaat.meer` on the one screen that is telling him his
  // bookkeeping still needs a file.
  for (const r of DOCUMENT_REFERRERS) {
    assert.ok(r.keyOne in MESSAGES, `${r.keyOne} is not in the catalogue`);
    assert.ok(r.keyMany in MESSAGES, `${r.keyMany} is not in the catalogue`);
    assert.match(
      MESSAGES[r.keyMany].nl, /\{count\}/,
      `${r.keyMany} is the plural sentence but takes no count — it would say the same as the singular`,
    );
    assert.doesNotMatch(
      MESSAGES[r.keyOne].nl, /\{count\}/,
      `${r.keyOne} is the singular sentence; a count in it means the wrong key was chosen somewhere`,
    );
  }
});
