// tests/render/kassa-screen.test.tsx
// [RENDER-GATE] Does the counter survive a render, with rows that reach every branch?
//
// Run: npm run test:render
//
// The gate this file belongs to exists because tsc, eslint, next build and the Playwright smoke
// sweep are all blind to a /dashboard/* screen that throws on every render — see the header of
// money-screens.test.tsx for the bug that proved it.
//
// The Kassa is exactly the shape that hides such a bug: everything it draws arrives from its own
// fetch, so rendering the screen itself proves only that an EMPTY counter renders — `[].map(cb)`
// never calls `cb`. That is why the drawing lives in KassaPanels.tsx and takes its rows as props,
// and why this file hands it a real ticket, a real day and a real sales history instead of nothing.

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
    usePathname: () => "/dashboard/kassa",
    useParams: () => ({}),
    notFound: () => { throw new Error("[RENDER-GATE] the component called notFound()"); },
    redirect: (to: string) => { throw new Error(`[RENDER-GATE] the component redirected to ${to}`); },
  },
});

test("[KASSA] the counter draws a real ticket, a real day and a real history", async () => {
  const panels = await import("../../src/app/dashboard/kassa/KassaPanels");
  const { translator } = await import("../../src/lib/i18n/t");
  const t = translator("nl");

  const lines = [
    { key: "1", description: "Knippen", quantity: 2, unit_price_incl: 25, btw_rate: 21, article_id: "a1" },
    { key: "2", description: "Shampoo", quantity: 1, unit_price_incl: 8.5, btw_rate: 9, article_id: null },
    // A refund line: a negative quantity is a real thing on a counter and must draw like any other.
    { key: "3", description: "Correctie", quantity: -1, unit_price_incl: 25, btw_rate: 21, article_id: null },
  ];

  const html = renderToStaticMarkup(
    React.createElement(panels.TicketPanel, {
      lines, onQuantity() {}, onRemove() {}, onTender() {}, busy: false, t,
    }),
  );
  assert.ok(html.length > 0, "the ticket panel renders something");
  assert.match(html, /Knippen/, "…and names what is on the ticket");
  assert.match(html, /Shampoo/, "…including the second line");
  // 2 × 25 + 8,50 − 25 = 33,50. The total is arithmetic the panel does itself, so it is worth
  // asserting: a ticket that adds up wrongly is worse than one that crashes.
  assert.match(html, /33,50/, "…and totals the lines, refund included");
  // The three tender buttons are the only way a ticket leaves the screen.
  assert.match(html, /Pin/, "the pin tender is offered");
  assert.match(html, /Contant/, "the cash tender is offered");
  assert.match(html, /Overig/, "the other tender is offered");
});

test("[KASSA] an empty ticket says what to do instead of drawing nothing", async () => {
  const panels = await import("../../src/app/dashboard/kassa/KassaPanels");
  const { translator } = await import("../../src/lib/i18n/t");
  const t = translator("nl");

  const html = renderToStaticMarkup(
    React.createElement(panels.TicketPanel, {
      lines: [], onQuantity() {}, onRemove() {}, onTender() {}, busy: false, t,
    }),
  );
  assert.ok(html.length > 0, "an empty ticket still renders");
  assert.match(html, /Tik hierboven een dienst aan/, "…and points at the next action");
  // A counter with nothing on the ticket must not offer to take a payment for nothing.
  assert.doesNotMatch(html, /Hoe is er betaald/, "…and does not ask for payment on an empty ticket");
});

test("[KASSA] the day's takings show the split the reconciliation keys on", async () => {
  const panels = await import("../../src/app/dashboard/kassa/KassaPanels");
  const { translator } = await import("../../src/lib/i18n/t");
  const t = translator("nl");

  const html = renderToStaticMarkup(
    React.createElement(panels.DayTakings, {
      totals: { total: 123.5, pin: 40, cash: 33.5, other: 50 }, t,
    }),
  );
  assert.match(html, /123,50/, "the day's total is shown");
  // pin_amount suppresses the bank settlement and cash_amount feeds the drawer — an owner who
  // cannot see the split cannot notice the day that will not reconcile.
  assert.match(html, /40,00/, "…and the pin share");
  assert.match(html, /33,50/, "…and the cash share");
});

test("[KASSA] the history groups lines into the tickets they were sold as", async () => {
  const panels = await import("../../src/app/dashboard/kassa/KassaPanels");
  const { translator } = await import("../../src/lib/i18n/t");
  const t = translator("nl");

  const sales = [
    { id: "s1", ticket_id: "t1", description: "Knippen", quantity: 1, unit_price_incl: 25, btw_rate: 21, method: "pin" as const },
    { id: "s2", ticket_id: "t1", description: "Baard", quantity: 1, unit_price_incl: 15, btw_rate: 21, method: "pin" as const },
    { id: "s3", ticket_id: "t2", description: "Shampoo", quantity: 1, unit_price_incl: 8.5, btw_rate: 9, method: "cash" as const },
  ];

  const html = renderToStaticMarkup(
    React.createElement(panels.SalesHistory, { sales, onVoid() {}, t }),
  );
  // Two tickets, not three lines: a ticket is the transaction, and voiding one is all-or-nothing.
  assert.match(html, /Knippen/, "the first ticket's lines are named");
  assert.match(html, /Baard/, "…both of them");
  assert.match(html, /40,00/, "…and the ticket totals its own lines");
  assert.match(html, /8,50/, "the second ticket stands on its own");
  // [TAAL] One key per payment method — never one sentence with the method substituted in.
  assert.match(html, /Met pin betaald/, "a card ticket says so");
  assert.match(html, /Contant betaald/, "a cash ticket says so");
});

test("[KASSA] an empty history and an empty price list both say so", async () => {
  const panels = await import("../../src/app/dashboard/kassa/KassaPanels");
  const { translator } = await import("../../src/lib/i18n/t");
  const t = translator("nl");

  const history = renderToStaticMarkup(
    React.createElement(panels.SalesHistory, { sales: [], onVoid() {}, t }),
  );
  assert.match(history, /Nog niets aangeslagen/, "an empty day says it is empty");

  const empty = renderToStaticMarkup(
    React.createElement(panels.PriceList, { items: [], onPick() {}, t }),
  );
  // A counter whose price list is empty is not broken — it is new, and it has to say what to do.
  assert.match(empty, /prijslijst is nog leeg/, "an empty price list explains itself");
  assert.match(empty, /\/dashboard\/artikelen/, "…and links to where it gets filled");

  const filled = renderToStaticMarkup(
    React.createElement(panels.PriceList, {
      items: [{ id: "a1", description: "Knippen", gross: 25, btw_rate: 21 }],
      onPick() {}, t,
    }),
  );
  assert.match(filled, /Knippen/, "a filled price list names the service");
  // The GROSS price, because that is what the customer pays — articles.unit_price is stored ex-btw.
  assert.match(filled, /25,00/, "…at the price the customer pays");
  assert.match(filled, /21% btw/, "…and shows which rate it carries");
});

test("[KASSA] the panels render in Arabic without falling back to a key", async () => {
  const panels = await import("../../src/app/dashboard/kassa/KassaPanels");
  const { translator } = await import("../../src/lib/i18n/t");
  const t = translator("ar");

  const html = renderToStaticMarkup(
    React.createElement(panels.TicketPanel, {
      lines: [{ key: "1", description: "Knippen", quantity: 1, unit_price_incl: 25, btw_rate: 21, article_id: null }],
      onQuantity() {}, onRemove() {}, onTender() {}, busy: false, t,
    }),
  );
  assert.ok(html.length > 0, "the Arabic counter renders");
  // The one failure this catches: a key reaching the screen. A bookkeeping app with
  // 'kassa.hoeBetaald' on a heading is worse than one in a language read less comfortably.
  assert.doesNotMatch(html, /kassa\.[a-zA-Z]/, "no message key leaked onto the screen");
  assert.match(html, /كيف تم الدفع/, "…and the Arabic copy is actually used");
});

test("[KOR-FACTUUR] under the KOR the hand-typed day offers 0% and nothing else", async () => {
  const { default: HandmatigeDag } = await import("../../src/app/dashboard/dagomzet/HandmatigeDag");
  const html = renderToStaticMarkup(React.createElement(HandmatigeDag, { korActive: true }));
  // Stating btw under the KOR makes it OWED (art. 37 Wet OB) with no right to deduct anything
  // against it, and a day's takings reach rubriek 1a as directly as an invoice does. The boxes that
  // could hold that btw are simply not offered.
  assert.doesNotMatch(html, /Tegen 21%/, "the 21% box is not offered");
  assert.doesNotMatch(html, /Tegen 9%/, "the 9% box is not offered");
  assert.match(html, /Tegen 0%/, "…and the 0% box still is");
  // Absent choices must be explained, not merely missing — the same sentence the invoice screen uses.
  assert.match(html, /kleineondernemersregeling|KOR aanstaan/, "…with the reason written next to it");
});

test("[KASSA] the hand-typed day panel renders and holds its two totals apart", async () => {
  const { default: HandmatigeDag } = await import("../../src/app/dashboard/dagomzet/HandmatigeDag");
  const html = renderToStaticMarkup(React.createElement(HandmatigeDag, {}));
  assert.ok(html.length > 0, "the panel renders");
  assert.match(html, /Dag zelf invullen/, "…and titles itself");
  // Both totals must be on screen at once: they are what the owner compares before saving, and the
  // save is refused server-side when they disagree.
  assert.match(html, /Omzet bij elkaar/, "the revenue total is shown");
  assert.match(html, /Betaald bij elkaar/, "…next to the payment total");
  // The three rates are the whole point of the panel — without one the aangifte stays blocked.
  assert.match(html, /Tegen 21%/, "the 21% box exists");
  assert.match(html, /Tegen 9%/, "the 9% box exists");
  assert.match(html, /Tegen 0%/, "the 0% box exists");
});
