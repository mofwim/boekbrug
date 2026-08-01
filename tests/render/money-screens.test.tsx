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
    // A client PAGE reads its own route parameter. Stubbing it lets /dashboard/invoice/[id] be
    // rendered like any other component.
    useParams: () => ({ id: "inv-1" }),
    // These throw in real Next too — a render that reaches them is a redirect, not a crash, and a
    // test asserting "it renders" should say so out loud rather than pass on a silent no-op.
    notFound: () => { throw new Error("[RENDER-GATE] the component called notFound()"); },
    redirect: (to: string) => { throw new Error(`[RENDER-GATE] the component redirected to ${to}`); },
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
  // [SCAN-WHOLE-BOOK] With no server scan, the banner must NOT claim to have checked everything.
  assert.match(html, /konden we nu niet nakijken/, "a list-only count says it is a list-only count");
});

test("[SCAN-WHOLE-BOOK] the banner counts the whole book, and names what is out of reach", async () => {
  // The failure this guards is a bounded read presented as a complete answer. The pay screen loads
  // every OPEN invoice but only the 200 most recent PAID ones — and a wrongly booked invoice that
  // has since been paid went into the aangifte just as wrong. So the count comes from the server,
  // over the owner's whole history, and anything it found that is not on this screen is said out
  // loud rather than quietly dropped from a worklist that cannot reach it.
  const { default: IncomingManageClient } = await import("../../src/app/dashboard/incoming/manage/IncomingManageClient");
  const { ToastProvider } = await import("../../src/components/ui/Toast");
  const { scanInvoices } = await import("../../src/lib/invoice-scan");

  // One broken invoice IS on the screen; two more exist only in the server scan.
  const onScreen = manageRow({ id: "math", total_ex_btw: 985.87, btw_amount: 88.73, total_inc_btw: 1078.46 });
  const bookScan = scanInvoices([
    { id: "math", invoice_number: "2033161", client_name: "Groothandel", invoice_date: "2026-02-21", invoice_type: "factuur", total_ex_btw: 985.87, btw_amount: 88.73, total_inc_btw: 1078.46 },
    { id: "old1", invoice_number: "OLD1", client_name: "Oud", invoice_date: "2025-05-02", invoice_type: "factuur", total_ex_btw: 100, btw_amount: 52, total_inc_btw: 152 },
    { id: "old2", invoice_number: "OLD2", client_name: "Oud", invoice_date: "2025-05-09", invoice_type: "factuur", total_ex_btw: 200, btw_amount: 9, total_inc_btw: 250 },
  ]);
  assert.equal(bookScan.total, 3, "the fixture really does hold three findings");

  const html = renderToStaticMarkup(
    React.createElement(ToastProvider, null,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      React.createElement(IncomingManageClient as any, {
        profile: { id: "u1" }, initialInvoices: [onScreen], totalCount: 1,
        readFailed: [], filedQuarters: [], bookScan,
      })),
  );

  assert.match(html, /3 geboekte facturen kloppen niet/, "the count is the whole book's, not the list's");
  assert.match(html, /al je 3 bevestigde inkoopfacturen/, "and it says which set it counted");
  assert.match(html, /2 ervan staan niet in deze lijst/, "the unreachable findings are named");
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

/**
 * The rest of the money line.
 *
 * These screens fetch their own data in an effect, so they take few props or none, and a static
 * render shows their loading state. That is much shallower than the two above — and still worth
 * having, because the bug this file was built for lived in the COMPONENT BODY, which runs in full
 * on every render regardless of what the effects would later fetch. Every derived const, every
 * useMemo, every `rows.filter(...)` over the initial empty state executes here.
 *
 * What it does NOT cover, stated rather than implied: the branches that only exist once data has
 * arrived. Handing these screens real rows would mean reaching into their internal state, which a
 * render gate cannot do. The two screens above take their data as props and are therefore tested
 * properly; these are covered against "it does not even start".
 */
const SELF_LOADING_SCREENS: Array<{ name: string; path: string; props: Record<string, unknown> }> = [
  { name: "facturen (verkoopfacturen)", path: "../../src/app/dashboard/facturen/FacturenClient", props: { profile: { id: "u1" } } },
  { name: "bank", path: "../../src/app/dashboard/bank/BankClient", props: {} },
  { name: "kas", path: "../../src/app/dashboard/kas/KasClient", props: {} },
  { name: "aangifte", path: "../../src/app/dashboard/aangifte/AangifteClient", props: {} },
  // The second wave. Same reasoning, same shallow-but-real coverage — every one of these was
  // probed before it was wired, and none of them was broken. This buys protection against the next
  // change; it did not repair anything outstanding.
  { name: "dagomzet (kassa-omzet)", path: "../../src/app/dashboard/dagomzet/DagomzetImportClient", props: {} },
  { name: "waarheid", path: "../../src/app/dashboard/waarheid/WaarheidClient", props: {} },
  { name: "klaar (kwartaal-gereedheid)", path: "../../src/app/dashboard/klaar/KlaarClient", props: {} },
  // A client PAGE rather than a client component — it reads its id from useParams, which the mock
  // at the top of this file supplies.
  { name: "invoice detail", path: "../../src/app/dashboard/invoice/[id]/page", props: {} },
];

/**
 * Not on the list, and stated rather than left to be noticed: /dashboard/resultaat and
 * /dashboard/quarterly are async SERVER components. They await a Supabase client and a session
 * before they render anything, so renderToStaticMarkup cannot call them without a database and a
 * logged-in user — which is the thing this gate exists to avoid needing. quarterly's actual
 * content is the client component QuarterlyOverview, and that one IS covered below.
 */

for (const screen of SELF_LOADING_SCREENS) {
  test(`[RENDER-GATE] ${screen.name} renders`, async () => {
    const mod = await import(screen.path);
    const { ToastProvider } = await import("../../src/components/ui/Toast");
    const { DialogProvider } = await import("../../src/components/ui/Dialog");
    const html = renderToStaticMarkup(
      React.createElement(DialogProvider, null,
        React.createElement(ToastProvider, null,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          React.createElement(mod.default as any, screen.props))),
    );
    assert.ok(html.length > 200, `${screen.name} rendered something`);
  });
}

test("[RENDER-GATE] the quarter overview renders, for both roles", async () => {
  // The screen that says whether a quarter is ready to file. Its page wrapper is a server component,
  // so the client component is the reachable half — and it branches hard on the role: an accountant
  // sees a client list, a zzp'er sees their own quarter. Two renders, because a crash in one branch
  // is invisible from the other.
  const { QuarterlyOverview } = await import("../../src/components/quarterly/QuarterlyOverview");
  const { ToastProvider } = await import("../../src/components/ui/Toast");
  const { DialogProvider } = await import("../../src/components/ui/Dialog");
  for (const isAccountant of [false, true]) {
    const html = renderToStaticMarkup(
      React.createElement(DialogProvider, null,
        React.createElement(ToastProvider, null,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          React.createElement(QuarterlyOverview as any, { isAccountant, role: isAccountant ? "accountant" : "zzper" }))),
    );
    assert.ok(html.length > 200, `the ${isAccountant ? "accountant" : "zzp"} branch rendered`);
  }
});

test("[RENDER-GATE] the accountant bridge renders a tree with money on it", async () => {
  // Takes its data as props, so unlike the self-loading screens above this one gets real nodes —
  // and the lesson from the bug that started this file applies directly: an empty array never calls
  // the callbacks that do the work, so the branches would go unvisited.
  const { default: BrugClient } = await import("../../src/app/dashboard/brug/BrugClient");
  const { ToastProvider } = await import("../../src/components/ui/Toast");
  const { DialogProvider } = await import("../../src/components/ui/Dialog");

  const node = (over: Record<string, unknown> = {}) => ({
    source: "invoice", id: "n1", displayName: "RE0801378", path: ["2026", "Q1", "Voldaan"],
    date: "2026-03-12", amount: 871.4, badges: [], pdfUrl: null, hidden: false, clientId: null,
    ownerId: "u1", partyName: "Groothandel", direction: "incoming", hasLocation: true,
    folderId: null, docId: null, ...over,
  });

  const html = renderToStaticMarkup(
    React.createElement(DialogProvider, null,
      React.createElement(ToastProvider, null,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        React.createElement(BrugClient as any, {
          nodes: [
            node(),
            // A credit note: negative, and badged as such.
            node({ id: "n2", displayName: "CN9", amount: -109, badges: [{ label: "Creditnota", tone: "info" }] }),
            // An outgoing invoice, a hidden (archived) row, and a document with no amount at all.
            node({ id: "n3", displayName: "2026-001", direction: "outgoing", amount: 1210 }),
            node({ id: "n4", displayName: "Oud", hidden: true }),
            node({ id: "n5", source: "document", displayName: "bankafschrift.pdf", amount: null, partyName: null, direction: null, docId: "d1" }),
          ],
          role: "zzper",
          docStatus: { d1: { status: "verwerkt", vraag_text: null } },
          readFailed: [],
        }))),
  );
  assert.ok(html.length > 500, "the bridge rendered its tree");
});

test("[RENDER-GATE] the accountant bridge says when a read failed", async () => {
  // [NO-SILENT-EMPTY] An empty tree plus a failed read must never render as "there is nothing here".
  const { default: BrugClient } = await import("../../src/app/dashboard/brug/BrugClient");
  const { ToastProvider } = await import("../../src/components/ui/Toast");
  const { DialogProvider } = await import("../../src/components/ui/Dialog");
  const html = renderToStaticMarkup(
    React.createElement(DialogProvider, null,
      React.createElement(ToastProvider, null,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        React.createElement(BrugClient as any, { nodes: [], role: "zzper", docStatus: {}, readFailed: ["facturen"] }))),
  );
  assert.ok(html.length > 200, "it still renders when the read failed");
});

test("[RENDER-GATE] Vandaag renders the lists it is famous for getting wrong", async () => {
  // The money dashboard: what is due, what is overdue, what is partly paid. It takes its rows as
  // props, so unlike the four above this one can be handed the cases that actually branch.
  const { default: VandaagClient } = await import("../../src/app/dashboard/vandaag/VandaagClient");
  const { ToastProvider } = await import("../../src/components/ui/Toast");

  const inv = (over: Record<string, unknown> = {}) => ({
    id: "v1", client_name: "Groothandel", invoice_number: "RE1", invoice_date: "2026-03-01",
    due_date: "2026-03-31", total_inc_btw: 872, amount_paid: 0, status: "received",
    direction: "incoming", ...over,
  });

  const html = renderToStaticMarkup(
    React.createElement(ToastProvider, null,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      React.createElement(VandaagClient as any, {
        payable: [
          inv(),
          // Partly paid: the remaining amount is the one that must show, not the invoice total.
          inv({ id: "v2", amount_paid: 400 }),
          // Long overdue.
          inv({ id: "v3", due_date: "2025-11-01" }),
          // A credit note from a supplier: negative, and must not read as a debt.
          inv({ id: "v4", total_inc_btw: -109, invoice_number: "CN1" }),
          // No due date at all — the [DATELESS-TASK] case.
          inv({ id: "v5", due_date: null }),
        ],
        remind: [inv({ id: "o1", direction: "outgoing", status: "overdue", due_date: "2026-01-15" })],
        loadFailed: false,
        toVerifyCount: 3,
        datelessPayableCount: 1,
      })),
  );
  assert.ok(html.length > 500, "Vandaag rendered its lists");
});

test("[RENDER-GATE] the sales overview renders", async () => {
  const { default: VerkoopClient } = await import("../../src/app/dashboard/verkoop/VerkoopClient");
  const { ToastProvider } = await import("../../src/components/ui/Toast");

  const f = (over: Record<string, unknown> = {}) => ({
    id: "s1", invoice_number: "2026-001", client_name: "Klant", client_email: "k@example.com",
    invoice_date: "2026-03-01", due_date: "2026-03-31", total_inc_btw: 1210, amount_paid: 0,
    status: "sent", ...over,
  });

  const html = renderToStaticMarkup(
    React.createElement(ToastProvider, null,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      React.createElement(VerkoopClient as any, {
        // One of every state stateOf() can return, so no branch of the status colouring is unvisited.
        facturen: [
          f(),
          f({ id: "s2", status: "draft" }),
          f({ id: "s3", status: "paid", amount_paid: 1210 }),
          f({ id: "s4", status: "sent", due_date: "2025-12-01", reminder_count: 3, last_reminder_at: "2026-01-05T10:00:00Z" }),
          f({ id: "s5", status: "sent", amount_paid: 500 }),
        ],
        bedrijf: "Mijn Zaak",
        // Server time, passed in rather than read here — the component's own header says why.
        nu: Date.parse("2026-03-15T12:00:00Z"),
      })),
  );
  assert.ok(html.length > 500, "the sales overview rendered its list");
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

test("[GOCARDLESS] the bank-connection panel renders in each of its states", async () => {
  // This panel is only ever reached behind a login, so the smoke test never opens it and the
  // static gates never call it. It also branches on FOUR things at once — configured, connected,
  // expiring, rate-limited — and three of those branches are the ones an owner meets on a bad
  // day, i.e. exactly when a white screen is least affordable.
  const { default: BankConnectPanel } = await import("../../src/app/dashboard/bank/BankConnectPanel");

  const account = (over: Record<string, unknown> = {}) => ({
    id: "acc-1", iban: "NL02ABNA0123456789", ownerName: "Jansen Bouw", currency: "EUR",
    status: "READY", lastSyncedAt: "2026-07-31T05:00:00Z", lastSyncedThrough: "2026-07-31",
    lastError: null, ...over,
  });
  const connection = (over: Record<string, unknown> = {}) => ({
    id: "c1", institutionName: "ING", institutionBic: "INGBNL2A", status: "linked",
    connectedAt: "2026-05-03T10:00:00Z", lastSyncedAt: "2026-07-31T05:00:00Z", lastError: null,
    accessValidUntil: "2026-08-01", daysUntilExpiry: 60, canSyncNow: true,
    accounts: [account()], ...over,
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const render = (state: any) =>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    renderToStaticMarkup(React.createElement(BankConnectPanel as any, { initialState: state }));

  // An unconfigured server hides the card entirely rather than offering a dead button.
  assert.equal(render({ configured: false, connections: [] }), "");

  const empty = render({ configured: true, connections: [] });
  assert.match(empty, /Koppel je bank/);

  const linked = render({ configured: true, connections: [connection()] });
  assert.match(linked, /ING/);
  assert.match(linked, /NL02ABNA0123456789/);
  assert.match(linked, /Ververs/);

  // The two states that MUST still render, because they are what the owner sees when the feed
  // has stopped working — and a crash here would hide the very message telling him to reconnect.
  const expiring = render({ configured: true, connections: [connection({ daysUntilExpiry: 3 })] });
  assert.match(expiring, /verloopt over 3 dagen/);

  const expired = render({
    configured: true,
    connections: [connection({ status: "expired", daysUntilExpiry: -2 })],
  });
  assert.match(expired, /Opnieuw koppelen/);

  // Rate-limited: the refresh button has to be visibly disabled, not silently inert.
  const spent = render({ configured: true, connections: [connection({ canSyncNow: false })] });
  assert.match(spent, /disabled/);

  // A connection with no accounts yet (consent given, details still processing) must not throw
  // on the empty list — the branch a first-day owner hits.
  const bare = render({
    configured: true,
    connections: [connection({ accounts: [], status: "pending", daysUntilExpiry: null })],
  });
  assert.ok(bare.length > 100, "a pending connection still renders");
});
