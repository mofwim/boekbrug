// [NAV-BESTEMMINGEN] Pure node test — run: npx tsx --test src/lib/nav-destinations.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";

import { destinationsFor, railSectionsFor, railDestinations, activeHref, OWNER, OWNER_COUNTER, ACCOUNTANT } from "./nav-destinations";

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

test("[NAV-BESTEMMINGEN] every label is a catalogue key, never a word", () => {
  // The navigation is on every screen, so a hard-coded Dutch label here is the one piece of Dutch
  // an owner reading Arabic could never get away from.
  for (const list of [OWNER, OWNER_COUNTER, ACCOUNTANT]) {
    for (const d of list) {
      assert.match(d.label, /^nav\./, `${d.href} carries "${d.label}" — a label must be a catalogue key`);
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
    assert.match(d.label, /^(nav|start)\./, `${d.href} carries "${d.label}" — not a catalogue key`);
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
