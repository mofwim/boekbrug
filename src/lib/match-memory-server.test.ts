// [GEHEUGEN] Run: npx tsx --test src/lib/match-memory-server.test.ts
//
// ── WHY THIS FILE EXISTS ──
// loadMatchMemory took a Supabase client typed `any`. It has to be: bank_tx_invoices is not in
// the generated Database types, and the rest of this line uses the same relaxed client. But `any`
// means tsc has no method list to check a chain against, so a call in the wrong ORDER is not a
// type error — it is `undefined is not a function`, at runtime, in production.
//
// Which is what happened. The invoices read called `.or()` directly on `.from()`:
//
//     TypeError: e.from(...).or is not a function        /api/bank/match, 15 August 2026
//
// PostgREST's builders are two different objects and only one of them has filters on it.
// `.from()` returns a query builder that can start a verb — select, insert, update, delete —
// and `.select()` returns the filter builder that carries `.eq()`, `.or()`, `.in()`. One line
// too early and the chain is not a bad query, it is a crash.
//
// It surfaced as nothing at all. The caller catches, logs "[GEHEUGEN] confirmed-match memory read
// failed — matching without it", and carries on, exactly as the best-effort contract in
// match-memory-server.ts promises. So bank matching kept working, kept producing answers, and
// silently never used a single confirmation the owner had already made. The feature was not
// broken in a way anyone could see; it was absent.
//
// ── WHAT THE FAKE IS FOR ──
// The fake below is not a stand-in for Supabase. Its only job is to have the SHAPE of PostgREST's
// two builders — filters exist on what select() returns and nowhere else — so that calling them
// out of order throws here, on a laptop, in milliseconds, instead of on /api/bank/match. A fake
// that answered `.or()` on anything would pass this test with the bug back in place, which would
// make it worse than no test.

import { test } from "node:test";
import assert from "node:assert/strict";

import { loadMatchMemory } from "./match-memory-server";

type Row = Record<string, unknown>;

/** Every filter PostgREST puts on the object select() returns, and nothing else. */
const FILTERS = ["eq", "or", "in", "order", "range", "limit", "is", "not", "gte", "lte"] as const;

/**
 * A client with PostgREST's shape: from() can only start a verb, filters live after select().
 * Records the calls so a test can also assert WHICH filters a read applied.
 */
function fakeClient(tables: Record<string, Row[]>) {
  const calls: Array<{ table: string; filters: string[]; args: unknown[] }> = [];

  function filterBuilder(table: string, rows: Row[]) {
    const applied: string[] = [];
    const args: unknown[] = [];
    const builder: Record<string, unknown> = {
      // Thenable, because the first read in loadMatchMemory is awaited directly.
      then(resolve: (v: { data: Row[] | null; error: null }) => unknown) {
        calls.push({ table, filters: applied, args });
        return Promise.resolve({ data: rows, error: null }).then(resolve);
      },
    };
    for (const name of FILTERS) {
      builder[name] = (...a: unknown[]) => {
        applied.push(name);
        args.push(...a);
        return builder;
      };
    }
    return builder;
  }

  const client = {
    from(table: string) {
      // Deliberately ONLY the verbs. This missing `.or` is the entire point of the file.
      return {
        select: (_columns?: string) => filterBuilder(table, tables[table] ?? []),
      };
    },
  };

  return { client, calls };
}

const TABLES = {
  bank_tx_invoices: [{ transaction_id: "tx-1", invoice_id: "inv-1" }],
  bank_transactions: [{ id: "tx-1", counterpart_name: "Jansen Groothandel", counterpart_iban: "NL12INGB0001234567" }],
  invoices: [{ id: "inv-1", client_name: "Jansen Groothandel BV" }],
};

test("[GEHEUGEN] the memory loads against a client shaped like PostgREST", async () => {
  // Before the fix this threw `client.from(...).or is not a function` — the production error,
  // reproduced. It is an assertion about call ORDER wearing the clothes of a happy path.
  const { client } = fakeClient(TABLES);
  const memory = await loadMatchMemory(client, "user-1");
  assert.ok(memory, "loadMatchMemory returned nothing");
});

test("[GEHEUGEN] a confirmation the owner made is actually remembered", async () => {
  // The bug's real cost was not the exception, it was this: an empty memory is indistinguishable
  // from "this counterparty is new", and the matcher went on reasoning from the payment alone.
  //
  // Asserted through the indexes and not through JSON: MatchMemory holds Maps, and
  // JSON.stringify renders a Map as `{}` — so a stringified check would have passed on a
  // completely empty memory, which is exactly the state this test exists to rule out.
  const { client } = fakeClient(TABLES);
  const memory = await loadMatchMemory(client, "user-1");

  assert.equal(memory.byName.size, 1, "the counterpart name index is empty");
  assert.equal(memory.byIban.size, 1, "the counterpart IBAN index is empty");

  const parties = [...memory.byName.values()][0]!;
  assert.equal(parties.size, 1, "the counterpart should remember exactly one party");
  assert.match(
    [...parties][0]!,
    /jansen/i,
    "the party the owner confirmed is not the one that was remembered",
  );
});

test("[GEHEUGEN] both sides of an invoice are still checked for ownership", async () => {
  // The .or() that crashed is a security filter, not a nicety: without it the read is scoped only
  // by the ids it was handed. Moving it must not have dropped it, and a chain that silently no
  // longer filters looks exactly like one that does.
  const { client, calls } = fakeClient(TABLES);
  await loadMatchMemory(client, "user-1");

  const invoiceRead = calls.find((c) => c.table === "invoices");
  assert.ok(invoiceRead, "the invoices table was never read");
  assert.ok(invoiceRead.filters.includes("or"), "the ownership filter is gone from the invoice read");
  assert.ok(
    invoiceRead.args.some((a) => typeof a === "string" && a.includes("sender_id.eq.user-1")),
    "the ownership filter no longer names the user on the sender side",
  );
  assert.ok(
    invoiceRead.args.some((a) => typeof a === "string" && a.includes("receiver_id.eq.user-1")),
    "the ownership filter no longer names the user on the receiver side",
  );
});

test("[GEHEUGEN] the transaction read stays scoped to its owner", async () => {
  const { client, calls } = fakeClient(TABLES);
  await loadMatchMemory(client, "user-1");

  const txRead = calls.find((c) => c.table === "bank_transactions");
  assert.ok(txRead, "the bank_transactions table was never read");
  assert.ok(txRead.filters.includes("eq"), "the user_id filter is gone from the transaction read");
});

test("[GEHEUGEN] no confirmations yields an empty memory instead of a throw", async () => {
  // The best-effort contract: the degradation removes evidence, it never invents any and it never
  // takes the matcher down with it.
  const { client } = fakeClient({ bank_tx_invoices: [], bank_transactions: [], invoices: [] });
  const memory = await loadMatchMemory(client, "user-1");
  assert.ok(memory, "an empty administration must still produce a memory object");
});

test("[GEHEUGEN] the fake refuses a filter on from(), which is what production did", () => {
  // If this ever passes, the fake has stopped modelling PostgREST and every assertion above it
  // has quietly become worthless — a test that cannot fail is the most expensive kind.
  const { client } = fakeClient(TABLES);
  const queryBuilder = client.from("invoices") as unknown as Record<string, unknown>;
  assert.equal(
    typeof queryBuilder.or,
    "undefined",
    "from() must not carry filters, or this file no longer catches the bug it was written for",
  );
});
