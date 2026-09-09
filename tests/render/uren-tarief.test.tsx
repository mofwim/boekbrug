// tests/render/uren-tarief.test.tsx
// [TARIEF-KLANT] + [DECLARABEL] The hours screen, rendered with the numbers a dienstverlener sees.
//
// Two things this covers that no other gate can:
//
//   1. The screen SURVIVES a render with real rows — the class of bug money-screens.test.tsx was
//      written for. /dashboard/uren was never on that line.
//   2. The declarabel share is a percentage of the year total, and it is ABSENT rather than "0%"
//      when there is nothing to divide by. A 0% beside a full year of hours would be a lie about
//      the one number a consultant steers on.
//
// The rate prefill itself is a keystroke, and renderToStaticMarkup never clicks — its rules live in
// src/lib/uren.test.ts, and the wiring is held in place by the [TARIEF-KLANT] lifecycle gate.

import { test, mock } from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

process.env.NEXT_PUBLIC_SUPABASE_URL ??= "https://render-gate.invalid";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??= "render-gate-anon-key";

mock.module("next/navigation", {
  namedExports: {
    useRouter: () => ({ push() {}, replace() {}, refresh() {}, back() {}, forward() {}, prefetch() {} }),
    useSearchParams: () => new URLSearchParams(),
    usePathname: () => "/dashboard/uren",
    useParams: () => ({}),
    notFound: () => { throw new Error("[RENDER-GATE] the component called notFound()"); },
    redirect: (to: string) => { throw new Error(`[RENDER-GATE] the component redirected to ${to}`); },
  },
});

const entry = (over: Record<string, unknown> = {}) => ({
  id: "e1", client_id: "c1", worked_on: "2026-09-01", description: "Adviesgesprek",
  hours: 4, hourly_rate: 95, invoice_id: null, billable: true, ...over,
});

async function render(over: Record<string, unknown>) {
  const { default: UrenClient } = await import("../../src/app/dashboard/uren/UrenClient");
  const { ToastProvider } = await import("../../src/components/ui/Toast");
  const { DialogProvider } = await import("../../src/components/ui/Dialog");
  const { assessUrencriterium } = await import("../../src/lib/urencriterium");
  const props = {
    initialEntries: [
      entry(),
      // An hour with no rate — the leak the customer rate exists to close.
      entry({ id: "e2", hourly_rate: null, description: "Nabellen" }),
      // Own time: counted for the criterion, never invoiced.
      entry({ id: "e3", billable: false, hourly_rate: null, description: "Administratie" }),
      // Already invoiced, so the billed tab has something too.
      entry({ id: "e4", invoice_id: "inv-1" }),
    ],
    clients: [
      { id: "c1", name: "Bakkerij De Jong", default_hourly_rate: 95 },
      // A customer without an agreed rate must be a normal customer, not a broken one.
      { id: "c2", name: "Stichting Wijkwerk", default_hourly_rate: null },
    ],
    loadFailed: false,
    urencriterium: assessUrencriterium({ hoursSoFar: 1000, today: "2026-09-09", year: 2026, everRegistered: true }),
    ...over,
  };
  return renderToStaticMarkup(
    React.createElement(DialogProvider, null,
      React.createElement(ToastProvider, null,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        React.createElement(UrenClient as any, props))),
  );
}

test("[DECLARABEL] the year total names the billable share as a percentage", async () => {
  const html = await render({ declarabelThisYear: 640 });
  assert.ok(html.length > 500, "the hours screen must survive a render with rows");
  assert.match(html, /waarvan 640 declarabel \(64%\)/,
    "640 of 1.000 hours is 64% — the number a dienstverlener steers on");
});

test("[DECLARABEL] a year without hours gets no percentage, and never 0%", async () => {
  const html = await render({
    declarabelThisYear: 0,
    urencriterium: (await import("../../src/lib/urencriterium"))
      .assessUrencriterium({ hoursSoFar: 0, today: "2026-01-02", year: 2026, everRegistered: true }),
  });
  assert.doesNotMatch(html, /\(0%\)/, "0 of 0 hours is no answer at all, not a share of nothing");
});

test("[DECLARABEL] a failed read shows no share at all", async () => {
  const html = await render({ declarabelThisYear: null });
  assert.doesNotMatch(html, /declarabel \(/, "we could not look is not a percentage");
});
