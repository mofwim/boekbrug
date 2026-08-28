// src/lib/funnel-events.test.ts
// Run: npx tsx --test src/lib/funnel-events.test.ts
//
// What these tests are FOR. This funnel runs over invoices, so the failure the module has to make
// impossible is an invoice field reaching an analytics vendor. The `FunnelProps` type closes that
// at the call site — passing `client_name` or `total` will not compile. These tests close what a
// type cannot see: that nothing empty, oversized or unexpected survives the runtime pass.
//
// Only the pure half is imported. trackFunnel() itself is one call into a vendor SDK wrapped in a
// try/catch; mocking that to watch it be called would test the mock.

import { test } from "node:test";
import assert from "node:assert/strict";
import { funnelProperties, FUNNEL_EVENTS } from "./funnel-events";

test("[FUNNEL-METING] every step has a distinct, stable name", () => {
  const names = Object.values(FUNNEL_EVENTS);
  assert.equal(new Set(names).size, names.length, "two steps sharing a name would merge in the dashboard");
  // The names are the contract with the analytics dashboard: renaming one silently restarts its
  // history, so they are asserted literally rather than derived from the object.
  assert.deepEqual(names, [
    "invoice_page_view",
    "invoice_created",
    "invoice_pdf_download",
    "invoice_handoff_created",
    "invoice_cta_click",
    "register_started",
    "register_completed",
  ]);
});

test("[FUNNEL-METING] the trade travels with the event", () => {
  assert.deepEqual(funnelProperties({ vak: "loodgieter" }), { vak: "loodgieter" });
  assert.deepEqual(
    funnelProperties({ vak: "schilder", source: "google", medium: "organic", campaign: "zzp-2026" }),
    { vak: "schilder", source: "google", medium: "organic", campaign: "zzp-2026" },
  );
});

test("[FUNNEL-METING] unknown values are left out, not sent as empty", () => {
  assert.deepEqual(
    funnelProperties({ vak: null, source: "", medium: "   ", campaign: undefined }),
    {},
    "an empty property is noise in every report that groups by it",
  );
  assert.deepEqual(funnelProperties({}), {}, "no properties at all is a valid event");
});

test("[FUNNEL-METING] values are trimmed and capped before they leave", () => {
  assert.deepEqual(funnelProperties({ vak: "  kapper  " }), { vak: "kapper" });
  // utm_* comes off a URL a stranger can write; an unbounded property is theirs to choose.
  const long = funnelProperties({ campaign: "x".repeat(500) });
  assert.equal(long.campaign.length, 64);
});

test("[FUNNEL-METING] nothing but the four route keys can get through", () => {
  // The type already refuses this at a call site; this is the runtime half of the same promise,
  // for anything that reaches the function as `unknown` (a JSON blob, a spread of wider state).
  const smuggled = {
    vak: "schilder",
    client_name: "Bakkerij Hendriks",
    iban: "NL91ABNA0417164300",
    total: 1210,
  } as unknown as Parameters<typeof funnelProperties>[0];

  const sent = funnelProperties(smuggled);
  assert.deepEqual(sent, { vak: "schilder" });
  for (const forbidden of ["client_name", "iban", "total"]) {
    assert.ok(!(forbidden in sent), `${forbidden} must never reach analytics`);
  }
});
