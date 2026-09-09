// [NAV-BESTEMMINGEN] Pure node test — run: npx tsx --test src/lib/nav-destinations.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";

import { destinationsFor, railSectionsFor, railDestinations, activeHref, OWNER, OWNER_COUNTER, ACCOUNTANT, OWNER_WERK, DOOR_LOOK, doorLook } from "./nav-destinations";

test("[NAV-BESTEMMINGEN] each role gets its own list, and the trade only moves the second one", () => {
  assert.deepEqual(destinationsFor("zzper"), OWNER);
  assert.deepEqual(destinationsFor("zzper", true), OWNER_COUNTER);
  assert.deepEqual(destinationsFor("accountant"), ACCOUNTANT);
  // The trade describes the OWNER; an accountant works across many of them.
  assert.deepEqual(destinationsFor("accountant", true), ACCOUNTANT, "a counter trade never reshapes the accountant's bar");
  // Only the second destination differs between the two owner lists — that one change is the point.
  assert.deepEqual(OWNER.map((d) => d.href).filter((_, i) => i !== 1), OWNER_COUNTER.map((d) => d.href).filter((_, i) => i !== 1));
  assert.notEqual(OWNER[1].href, OWNER_COUNTER[1].href);
});

test("[WERK] the work trade's bar leads with its work, and only the second slot moves", () => {
  // The owner's decision: a mechanic opens the app for his werkplaats, a courier for his ritten.
  // The second tap is that screen; Facturen stays a home tile. Everything else stays where it was,
  // so nobody's thumb has to relearn the bar.
  assert.deepEqual(destinationsFor("zzper", false, true), OWNER_WERK);
  assert.deepEqual(destinationsFor("zzper", true, true), OWNER_WERK, "work wins over the counter: the desk is where a job ends");
  assert.equal(OWNER_WERK[1].href, "/dashboard/werk");
  assert.deepEqual(OWNER.map((d) => d.href).filter((_, i) => i !== 1), OWNER_WERK.map((d) => d.href).filter((_, i) => i !== 1));
  assert.equal(OWNER_WERK.map((d) => d.href).indexOf("/dashboard/vandaag"), 2, "[KORTE-WEG] Vandaag keeps its place");
  assert.ok(OWNER_WERK.length <= 5);
  assert.deepEqual(destinationsFor("accountant", false, true), ACCOUNTANT, "a trade never reshapes the accountant's bar");
  assert.ok(railDestinations("zzper", false, true).map((d) => d.href).includes("/dashboard/werk"), "the rail carries it too");
  assert.ok(!railDestinations("zzper", false, false).map((d) => d.href).includes("/dashboard/werk"), "…and only for the work trade");
});

test("[NAV-BESTEMMINGEN] home is exact, or it claims every screen in the app", () => {
  // /dashboard is a prefix of EVERY dashboard route. Without `exact`, standing on Kas lit up
  // "Start" — a bar that misreports your position is worse than one that admits it does not cover
  // this screen.
  assert.equal(activeHref("/dashboard", OWNER), "/dashboard");
  assert.equal(activeHref("/dashboard/kas", OWNER), null, "Kas belongs to no destination, and says so");
  assert.equal(activeHref("/dashboard/waarheid", OWNER), null);
});

test("[NAV-BESTEMMINGEN] the longest match wins, so a child lights its own parent", () => {
  assert.equal(activeHref("/dashboard/facturen", OWNER), "/dashboard/facturen");
  assert.equal(activeHref("/dashboard/incoming/manage", OWNER), "/dashboard/incoming");
  // `also` paths belong to their destination: a new invoice is Facturen, an upload is Inkomend.
  assert.equal(activeHref("/dashboard/invoice/new", OWNER), "/dashboard/facturen");
  assert.equal(activeHref("/dashboard/upload", OWNER), "/dashboard/incoming");
  // The accountant's client screens light Klanten, not Start.
  assert.equal(activeHref("/dashboard/clients/beheer", ACCOUNTANT), "/dashboard/clients/beheer");
  assert.equal(activeHref("/dashboard/accountant", ACCOUNTANT), "/dashboard/accountant");
});

test("[KORTE-WEG] the owner's daily screen is in the bar itself, for both trades", () => {
  // Below 640px the bottom bar IS the standing navigation — the header's text links are
  // `display: none !important` there and the rail starts at 1024px (asserted against globals.css
  // in the [KORTE-WEG] gate). So a screen that is not in this list has no standing door on the
  // device these owners actually hold, whatever else links to it.
  for (const counter of [false, true]) {
    const hrefs = destinationsFor("zzper", counter).map((d) => d.href);
    assert.ok(hrefs.includes("/dashboard/vandaag"),
      `the owner${counter ? " (counter)" : ""} has no standing way to the screen that lists what ` +
      "must be paid today and prints the aangifte deadline");
    // Five is M3's ceiling, and the bar's own note explains what six costs on a 320px screen.
    assert.ok(hrefs.length <= 5, `the ${counter ? "counter " : ""}owner's bar carries ${hrefs.length} destinations`);
    // The trade still owns the second slot: a kapper opens the Kassa thirty times a day and
    // Vandaag once. Vandaag sits after it, in the same place for both, or the two bars would
    // teach two different maps of one app.
    assert.equal(hrefs.indexOf("/dashboard/vandaag"), 2,
      "Vandaag moved out of the slot the trade shortcut leaves it");
  }

  // The accountant does not get it, and that is the same reasoning the module gives for their
  // whole list: Vandaag is the OWNER's day. An accountant works across many administraties and
  // their own day is the werkvoorraad, not one client's payables.
  assert.ok(!destinationsFor("accountant").map((d) => d.href).includes("/dashboard/vandaag"));

  // [NEGATIEVE CONTROLE] Everything above also passes if destinationsFor returned the owner's list
  // for every argument, or if the rail simply held every route in the app. These pin both.
  assert.notDeepEqual(destinationsFor("accountant"), destinationsFor("zzper"));
  for (const counter of [false, true]) {
    const rail = railDestinations("zzper", counter).map((d) => d.href);
    assert.ok(rail.includes("/dashboard/vandaag"), "the rail lost the same screen the phone bar carries");
    assert.ok(!rail.includes("/dashboard/beveiliging"),
      "the rail now lists everything, so finding a route in it proves nothing");
  }
});

test("[NAV-BESTEMMINGEN] every label is a catalogue key, never a word", () => {
  // The navigation is on every screen, so a hard-coded Dutch label here is the one piece of Dutch
  // an owner reading Arabic could never get away from.
  for (const list of [OWNER, OWNER_COUNTER, ACCOUNTANT]) {
    for (const d of list) {
      // `chrome.` is allowed beside `nav.` for one reason and it is not laxity: a destination that
      // ALSO has a sub-page header must carry that header's key, or the bar and the bar above it
      // name one screen twice and the two can drift apart in any of the four languages. Vandaag is
      // the case ([KORTE-WEG]); DashboardChrome wrote out the same reasoning for kassa.titel.
      assert.match(d.label, /^(nav|chrome)\./, `${d.href} carries "${d.label}" — a label must be a catalogue key`);
      assert.ok(d.icon.length > 0, `${d.href} has no icon`);
      assert.match(d.href, /^\/dashboard/, `${d.href} is not a dashboard route`);
    }
  }
});

// ── The rail: the whole home screen, and the phone's four inside it ─────────────────────────────

test("[ZIJBALK] every primary destination is somewhere in the rail", () => {
  // THE invariant. The phone shows four because 320px allows four; the rail shows the home screen.
  // A primary destination missing from the rail is the app meaning different things at different
  // widths — the drift the shared module exists to stop.
  for (const [role, counter] of [["zzper", false], ["zzper", true], ["accountant", false]] as const) {
    const rail = new Set(railDestinations(role, counter).map((d) => d.href));
    for (const d of destinationsFor(role, counter)) {
      assert.ok(rail.has(d.href), `${role}${counter ? " (counter)" : ""}: ${d.href} is on the phone bar but not on the rail`);
    }
  }
});

test("[ZIJBALK] the rail is grouped, and every row is still a catalogue key", () => {
  const secties = railSectionsFor("zzper");
  assert.ok(secties.length >= 3, "the rail lost its grouping and became one long list");
  assert.equal(secties[0].heading, null, "the first group carries no heading, like the home screen");
  assert.ok(secties.slice(1).every((s) => s.heading !== null), "every group after the first is named");
  // Same keys the home screen uses, so a tile and a rail row cannot name one destination twice.
  for (const d of railDestinations("zzper")) {
    assert.match(d.label, /^(nav|start|chrome)\./, `${d.href} carries "${d.label}" — not a catalogue key`);
    assert.match(d.href, /^\/dashboard/, `${d.href} is not a dashboard route`);
    assert.ok(d.icon.length > 0, `${d.href} has no icon`);
  }
  // No destination twice: a duplicate href would light two rows at once.
  const hrefs = railDestinations("zzper").map((d) => d.href);
  assert.equal(new Set(hrefs).size, hrefs.length, "the rail lists a destination more than once");
});

test("[VAK-BRUG] the counter owner leads with the Kassa and keeps Facturen", () => {
  const hrefs = railDestinations("zzper", true).map((d) => d.href);
  assert.ok(hrefs.includes("/dashboard/kassa"));
  // The phone bar HAD to drop Facturen for it; a rail does not, and pretending otherwise would
  // take a real destination away from an owner who does still send the occasional invoice.
  assert.ok(hrefs.includes("/dashboard/facturen"));
  assert.ok(hrefs.indexOf("/dashboard/kassa") < hrefs.indexOf("/dashboard/facturen"));
});

test("[ZIJBALK] the deeper destination wins across groups", () => {
  const alle = railDestinations("zzper");
  // /dashboard/incoming/manage is Inkoopfacturen in one group and a child of Inkomend in another.
  assert.equal(activeHref("/dashboard/incoming/manage", alle), "/dashboard/incoming/manage");
  assert.equal(activeHref("/dashboard/incoming", alle), "/dashboard/incoming");
  // …and a screen the rail does not carry still lights nothing.
  assert.equal(activeHref("/dashboard/beveiliging", alle), null);
});

// ── [ZIJBALK-DEUR] One look per door ────────────────────────────────────────────────────────────

test("[ZIJBALK-DEUR] every rail row carries the look of its tile, from the one table", () => {
  for (const [role, counter, work] of [
    ["zzper", false, false], ["zzper", true, false], ["zzper", false, true], ["accountant", false, false],
  ] as const) {
    for (const d of railDestinations(role, counter, work)) {
      const look = DOOR_LOOK[d.href as keyof typeof DOOR_LOOK];
      assert.ok(look, `${role}: ${d.href} has no entry in DOOR_LOOK`);
      assert.equal(d.icon, look.icon, `${d.href}: the rail glyph is not the tile's`);
      assert.equal(d.tint, look.tint, `${d.href}: the rail colour is not the tile's`);
    }
  }
  // The table is total over what it names, and a colour is a colour.
  for (const [href, look] of Object.entries(DOOR_LOOK)) {
    assert.match(href, /^\/dashboard/, `${href} is not a dashboard route`);
    assert.match(look.icon, /^[a-z][a-z0-9_]{2,}$/, `${href} has no glyph`);
    assert.match(look.tint, /^#[0-9A-Fa-f]{6}$/, `${href} has no colour`);
  }
  assert.equal(doorLook("/dashboard/facturen").tint, "#00897B", "the Facturen tile is teal on the home, and so on the rail");
});
