// tests/render/screens-render.test.tsx
// [WIT-SCHERM] Every dashboard screen must survive being CALLED, not merely compiled.
//
// Run: npm run test:render
//
// ── THE HOLE THIS CLOSES ──
// The render gate existed, and it covered the four money screens. Measured across the rest:
// fifteen client screens — 5.317 lines, including /dashboard/upload, the door every document in
// this app comes through — were never called by any test. A screen that throws on every render
// passes tsc, eslint, next build and the Playwright smoke sweep, because none of those call a
// component and the smoke test never logs in (see money-screens.test.tsx for the case that proved
// it). So fifteen screens could have been white pages and every gate would have been green.
//
// That is not an abstract risk here. The owner demonstrates this app to accountants, on his own
// laptop, with no developer in the room. A screen that breaks during that meeting ends the meeting.
//
// ── WHAT THIS FILE ASSERTS, AND WHAT IT DELIBERATELY DOES NOT ──
// It asserts each screen RUNS and produces markup. It is not a UI test: not how a screen looks, not
// what a click does. Behaviour lives in the pure modules with their own tests. This covers the one
// thing those cannot see — whether the screen that uses them survives being called.
//
// A screen that fetches its own rows can only be seen in its EMPTY state from here, and that limit
// is stated rather than hidden: renderToStaticMarkup runs no effects, so nothing reaches a network.
// Where a screen takes its rows as props, this file hands it rows that exercise the branches —
// [RENDER-GATE]'s own rule, because `[].filter(cb)` never calls `cb` and the bug hides in `cb`.
//
// The companion gate [WIT-SCHERM] in lifecycle-gates.test.ts holds the list closed: a new client
// screen with no render here turns it red.

import test from "node:test";
import { mock } from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import type { ProfileRow } from "../../src/types/rows";

// DELIBERATELY FAKE — the same reasoning as money-screens.test.tsx: the Supabase client refuses to
// be CONSTRUCTED without a URL and a key, and these screens construct one while rendering. The host
// does not exist, which is exactly right; if a render ever needs real keys it has stopped being a
// render gate.
process.env.NEXT_PUBLIC_SUPABASE_URL ??= "https://render-gate.invalid";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??= "render-gate-anon-key";

// The App Router hooks throw outside a router. Stubbed rather than provided: this gate is about the
// component body, and a real router would only add a way to fail for a reason that is not the
// screen's fault. notFound/redirect throw loudly — a screen that reaches them is redirecting, and a
// test asserting "it renders" must say so rather than pass on a silent no-op.
mock.module("next/navigation", {
  namedExports: {
    useRouter: () => ({ push() {}, replace() {}, refresh() {}, back() {}, forward() {}, prefetch() {} }),
    useSearchParams: () => new URLSearchParams(),
    usePathname: () => "/dashboard",
    useParams: () => ({ id: "x-1" }),
    notFound: () => { throw new Error("[WIT-SCHERM] the screen called notFound()"); },
    redirect: (to: string) => { throw new Error(`[WIT-SCHERM] the screen redirected to ${to}`); },
  },
});

/** The providers src/app/layout.tsx mounts above every screen. Five of these screens need them. */
async function inApp(node: React.ReactElement) {
  const { ToastProvider } = await import("../../src/components/ui/Toast");
  const { DialogProvider } = await import("../../src/components/ui/Dialog");
  return React.createElement(ToastProvider, null, React.createElement(DialogProvider, null, node));
}

/**
 * Every screen this file actually rendered, as a repo-relative path.
 *
 * Filled by renderScreen itself and checked by the last test in this file against what is on disk.
 * A list written by hand would go stale the day a screen is added — and worse, a hand-written list
 * can name a screen nobody renders, which is a gate that passes for the wrong reason. Nothing gets
 * into this set except by surviving a render.
 */
const rendered = new Set<string>();

/** Renders a screen the way the app mounts it, and fails with the screen's own error if it throws. */
async function renderScreen(spec: string, props: Record<string, unknown> = {}): Promise<string> {
  const mod = await import(spec);
  const Screen = mod.default as React.ComponentType<Record<string, unknown>>;
  const html = renderToStaticMarkup(await inApp(React.createElement(Screen, props)));
  rendered.add(spec.replace(/^(\.\.\/)+/, "") + ".tsx");
  return html;
}

/** A complete owner profile. Cast because the row has thirty columns and none of them is the point. */
const profile = (over: Partial<ProfileRow> = {}): ProfileRow => ({
  id: "u-1", full_name: "Jamal Haddad", company_name: "Haddad Klussen", email: "jamal@example.nl",
  role: "zzper", account_purpose: "boekhouden", kvk_number: "87654321", btw_number: "NL003456789B01",
  iban: "NL91ABNA0417164300", address: "Kerkstraat 1", postal_code: "1012 AB", city: "Amsterdam",
  phone: "0612345678", preferred_language: "nl", onboarding_done: true, onboarding_step: 9,
  kor_active: false, vat_exempt_activity: false, vat_scheme: "kwartaal", invoice_number_padding: 4,
  kas_opening_balance: 0, reminders_enabled: true, reminder_offsets: [3, 14, 30], vak: "bouw-klus",
  created_at: "2026-01-04T09:00:00Z", ...over,
} as unknown as ProfileRow);

// ─────────────────────────────────────────────────────────────────────────────
// The screens that take their rows as props — handed rows that exercise branches
// ─────────────────────────────────────────────────────────────────────────────

test("[WIT-SCHERM] the customer list renders with balances, a customer at zero and one unread", async () => {
  // The three states must all be walked: a customer who owes, one who owes nothing (0 is a real
  // answer and must not read as "unknown"), and one absent from the map entirely.
  const html = await renderScreen("../../src/app/dashboard/klanten/KlantenClient", {
    profile: profile(),
    openByClient: { "c-1": 1210.5, "c-2": 0 },
  });
  assert.ok(html.length > 400, "the customer screen renders");
});

test("[WIT-SCHERM] the customer list also renders when the balances could not be read", async () => {
  // [NO-SILENT-EMPTY] null is "we could not look", which is a different screen from "nobody owes".
  const html = await renderScreen("../../src/app/dashboard/klanten/KlantenClient", {
    profile: profile(), openByClient: null,
  });
  assert.ok(html.length > 400, "the customer screen renders with no balance map");
});

test("[WIT-SCHERM] the retention vault renders a year inside and a year outside the keep period", async () => {
  const jaar = (year: number, within: boolean) => ({
    year, keepThroughYear: year + 7, withinRetention: within,
    outgoingCount: within ? 24 : 0, incomingCount: within ? 61 : 0, documentCount: within ? 58 : 0,
    bankStatements: within ? 4 : 0, outgoingTotal: within ? 48210.75 : 0,
    quarters: [1, 2, 3, 4].map((q) => ({
      quarter: q, outgoingCount: 6, incomingCount: 15, documentCount: 14, filed: q < 4,
    })),
    // A year with a gap and a year without: the gap list is where the honest sentence lives, and an
    // empty list must not render the same as a year nobody checked.
    gaps: within ? ["Over Q4 ontbreekt een bankafschrift"] : [],
  });
  const html = await renderScreen("../../src/app/dashboard/kluis/KluisClient", {
    summaries: [jaar(2026, true), jaar(2017, false)],
    currentYear: 2026, purpose: "boekhouden", justPaid: false,
  });
  assert.ok(html.length > 400, "the vault renders");
  assert.ok(html.includes("2026"), "the current year is on screen");
});

test("[WIT-SCHERM] the daily-takings import renders with card payouts and under the KOR", async () => {
  const html = await renderScreen("../../src/app/dashboard/dagomzet/DagomzetImportClient", {
    korActive: true,
    cardPayouts: [
      { date: "2026-09-08", gross: 412.55, fee: 4.12, net: 408.43, provider: "SumUp" },
      // A payout with no date: the row must survive a field the reader could not fill.
      { date: null, gross: 88.2, fee: 0.9, net: 87.3, provider: null },
    ],
  });
  assert.ok(html.length > 400, "the takings import renders");
});

test("[WIT-SCHERM] the search screen renders for each role, with a query already typed", async () => {
  for (const role of ["zzper", "accountant", "medewerker"] as const) {
    const html = await renderScreen("../../src/app/dashboard/zoeken/ZoekenClient", {
      initialQuery: "20260005", role,
    });
    assert.ok(html.length > 200, `the search screen renders for ${role}`);
  }
});

test("[WIT-SCHERM] the work screen renders for every trade that has a skin", async () => {
  // The trade decides the nouns, the statuses and which fields exist. A skin that throws on one
  // trade is invisible from any other, so every trade that HAS a work layer is walked.
  //
  // A trade WITHOUT one is deliberately not walked here, and that is a finding rather than a gap:
  // this screen does `workSkin(vak)!` and would throw on an unknown trade — but it cannot be
  // reached with one, because werk/page.tsx redirects to /dashboard before mounting it. Checked
  // rather than assumed; the gate [WIT-SCHERM] in lifecycle-gates.test.ts holds that redirect in
  // place, since without it this line becomes a white screen.
  for (const vak of ["automonteur", "transport", "bouw-klus", "schoonmaak", "fietsenmaker", "dienstverlening"]) {
    const html = await renderScreen("../../src/app/dashboard/werk/WerkClient", { vak });
    assert.ok(html.length > 100, `the work screen renders for ${vak}`);
  }
});

test("[WIT-SCHERM] the home screen renders every list it can show, and its four silences", async () => {
  // This is the screen the owner opens on, and the first thing an accountant is shown. Every list
  // on it is walked with a row that reaches the branch behind it — an empty list would render a
  // page whose entire body never ran.
  const inv = (over: Record<string, unknown> = {}) => ({
    id: "i-1", client_name: "Bouwmarkt Zuid", invoice_number: "2026-0041",
    invoice_date: "2026-08-20", due_date: "2026-09-19", total_inc_btw: 1210.55,
    amount_paid: 0, status: "received", direction: "incoming", ...over,
  });
  const html = await renderScreen("../../src/app/dashboard/vandaag/VandaagClient", {
    payable: [
      inv(),
      // Part-paid: the remaining amount is |total| − amount_paid, not the total.
      inv({ id: "i-2", client_name: "Energie Direct", total_inc_btw: 402.6, amount_paid: 200 }),
      // Long overdue, and a total the reader never got — the row must survive a null amount.
      inv({ id: "i-3", client_name: "Onbekend", due_date: "2026-06-01", total_inc_btw: null }),
    ],
    remind: [
      inv({ id: "o-1", direction: "outgoing", status: "sent", client_name: "Jansen BV", total_inc_btw: 2662 }),
      inv({ id: "o-2", direction: "outgoing", status: "overdue", client_name: "De Vries", due_date: "2026-07-02", total_inc_btw: 484 }),
    ],
    offertes: [
      { ...inv({ id: "q-1", direction: "outgoing", status: "sent" }), followupState: "verloopt-binnenkort", followupDays: 3 },
      { ...inv({ id: "q-2", direction: "outgoing", status: "sent" }), followupState: "verlopen", followupDays: -11 },
      { ...inv({ id: "q-3", direction: "outgoing", status: "sent" }), followupState: "geaccepteerd", followupDays: 5 },
    ],
    refunds: [
      { id: "cr-1", invoiceNumber: "CR-2026-3", invoiceDate: "2026-08-30", clientName: "Jansen BV", amount: 121, standalone: false },
      // A credit with no invoice to compare against: the whole amount is listed, and the row says so.
      { id: "cr-2", invoiceNumber: null, invoiceDate: null, clientName: null, amount: 60.5, standalone: true },
    ],
    toVerifyCount: 4,
    datelessPayableCount: 2,
    zelf: { self: 17, hand: 3, waiting: 4 },
    werk: {
      pluralKey: "werk.meervoud.werkorders",
      counts: { open: 3, bezig: 1, wacht: 2, klaar: 4, klaarExBtw: 2840 },
      signals: [
        { kind: "meerwerk_open", n: 2, amount: 380 },
        { kind: "hours_without_rate", n: 1 },
        { kind: "costs_unlinked", n: 3, amount: 96.4 },
        { kind: "over_budget", n: 1 },
        { kind: "contract_ending", n: 1 },
        { kind: "bundle_over", n: 1, hours: 6.5 },
        { kind: "hours_unbilled_old", n: 5, amount: 610, days: 44 },
      ],
    },
  });
  assert.ok(html.length > 1500, "the home screen renders its lists");
});

test("[WIT-SCHERM] the home screen renders when every read failed, and says nothing it cannot know", async () => {
  // [NO-SILENT-EMPTY] The dangerous half: a screen whose reads all failed must still open, and
  // must not draw the same page as one where there is genuinely nothing to do.
  const html = await renderScreen("../../src/app/dashboard/vandaag/VandaagClient", {
    payable: [], remind: [], offertes: [], refunds: null, loadFailed: true,
    toVerifyCount: 0, datelessPayableCount: 0, zelf: null, werk: null,
  });
  assert.ok(html.length > 200, "the home screen renders after a failed load");
});

test("[WIT-SCHERM] the dashboard shell renders for a trade with vehicles and one without", async () => {
  for (const [vehicleTrade, workPluralKey] of [[true, "werk.meervoud.werkorders"], [false, null]] as const) {
    const html = await renderScreen("../../src/app/dashboard/DashboardClient", {
      profile: { id: "u-1", full_name: "Jamal Haddad", company_name: "Haddad Klussen", email: "jamal@example.nl", role: "zzper" },
      vehicleTrade, workPluralKey,
    });
    assert.ok(html.length > 50, "the dashboard shell renders");
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// The screens that fetch their own rows — seen here in the state the owner meets first
// ─────────────────────────────────────────────────────────────────────────────
//
// An empty render is a weaker assertion than a populated one and is written down as such. It still
// catches the whole import-time and body-level class: a bad import, a hook called conditionally, a
// const read before it is declared at the top level of the component. And it covers the first
// second of every one of these screens, which is the second an accountant is looking at.

const SELF_FETCHING: readonly [string, string][] = [
  ["the upload door", "../../src/app/dashboard/upload/UploadClient"],
  ["the logbook", "../../src/app/dashboard/logboek/LogboekClient"],
  ["the bank categorisation screen", "../../src/app/dashboard/bank/categoriseren/CategoriseClient"],
  ["the till", "../../src/app/dashboard/kassa/KassaClient"],
  ["the team screen", "../../src/app/dashboard/settings/team/TeamClient"],
  ["the vehicle register", "../../src/app/dashboard/voertuigen/VoertuigenClient"],
  ["the asset register", "../../src/app/dashboard/bedrijfsmiddelen/BedrijfsmiddelenClient"],
  ["the workplace screen", "../../src/app/dashboard/werkplek/WerkplekClient"],
  ["the ledger year screen", "../../src/app/dashboard/grootboek/GrootboekJaarClient"],
];

for (const [naam, spec] of SELF_FETCHING) {
  test(`[WIT-SCHERM] ${naam} renders`, async () => {
    const html = await renderScreen(spec);
    assert.ok(html.length > 20, `${naam} produced no markup at all`);
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// The list closes itself
// ─────────────────────────────────────────────────────────────────────────────

test("[WIT-SCHERM] no dashboard screen exists that this file never rendered", () => {
  // Runs last, so `rendered` holds every screen the tests above actually got through. Comparing it
  // against what is on disk is what keeps this file honest as the app grows: a new screen is a red
  // gate on the day it is written, not a white page discovered in front of an accountant.
  const screens: string[] = [];
  const collect = (dir: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) collect(p);
      else if (/Client\.tsx$/.test(e.name)) screens.push(p);
    }
  };
  collect("src/app/dashboard");
  assert.ok(screens.length >= 30, `only ${screens.length} screens found — the scan is broken, not the app`);

  // Screens covered by a render test OTHER than this one. Named individually rather than scanned,
  // because "some test mentions this path" is not the same as "something renders it", and a gate
  // that cannot tell those apart passes on the day it matters.
  const elders = new Set([
    "src/app/dashboard/incoming/manage/IncomingManageClient.tsx",  // money-screens
    "src/app/dashboard/incoming/IncomingInvoicesClient.tsx",       // money-screens
    "src/app/dashboard/bank/BankClient.tsx",                       // money-screens
    "src/app/dashboard/facturen/FacturenClient.tsx",               // money-screens
    "src/app/dashboard/aangifte/AangifteClient.tsx",               // tax-screens
    "src/app/dashboard/jaar/JaarClient.tsx",                       // year-standing
    "src/app/dashboard/waarheid/WaarheidClient.tsx",               // tax-screens
    "src/app/dashboard/kas/KasClient.tsx",                         // kassa-screen
    "src/app/dashboard/klaar/KlaarClient.tsx",                     // tool-screens
    "src/app/dashboard/brug/BrugClient.tsx",                       // tool-screens
    "src/app/dashboard/uren/UrenClient.tsx",                       // uren-tarief
    "src/app/dashboard/artikelen/ArtikelenClient.tsx",             // tool-screens
    "src/app/dashboard/leveranciers/LeveranciersClient.tsx",       // creditors-screen
    "src/app/dashboard/verkoop/VerkoopClient.tsx",                 // money-screens
    "src/app/dashboard/vragen/VragenClient.tsx",                   // tool-screens
    "src/app/dashboard/beveiliging/BeveiligingClient.tsx",         // security-screens
    "src/app/dashboard/klanten/[id]/KlantDetailClient.tsx",        // tool-screens
    "src/app/dashboard/bank/verdelen/[txId]/VerdeelClient.tsx",    // bank-som-klopt
  ]);

  const missing = screens.filter((s) => !rendered.has(s) && !elders.has(s));
  assert.deepEqual(missing, [],
    "these screens are never CALLED by any test, so they could be white pages with every gate " +
    "green:\n  \u00b7 " + missing.join("\n  \u00b7 "));

  // And the elders list may not rot: a path in it that no longer exists is a screen someone renamed,
  // which silently takes its render coverage with it.
  const onDisk = new Set(screens);
  const ghosts = [...elders].filter((e) => !onDisk.has(e));
  assert.deepEqual(ghosts, [], "these are listed as covered elsewhere but no longer exist: " + ghosts.join(", "));
});
