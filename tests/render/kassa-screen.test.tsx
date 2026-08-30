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

test("[VAK-BRUG] the trade panel offers every trade the catalogue knows", async () => {
  const { default: VakPrijslijst } = await import("../../src/app/dashboard/artikelen/VakPrijslijst");
  const { VAKKEN } = await import("../../src/lib/vak-sjablonen");

  const html = renderToStaticMarkup(React.createElement(VakPrijslijst, {}));
  assert.ok(html.length > 0, "the panel renders");
  assert.match(html, /Begin met de regels van jouw vak/, "…and says what it is for");

  // Every trade reachable, or the owner whose trade is missing concludes the app is not for him.
  // Read from VAKKEN rather than a hard-coded list, so adding a twelfth trade cannot leave the
  // dropdown behind.
  for (const vak of VAKKEN) {
    assert.ok(
      html.includes(vak.label),
      `the dropdown offers "${vak.label}"`,
    );
  }
});

test("[VAK-BRUG] a trade's lines never arrive carrying a price", async () => {
  const { vakArticleSeeds } = await import("../../src/lib/vak-profile");
  const { VAKKEN } = await import("../../src/lib/vak-sjablonen");

  // Rule 1 of vak-sjablonen.ts, asserted at the boundary the screen actually reads. An hourly rate
  // of EUR 65 is wrong for everyone except coincidentally one person, and a wrongly prefilled
  // amount that slips through is worse than an empty field.
  for (const vak of VAKKEN) {
    const seeds = vakArticleSeeds(vak.slug);
    assert.ok(seeds.length > 0, `${vak.slug} offers lines`);
    for (const seed of seeds) {
      assert.ok(!("unit_price" in seed), `${vak.slug} carries no price`);
      assert.ok([0, 9, 21].includes(seed.btw_rate), `${vak.slug} carries a real Dutch rate`);
    }
  }
});

test("[VAK-BRUG] a counter trade's phone bar leads with the Kassa, not with Facturen", async () => {
  const { BottomNav } = await import("../../src/components/nav/BottomNav");

  const counter = renderToStaticMarkup(
    React.createElement(BottomNav, { role: "zzper" as never, counter: true }),
  );
  // The bar is on EVERY screen, so it is the first thing a barber reads about whose app this is.
  assert.match(counter, /\/dashboard\/kassa/, "the counter is one tap away");
  assert.doesNotMatch(counter, /\/dashboard\/facturen/, "…and the invoice list is not in the bar");
  // Still four destinations — the file's own rule, and past four the labels stop fitting on 320px.
  assert.match(counter, /\/dashboard\/incoming/, "his wholesaler bills stay reachable");
  assert.match(counter, /\/dashboard\/bestanden/, "…and his files");

  // The fail direction: anyone who has not told us a trade keeps exactly the bar they had.
  const invoicing = renderToStaticMarkup(
    React.createElement(BottomNav, { role: "zzper" as never, counter: false }),
  );
  assert.match(invoicing, /\/dashboard\/facturen/, "an invoicing owner keeps Facturen");
  assert.doesNotMatch(invoicing, /\/dashboard\/kassa/, "…and does not get a counter he has no use for");

  // Omitting the prop must behave like the old app, not like a counter shop.
  const legacy = renderToStaticMarkup(
    React.createElement(BottomNav, { role: "zzper" as never }),
  );
  assert.equal(legacy, invoicing, "no prop means the bar everyone has always had");
});

test("[VAK-BRUG] an accountant's bar never varies by trade", async () => {
  const { BottomNav } = await import("../../src/components/nav/BottomNav");
  // The trade describes the OWNER; an accountant works across many of them. Same reasoning as the
  // deliberately Dutch-only accountant module in AGENTS.md.
  const withFlag = renderToStaticMarkup(
    React.createElement(BottomNav, { role: "accountant" as never, counter: true }),
  );
  const without = renderToStaticMarkup(
    React.createElement(BottomNav, { role: "accountant" as never, counter: false }),
  );
  assert.equal(withFlag, without, "the flag cannot reach an accountant's bar");
  assert.doesNotMatch(withFlag, /\/dashboard\/kassa/, "…and never puts a counter on it");
});

test("[VOERTUIG] the fleet draws real cars, with where each APK stands", async () => {
  const panels = await import("../../src/app/dashboard/voertuigen/VoertuigenPanels");
  const { translator } = await import("../../src/lib/i18n/t");
  const t = translator("nl");

  const vehicles = [
    { id: "1", kenteken: "12ABC3", description: "Volkswagen Golf", customer_name: "Jansen", customer_phone: "0612345678", apk_expiry: "2026-08-10", notes: null },
    { id: "2", kenteken: "AB12CD", description: "Opel Corsa", customer_name: null, customer_phone: null, apk_expiry: "2026-09-01", notes: "Remmen nakijken" },
    { id: "3", kenteken: "1ABC23", description: null, customer_name: null, customer_phone: null, apk_expiry: null, notes: null },
  ];

  const html = renderToStaticMarkup(
    React.createElement(panels.VehicleList, { vehicles, today: "2026-08-20", onRemove() {}, t }),
  );
  assert.ok(html.length > 0, "the list renders");
  // The plate is printed the way it is on the car, derived from the sidecode shape.
  assert.match(html, /12-ABC-3/, "a sidecode-7 plate is grouped correctly");
  assert.match(html, /AB-12-CD/, "…and a sidecode-4 one");
  assert.match(html, /1-ABC-23/, "…and a sidecode-8 one");
  assert.match(html, /Volkswagen Golf/, "the car is named");
  assert.match(html, /Remmen nakijken/, "a note is shown");
  // Each state gets its OWN sentence — a noun inside a sentence is not a parameter.
  assert.match(html, /APK is verlopen/, "an overdue car says so");
  assert.match(html, /APK verloopt binnenkort/, "a due car says so");
  // The one that must never read as reassurance: no date is a missing fact, not a valid APK.
  assert.match(html, /APK-datum niet bekend/, "a car with no date says the date is missing");
  assert.doesNotMatch(html, /1-ABC-23<\/span>[\s\S]{0,200}APK is nog geldig/, "…and never that it is valid");
  // The reminder is only worth anything if it leads to the call.
  assert.match(html, /tel:0612345678/, "the customer's number is tappable");
});

test("[VOERTUIG] the call list appears only when there is someone to call", async () => {
  const panels = await import("../../src/app/dashboard/voertuigen/VoertuigenPanels");
  const { vehiclesNeedingApk } = await import("../../src/lib/vehicle");
  const { translator } = await import("../../src/lib/i18n/t");
  const t = translator("nl");

  const fleet = [
    { id: "1", kenteken: "12ABC3", description: null, customer_name: "Jansen", customer_phone: "0612345678", apk_expiry: "2026-08-10", notes: null },
    { id: "2", kenteken: "AB12CD", description: null, customer_name: null, customer_phone: null, apk_expiry: "2027-01-01", notes: null },
  ];
  const calling = vehiclesNeedingApk(fleet, "2026-08-20");

  const html = renderToStaticMarkup(React.createElement(panels.ApkCallList, { vehicles: calling, t }));
  assert.match(html, /12-ABC-3/, "the overdue car is listed");
  assert.doesNotMatch(html, /AB-12-CD/, "…and the one that is fine is not");

  // An empty "you have 0 reminders" panel trains an owner to stop reading the place his reminders
  // appear, so it renders nothing at all.
  const empty = renderToStaticMarkup(React.createElement(panels.ApkCallList, { vehicles: [], t }));
  assert.equal(empty, "", "nothing to call about renders nothing at all");
});

test("[VOERTUIG] an empty garage says so, in Arabic too, without leaking a key", async () => {
  const panels = await import("../../src/app/dashboard/voertuigen/VoertuigenPanels");
  const { translator } = await import("../../src/lib/i18n/t");

  const nl = renderToStaticMarkup(
    React.createElement(panels.VehicleList, { vehicles: [], today: "2026-08-20", onRemove() {}, t: translator("nl") }),
  );
  assert.match(nl, /Nog geen voertuigen/, "an empty garage explains itself");

  const ar = renderToStaticMarkup(
    React.createElement(panels.VehicleList, {
      vehicles: [{ id: "1", kenteken: "12ABC3", description: null, customer_name: null, customer_phone: null, apk_expiry: null, notes: null }],
      today: "2026-08-20", onRemove() {}, t: translator("ar"),
    }),
  );
  assert.doesNotMatch(ar, /vtg\.[a-zA-Z]/, "no message key leaked onto the screen");
  // APK and kenteken are Dutch domain terms with no English equivalent — AGENTS.md names both.
  // They stay as they are in every language, exactly like btw.
  assert.match(ar, /APK/, "APK stays APK in Arabic");
});

// ── [DAG-UIT-DE-BANK] The hand-typed day offers what the bank already knows ───────────────────
//
// This panel takes its data as props, so the suggestion can be rendered without a session or a
// database. Both branches are handed in on purpose: the offer, and its floor caveat — the caveat
// is a conditional inside the panel, so an empty fixture would prove nothing about it.

test("[DAG-UIT-DE-BANK] a day the bank describes gets an offer, and it is an offer", async () => {
  const { default: HandmatigeDag } = await import("../../src/app/dashboard/dagomzet/HandmatigeDag");
  const { amsterdamToday } = await import("../../src/lib/turnover-import");
  const today = amsterdamToday();
  // Real ING debit lines, re-dated so their DAT names today — the panel opens on today's date.
  const dat = today.replace(/-/g, "");
  const payouts = [
    { date: today, amount: 928.02, description: `AFREK. BETAALAUTOMAAT MAES REFNR. F9Q3BH DAT. ${dat}/6123 AANT. 60 MREFNR. KFM` },
    { date: today, amount: 318.87, description: `AFREK. BETAALAUTOMAAT VPAY REFNR. F9Q3BH DAT. ${dat}/6123 AANT. 19 MREFNR. KFM` },
  ];
  const html = renderToStaticMarkup(React.createElement(HandmatigeDag as never, { cardPayouts: payouts }));
  assert.match(html, /1\.246,89/, "the bank's figure for the day is on the screen");
  assert.match(html, /Overnemen/, "…as something the owner presses, never as a filled field");
  // The offer is NOT the field. The Pin input must still be empty: only the owner knows the cash
  // and the rate split, so a form that filled itself would look complete while being neither.
  assert.match(html, /aria-label="Pin"[^>]*value=""/, "the Pin field stays empty until pressed");
});

test("[DAG-UIT-DE-BANK] a week-numbered credit payout makes the figure a stated floor", async () => {
  const { default: HandmatigeDag } = await import("../../src/app/dashboard/dagomzet/HandmatigeDag");
  const { amsterdamToday } = await import("../../src/lib/turnover-import");
  const today = amsterdamToday();
  const dat = today.replace(/-/g, "");
  const payouts = [
    { date: today, amount: 928.02, description: `AFREK. BETAALAUTOMAAT MAES REFNR. F9Q3BH DAT. ${dat}/6123 AANT. 60 MREFNR. KFM` },
    // DAT. 202618 is a WEEK number: it belongs to no day, and its € 210,55 is excluded.
    { date: today, amount: 206.78, description: "AFREK. BETAALAUTOMAAT MAST REFNR. F9Q3BH DAT. 202618 AANT. 12 BRUTO 21055 /COM D377" },
  ];
  const html = renderToStaticMarkup(React.createElement(HandmatigeDag as never, { cardPayouts: payouts }));
  assert.match(html, /928,02/, "only the day-dated line is in the figure");
  assert.doesNotMatch(html, /1\.138,57/, "the week-numbered line is never added to a day");
  assert.match(html, /ondergrens/, "and the panel says the figure is a floor");
  assert.match(html, /210,55/, "naming what it left out");
});

test("[DAG-UIT-DE-BANK] a day the bank says nothing about offers nothing", async () => {
  const { default: HandmatigeDag } = await import("../../src/app/dashboard/dagomzet/HandmatigeDag");
  const html = renderToStaticMarkup(React.createElement(HandmatigeDag as never, { cardPayouts: [] }));
  assert.ok(html.length > 0, "the form still renders");
  assert.doesNotMatch(html, /Overnemen/, "no offer where there is nothing to offer");
  assert.doesNotMatch(html, /ondergrens/);
});
