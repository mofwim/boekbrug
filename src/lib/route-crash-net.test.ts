// [DEUR-VANGNET] Pure node test — run: npx tsx --test src/lib/route-crash-net.test.ts
//
// The net under every door that takes a document from a person. What it must do is narrow and the
// three things it must NOT do are what this pins.

import { test } from "node:test";
import assert from "node:assert/strict";

import { withCrashNet } from "./route-crash-net";

test("[DEUR-VANGNET] a handler that answers is passed straight through", async () => {
  const answer = new Response("ok", { status: 200 });
  const got = await withCrashNet("TEST", "nooit te zien", async () => answer);
  assert.equal(got, answer, "the net may not touch a normal answer");
});

test("[DEUR-VANGNET] a throw becomes JSON with the sentence the caller passed", async () => {
  // The exact shape of the outage: a TypeError one line before anything is written.
  const res = await withCrashNet("TEST", "Het is NIET opgeslagen.", async () => {
    throw new TypeError("x.catch is not a function");
  });
  assert.equal(res.status, 500);
  const body = await res.json();
  assert.equal(body.error, "Het is NIET opgeslagen.", "the owner reads the caller's sentence, not a code");
  // The platform's HTML answer is what the client could not parse — this must be real JSON.
  assert.match(res.headers.get("content-type") ?? "", /application\/json/);
});

test("[DEUR-VANGNET] a non-Error throw still answers instead of escaping", async () => {
  // `throw 'string'` and `throw undefined` are legal. A net that only handled Error would let
  // exactly the odd cases through, which is the opposite of what it is for.
  for (const thrown of ["kapot", undefined, null, 42, { code: "X" }]) {
    const res = await withCrashNet("TEST", "zin", async () => {
      throw thrown;
    });
    assert.equal(res.status, 500, `a thrown ${JSON.stringify(thrown)} escaped the net`);
  }
});

test("[DEUR-VANGNET] Next's own control-flow throw is handed back, never swallowed", async () => {
  // redirect() and notFound() throw ON PURPOSE. Catching one would turn a working redirect into a
  // "something went wrong" page — a net that causes the failure it exists to report.
  const redirectish = Object.assign(new Error("NEXT_REDIRECT"), { digest: "NEXT_REDIRECT;replace;/x;307;" });
  await assert.rejects(
    () => withCrashNet("TEST", "zin", async () => { throw redirectish; }),
    /NEXT_REDIRECT/,
    "the net swallowed a redirect",
  );
});
