// tests/render/security-screens.test.tsx
// [RENDER-GATE] Does the security screen survive one render, with rows that reach every branch?
//
// Run: npm run test:render
//
// The reasoning for this whole directory is in money-screens.test.tsx: tsc, eslint, next build and
// the Playwright smoke test are all blind to a /dashboard/* screen that throws on every render.
//
// What this file adds on top of "it renders" is the one assertion the pure test cannot make. The
// rule in src/lib/security-overview.ts — never say "alleen jij" on a read that did not finish — is
// tested there as a value. Here it is tested as a SENTENCE, because a panel that computed the same
// answer correctly and then rendered the wrong string would pass every test in that file. Handing
// this component an incomplete read and asserting that the reassuring sentence is absent is the
// only place those two can be checked against each other.

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
    usePathname: () => "/dashboard/beveiliging",
    useParams: () => ({}),
    notFound: () => { throw new Error("[RENDER-GATE] the component called notFound()"); },
    redirect: (to: string) => { throw new Error(`[RENDER-GATE] the component redirected to ${to}`); },
  },
});

const owner = { kind: "owner" as const, revokeId: null, name: "Kiwi Diensten", email: "kiwi@example.nl", since: null };

test("[BEVEILIGING] the access panel renders every kind of holder", async () => {
  const { ToegangPaneel } = await import("../../src/components/beveiliging/ToegangPaneel");
  const { translator } = await import("../../src/lib/i18n/t");

  const html = renderToStaticMarkup(
    React.createElement(ToegangPaneel, {
      holders: [
        owner,
        { kind: "bookkeeper", revokeId: "link-1", name: "Boekhouder BV", email: "bh@example.nl", since: "2026-01-15" },
        // A member we could not put a name to. The row must still appear — the fact that someone is
        // there does not depend on our being able to spell them.
        { kind: "member", revokeId: "m-1", name: null, email: null, since: "2026-04-01" },
      ],
      complete: true,
      count: 3,
      t: translator("nl"),
      manageHref: "/dashboard/settings/team",
    }),
  );

  assert.ok(html.length > 0, "the panel rendered nothing at all");
  assert.match(html, /Kiwi Diensten/, "the owner is on his own list");
  assert.match(html, /Boekhouder BV/);
  assert.match(html, /Naam niet gelezen/, "a nameless row says so instead of vanishing");
  assert.match(html, /3 mensen/, "the count is stated when every source answered");
  assert.match(html, /15-01-2026/, "the bookkeeper's start date is on the row");
});

test("[BEVEILIGING] an incomplete read never renders the reassuring sentence", () => {
  // THE ONE THAT MATTERS. "Alleen jij" is a promise. Made on a read that half-failed it is worse
  // than no screen at all, because the owner stops looking — on the screen he opened precisely to
  // check whether anyone else is in his books.
  return (async () => {
    const { ToegangPaneel } = await import("../../src/components/beveiliging/ToegangPaneel");
    const { translator } = await import("../../src/lib/i18n/t");

    const render = (complete: boolean, count: number | null) =>
      renderToStaticMarkup(
        React.createElement(ToegangPaneel, {
          holders: [owner],
          complete,
          count,
          t: translator("nl"),
          manageHref: "/dashboard/settings/team",
        }),
      );

    const broken = render(false, null);
    assert.doesNotMatch(broken, /Alleen jij/, "a failed read is being reported as a private administration");
    assert.match(broken, /misschien niet compleet/, "…and it must say what actually happened");
    // No number either: a count printed over an incomplete list is the same lie with digits.
    assert.doesNotMatch(broken, /mensen kunnen bij/);

    // And when everything did answer, the promise IS made — otherwise the screen warns forever and
    // the warning stops meaning anything.
    const whole = render(true, 1);
    assert.match(whole, /Alleen jij/);
    assert.doesNotMatch(whole, /misschien niet compleet/);
  })();
});

test("[BEVEILIGING] the screen itself renders, in its three load states", async () => {
  const { default: BeveiligingClient } = await import("../../src/app/dashboard/beveiliging/BeveiligingClient");

  // Effects never run under renderToStaticMarkup, so this is the "reading" state — which is exactly
  // the one every visitor sees first, and the one a crash would take down before anything else.
  const html = renderToStaticMarkup(React.createElement(BeveiligingClient));
  assert.ok(html.length > 0, "the security screen rendered nothing");
  assert.match(html, /Beveiliging|beveiliging|administratie/, "the screen has no words on it");
});

// ─── [DOORLOPEND] The numbering verdict ──────────────────────────────────────────────

const series = (over: Record<string, unknown> = {}) => ({
  type: "factuur", year: 2026, first: 1, last: 3, issued: 3,
  missing: [] as number[], burnedAtEnd: 0 as number | null, duplicates: [] as string[], ...over,
});

test("[DOORLOPEND] a clean series says so in one line, and never in a warning box", () => {
  return (async () => {
    const { NummeringUitslag } = await import("../../src/components/beveiliging/NummeringPaneel");
    const { translator } = await import("../../src/lib/i18n/t");
    const html = renderToStaticMarkup(
      React.createElement(NummeringUitslag, {
        report: { series: [series()], unreadable: [], clean: true, unaccounted: 0, countersRead: true },
        t: translator("nl"),
      }),
    );
    assert.match(html, /loopt door/, "the healthy answer must be on the screen — a check nobody sees buys no confidence");
    assert.doesNotMatch(html, /amber/, "a green box the size of a warning teaches people to skim this spot");
    assert.doesNotMatch(html, /ontbreken/);
  })();
});

test("[DOORLOPEND] a gap names the numbers, and a burned end says the counter is ahead", () => {
  return (async () => {
    const { NummeringUitslag } = await import("../../src/components/beveiliging/NummeringPaneel");
    const { translator } = await import("../../src/lib/i18n/t");
    const html = renderToStaticMarkup(
      React.createElement(NummeringUitslag, {
        report: {
          series: [series({ missing: [2], last: 4 }), series({ type: "creditnota", burnedAtEnd: 1 })],
          unreadable: ["2026/0009"],
          clean: false,
          unaccounted: null,
          countersRead: true,
        },
        t: translator("nl"),
      }),
    );
    // The number itself, because "er ontbreekt iets" is not something an owner can act on.
    assert.match(html, /nummer 2 is nooit uitgereikt/);
    // The end-of-series case, which a hole-scan cannot see at all.
    assert.match(html, /teller staat hoger/);
    // Both series named separately, so the owner knows which one to look at.
    assert.match(html, /Facturen 2026/);
    assert.match(html, /Creditnota/);
    // Unreadable numbers are shown as themselves — an owner recognises his own imported history.
    assert.match(html, /2026\/0009/);
    // And a next step, because a finding with none is a screen that worries someone and leaves him.
    assert.match(html, /kun je niet opnieuw gebruiken/);
  })();
});

test("[DOORLOPEND] half a check is never reported as a whole one", () => {
  return (async () => {
    const { NummeringUitslag } = await import("../../src/components/beveiliging/NummeringPaneel");
    const { translator } = await import("../../src/lib/i18n/t");
    // Clean as far as we could see, but the counters did not answer — so the end of the series is
    // unchecked, which is exactly where a burned number is likeliest to sit.
    const html = renderToStaticMarkup(
      React.createElement(NummeringUitslag, {
        report: { series: [series({ burnedAtEnd: null })], unreadable: [], clean: true, unaccounted: null, countersRead: false },
        t: translator("nl"),
      }),
    );
    assert.match(html, /loopt door/);
    assert.match(html, /einde van de reeks konden we nu niet nakijken/, "the unchecked half must be named");

    // And "we could not check" is its own answer, never a quiet clean one.
    const failed = renderToStaticMarkup(
      React.createElement(NummeringUitslag, { report: null, t: translator("nl") }),
    );
    assert.match(failed, /konden je nummering nu niet nakijken/);
    assert.doesNotMatch(failed, /loopt door/, "a failed check must never render the reassuring sentence");
  })();
});

// ─── [GELD-INVARIANT] Do the books agree with themselves? ────────────────────────────

// money-invariants.ts was complete, considered and tested — and nothing called it. No screen, no
// route, no cron. A money audit that runs nowhere is the exact defect that file warns about in its
// own header: computed, and told to no one.
//
// These render the verdict, because the rule is tested as VALUES elsewhere and a component that
// computed the right answer and printed the wrong sentence would pass every test over there.

const finding = (over: Record<string, unknown> = {}) => ({
  kind: "paid_without_payments",
  entityId: "inv-1",
  euros: 1210,
  message: "Factuur 20260046 staat op betaald, maar er staat geen enkele betaling tegenover (€ 1.210,00).",
  ...over,
});

test("[GELD-INVARIANT] books that agree say so in one line, and never in a warning box", () => {
  return (async () => {
    const { GeldUitslag } = await import("../../src/components/beveiliging/GeldPaneel");
    const { translator } = await import("../../src/lib/i18n/t");
    const html = renderToStaticMarkup(
      React.createElement(GeldUitslag, {
        audit: { headline: "", violations: [], drawer: [], drawerChecked: true },
        t: translator("nl"),
      }),
    );
    assert.match(html, /Geen enkel verschil gevonden/, "the healthy answer must be on the screen — a check nobody sees buys no confidence");
    assert.doesNotMatch(html, /amber/, "a green box the size of a warning teaches people to skim this spot");
    assert.doesNotMatch(html, /oneens/);
  })();
});

test("[GELD-INVARIANT] a difference is stated in the rule's own words, with a next step", () => {
  return (async () => {
    const { GeldUitslag } = await import("../../src/components/beveiliging/GeldPaneel");
    const { translator } = await import("../../src/lib/i18n/t");
    const html = renderToStaticMarkup(
      React.createElement(GeldUitslag, {
        audit: {
          headline: "",
          violations: [finding()],
          drawer: [finding({ kind: "drawer_negative", entityId: "2026-02-11", message: "De kaslade staat op 11-02-2026 onder nul (€ 40,00 negatief)." })],
          drawerChecked: true,
        },
        t: translator("nl"),
      }),
    );
    // The sentence comes from the rule because it names the two figures that disagree — summarising
    // it on the screen would lose exactly that.
    assert.match(html, /20260046 staat op betaald/);
    assert.match(html, /€ 1\.210,00/, "the euros are what decide whether this waits until Monday");
    assert.match(html, /kaslade staat op 11-02-2026 onder nul/, "the drawer axis is shown alongside, not instead");
    // And a next step, because a finding with none worries someone and leaves him there.
    assert.match(html, /niet automatisch/);
  })();
});

test("[GELD-INVARIANT] half a check is never reported as a whole one", () => {
  return (async () => {
    const { GeldUitslag } = await import("../../src/components/beveiliging/GeldPaneel");
    const { translator } = await import("../../src/lib/i18n/t");
    // Clean as far as we could see, but the drawer half did not run — and the till is exactly
    // where a missing movement hides best.
    const half = renderToStaticMarkup(
      React.createElement(GeldUitslag, {
        audit: { headline: "", violations: [], drawer: [], drawerChecked: false },
        t: translator("nl"),
      }),
    );
    assert.match(half, /Geen enkel verschil gevonden/);
    assert.match(half, /kaslade konden we nu niet nakijken/, "the unchecked half must be named");

    // And "we could not check" is its own answer, never a quiet clean one.
    const failed = renderToStaticMarkup(
      React.createElement(GeldUitslag, { audit: null, t: translator("nl") }),
    );
    assert.match(failed, /konden je boeken nu niet nakijken/);
    assert.doesNotMatch(failed, /Geen enkel verschil gevonden/, "a failed check must never render the reassuring sentence");
  })();
});
