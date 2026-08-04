// [PUBLIC-SURFACE] Pure node test — run: npx tsx --test src/lib/public-paths.test.ts
//
// The Playwright sweep in tests/public-surface.spec.ts is the real gate: it asks a running server.
// This file is the half-second version that runs in every `npm run test:unit`, and it pins the two
// rules that made /en unreachable — a public page can be public in a prefix list and still not be
// public as itself.
import { test } from "node:test";
import assert from "node:assert/strict";

import { isPublic, PUBLIC_PATHS, EXACT_PUBLIC_PATHS } from "./public-paths";

test("every declared public path is public", () => {
  for (const p of PUBLIC_PATHS) {
    assert.equal(isPublic(p), true, `${p} is in PUBLIC_PATHS but isPublic() says no`);
  }
  for (const p of EXACT_PUBLIC_PATHS) {
    assert.equal(isPublic(p), true, `${p} is in EXACT_PUBLIC_PATHS but isPublic() says no`);
  }
});

test("the English homepage is reachable without a session", () => {
  // The bug the user hit: "Read this page in English →" on boekbrug.nl landed on
  // /login?redirect=%2Fen, because /en/prijzen and /en/blog were listed and the bare /en was not.
  assert.equal(isPublic("/en"), true);
  assert.equal(isPublic("/en/"), true, "a trailing slash is the same page");
  assert.equal(isPublic("/en/prijzen"), true);
  assert.equal(isPublic("/en/blog"), true);
  assert.equal(isPublic("/en/btw-berekenen"), true);
});

test("an exact public path does not open what is nested under it", () => {
  // This is the whole reason /en is not simply an entry in the prefix list. If it were, this
  // assertion would fail — and every future page under /en would be published by accident.
  assert.equal(isPublic("/en/dashboard"), false);
  assert.equal(isPublic("/en/whatever-ships-next"), false);
  // And "/" must never make the app public, which is the older half of the same rule.
  assert.equal(isPublic("/dashboard"), false);
  assert.equal(isPublic("/dashboard/aangifte"), false);
  assert.equal(isPublic("/onboarding"), false);
});

test("an exact public path is not a prefix for a sibling that merely starts the same", () => {
  // startsWith("/en") also matches "/energie". Nothing is named that today; the point is that
  // adding one tomorrow must not silently make it public.
  assert.equal(isPublic("/energie"), false);
  assert.equal(isPublic("/enquete"), false);
});

test("nested pages under a prefix path stay public with it", () => {
  assert.equal(isPublic("/blog/een-artikel"), true);
  assert.equal(isPublic("/factuur-maken/loodgieter"), true);
  assert.equal(isPublic("/pay/some-token"), true);
});
