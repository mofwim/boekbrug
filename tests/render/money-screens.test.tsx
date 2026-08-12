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
    // [E-FACTUUR-ZICHTBAAR] A supplier's Peppol invoice: the figures are the supplier's own, so the
    // row must say the owner never has to check this one. Its badge only renders for a row that
    // carries a non-contradicting _einvoice, so without this row the assertion below would pass
    // over markup that was never produced.
    manageRow({
      id: "ubl", client_name: "Groothandel Noord B.V.", invoice_number: "2026-0418",
      field_confidence: {
        _einvoice: {
          totalIncBtw: 871.4, totalExBtw: 799.45, btwAmount: 71.95, syntax: "ubl",
          invoiceNumber: "2026-0418", vendorName: "Groothandel Noord B.V.",
          invoiceDate: "2026-03-12", dueDate: null, vendorIban: null, paymentReference: null,
          isCreditNote: false, contradicts: false,
        },
      },
    }),
    // …and one the supplier's own file CONTRADICTS. That already earns a warning, so the
    // reassuring badge must NOT appear beside it — a screen that argues with itself is worse than
    // one that says nothing.
    manageRow({
      id: "ublbad", client_name: "Tegenspraak B.V.", invoice_number: "2026-0999",
      total_inc_btw: 87.14,
      field_confidence: {
        _einvoice: {
          totalIncBtw: 871.4, totalExBtw: 799.45, btwAmount: 71.95, syntax: "ubl",
          invoiceNumber: "2026-0999", vendorName: "Tegenspraak B.V.",
          invoiceDate: "2026-03-12", dueDate: null, vendorIban: null, paymentReference: null,
          isCreditNote: false, contradicts: true,
        },
      },
    }),
    // [BON-AUTO] A kassabon the app marked PAID by itself, on the strength of the tender line the
    // till printed. Its badge only renders for a row that carries _auto_paid, so without this row
    // the assertion below would pass over markup that was never produced.
    manageRow({
      id: "bon", client_name: "Nettorama", invoice_number: null, status: "paid",
      total_ex_btw: 9.86, btw_amount: 0.88, total_inc_btw: 10.74, amount_paid: 10.74,
      invoice_date: "2026-03-18", payment_date: "2026-03-18", payment_method: "kas",
      field_confidence: {
        _intake_kind: "receipt",
        _auto_verified: { at: "2026-03-18T09:00:00Z", reason: "clean" },
        _auto_paid: { at: "2026-03-18T09:00:00Z", method: "kas", date: "2026-03-18", reason: "bon_tender_cash", evidence: "wisselgeld" },
      },
    }),
    // [DUP-ON-PAY] The Enka pair, verbatim: one supplier, one invoice number, two amounts, both
    // waiting to be paid. Without BOTH rows the grouping has nothing to group and the assertion
    // below would pass over an empty list.
    manageRow({ id: "dupA", client_name: "Enka Horeca B.V.", invoice_number: "26701681", total_ex_btw: 1213.5, btw_amount: 134.64, total_inc_btw: 1348.14, invoice_date: "2026-01-30" }),
    manageRow({ id: "dupB", client_name: "Enka Horeca B.V.", invoice_number: "26701681", total_ex_btw: 1213.5, btw_amount: 122.18, total_inc_btw: 1335.68, invoice_date: "2026-01-30" }),
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

  // [BETAALDATUM] A paid invoice says WHEN. The card carried "Betaald" plus the invoice date and
  // the vervaldatum — two dates that are not about the payment — while the one that is decided
  // which BTW quarter the cost falls in under the kasstelsel, and was nowhere on the screen.
  // Row 'paid' settled on 2026-03-20 and row 'bon' on 2026-03-18, both with a payment_date.
  assert.match(html, /betaald 20 mrt/, "a paid invoice shows the date it was paid");
  assert.match(html, /betaald 18 mrt/, "…including one the app booked from a kassabon");
  // And an UNPAID row must not claim one. There are several in this list; none has a payment_date,
  // so exactly two of these labels may exist.
  assert.equal(
    (html.match(/· betaald \d/g) ?? []).length, 2,
    "only the two rows that carry a payment_date say when they were paid",
  );

  // [CREDIT-NOT-PAYABLE] The row 'cn' is a correctly booked credit note (all three amounts
  // negative). It wore "Te betalen", a vervaldatum, "Heb je betaald?" and a QR Betalen button —
  // four claims about direction, all pointing the wrong way, and the last one prepares a real
  // transfer of money the supplier owes the OWNER. What has to be on screen instead is what
  // actually happens to it, because with the buttons gone the row would otherwise say nothing.
  assert.match(html, /Te ontvangen/, "a credit note is money coming in, and the chip must say so");

  // [DUP-ON-PAY] Two rows, one supplier, one invoice number, both "Te betalen", both counted in the
  // total at the top — reported three times by the owner, who found each pair by adding up their
  // own list. The warning has to be on the COLLAPSED row: that is where they were looking.
  assert.match(html, /staat 2× in je administratie/, "the pair is named on the row");

  // [BULK-UNDO] The reverse of "Meerdere betalen" has to be reachable, and as its own entry point:
  // the two modes select different rows (open vs settled), so one shared selection would let a tap
  // land on the opposite of what the owner meant, on the money core.
  assert.match(html, /Meerdere annuleren/, "bulk undo is offered");
  assert.match(html, /Meerdere betalen/, "…beside the one it mirrors, not instead of it");
  assert.match(html, /correctie of een dubbele import/, "…and says what that means");
  // The four payable affordances are gone from the LIST. The sentence explaining how a credit note
  // resolves lives in the opened card, where the detail belongs — the chip carries it here.
  assert.doesNotMatch(html, /Heb je betaald\?[\s\S]{0,40}CR0300343/, "no pay prompt beside a credit note");
  // [E-FACTUUR-ZICHTBAAR] The app was loud about problems and silent about its strongest certainty.
  // An owner who keeps the paper invoice open beside the screen could see which rows to doubt and
  // not which ones they never have to check again.
  assert.match(html, /Cijfers van de leverancier/, "the supplier's own figures are named on the row");
  assert.match(
    html, /Deze hoef je niet na te kijken/,
    "…and it says what that means, not merely that it happened",
  );
  // Exactly ONE row earns it: the contradicting one must not, or the screen argues with itself.
  assert.equal(
    (html.match(/Cijfers van de leverancier/g) ?? []).length, 1,
    "a contradicted e-invoice may never wear the reassuring badge",
  );

  // [BON-AUTO] A bon the app both booked AND paid needs its own badge. "Automatisch" alone reads
  // as "booked", and an owner who believes a settled bon is still open pays it a second time.
  assert.match(html, /Bon · al afgerekend/, "an auto-settled bon says so on the row");
  // And the basis is the WORD ON THE PAPER, not our conclusion — a claim the owner can check by
  // looking at the bon, with the way back named in the same breath.
  assert.match(html, /Op de bon staat &quot;wisselgeld&quot;/, "the tender line is quoted");
  assert.match(html, /Zet de betaling hieronder terug/, "…and undoing it is offered beside it");

  // A filed quarter changes what the owner has to DO, so it must be said, not implied.
  assert.match(html, /aangifte al ingediend/, "a filed quarter is marked as a correction");
  // [SCAN-WHOLE-BOOK] With no server scan, the banner must NOT claim to have checked everything.
  assert.match(html, /konden we nu niet nakijken/, "a list-only count says it is a list-only count");
});

test("[AUTO-INCASSO] an incasso invoice loses the two things that would cost money", async () => {
  // The screen this feature was reported from. Two WonenBreburg rent invoices, both past their
  // vervaldatum, both wearing "2 dagen te laat" and offering a Betalen button — for money the bank
  // had already taken. The badge is the annoyance; the button is a second payment.
  //
  // Rendered against the LIST, not an opened card, because that is where both of them stood.
  const { default: IncomingManageClient } = await import("../../src/app/dashboard/incoming/manage/IncomingManageClient");
  const { ToastProvider } = await import("../../src/components/ui/Toast");
  const { supplierNameKey } = await import("../../src/lib/supplier-registry");

  const rows = [
    // Two invoices from one supplier, DIFFERENT amounts — the pair that proves an amount rule
    // would have covered one and left the other behind.
    manageRow({ id: "h1", client_name: "WonenBreburg", invoice_number: "VHF0001107004", total_ex_btw: 83.70, btw_amount: 0, total_inc_btw: 83.70, invoice_date: "2026-07-15", due_date: "2026-08-01" }),
    manageRow({ id: "h2", client_name: "WonenBreburg", invoice_number: "VHF0001107657", total_ex_btw: 74.96, btw_amount: 0, total_inc_btw: 74.96, invoice_date: "2026-07-15", due_date: "2026-08-01" }),
    // A supplier NOT on incasso, equally overdue — the control. Everything this test asserts is
    // missing for the two above must still be present for this one, or the assertions would pass
    // just as well on a screen that lost its pay buttons entirely.
    manageRow({ id: "g1", client_name: "Groothandel", invoice_number: "263548", due_date: "2026-07-14" }),
  ];

  const render = (keys: string[] | null) => renderToStaticMarkup(
    React.createElement(ToastProvider, null,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      React.createElement(IncomingManageClient as any, {
        profile: { id: "u1" }, initialInvoices: rows, totalCount: rows.length,
        readFailed: [], filedQuarters: [], incassoKeys: keys,
      })),
  );

  const on = render([supplierNameKey("WonenBreburg")]);
  assert.ok(on.length > 1000, "the screen rendered something substantial");
  assert.match(on, /Automatisch afgeschreven/, "the incasso rows say who pays them");
  // The control is still late, so the badge itself has not been removed from the screen — only
  // from the rows the bank collects.
  assert.match(on, /dagen te laat/, "the ordinary overdue invoice is still marked late");
  // The em-dash form appears in the badge's title attribute, once per late row — the visible text
  // repeats the same words, so a bare /dagen te laat/ counts each row twice.
  assert.equal(
    (on.match(/— \d+ dagen? te laat/g) ?? []).length, 1,
    "only the non-incasso invoice may be late — the owner is not late for a collection that runs itself",
  );
  // The pay CTA: one, for the one invoice the owner actually has to pay.
  assert.equal(
    (on.match(/Heb je betaald\?/g) ?? []).length, 1,
    "an incasso invoice still offering to be marked paid is one tap away from a double payment",
  );

  // Switch the mandate off and the same three rows behave as they always did. Without this, a
  // component that simply never renders those elements would pass everything above.
  const off = render([]);
  assert.equal((off.match(/— \d+ dagen? te laat/g) ?? []).length, 3, "with no mandate, all three are late again");
  assert.equal((off.match(/Heb je betaald\?/g) ?? []).length, 3, "and all three can be paid by hand");
  assert.doesNotMatch(off, /Automatisch afgeschreven/);

  // And the read that could not run is its own state: it must not read as "nobody is on incasso"
  // in silence, because that silence is what puts the Betalen button back.
  const unknown = render(null);
  assert.match(unknown, /niet ophalen/, "a failed incasso read is said out loud");
  assert.match(unknown, /Betaal ze niet nog een keer/, "…and it names the actual risk");
});

test("[VRIJGESTELD] the cost-attribution control renders each of its three states", async () => {
  const { CostAttribution } = await import("../../src/app/dashboard/incoming/manage/IncomingManageClient");

  // Rendered directly, not through the screen. Inside the row it lives behind `expanded`, which
  // only a click opens — a static render of the screen never reaches it, so asserting on the
  // screen would have been a test that passes without touching the code it names.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const render = (value: string | null) =>
    renderToStaticMarkup(React.createElement(CostAttribution as any, { value, onChange: () => {} }));

  for (const value of ["direct_taxed", "mixed", "direct_exempt", null]) {
    const html = render(value);
    assert.match(html, /Waarvoor is deze kost/, `${value ?? "null"}: the question is asked`);
    // All three choices are always offered — the control is how you CHANGE the answer, so hiding
    // the others would leave an owner who mis-tapped with no way back.
    assert.match(html, /Belast werk/, `${value ?? "null"}: the taxed choice is offered`);
    assert.match(html, /Allebei/, `${value ?? "null"}: the mixed choice is offered`);
    assert.match(html, /Vrijgesteld werk/, `${value ?? "null"}: the exempt choice is offered`);
  }

  // The case that matters most: null is what EVERY existing invoice looks like the day the
  // migration runs, and it must show the default the aangifte is already applying to it — not an
  // empty control that reads as an unanswered question.
  assert.match(render(null), /naar verhouding/, "an unclassified cost explains the pro-rata default");
  assert.equal(render(null), render("mixed"), "null and 'mixed' are the same state, shown the same");
  // A value from a future migration must not blank the control or drop the explanation.
  assert.match(render("something_else"), /naar verhouding/, "an unknown value falls back to mixed");

  assert.match(render("direct_taxed"), /volledig aftrekbaar/, "the taxed state says the BTW is fully deductible");
  assert.match(render("direct_exempt"), /geen recht op aftrek/, "the exempt state says there is no deduction");
});

test("[VRIJGESTELD] the pay screen is unchanged for an owner without exempt turnover", async () => {
  const { default: IncomingManageClient } = await import("../../src/app/dashboard/incoming/manage/IncomingManageClient");
  const { ToastProvider } = await import("../../src/components/ui/Toast");

  const rows = [manageRow({ id: "energie", client_name: "Energie", invoice_number: "E-9" })];
  const render = (profile: Record<string, unknown>) =>
    renderToStaticMarkup(
      React.createElement(ToastProvider, null,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        React.createElement(IncomingManageClient as any, {
          profile, initialInvoices: rows, totalCount: rows.length, readFailed: [], filedQuarters: [],
        })),
    );

  // The 99%: the screen still renders with the new branch compiled into it, and nothing about the
  // exemption reaches them — not when the column is absent, and not when they answered no.
  assert.ok(render({ id: "u1" }).length > 1000, "the ordinary screen is still substantial");
  assert.doesNotMatch(render({ id: "u1" }), /Waarvoor is deze kost/, "an ordinary owner is never asked");
  assert.doesNotMatch(render({ id: "u1", vat_exempt_activity: false }), /Waarvoor is deze kost/);
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
  // [VRIJGESTELD] The invoice form, which now builds its BTW-tarief dropdown from the owner's
  // profile. Added for the reason at the top of this file: the other five gates compile this
  // component without ever calling it. It renders in full here (~13k of markup, rate select
  // included), so a throw anywhere in the form body is caught.
  { name: "invoice form (nieuwe factuur)", path: "../../src/app/dashboard/invoice/new/page", props: {} },
];

// [BETALINGSVERSCHIL] dashboard/zzp/DailyTruth is deliberately NOT on the list above, for exactly
// the reason /dashboard/settings is not (see limit 2 below). It was tried: its first render is
// `if (loading) return <div style={{ height: 148 }} />` — a bare skeleton with no text at all, so
// it fails the "rendered something" assertion outright rather than passing hollowly. Either way
// the entry would say nothing about the screen.
//
// Its new branch — the payment-difference notice under "Te ontvangen" — is covered where the
// decision actually lives: paymentDifferenceNote and detectPaymentDifferences in
// payment-difference.test.ts, including that the sentence never claims to have written anything
// off. That is the split this file's own header argues for: render gates catch a screen that
// cannot start, and pure tests catch a screen that says the wrong thing.

/**
 * [VRIJGESTELD] Two limits of the line above, stated rather than left to be discovered:
 *
 *  1. The "Vrijgesteld" option itself is NOT exercised. It is gated on profile.vat_exempt_activity,
 *     and the form loads its profile in an effect — effects never run under renderToStaticMarkup,
 *     so `profile` is null here and the option is correctly absent. What this gate proves is that
 *     the form still renders with the new branch in it, not that the branch renders.
 *  2. /dashboard/settings is deliberately NOT on the list, even though the exemption declaration
 *     lives there. Its entire body sits behind a `loading` flag that only an effect can clear, so
 *     one render returns a 123-character "Laden..." and nothing else. Listing it would add a test
 *     that passes without ever reaching the code it claims to cover — the precise false green this
 *     file exists to prevent.
 *
 * Both are the same structural boundary: this gate calls components, it does not run their
 * effects. The exemption logic that MATTERS is pure and is tested where it lives —
 * vat-exemption.test.ts (26 cases) and financial-result.test.ts.
 */

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

  // [PARTIAL-PAY] Not just "it rendered" — the number it rendered. v2 is EUR 872 with EUR 400 paid,
  // so the amount on the card is the EUR 472 that is still owed. Showing the invoice total there
  // tells an owner to pay money they already paid, and this list is the one they work from.
  assert.ok(html.includes("€ 472,00"), "the partly-paid card must show what is still OPEN");
  assert.ok(
    html.includes("deels betaald") && html.includes("€ 872,00"),
    "…with the full total named beside it, so the smaller number is never a mystery",
  );
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

test("[ENABLEBANKING] the bank-connection panel renders in each of its states", async () => {
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

test("[FULL-CORRECTION] the shared correction editor renders, and shows the supplier memory", async () => {
  // ONE editor, opened from the pay screen and from /bank. It is rendered here directly because on
  // both screens it lives behind a click, and a static render never clicks — the same reason
  // InvoiceCard is exported. What matters is that every field the accountant reads is on it.
  const { default: InvoiceCorrectionModal } = await import("../../src/components/invoice/InvoiceCorrectionModal");

  const html = renderToStaticMarkup(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    React.createElement(InvoiceCorrectionModal as any, {
      invoice: {
        id: "inv-1", invoice_number: "26302050", client_name: "ATAPACK Cash & Carry B.V.",
        invoice_date: "2026-03-27", invoice_type: "factuur",
        total_ex_btw: 6112.66, btw_amount: 550.14, total_inc_btw: 6662.8,
      },
      readingHint: "Bij deze leverancier heb je 3 eerdere facturen zelf gecorrigeerd — meestal het btw-bedrag. Controleer dat hier extra.",
      onClose() {}, onSaved() {}, onMessage() {},
    }),
  );

  // The money fields, and the ones that carry no money and still decide where the invoice lands.
  assert.match(html, /Totaal \(incl\. BTW\)/);
  assert.match(html, /Factuurnummer/, "the number the duplicate gate and bank matcher key on");
  assert.match(html, /Leverancier/, "the name the supplier memory groups by");
  assert.match(html, /Factuurdatum/, "the date that picks the BTW quarter");
  // It opens on the invoice's CURRENT values — an editor that opens empty invites a retype, and a
  // retyped correct figure is how a correct figure becomes a typo.
  assert.match(html, /26302050/);
  assert.match(html, /ATAPACK Cash &amp; Carry B\.V\./);
  assert.match(html, /6662\.8/);
  // [READING-MEMORY] travels with the editor, so it reaches /bank too.
  assert.match(html, /meestal het btw-bedrag/);
  // [KIND-CORRECTION] the one-way declaration, with the sentence that now describes what it does.
  assert.match(html, /Dit is een creditnota/);
  assert.match(html, /als minbedrag opgeslagen/);
});

test("[FULL-CORRECTION] a credit note is not offered the creditnota tick again", async () => {
  // The declaration is one-way ('factuur' → 'creditnota'). Offering it on a row that already IS one
  // would suggest a reverse that must never exist: it would quietly turn a credit into a debt.
  const { default: InvoiceCorrectionModal } = await import("../../src/components/invoice/InvoiceCorrectionModal");
  const html = renderToStaticMarkup(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    React.createElement(InvoiceCorrectionModal as any, {
      invoice: {
        id: "cn-1", invoice_number: "CN9", client_name: "Sweets", invoice_date: "2026-02-17",
        invoice_type: "creditnota", total_ex_btw: -100, btw_amount: -9, total_inc_btw: -109,
      },
      onClose() {}, onSaved() {}, onMessage() {},
    }),
  );
  assert.doesNotMatch(html, /Dit is een creditnota/);
  assert.match(html, /-109/, "and it still opens on the stored negative amounts");
});

// ─── [CREDIT-SAFE] A suspected credit note is not dunned, and its badge is reachable ──────────
// CREDITFACTUUR CR0301267 from Dutch Sweets: printed "Totaal bedrag (EUR) : € -33,87", stored
// +33,87, badged "⚠ Lijkt een creditnota" — and beside that badge sat "2 dagen te laat", a
// "Heb je betaald?" button and a filled-in payment QR for € 33,87 to the supplier's IBAN.
//
// Two renders, because one proves nothing. The first shows the dunning is gone; the second shows
// it is gone BECAUSE of the credit signal and not because the fixture stopped being overdue.

const sweetsRows = (creditNumber: string) => [
  // Overdue by any clock: due 2026-04-11, and these tests run later than that.
  manageRow({
    id: "cr", client_name: "Dutch Sweets", invoice_number: creditNumber,
    total_ex_btw: 31.07, btw_amount: 2.8, total_inc_btw: 33.87,
    invoice_date: "2026-07-02", due_date: "2026-08-01",
  }),
  // The contrast the signal needs — paid, so it cannot contribute a dunning badge of its own.
  manageRow({
    id: "re", client_name: "Dutch Sweets", invoice_number: "RE0802039",
    status: "paid", amount_paid: 740.47, total_ex_btw: 679.33, btw_amount: 61.14,
    total_inc_btw: 740.47, payment_date: "2026-05-01",
  }),
];

const renderManage = async (rows: unknown[]) => {
  const { default: IncomingManageClient } = await import("../../src/app/dashboard/incoming/manage/IncomingManageClient");
  const { ToastProvider } = await import("../../src/components/ui/Toast");
  return renderToStaticMarkup(
    React.createElement(ToastProvider, null,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      React.createElement(IncomingManageClient as any, {
        profile: { id: "u1" }, initialInvoices: rows, totalCount: rows.length,
        readFailed: [], filedQuarters: [],
      })),
  );
};

test("[CREDIT-SAFE] a suspected credit note loses its dunning badge and gains a tappable one", async () => {
  const html = await renderManage(sweetsRows("CR0301267"));

  assert.match(html, /Lijkt een creditnota/, "the signal still fires on the real case");
  assert.doesNotMatch(html, /te laat/, "money the supplier owes you is never late");
  // On a phone there is no hover, so a title attribute was the whole explanation and none of it was
  // reachable. The badge has to be something you can press.
  assert.match(
    html, /<button[^>]*>⚠ Lijkt een creditnota<\/button>/,
    "the warning badge is a button, not a tooltip nobody can open",
  );
});

test("[CREDIT-SAFE] the same overdue row IS dunned once it stops looking like a credit note", async () => {
  // Same fixture, same dates, only the number changes: RE… carries no credit prefix, so the signal
  // stays quiet and the row is an ordinary late bill again. Without this second render the first
  // one would also pass on a screen that had simply stopped dunning anything.
  const html = await renderManage(sweetsRows("RE0803119"));

  assert.doesNotMatch(html, /Lijkt een creditnota/, "no credit prefix, no signal");
  assert.match(html, /te laat/, "an ordinary overdue invoice must still say so");
});

// ─── [INTAKE-QUEUE] The button that is on nearly every screen ─────────────────
// This component gained state in the queue change — a counter, a ref, and a new summary sheet — and
// it renders on almost every dashboard surface. A bad hook order or a reference before declaration
// would not break one screen, it would white-page most of them, and the source-level gates in
// bundle-weight-gates.test.ts cannot see that: they read imports and shapes, never a render.
//
// This does not test the queue. Behaviour under three concurrent uploads needs a real device, and
// that is stated rather than pretended: renderToStaticMarkup never runs an effect and never fires a
// click. What it proves is the thing the other gates structurally cannot — that the component still
// RUNS, in each of its placements.

test("[RENDER-GATE] the intake button renders in every placement it is used in", async () => {
  const { default: IntakeButton } = await import("../../src/components/intake/IntakeButton");
  const { ToastProvider } = await import("../../src/components/ui/Toast");

  // The placements the app actually mounts it in. An unknown one is included on purpose: the prop
  // is a union today, and a component that throws on an unexpected value would take the page with
  // it rather than degrade.
  for (const placement of ["fab", "card", "inline", undefined]) {
    const html = renderToStaticMarkup(
      React.createElement(ToastProvider, null,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        React.createElement(IntakeButton as any, { placement })),
    );
    assert.ok(html.length > 0, `placement ${String(placement)} rendered nothing at all`);
  }
});

test("[INTAKE-QUEUE] the idle button invites a capture and claims no work in progress", async () => {
  // The counter starts at zero, so the resting copy must be the invitation — not "1 wordt gelezen".
  // If inFlight ever initialised wrong, every screen carrying this button would greet the owner
  // with a progress line about an upload that does not exist.
  const { default: IntakeButton } = await import("../../src/components/intake/IntakeButton");
  const { ToastProvider } = await import("../../src/components/ui/Toast");

  const html = renderToStaticMarkup(
    React.createElement(ToastProvider, null,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      React.createElement(IntakeButton as any, { placement: "card" })),
  );
  assert.match(html, /Maak een foto of upload/, "the resting state must invite a capture");
  assert.doesNotMatch(html, /wordt gelezen/, "an idle button must not claim something is processing");
});

test("[DOC-INLINE] the document sheet shows the paper, our numbers AND what was checked", async () => {
  // The sheet exists to make verifying cheap. All three parts have to be on screen at once — the
  // document alone is what the old window.open already gave, and it is not what made checking
  // expensive. What was missing is our reading beside it, and the checks stated instead of implied.
  const { default: InvoiceDocumentSheet } = await import("../../src/components/invoice/InvoiceDocumentSheet");

  const clean = renderToStaticMarkup(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    React.createElement(InvoiceDocumentSheet as any, {
      invoice: {
        id: "d1", client_name: "Oz&er food", invoice_number: "26035350", invoice_date: "2026-06-24",
        invoice_type: "factuur", total_ex_btw: 257.85, btw_amount: 23.21, total_inc_btw: 281.06,
        vendor_iban: "NL65RABO0171136276", field_confidence: null, vendorNumbers: [],
      },
      onClose() {}, onCorrect() {},
    }),
  );
  assert.match(clean, /Wat wij hebben gelezen/, "our reading is on screen next to the paper");
  assert.match(clean, /26035350/, "…with the number the owner is about to compare");
  assert.match(clean, /281,06/, "…and the total, formatted the Dutch way");
  assert.match(clean, /Alle 8 controles gedaan/, "a clean invoice says what was checked instead of nothing");
  assert.match(clean, /Klopt niet — corrigeren/, "and the fix is one tap from the doubt");
  assert.match(clean, /9% over het hele bedrag/, "including the btw axis, which is a real check here");

  // The half that must never be cosmetic: a check that could not run says so, and the summary
  // stops claiming completeness. A green list that overstates is worse than no list.
  const unsure = renderToStaticMarkup(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    React.createElement(InvoiceDocumentSheet as any, {
      invoice: {
        id: "d2", client_name: "Oz&er food", invoice_number: "26035350", invoice_date: "2026-06-24",
        invoice_type: "factuur", total_ex_btw: 257.85, btw_amount: 23.21, total_inc_btw: 281.06,
        vendor_iban: "NL65RABO0171136276", vendorNumbers: [],
        field_confidence: { _safecore: { iban_check_unavailable: true } },
      },
      onClose() {}, onCorrect: null,
    }),
  );
  assert.doesNotMatch(unsure, /Alle \d+ controles gedaan/, "a skipped check breaks the completeness claim");
  assert.match(unsure, /konden we niet nagaan/, "and it is said, not merely left quieter");

  // [BTW-SPLIT] The invoice this whole axis exists for, on the screen it lied on: Enka Horeca
  // 26701681, whose three amounts agree with each other and are € 0,46 wrong. Nothing else on this
  // sheet can tell — so the one row that CAN say "we did not check this" has to actually reach the
  // markup, greyed and worded, and the summary line above it has to stop claiming completeness.
  const mixed = renderToStaticMarkup(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    React.createElement(InvoiceDocumentSheet as any, {
      invoice: {
        id: "d3", client_name: "Enka Horeca B.V.", invoice_number: "26701681",
        invoice_date: "2026-01-30", invoice_type: "factuur",
        total_ex_btw: 1213.5, btw_amount: 122.18, total_inc_btw: 1335.68,
        vendor_iban: "NL65RABO0171136276", field_confidence: null, vendorNumbers: [],
      },
      onClose() {}, onCorrect() {},
    }),
  );
  assert.doesNotMatch(mixed, /Alle \d+ controles gedaan/, "seven green ticks over a wrong btw is the bug");
  assert.match(mixed, /mengt btw-tarieven/, "the reason the btw could not be verified is on screen");
  assert.match(mixed, /btw-specificatie/, "and it says where to look on the paper");

  // The colour is read before the sentence. Green over "1 konden we niet nagaan" says stop-looking
  // while the words say keep-looking, and at a glance the colour wins — the same overstatement in
  // a different medium. #137333 is the green reserved for a genuinely complete list.
  const summaryColour = (html: string) => /font-weight:700;color:(#[0-9A-Fa-f]{6})[^"]*">[^<]*controles/.exec(html)?.[1];
  assert.equal(summaryColour(clean), "#137333", "a complete list earns the green");
  assert.notEqual(summaryColour(mixed), "#137333", "an incomplete one must not wear it");
  assert.notEqual(summaryColour(unsure), "#137333");
});

test("[RENDER-GATE] factureren namens een klant renders, and says whose invoice it is", async () => {
  const { default: AccountantFactuur } = await import("../../src/modules/accountant/pages/AccountantFactuur");

  // With a mandate. Two clients, so the picker branch runs — one client auto-selects and would
  // skip the very code path that decides which name goes on the invoice.
  const html = renderToStaticMarkup(
    React.createElement(AccountantFactuur, {
      klanten: [
        { id: "c1", naam: "Bakkerij Yilmaz", btwNummer: "NL001234567B01" },
        { id: "c2", naam: "Loodgieter De Vries", btwNummer: null },
      ],
    }),
  );
  assert.match(html, /Factureren namens een klant/, "the screen renders at all");
  assert.match(html, /Bakkerij Yilmaz/, "…with the clients who granted a mandate");
  // Art. 35: the number series belongs to the client, and the screen has to say so before the
  // accountant presses a button that consumes one of their numbers.
  assert.match(html, /art\. 35 Wet OB/, "the irreversibility of an issued number is stated");

  // Without a mandate the screen must NOT look broken or empty — it has to name the one thing that
  // is missing and who can fix it, because the accountant cannot fix it himself.
  const leeg = renderToStaticMarkup(React.createElement(AccountantFactuur, { klanten: [] }));
  assert.match(leeg, /Nog geen enkele klant heeft je hiervoor gemachtigd/, "the empty state explains itself");
  assert.match(leeg, /Instellingen/, "…and points at where the CLIENT turns it on");
  assert.match(leeg, /35a/, "…and says the responsibility stays with the entrepreneur");
});

test("[ARTIKELEN-WIPE] the empty-the-catalogue action exists, and only when there is something to empty", async () => {
  // A destructive action on a screen full of rows: the render gate is where "it is on the page at
  // all" is held, since the manage screen's own gates cannot see this one.
  const { default: ArtikelenClient } = await import("../../src/app/dashboard/artikelen/ArtikelenClient");
  const { ToastProvider } = await import("../../src/components/ui/Toast");
  const { DialogProvider } = await import("../../src/components/ui/Dialog");

  // Effects never run under renderToStaticMarkup, so the list starts empty and loading — which is
  // exactly the state that must NOT offer to delete everything.
  const html = renderToStaticMarkup(
    React.createElement(DialogProvider, null,
      React.createElement(ToastProvider, null,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        React.createElement(ArtikelenClient as any, {}))),
  );
  assert.ok(html.length > 200, "the screen rendered");
  assert.doesNotMatch(
    html, /artikelen verwijderen/,
    "with nothing loaded there is nothing to empty — offering it would be a destructive button " +
      "over an unknown list",
  );
});

test("[CHECKLIST] the verify queue shows the checks too — it is where the invoice enters the books", async () => {
  // The pay screen got this first, and it is the SECOND-most important place for it. The queue is
  // where the owner decides to confirm an invoice INTO the books, which is the moment "what did we
  // check, and what could we not check" is worth anything at all.
  const { InvoiceCard } = await import("../../src/app/dashboard/incoming/IncomingInvoicesClient");
  const { ToastProvider } = await import("../../src/components/ui/Toast");
  const { DialogProvider } = await import("../../src/components/ui/Dialog");
  const { classifyImportHealth } = await import("../../src/lib/import-health");

  const base = {
    id: "q9", client_name: "Oz&er food", client_email: null, invoice_type: "factuur",
    total_ex_btw: 257.85, btw_amount: 23.21, total_inc_btw: 281.06, amount_paid: 0,
    invoice_date: "2026-06-24", invoice_number: "26035350", source: "upload",
    pdf_url: "u1/x.pdf", document_id: null, created_at: "2026-06-24T10:00:00Z",
    folder_id: null, folder_name: null, field_confidence: null,
    vendor_iban: "NL65RABO0171136276",
    // [REREAD-CONFIRMED] What page.tsx now selects, and what reimportDecision reads. Left out, the
    // predicate answers "no" and the re-read offer silently never renders — which is exactly the
    // failure it exists to prevent, so the fixture has to carry them.
    direction: "incoming", status: "processing", accountant_status: null,
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const invoice = { ...base, health: classifyImportHealth(base as any) };

  const html = renderToStaticMarkup(
    React.createElement(DialogProvider, null,
      React.createElement(ToastProvider, null,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        React.createElement(InvoiceCard as any, {
          invoice, mode: "pending", expanded: true,
          onToggle() {}, onConfirmPaid() {}, onEdit() {}, onIgnore() {}, onRestore() {},
        }))),
  );

  // The entry point. Its label has to promise both halves, because the checks are the reason to
  // open it — the document alone is what the old window.open already gave.
  assert.match(html, /Bekijk factuur en controles/, "the queue offers the document AND the checks");
  // And the old behaviour must be gone: handing the file to the operating system loses the queue
  // position, which on this screen means losing your place in the verification you were doing.
  assert.doesNotMatch(html, /Bekijk factuur<\/button>/, "the OS hand-off label is gone");

  // [REREAD-CONFIRMED] This invoice is CLEAN — classifyImportHealth finds nothing, so the amber
  // "Even controleren" block that used to hold the only "Opnieuw inlezen" button never renders.
  // That is the case the owner hit: told to press it, nothing to press. The offer has to be here
  // on a spotless card, with the sentence that says what it is for.
  assert.match(html, /Opnieuw inlezen/, "a clean invoice can be re-read too — that is where a misread amount hides");
  assert.match(html, /Klopt er iets niet/, "and the owner is told what the button is for");
});

test("[RENDER-GATE] the debtor board renders, and stays honest about what it cannot do", async () => {
  const { default: AccountantDebiteuren } = await import("../../src/modules/accountant/pages/AccountantDebiteuren");
  const { buildDebtorBoard } = await import("../../src/lib/accountant-debtors");

  const NOW = Date.parse("2026-08-04T12:00:00Z");
  const day = (n: number) => new Date(NOW + n * 86_400_000).toISOString().slice(0, 10);
  const inv = (over: Record<string, unknown> = {}) => ({
    ownerId: "k1", id: "f1", invoice_number: "2026-001", client_name: "Afnemer BV",
    client_email: "afnemer@example.com", invoice_date: day(-40), due_date: day(-30),
    total_inc_btw: 500, amount_paid: 0, status: "sent", last_reminder_at: null,
    reminder_count: 0, ...over,
  });

  // Rows that exercise the BRANCHES — an empty list would render the same for any bug in them.
  const groepen = buildDebtorBoard(
    [
      inv({ id: "kan" }),                                            // the button path
      inv({ id: "geen-mail", client_email: null }),                  // refused: no address
      inv({ id: "stil", reminders_paused: true }),                   // refused: the owner said no
      inv({ id: "oud", due_date: day(-200), total_inc_btw: 120 }),   // the months-late wording
      inv({ id: "deel", total_inc_btw: 500, amount_paid: 180 }),     // a partial payment
    ] as never,
    { k1: "Bakkerij Yilmaz" },
    NOW,
  ).map((g) => ({ ...g, rows: g.rows.map((r) => ({ ...r, paused: false })) }));

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const html = renderToStaticMarkup(React.createElement(AccountantDebiteuren as any, { groepen }));
  assert.match(html, /Openstaande facturen/, "the screen renders at all");
  assert.match(html, /Bakkerij Yilmaz/, "…grouped by the client whose money it is");
  assert.match(html, /6 maanden te laat/, "…and the oldest debt is named in months, not raw days");
  // The half that must never be cosmetic: a row that cannot be mailed says WHY. A grey button with
  // no sentence teaches the accountant to stop reading the screen.
  assert.match(html, /Deze klant heeft geen e-mailadres/, "the refusal is spelled out");
  assert.match(html, /stilgezet/, "including the owner's own 'not this one'");
  // And the ceiling that is a decision rather than a next tap.
  assert.match(html, /art\. 6:96 BW/, "what comes after three reminders is not a button");

  // Nothing overdue is a different sentence from no mandate — a board that says "geen mandaat"
  // when everything is simply paid would send the accountant chasing a permission they have.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const leeg = renderToStaticMarkup(React.createElement(AccountantDebiteuren as any, { groepen: [] }));
  assert.match(leeg, /Niets te laat/, "all paid says so");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const geen = renderToStaticMarkup(React.createElement(AccountantDebiteuren as any, { groepen: [], geenMandaat: true }));
  assert.match(geen, /Nog geen enkele klant heeft je gemachtigd/, "no mandate says something else");
  assert.match(geen, /Instellingen/, "…and points at where the CLIENT turns it on");
});

test("[RENDER-GATE] stukken opvragen renders, and refuses to promise completeness", async () => {
  const { default: AccountantOpvragen } = await import("../../src/modules/accountant/pages/AccountantOpvragen");

  const props = {
    klanten: [{ id: "k1", naam: "Bakkerij Yilmaz" }, { id: "k2", naam: "Loodgieter De Vries" }],
    kwartalen: [
      { year: 2026, quarter: 2, label: "Q2 2026" },
      { year: 2026, quarter: 1, label: "Q1 2026" },
    ],
  };

  // Effects never run under renderToStaticMarkup, so the readiness fetch never fires — which is
  // the pre-selection state, and the one a bug in the picker would show first.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const html = renderToStaticMarkup(React.createElement(AccountantOpvragen as any, props));
  assert.match(html, /Stukken opvragen/, "the screen renders at all");
  assert.match(html, /Bakkerij Yilmaz/, "…with the linked clients");
  assert.match(html, /Q2 2026/, "…and the quarters to pick from");

  // No linked clients is a different sentence from no gaps — one sends the accountant to the
  // invite screen, the other to a phone call.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const leeg = renderToStaticMarkup(React.createElement(AccountantOpvragen as any, { ...props, klanten: [] }));
  assert.match(leeg, /nog geen gekoppelde klanten/, "the empty state names the actual blocker");
  assert.match(leeg, /Klanten beheren/, "…and where to fix it");
});

test("[RENDER-GATE] the request text the client receives never claims the quarter is complete", async () => {
  // The pure builder is what BOTH the preview and the server use, so asserting it here covers the
  // sentence the client actually reads. readiness.ts cannot see a receipt that was never uploaded;
  // a request implying "then we are done" breaks at exactly the wrong moment.
  const { buildDocumentRequest } = await import("../../src/lib/document-request");
  const r = buildDocumentRequest({
    items: [{ title: "3 bankregels zonder bon", detail: "€ 412 aan kosten" }],
    quarterLabel: "Q2 2026",
    accountantName: "Administratiekantoor De Wit",
  });
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.match(r.text, /wat er niet in staat, kan ik ook niet zien/);
    assert.doesNotMatch(r.text, /compleet|volledig/i);
  }
});

test("[RENDER-GATE] the confirm queue renders, and never hides what the reader was unsure about", async () => {
  const { default: AccountantBevestigen } = await import("../../src/modules/accountant/pages/AccountantBevestigen");

  const rij = (over: Record<string, unknown> = {}) => ({
    id: "i1", clientId: "k1", clientNaam: "Bakkerij Yilmaz", leverancier: "Groothandel Bos",
    factuurnummer: "RE0801378", datum: "2026-06-24", totaalInc: 871.4, btw: 71.95,
    twijfels: [] as string[], ...over,
  });

  // Rows that exercise the branches — a clean one, one the reader was unsure about, and one with
  // nothing filled in at all.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const html = renderToStaticMarkup(React.createElement(AccountantBevestigen as any, {
    rijen: [
      rij(),
      rij({ id: "i2", twijfels: ["het bedrag", "de datum"] }),
      rij({ id: "i3", leverancier: "", factuurnummer: null, datum: null, totaalInc: null, btw: null }),
    ],
  }));
  assert.match(html, /Bevestigen/, "the screen renders at all");
  assert.match(html, /Bakkerij Yilmaz/, "…saying whose books these are, on every row");
  assert.match(html, /871,40/, "…with the amount formatted the Dutch way");
  // The half that must never become decoration: a doubt is shown BEFORE the button, in words.
  // A confirm button above a hidden doubt turns the accountant into a rubber stamp.
  assert.match(html, /Dit konden wij niet zeker lezen: het bedrag · de datum/);
  // And the sentence that keeps the liability where the law puts it (art. 52 AWR).
  assert.match(html, /art\. 52 AWR/, "the responsibility is named on the screen, not only in the terms");
  // [FACTUURVRAAG] The alternative to confirming is one tap away — and it is now a QUESTION about
  // this invoice, not a link away to a quarter-level screen for missing documents that carried
  // neither the invoice nor the client.
  assert.match(html, /Klopt niet — vraag stellen/, "the alternative to confirming is one tap away");
  assert.doesNotMatch(
    html, /href="\/dashboard\/accountant\/opvragen"/,
    "the row's alternative navigates away again, carrying nothing about the invoice in front of it",
  );

  // No mandate is a different sentence from an empty queue — one sends the accountant to their
  // client, the other means there is genuinely nothing to do.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const geen = renderToStaticMarkup(React.createElement(AccountantBevestigen as any, { rijen: [], geenMandaat: true }));
  assert.match(geen, /Nog geen enkele klant heeft je gemachtigd/);
  assert.match(geen, /andere machtiging dan die om te factureren/, "and it says the two are separate");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const leeg = renderToStaticMarkup(React.createElement(AccountantBevestigen as any, { rijen: [] }));
  assert.match(leeg, /Er staat niets te wachten/);
});

test("[VRAAG-MACHTIGING] the empty states offer a way OUT of themselves", async () => {
  // The gap this closes: four screens waited on a permission and none of them could ask for one.
  // Their empty states said "your client turns it on in Settings" — instructions for a phone call
  // that has to happen outside the app. A feature that only starts after a phone call does not
  // start. So every one of those empty states now carries the ask, right under the explanation.
  const { default: AccountantFactuur } = await import("../../src/modules/accountant/pages/AccountantFactuur");
  const { default: AccountantBevestigen } = await import("../../src/modules/accountant/pages/AccountantBevestigen");
  const { default: AccountantDebiteuren } = await import("../../src/modules/accountant/pages/AccountantDebiteuren");

  const gekoppeld = [{ id: "k1", naam: "Bakkerij Yilmaz" }, { id: "k2", naam: "Loodgieter De Vries" }];

  const schermen: Array<[string, string]> = [
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ["factuur", renderToStaticMarkup(React.createElement(AccountantFactuur as any, { klanten: [], gekoppeld }))],
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ["bevestigen", renderToStaticMarkup(React.createElement(AccountantBevestigen as any, { rijen: [], geenMandaat: true, gekoppeld }))],
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ["debiteuren", renderToStaticMarkup(React.createElement(AccountantDebiteuren as any, { groepen: [], geenMandaat: true, gekoppeld }))],
  ];

  for (const [naam, html] of schermen) {
    assert.match(html, /Vraag toestemming/, `${naam}: the ask is on the screen`);
    assert.match(html, /Bakkerij Yilmaz/, `${naam}: …with the linked clients to ask`);
    // It asks; it never grants. The client decides on their own screen — an accountant who could
    // grant themselves is the hole accountant_clients_insert_consent.sql closed.
    assert.match(html, /Beslissen doet hij zelf/, `${naam}: and says who decides`);
  }
});

test("[VRAAG-MACHTIGING] with no linked clients at all, the ask stays hidden", async () => {
  // Nothing to ask, and a picker with an empty dropdown is worse than no picker: it looks broken
  // rather than not-yet-applicable. The screen's own explanation already names the real blocker.
  const { default: AccountantBevestigen } = await import("../../src/modules/accountant/pages/AccountantBevestigen");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const html = renderToStaticMarkup(React.createElement(AccountantBevestigen as any, { rijen: [], geenMandaat: true, gekoppeld: [] }));
  assert.doesNotMatch(html, /Vraag toestemming/);
  assert.match(html, /Nog geen enkele klant heeft je gemachtigd/, "the explanation is still there");
});

// ─────────────────────────────────────────────────────────────────────────────
// [WERKVOORRAAD] De boekhoudershome — het scherm dat vier tegels een getal geeft
//
// Dit is de eerste pagina die een boekhouder opent, en tot vandaag stond er op de vier
// werktegels niets. De regel die dat oplost rekent met bedragen en dagen, en die twee
// dingen zijn precies wat er in een lege lijst niet gebeurt: hand hem nul rijen en elke
// tak blijft ongemoeid. Dus wordt hij hier met ECHTE standen gerenderd — met mandaat en
// zonder, met werk en zonder — want de nul-zonder-mandaat en de nul-zonder-werk zijn twee
// verschillende zinnen en het scherm hoort ze allebei te kunnen uitspreken.
// ─────────────────────────────────────────────────────────────────────────────

const homeProfile = {
  id: "acc-1", full_name: "Sanne de Vries", company_name: "De Vries Administratie",
  email: "sanne@devries.nl", role: "accountant",
};
const homeOverview = { total_clients: 3, clients_with_open_questions: 1, clients_missing_bank: 0 };
const homeClients = [
  { id: "c1", full_name: "Jan Jansen", company_name: "Jansen Bouw", email: "jan@jansenbouw.nl" },
  { id: "c2", full_name: "Piet Pieters", company_name: null, email: "piet@example.nl" },
];

test("[WERKVOORRAAD] de home toont de werkvoorraad als getallen, niet als tegels zonder tekst", async () => {
  const { default: AccountantHome } = await import("../../src/modules/accountant/pages/AccountantHome");

  const html = renderToStaticMarkup(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    React.createElement(AccountantHome as any, {
      profile: homeProfile,
      overview: homeOverview,
      workQueues: {
        toConfirm: 12, overdueCount: 3, overdueTotal: 4231.55, worstDaysLate: 74,
        mandatedForInvoices: 2, mandatedForConfirm: 2, complete: true,
      },
      clients: homeClients,
      todos: [],
      notifications: [],
      unreadMessages: 0,
    }),
  );

  assert.ok(html.length > 500, "de home rendert");
  assert.match(html, /Wat er op jou ligt/);
  // Het getal zelf moet er staan — een tegel met alleen een label is precies wat hier weg moest.
  assert.match(html, />12</, "de stapel die een kwartaal tegenhoudt staat er als getal");
  assert.match(html, /4\.232|4\.231/, "het te late bedrag staat er in Nederlandse notatie");
  assert.match(html, /oudste 74 dagen/, "hoe oud de oudste schuld is, want dat is het echte signaal");
  assert.match(html, /3 facturen/);
});

test("[WERKVOORRAAD] nul-omdat-niets en nul-omdat-geen-machtiging zijn twee verschillende zinnen", async () => {
  const { default: AccountantHome } = await import("../../src/modules/accountant/pages/AccountantHome");

  // Wél gemachtigd, niets te doen. Dit is een gerustheid en hoort zo te lezen.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rustig = renderToStaticMarkup(React.createElement(AccountantHome as any, {
    profile: homeProfile, overview: homeOverview, clients: homeClients, todos: [],
    notifications: [], unreadMessages: 0,
    workQueues: {
      toConfirm: 0, overdueCount: 0, overdueTotal: 0, worstDaysLate: 0,
      mandatedForInvoices: 2, mandatedForConfirm: 2, complete: true,
    },
  }));
  assert.match(rustig, /Niets houdt een kwartaal tegen/);
  assert.match(rustig, /Niets te laat/);
  assert.doesNotMatch(rustig, /machtigde je hiervoor/, "wie gemachtigd is hoort daar niet over te lezen");

  // Gekoppeld maar niet gemachtigd voor bevestigen. Dezelfde nul, een heel ander bericht:
  // hier is niets te zien omdat je niets mág, en dat is oplosbaar — via /vraag-machtiging.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const halfMandaat = renderToStaticMarkup(React.createElement(AccountantHome as any, {
    profile: homeProfile, overview: homeOverview, clients: homeClients, todos: [],
    notifications: [], unreadMessages: 0,
    workQueues: {
      toConfirm: 0, overdueCount: 1, overdueTotal: 250, worstDaysLate: 5,
      mandatedForInvoices: 1, mandatedForConfirm: 0, complete: true,
    },
  }));
  assert.match(halfMandaat, /Nog niemand machtigde je hiervoor/);
  assert.doesNotMatch(halfMandaat, /Niets houdt een kwartaal tegen/,
    "een nul zonder machtiging mag NOOIT als 'alles is in orde' lezen");
});

test("[WERKVOORRAAD] een onbekende stand toont geen geruststellende nul", async () => {
  const { default: AccountantHome } = await import("../../src/modules/accountant/pages/AccountantHome");

  // complete=false betekent: een van de reads faalde. Nul is dan geen feit maar een gebrek aan
  // feiten, en een werkbord dat dat als "niets te doen" toont, liegt op de plek waar het niet mag.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const onbekend = renderToStaticMarkup(React.createElement(AccountantHome as any, {
    profile: homeProfile, overview: homeOverview, clients: homeClients, todos: [],
    notifications: [], unreadMessages: 0,
    workQueues: {
      toConfirm: 0, overdueCount: 0, overdueTotal: 0, worstDaysLate: 0,
      mandatedForInvoices: 2, mandatedForConfirm: 2, complete: false,
    },
  }));
  assert.ok(onbekend.length > 500, "de home rendert nog steeds");
  assert.doesNotMatch(onbekend, /Wat er op jou ligt/, "liever geen regel dan een onware regel");

  // En zonder de prop erbij — de home is ouder dan deze regel en hoort ook zo te openen.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const zonder = renderToStaticMarkup(React.createElement(AccountantHome as any, {
    profile: homeProfile, overview: homeOverview, clients: homeClients, todos: [],
    notifications: [], unreadMessages: 0,
  }));
  assert.ok(zonder.length > 500);
  assert.doesNotMatch(zonder, /Wat er op jou ligt/);
});

test("[WERKVOORRAAD] een boekhouder zonder enige machtiging krijgt geen leeg werkbord te zien", async () => {
  const { default: AccountantHome } = await import("../../src/modules/accountant/pages/AccountantHome");

  // Nieuwe boekhouder: klanten gekoppeld, nog niets gemachtigd. Twee blokken met nul erin zeggen
  // hem niets — de weg naar een machtiging loopt via de schermen zelf, waar de knop staat.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const html = renderToStaticMarkup(React.createElement(AccountantHome as any, {
    profile: homeProfile, overview: homeOverview, clients: homeClients, todos: [],
    notifications: [], unreadMessages: 0,
    workQueues: {
      toConfirm: 0, overdueCount: 0, overdueTotal: 0, worstDaysLate: 0,
      mandatedForInvoices: 0, mandatedForConfirm: 0, complete: true,
    },
  }));
  assert.ok(html.length > 500);
  assert.doesNotMatch(html, /Wat er op jou ligt/);
  // De tegels naar die schermen blijven wél staan — daar staat de knop om het te vragen.
  assert.match(html, /Bevestigen/);
});


// ─────────────────────────────────────────────────────────────────────────────
// [BETAALPLAN] Het verdeelscherm — één betaling over meerdere facturen
//
// Dit scherm rekent tijdens het typen: elk bedrag dat de eigenaar intikt verschuift "nog te
// verdelen" en kan het plan omslaan van kan naar kan-niet. Precies het soort tak dat in een lege
// lijst nooit wordt aangeraakt, dus krijgt het echte facturen — inclusief een creditnota, want
// diens minteken is het detail waar een echte batch op klapt.
// ─────────────────────────────────────────────────────────────────────────────

const verdeelTx = {
  id: "tx-1", amount: -850, date: "2026-07-28",
  description: "SEPA overboeking", counterpartName: "Aardappelgroothandel Altena B.V.",
  alreadyAllocated: 0,
};
const verdeelFacturen = [
  { id: "f1", direction: "incoming" as const, invoiceType: "factuur", totalIncBtw: 1000, amountPaid: 0,
    invoiceNumber: "2026-441", partyName: "Aardappelgroothandel Altena B.V.", invoiceDate: "2026-07-01", open: 1000 },
  { id: "f2", direction: "incoming" as const, invoiceType: "creditnota", totalIncBtw: -150, amountPaid: 0,
    invoiceNumber: "CR-88", partyName: "Aardappelgroothandel Altena B.V.", invoiceDate: "2026-07-10", open: 150 },
  { id: "f3", direction: "incoming" as const, invoiceType: "factuur", totalIncBtw: 320, amountPaid: 120,
    invoiceNumber: "2026-python", partyName: "Hano Groothandel", invoiceDate: "2026-06-02", open: 200 },
];

test("[BETAALPLAN] het verdeelscherm opent met echte facturen en noemt het bedrag dat te verdelen is", async () => {
  const { default: VerdeelClient } = await import("../../src/app/dashboard/bank/verdelen/[txId]/VerdeelClient");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const html = renderToStaticMarkup(React.createElement(VerdeelClient as any, {
    transactie: verdeelTx, facturen: verdeelFacturen,
  }));
  assert.ok(html.length > 800, "het scherm rendert");
  assert.match(html, /Betaling verdelen/);
  assert.match(html, /Geld dat wegging/, "de richting staat er, want die bepaalt welke facturen mogen");
  assert.match(html, /Nog te verdelen/);
  assert.match(html, /850,00/, "het bedrag van de betaling zelf");
  // De creditnota moet als zodanig herkenbaar zijn VOOR je hem aanvinkt — anders vink je hem aan
  // in de verwachting dat hij optelt.
  assert.match(html, /creditnota — gaat eraf/);
  // Een half betaalde factuur toont wat er NOG open staat, niet zijn totaal.
  assert.match(html, /200,00/);
});

test("[BETAALPLAN] zonder openstaande facturen wijst het scherm de weg in plaats van leeg te zijn", async () => {
  const { default: VerdeelClient } = await import("../../src/app/dashboard/bank/verdelen/[txId]/VerdeelClient");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const html = renderToStaticMarkup(React.createElement(VerdeelClient as any, {
    transactie: verdeelTx, facturen: [],
  }));
  assert.ok(html.length > 500);
  assert.match(html, /voeg hem dan eerst toe/, "een lege lijst die niets zegt is een doodlopende weg");
});

test("[BETAALPLAN] geld dat BINNENKWAM zegt dat ook, en toont het al gekoppelde deel", async () => {
  const { default: VerdeelClient } = await import("../../src/app/dashboard/bank/verdelen/[txId]/VerdeelClient");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const html = renderToStaticMarkup(React.createElement(VerdeelClient as any, {
    transactie: { ...verdeelTx, amount: 2420, alreadyAllocated: 605 },
    facturen: [{ ...verdeelFacturen[0], direction: "outgoing" as const }],
  }));
  assert.match(html, /Geld dat binnenkwam/);
  assert.match(html, /was al gekoppeld/, "wat een eerdere koppeling nam, is weg — dat hoort te blijken");
});

test("[BETAALPLAN] een al volledig verdeelde betaling is een dichte deur, geen doodlopende weg", async () => {
  // Zonder deze tak opende het scherm gewoon: lijst, invulvelden, knop — en elk plan werd daarna
  // geweigerd met "nog € 0,00 te vergeven". Waar, en het antwoord op de verkeerde vraag.
  const { default: VerdeelClient } = await import("../../src/app/dashboard/bank/verdelen/[txId]/VerdeelClient");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const html = renderToStaticMarkup(React.createElement(VerdeelClient as any, {
    transactie: { ...verdeelTx, alreadyAllocated: 850 }, facturen: verdeelFacturen,
  }));
  assert.match(html, /al helemaal verdeeld/);
  assert.doesNotMatch(html, /Nog te verdelen/, "geen invulvelden voor een verdeling die niet kan");
  assert.match(html, /ontkoppel dan eerst/, "en het zegt hoe je er wél weer bij komt");
});

test("[VERSTUURD] the send confirmation renders, and puts the irreversible part on the screen", async () => {
  // The panel that appears the instant an invoice becomes a legal document. Its words are tested
  // in invoice-sent-notice.test.ts; what a render cannot be replaced by is whether the component
  // that shows them survives being called — the whole reason this file exists.
  const { default: InvoiceSentModal } = await import("@/components/ui/InvoiceSentModal");
  const { invoiceSentNotice } = await import("@/lib/invoice-sent-notice");

  const notice = invoiceSentNotice({
    invoiceNumber: "2026-014",
    invoiceType: "factuur",
    clientName: "Stichting Contour de Twern",
    clientEmail: "info@example.nl",
    totalInc: 394.99,
    replyTo: "mo@boekbrug.nl",
  })!;

  const html = renderToStaticMarkup(
    React.createElement(InvoiceSentModal as any, { notice, onView: () => {}, onNew: () => {} }),
  );

  assert.ok(html.length > 0, "the panel may not render empty");
  assert.ok(html.includes("2026-014"), "the number that was just minted");
  assert.ok(html.includes("info@example.nl"), "where it went");
  assert.ok(html.includes("394,99"), "the amount, in Dutch");
  // The sentence the modal exists for. A layout change that dropped `definitief` would still
  // render fine and would still look like a success panel.
  assert.ok(html.includes("ligt vast"), "what can no longer be changed must be visible");
  assert.ok(html.includes("creditnota"), "…and how to correct it");
  assert.ok(html.includes("Zo controleer je het zelf"), "the owner's own question, answered here");
  assert.ok(html.includes("Bekijk de factuur") && html.includes("Nog een factuur"),
    "both exits — the panel must never be a dead end on a form that was already submitted");

  // A creditnota may never be announced as a factuur: at that moment the number becomes permanent.
  const credit = renderToStaticMarkup(
    React.createElement(InvoiceSentModal as any, {
      notice: invoiceSentNotice({ invoiceNumber: "2026-015", invoiceType: "creditnota" })!,
      onView: () => {}, onNew: () => {},
    }),
  );
  assert.ok(credit.includes("Creditnota verstuurd"));
});

test("[TAAL] the send confirmation renders in Arabic, right to left", async () => {
  // The first translated surface in the product. The blog has spoken Arabic for 53 articles; this
  // is the first thing inside the app that does. What a render proves and a unit test cannot: the
  // panel survives being called with Arabic, and the DIRECTION reaches the DOM — an Arabic panel
  // laid out left-to-right is legible word by word and unusable as a screen.
  const { default: InvoiceSentModal } = await import("@/components/ui/InvoiceSentModal");
  const { invoiceSentNotice } = await import("@/lib/invoice-sent-notice");

  const facts = {
    invoiceNumber: "2026-014",
    invoiceType: "factuur",
    clientName: "Stichting Contour de Twern",
    clientEmail: "info@example.nl",
    totalInc: 394.99,
    replyTo: "mo@boekbrug.nl",
  };

  const ar = renderToStaticMarkup(
    React.createElement(InvoiceSentModal as any, {
      notice: invoiceSentNotice(facts, "ar")!, onView: () => {}, onNew: () => {},
    }),
  );
  assert.ok(ar.includes('dir="rtl"'), "Arabic must be laid out right to left");
  assert.ok(ar.includes("تم إرسال الفاتورة"), "the title is Arabic");
  assert.ok(ar.includes("كيف تتحقّق بنفسك"), "and so is the heading over the checks");

  // The facts are data, not language: they must come through a translation unchanged, or the
  // owner is reading a confirmation about a different invoice than the one that was sent.
  assert.ok(ar.includes("2026-014"), "the number survives");
  assert.ok(ar.includes("394,99"), "the amount survives, in euros and Latin digits");
  assert.ok(ar.includes("info@example.nl"), "and the address it went to");
  // Rule 2, in its stronger form. This used to assert the literal words "Facturen" and
  // "Verzonden", which was right while the navigation bar and the status chip were Dutch. Both
  // are translated now, so the sentence must name what the screen ACTUALLY says — it fills itself
  // from nav.invoices and status.sent, the very keys the bar and the chip render.
  const { translate } = await import("@/lib/i18n/t");
  assert.ok(ar.includes(translate("ar", "nav.invoices")), "must name the tab as the bar labels it");
  assert.ok(ar.includes(translate("ar", "status.sent")), "must name the status as the chip labels it");
  assert.ok(!ar.includes("{tab}") && !ar.includes("{status}"), "no unfilled placeholder");

  // Dutch is unchanged and still ltr — the language of everyone using the app today.
  const nl = renderToStaticMarkup(
    React.createElement(InvoiceSentModal as any, {
      notice: invoiceSentNotice(facts, "nl")!, onView: () => {}, onNew: () => {},
    }),
  );
  assert.ok(nl.includes('dir="ltr"'));
  assert.ok(nl.includes("Factuur verstuurd") && nl.includes("Bekijk de factuur"));
});

test("[TAAL] the language switch renders, and names each language in its own script", async () => {
  const { LanguageCard } = await import("@/components/settings/LanguageCard");
  const html = renderToStaticMarkup(React.createElement(LanguageCard as any, {}));
  assert.ok(html.length > 0);
  // Someone looking for their own language scans for the shape of their own script, so these are
  // never translated.
  for (const label of ["Nederlands", "English", "العربية", "Türkçe"]) {
    assert.ok(html.includes(label), `the switch must offer ${label}`);
  }
  // The promise the card must keep making: the documents do not follow the interface language.
  assert.ok(html.includes("Belastingdienst"), "it says which language the documents stay in");
});

test("[ANDER-TOTAAL] the document's own total reaches the confirm modal as one tap", async () => {
  // Against the MODAL, because that is where the number is edited and where the offer lives. The
  // card shows the warning; this is the screen the owner acts on.
  //
  // The invoice this came from: NemaFood B.V. 262697, three scanned pages with no text layer. The
  // app read € 1.149,56 with € 94,92 BTW — internally consistent, so every arithmetic gate passed —
  // while the document says € 1.065,14 + € 95,54 = € 1.160,68.
  const { ConfirmPaidModal } = await import("../../src/app/dashboard/incoming/IncomingInvoicesClient");
  const { ToastProvider } = await import("../../src/components/ui/Toast");
  const { DialogProvider } = await import("../../src/components/ui/Dialog");
  const { classifyImportHealth } = await import("../../src/lib/import-health");

  const base = {
    id: "n1", client_name: "NemaFood B.V.", client_email: null, invoice_type: "factuur",
    total_ex_btw: 1054.64, btw_amount: 94.92, total_inc_btw: 1149.56, amount_paid: 0,
    invoice_date: "2026-07-28", invoice_number: "262697", source: "upload",
    pdf_url: null, document_id: null, created_at: "2026-07-28T10:00:00Z",
    folder_id: null, folder_name: null,
    field_confidence: {
      _grounding: {
        totalIncBtw: "absent", totalExBtw: "absent", btwAmount: "absent", source: "ocr",
        alternative: { ex: 1065.14, btw: 95.54, inc: 1160.68 },
      },
    },
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const invoice = { ...base, health: classifyImportHealth(base as any) };
  assert.ok(invoice.health.alternativeTotals, "the verdict must carry it, or the modal has nothing to show");

  const render = (inv: unknown) => renderToStaticMarkup(
    React.createElement(DialogProvider, null,
      React.createElement(ToastProvider, null,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        React.createElement(ConfirmPaidModal as any, {
          invoice: inv, onVerify() {}, onPay() {}, onCancel() {},
        }))),
  );

  const html = render(invoice);
  // The owner sees the document's total, and is asked rather than told.
  assert.match(html, /Staat dit bedrag op je factuur\?/, "the question is on the screen");
  assert.match(html, /1\.160,68/, "…and names the document's own total");
  // The warning sentence names all three figures, so the owner can match the totals block by eye.
  assert.match(html, /1\.065,14/);
  assert.match(html, /95,54/);
  // And the number the app read is still shown — the owner is comparing, not being overruled.
  assert.match(html, /1\.149,56/);

  // An invoice whose total IS corroborated must show none of this. A second figure on a correct
  // invoice is how a warning stops being read.
  const clean = { ...base, total_ex_btw: 1065.14, btw_amount: 95.54, total_inc_btw: 1160.68, field_confidence: null };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const cleanInvoice = { ...clean, health: classifyImportHealth(clean as any) };
  const cleanHtml = render(cleanInvoice);
  assert.doesNotMatch(cleanHtml, /Staat dit bedrag op je factuur\?/, "no offer on an invoice that reads right");
});
