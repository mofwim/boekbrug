// tests/render/tax-screens.test.tsx
// [RENDER-GATE] Do the three screens a quarter is FILED from survive one render?
//
// Run: npm run test:render
//
// ── WHY THESE THREE, AND WHY NOW ──
//
// The argument for this whole directory is at the top of money-screens.test.tsx, and AGENTS.md
// states the failure it exists for: /dashboard/incoming/manage went through tsc, eslint, next build
// AND the Playwright sweep with a `const` read seventy lines before it was declared, inside a
// .filter() callback that runs during render. The screen would have been white.
//
// These three were not in this directory at all:
//
//   · /dashboard/aangifte — the BTW return. The single most consequential screen in the product:
//     the owner copies these figures onto a form he files with the Belastingdienst.
//   · /dashboard/klaar    — the readiness board, which decides whether a quarter may be filed.
//   · /dashboard/waarheid — the truth lens, where an owner checks a figure he does not trust.
//
// All three fetch their own data, so what renders here is the first paint. That is not a weaker
// test than it sounds: a temporal-dead-zone reference, a null deref on an initial-state field or a
// bad import throws on exactly that paint, and every other gate in `npm run gates` is blind to it.
//
// Effects never run under renderToStaticMarkup, so nothing here reaches a network. If one of these
// screens ever needs one to paint, it has stopped being renderable and this test is where it shows.

import { test, mock } from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

// Same fakes and the same reasoning as money-screens.test.tsx: the Supabase client refuses to be
// CONSTRUCTED without a URL and a key, and these screens construct one while rendering. The host
// does not exist, which is the point.
process.env.NEXT_PUBLIC_SUPABASE_URL ??= "https://render-gate.invalid";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??= "render-gate-anon-key";

mock.module("next/navigation", {
  namedExports: {
    useRouter: () => ({ push() {}, replace() {}, refresh() {}, back() {}, forward() {}, prefetch() {} }),
    useSearchParams: () => new URLSearchParams(),
    usePathname: () => "/dashboard",
    useParams: () => ({}),
    notFound: () => { throw new Error("[RENDER-GATE] the component called notFound()"); },
    redirect: (to: string) => { throw new Error(`[RENDER-GATE] the component redirected to ${to}`); },
  },
});

async function shell(node: React.ReactElement): Promise<string> {
  const { ToastProvider } = await import("../../src/components/ui/Toast");
  const { DialogProvider } = await import("../../src/components/ui/Dialog");
  return renderToStaticMarkup(
    React.createElement(ToastProvider, null, React.createElement(DialogProvider, null, node)),
  );
}

test("[RENDER-GATE] the BTW return screen renders, in all three accountant states", async () => {
  const { default: AangifteClient } = await import("../../src/app/dashboard/aangifte/AangifteClient");

  // null is not a third shade of false: it means the read of "is there an accountant" itself
  // failed, and the screen must not then claim who files this return. All three must paint.
  for (const hasAccountant of [true, false, null] as const) {
    const html = await shell(React.createElement(AangifteClient, { hasAccountant }));
    assert.ok(html.length > 200, `hasAccountant=${String(hasAccountant)} rendered almost nothing`);
  }
});

test("[RENDER-GATE] the readiness board renders", async () => {
  // The board that decides whether a quarter may be filed at all. A white screen here does not
  // just hide a figure — it removes the gate.
  const { default: KlaarClient } = await import("../../src/app/dashboard/klaar/KlaarClient");
  const html = await shell(React.createElement(KlaarClient));
  assert.ok(html.length > 200, "the readiness board rendered almost nothing");
});

test("[RENDER-GATE] the truth lens renders", async () => {
  const { default: WaarheidClient } = await import("../../src/app/dashboard/waarheid/WaarheidClient");
  const html = await shell(React.createElement(WaarheidClient));
  assert.ok(html.length > 200, "the truth lens rendered almost nothing");
});

test("[RENDER-GATE] none of the three renders a raw message key", async () => {
  // [TAAL] t() returns the KEY for one it does not know, on purpose, so a typo is loud in
  // development. Loud is right there and wrong on a screen an owner files a tax return from.
  const { default: AangifteClient } = await import("../../src/app/dashboard/aangifte/AangifteClient");
  const { default: KlaarClient } = await import("../../src/app/dashboard/klaar/KlaarClient");
  const { default: WaarheidClient } = await import("../../src/app/dashboard/waarheid/WaarheidClient");
  const { MESSAGES } = await import("../../src/lib/i18n/messages");
  const PREFIXES = new Set(Object.keys(MESSAGES).map((k) => k.split(".")[0]));

  for (const [name, node] of [
    ["aangifte", React.createElement(AangifteClient, { hasAccountant: false })],
    ["klaar", React.createElement(KlaarClient)],
    ["waarheid", React.createElement(WaarheidClient)],
  ] as const) {
    const html = await shell(node);
    // A dotted lowercase token between tags LOOKS like a key — and so does `belastingdienst.nl`,
    // which is a domain in the copy and was the first thing this caught. So the test is anchored on
    // the catalogue's own PREFIXES: a token is a leaked key only when its first segment is one the
    // catalogue actually uses. Derived rather than listed, so a new prefix is covered the day it
    // exists — and an unknown key cannot be recognised by membership, because t() returns the key
    // precisely when the catalogue does NOT have it.
    const leaked = [...html.matchAll(/>([a-z][a-zA-Z0-9]*(?:\.[a-zA-Z0-9]+){1,3})</g)]
      .map((m) => m[1])
      .filter((tok) => PREFIXES.has(tok.split(".")[0]));
    assert.deepEqual(leaked, [], `${name} rendered untranslated keys: ${leaked.join(", ")}`);
  }
});
