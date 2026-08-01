// tests/render/money-screens.test.tsx
// [RENDER-GATE] Do the money screens survive one render?
//
// Run: npm run test:render
//
// ── WHY THIS EXISTS ──
// The five gates this repo runs are all blind to a crashing screen.
//
//   · `tsc --noEmit` type-checks, and a temporal-dead-zone reference inside a `.filter()` callback
//     is perfectly typed — TypeScript does not model WHEN a closure runs.
//   · `eslint src/` has no rule for it (no-use-before-define fires on 32 places in this repo,
//     almost all of them the harmless kind: a module-scope const used inside a function that runs
//     later). Turning it on would drown the real one in noise.
//   · `next build` compiles the component. It does not call it.
//   · The Playwright smoke test sweeps the PUBLIC surface — every path the middleware lets through
//     without a session. /dashboard/* is by definition not on it.
//
// So a logged-in screen that throws on EVERY render passes all five. That is not hypothetical:
// [INVOICE-SCAN] shipped through the whole gate set with `displayed` reading `onlyFlagged` seventy
// lines before it was declared. Five green gates, and the pay screen would have been a white page
// with "Cannot access 'onlyFlagged' before initialization" in the console.
//
// One render is enough to catch that entire class, and it costs under a second.
//
// ── WHAT IT IS NOT ──
// Not a UI test. It asserts that the component RUNS and that its output is not empty — not how it
// looks, not what it does when you click. Behaviour lives in the pure modules, which have their own
// tests; this gate covers the one thing those cannot see, which is whether the screen that uses
// them survives being called.
//
// ── WHY react-dom/server AND NOT PLAYWRIGHT ──
// Playwright would need a real session, a database with rows in a known state, and a served build.
// This needs none of that: the components take their data as props, so we hand them rows and call
// them. Effects never run under renderToStaticMarkup, so nothing reaches the network.
//
// ── WHY IT LIVES IN tests/render/ AND NOT IN tests/ ──
// playwright.config.ts has testDir './tests'. Its testMatch is pinned to *.spec.ts precisely so
// this file is not picked up by a runner that would not understand it.

import { test, mock } from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

// DELIBERATELY FAKE, and set here rather than in the npm script so the gate runs the same way on
// every machine and no one has to remember them. Same reasoning as playwright.config.ts: the
// Supabase client library refuses to be CONSTRUCTED without a URL and a key, and these screens
// construct one while rendering. The host does not exist, which is exactly right — effects never
// run under renderToStaticMarkup, so nothing here may reach a network, and if a render ever starts
// needing real keys it has stopped being a render gate.
process.env.NEXT_PUBLIC_SUPABASE_URL ??= "https://render-gate.invalid";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??= "render-gate-anon-key";

// The App Router hooks throw outside a router ("invariant expected app router to be mounted").
// Stubbed rather than provided: this gate is about the component body, and a real router would
// only add a way for the gate to fail for a reason that is not the screen's fault.
mock.module("next/navigation", {
  namedExports: {
    useRouter: () => ({ push() {}, replace() {}, refresh() {}, back() {}, forward() {}, prefetch() {} }),
    useSearchParams: () => new URLSearchParams(),
    usePathname: () => "/dashboard",
  },
});

/**
 * A confirmed purchase invoice, in the shape /dashboard/incoming/manage receives it.
 * Defaults describe a correct 9% invoice; every case below overrides only what it is about.
 */
const manageRow = (over: Record<string, unknown> = {}) => ({
  id: "a", invoice_number: "RE0801378", client_name: "Groothandel", status: "received",
  accountant_status: null, direction: "incoming", invoice_type: "factuur",
  total_inc_btw: 871.4, amount_paid: 0, total_ex_btw: 799.45, btw_amount: 71.95,
  invoice_date: "2026-03-12", due_date: "2026-04-11", payment_method: null, payment_date: null,
  created_at: "2026-03-12T10:00:00Z", document_id: null, pdf_url: null, vendor_iban: null,
  payment_reference: null, payment_prepared_at: null, field_confidence: null, ...over,
});

test("[RENDER-GATE] the pay screen renders, with rows that trip every warning it can show", async () => {
  const { default: IncomingManageClient } = await import("../../src/app/dashboard/incoming/manage/IncomingManageClient");
  const { ToastProvider } = await import("../../src/components/ui/Toast");

  const rows = [
    // A credit note the supplier numbers CR…, booked positive — the credit-note signal.
    manageRow({ id: "cr", invoice_number: "CR0300343", total_inc_btw: 51.8, total_ex_btw: 47.52, btw_amount: 4.28, invoice_date: "2026-02-17" }),
    // The ordinary invoice from the same supplier — the evidence the signal needs.
    manageRow({ id: "re" }),
    // A broken breakdown: 985.87 + 88.73 ≠ 1078.46.
    manageRow({ id: "math", client_name: "Vlees", invoice_number: "2033161", total_ex_btw: 985.87, btw_amount: 88.73, total_inc_btw: 1078.46, invoice_date: "2026-02-21" }),
    // A correctly booked credit note: all three amounts negative.
    manageRow({ id: "cn", client_name: "Vlees", invoice_number: "CN9", invoice_type: "creditnota", total_ex_btw: -100, btw_amount: -9, total_inc_btw: -109 }),
    // A paid invoice, so the paid tab and the settled-amount paths are exercised too.
    manageRow({ id: "paid", client_name: "Energie", invoice_number: "E-1", status: "paid", amount_paid: 871.4, payment_date: "2026-03-20" }),
  ];

  const html = renderToStaticMarkup(
    React.createElement(ToastProvider, null,
      // The component's prop type is not exported; the rows above match what page.tsx selects.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      React.createElement(IncomingManageClient as any, {
        profile: { id: "u1" },
        initialInvoices: rows,
        totalCount: rows.length,
        readFailed: [],
        filedQuarters: ["2026-Q1"],
      })),
  );

  // Not just "it did not throw": a component that renders null also does not throw, and would pass
  // a bare smoke assertion while showing the owner an empty page.
  assert.ok(html.length > 1000, "the screen rendered something substantial");
  // [INVOICE-SCAN] The banner is the whole reason this file exists — assert it actually appears for
  // rows that are wrong, so a scan silently returning nothing cannot pass as a working screen.
  assert.match(html, /kloppen niet|klopt niet/, "the scan banner names the wrong invoices");
  // A filed quarter changes what the owner has to DO, so it must be said, not implied.
  assert.match(html, /aangifte al ingediend/, "a filed quarter is marked as a correction");
});

test("[RENDER-GATE] the pay screen renders when the read failed, and says so", async () => {
  const { default: IncomingManageClient } = await import("../../src/app/dashboard/incoming/manage/IncomingManageClient");
  const { ToastProvider } = await import("../../src/components/ui/Toast");

  // [NO-SILENT-EMPTY] The path that matters most on this screen: no rows AND a failed read. It must
  // never render as "you owe nobody anything". Rendering it here also proves the empty-list branches
  // are reachable — they are the ones no manual test ever visits.
  //
  // This case is NOT a substitute for the one above, and the difference was measured: with the TDZ
  // bug reintroduced, the test above fails and THIS ONE STILL PASSES. `[].filter(cb)` never calls
  // cb, so an empty list walks straight past a crash that every real list hits. A render gate is
  // only as good as the rows it is handed.
  const html = renderToStaticMarkup(
    React.createElement(ToastProvider, null,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      React.createElement(IncomingManageClient as any, {
        profile: { id: "u1" },
        initialInvoices: [],
        totalCount: null,
        readFailed: ["openstaande facturen"],
        filedQuarters: null,
      })),
  );

  assert.ok(html.length > 500, "the screen still renders when the read failed");
  // The empty state must not assert that the list is complete.
  assert.doesNotMatch(html, /Geen inkoopfacturen<\/p>\s*<p[^>]*>Je hebt/, "no completeness claim after a failed read");
});

test("[RENDER-GATE] the verify queue renders", async () => {
  const { default: IncomingInvoicesClient } = await import("../../src/app/dashboard/incoming/IncomingInvoicesClient");
  const { ToastProvider } = await import("../../src/components/ui/Toast");
  const { DialogProvider } = await import("../../src/components/ui/Dialog");
  const { classifyImportHealth } = await import("../../src/lib/import-health");

  // health comes from the real classifier rather than a hand-built literal: a shape invented here
  // would keep passing after the classifier changed, which is the opposite of a gate.
  const queueRow = (over: Record<string, unknown> = {}) => {
    const base = {
      id: "q1", client_name: "Groothandel", client_email: null, invoice_type: "factuur",
      total_ex_btw: 985.87, btw_amount: 88.73, total_inc_btw: 1078.46, amount_paid: 0,
      invoice_date: "2026-02-21", invoice_number: "2033161", source: "email",
      pdf_url: null, document_id: null, created_at: "2026-02-21T10:00:00Z",
      folder_id: null, folder_name: null, field_confidence: null, ...over,
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return { ...base, health: classifyImportHealth(base as any) };
  };

  const html = renderToStaticMarkup(
    React.createElement(DialogProvider, null,
      React.createElement(ToastProvider, null,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        React.createElement(IncomingInvoicesClient as any, {
          // A broken breakdown and a clean one, so both the warning and the calm path render.
          initialInvoices: [queueRow(), queueRow({ id: "q2", invoice_number: "RE2", total_ex_btw: 800, btw_amount: 72, total_inc_btw: 872 })],
          ignoredInvoices: [],
          confirmedInvoices: [],
          connectionStatus: { connected: false, provider: null, email: null, connected_at: null, needs_reauth: false, pending_count: 0 },
          userRole: "zzper",
          // [READING-MEMORY] Keyed the way the server keys it: trimmed, lowercased.
          readingHints: { groothandel: "Bij deze leverancier heb je 3 eerdere facturen zelf gecorrigeerd — meestal het btw-bedrag. Controleer dat hier extra." },
        }))),
  );

  assert.ok(html.length > 1000, "the queue rendered something substantial");
  // The list is here, and both suppliers reached it.
  assert.match(html, /Groothandel/);
});

test("[READING-MEMORY] the supplier memory reaches the open card", async () => {
  // Against the CARD, not the list. Every card in the list renders collapsed — the expanded body is
  // behind a click, and a static render never clicks — so a list-level assertion on this text can
  // only ever fail. That is not a reason to assert nothing: the prop being dropped somewhere between
  // the server and the card is exactly the failure this covers, and it is invisible to tsc because
  // an optional prop that never arrives is perfectly typed.
  const { InvoiceCard } = await import("../../src/app/dashboard/incoming/IncomingInvoicesClient");
  const { ToastProvider } = await import("../../src/components/ui/Toast");
  const { DialogProvider } = await import("../../src/components/ui/Dialog");
  const { classifyImportHealth } = await import("../../src/lib/import-health");

  // A CLEAN invoice on purpose. The memory must show where the reader is confident and wrong —
  // Elegance Brands read cleanly twice and was wrong both times — so if this only rendered next to
  // an existing warning it would be silent on the invoices it exists for.
  const base = {
    id: "q1", client_name: "Elegance Brands", client_email: null, invoice_type: "factuur",
    total_ex_btw: 800, btw_amount: 72, total_inc_btw: 872, amount_paid: 0,
    invoice_date: "2026-07-30", invoice_number: "2026070769", source: "email",
    pdf_url: null, document_id: null, created_at: "2026-07-30T10:00:00Z",
    folder_id: null, folder_name: null, field_confidence: null,
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const invoice = { ...base, health: classifyImportHealth(base as any) };
  assert.equal(invoice.health.level, "clean", "the fixture really is an invoice the app is happy with");

  const render = (hint: string | null) => renderToStaticMarkup(
    React.createElement(DialogProvider, null,
      React.createElement(ToastProvider, null,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        React.createElement(InvoiceCard as any, {
          invoice, mode: "pending", expanded: true,
          onToggle() {}, onConfirmPaid() {}, onEdit() {}, onIgnore() {}, onRestore() {},
          readingHint: hint,
        }))),
  );

  const withHint = render("Bij deze leverancier heb je 3 eerdere facturen zelf gecorrigeerd — meestal het btw-bedrag. Controleer dat hier extra.");
  assert.match(withHint, /Wat je hier vaker corrigeert/, "the heading is on the open card");
  assert.match(withHint, /meestal het btw-bedrag/, "and it names the field the owner keeps fixing");

  // Same card, no memory: the block is gone entirely, not an empty box with a heading.
  const without = render(null);
  assert.doesNotMatch(without, /Wat je hier vaker corrigeert/);
});

test("[READING-MEMORY] a supplier with no history renders the queue exactly as before", async () => {
  // The prop is optional and, for most owners, empty — nobody has a supplier past the threshold on
  // day one. The absence has to be SILENT: no empty box, no heading with nothing under it. Rendered
  // rather than reasoned about, because "it is falsy so it will not show" is the kind of claim that
  // is true right up until someone wraps it in a container div.
  const { default: IncomingInvoicesClient } = await import("../../src/app/dashboard/incoming/IncomingInvoicesClient");
  const { ToastProvider } = await import("../../src/components/ui/Toast");
  const { DialogProvider } = await import("../../src/components/ui/Dialog");
  const { classifyImportHealth } = await import("../../src/lib/import-health");

  const base = {
    id: "q1", client_name: "Groothandel", client_email: null, invoice_type: "factuur",
    total_ex_btw: 800, btw_amount: 72, total_inc_btw: 872, amount_paid: 0,
    invoice_date: "2026-02-21", invoice_number: "RE1", source: "email",
    pdf_url: null, document_id: null, created_at: "2026-02-21T10:00:00Z",
    folder_id: null, folder_name: null, field_confidence: null,
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rows = [{ ...base, health: classifyImportHealth(base as any) }];

  const html = renderToStaticMarkup(
    React.createElement(DialogProvider, null,
      React.createElement(ToastProvider, null,
        // No readingHints prop at all — the shape an older server render sends.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        React.createElement(IncomingInvoicesClient as any, {
          initialInvoices: rows, ignoredInvoices: [], confirmedInvoices: [],
          connectionStatus: { connected: false, provider: null, email: null, connected_at: null, needs_reauth: false, pending_count: 0 },
          userRole: "zzper",
        }))),
  );

  assert.ok(html.length > 1000, "the queue still renders without the prop");
  assert.doesNotMatch(html, /Wat je hier vaker corrigeert/, "no heading without a hint under it");
});
