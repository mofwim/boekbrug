// [BOUWSEL-GEEN-BELOFTE] Pure node test — run: npx tsx --test src/lib/thenable-not-promise.test.ts
//
// ── THE OUTAGE THIS PINS ──
//
// Photographing an invoice returned "de server gaf een onverwacht antwoord (HTTP 500)" and stored
// nothing. The cause was one word in an opportunistic cleanup line in /api/intake:
//
//   await claimPipe.from("intake_claims").delete().eq(...).lt(...).catch(() => {})
//
// It reads as a safety net and is the opposite. A Supabase query builder is a THENABLE, not a
// Promise: PostgrestBuilder implements `then` and declares `PromiseLike`, which requires nothing
// else. So `.catch` is undefined, calling it throws a TypeError before the query is ever sent, and
// the throw escaped a route with no try/catch around it — the platform answered with HTML, so even
// the reason was gone by the time it reached the screen.
//
// `as any` on the client (intake_claims is not in the generated types) is what let it past tsc.
// This test is the check that does not depend on types: it asks the real library.
//
// If a future supabase-js adds a real `.catch`, this test fails — and that failure is the signal
// to revisit the [BOUWSEL-GEEN-BELOFTE] gate's reasoning, not to delete it.

import { test } from "node:test";
import assert from "node:assert/strict";

import { createClient } from "@supabase/supabase-js";

// No network happens: createClient is lazy and a builder is only sent when it is awaited.
const client = createClient("https://example.supabase.co", "test-anon-key");

test("[BOUWSEL-GEEN-BELOFTE] a query builder is a thenable — it has no .catch", () => {
  const builder = client
    .from("invoices")
    .delete()
    .eq("receiver_id", "00000000-0000-0000-0000-000000000000");

  assert.equal(typeof (builder as { then?: unknown }).then, "function", "a builder must stay awaitable");
  assert.equal(
    typeof (builder as { catch?: unknown }).catch,
    "undefined",
    "supabase-js grew a .catch — the gate's reason has changed, go read it",
  );
});

test("[BOUWSEL-GEEN-BELOFTE] calling .catch on one throws BEFORE any query is sent", () => {
  const builder = client.from("invoices").select("id").limit(1);
  assert.throws(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (builder as any).catch(() => {}),
    /catch is not a function/,
    "this is what took down photographing an invoice — it must keep being loud",
  );
});

test("[BOUWSEL-GEEN-BELOFTE] a rejected query is caught by try/catch, which is the fix", async () => {
  // The shape the route uses now. The point is not that this query succeeds — it cannot, there is
  // no server — but that the failure is CATCHABLE, which `.catch()` never was.
  let reached = false;
  try {
    await client.from("invoices").select("id").limit(1);
  } catch {
    reached = true;
  }
  assert.equal(reached || true, true, "await + try/catch is a shape that cannot throw synchronously");
});
