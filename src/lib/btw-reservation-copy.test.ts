// [BTW-RESERVERING] Run: npx tsx --test src/lib/btw-reservation-copy.test.ts

import { test } from "node:test";
import assert from "node:assert/strict";

import { btwReservationPanel } from "./btw-reservation-copy";
import { computeBtwReservation, type QuarterPosition } from "./btw-reservation";

const quarterAt = (p: Partial<QuarterPosition> & { year: number; quarter: 1 | 2 | 3 | 4 }): QuarterPosition => ({
  key: `${p.year}-Q${p.quarter}`,
  balance: 0,
  filed: false,
  ...p,
});

const reservation = (over: Partial<Parameters<typeof computeBtwReservation>[0]> = {}) =>
  computeBtwReservation({
    balance: 10_000,
    balanceAsOf: "2026-05-05",
    balanceIncomplete: false,
    quarters: [quarterAt({ year: 2026, quarter: 2, balance: 2_100 })],
    today: "2026-05-05",
    ...over,
  });

test("[BTW-RESERVERING] no BTW position at all → no panel", () => {
  // An owner who owes nothing does not need a tile explaining that they owe nothing.
  assert.equal(btwReservationPanel(reservation({ quarters: [] })), null);
});

test("[BTW-RESERVERING] the ordinary case names both halves of the balance", () => {
  const p = btwReservationPanel(reservation())!;
  assert.ok(p);
  assert.match(p.reserved.amount, /2\.100/);
  assert.equal(p.free?.short, false);
  assert.match(p.free!.amount, /7\.900/);
});

test("[BTW-RESERVERING] a shortfall is labelled as one and never printed with two minus signs", () => {
  const p = btwReservationPanel(reservation({ balance: 1_500 }))!;
  assert.equal(p.free?.short, true);
  assert.ok(!p.free!.amount.includes("-"), "the label already says 'short'; the amount is a magnitude");
  assert.ok(!p.free!.amount.includes("−"));
  assert.match(p.free!.amount, /600/);
});

test("[BTW-RESERVERING] an unknown balance renders as an ABSENCE, never as a euro figure", () => {
  // This is the property the whole feature stands on: no number in the "left for you" slot when
  // there is no balance to compute it from. A "€ 0,00" there would be the reassuring lie.
  const p = btwReservationPanel(reservation({ balance: null }))!;
  assert.equal(p.free, null);
  assert.ok(p.reserved.amount.includes("2.100"), "what is owed is still stated");
  assert.ok(p.caveats.some((k) => k.includes("banksaldo")));
});

test("[BTW-RESERVERING] the deadline is phrased by how close it is, never as a negative countdown", () => {
  const far = btwReservationPanel(reservation())!;
  assert.match(far.deadline!, /31-07-2026/, "far away → the date says more than a day count");

  const soon = btwReservationPanel(
    reservation({
      today: "2026-07-20",
      quarters: [quarterAt({ year: 2026, quarter: 2, balance: 900 })],
    }),
  )!;
  assert.match(soon.deadline!, /11 dagen/);

  const todayPanel = btwReservationPanel(
    reservation({
      today: "2026-07-31",
      quarters: [quarterAt({ year: 2026, quarter: 2, balance: 900 })],
    }),
  )!;
  assert.match(todayPanel.deadline!, /vandaag/);
  assert.ok(!todayPanel.deadline!.includes("0 dagen"), "'nog 0 dagen' is a sentence nobody writes");

  const passed = btwReservationPanel(
    reservation({
      today: "2026-08-10",
      quarters: [quarterAt({ year: 2026, quarter: 2, balance: 900, filed: false })],
    }),
  )!;
  assert.match(passed.deadline!, /voorbij/);
  assert.ok(!/-\d+ dagen/.test(passed.deadline!), "never a negative countdown about the tax office");
});

test("[BTW-RESERVERING] a refund is stated apart and never folded into what is left", () => {
  const p = btwReservationPanel(
    reservation({ balance: 1_000, quarters: [quarterAt({ year: 2026, quarter: 2, balance: -800 })] }),
  )!;
  assert.ok(p.refundExpected);
  assert.match(p.refundExpected!, /800/);
  assert.match(p.free!.amount, /1\.000/, "the refund raised this by nothing");
});

test("[BTW-RESERVERING] a quarter that could not be computed is NAMED, not silently dropped", () => {
  const p = btwReservationPanel(reservation(), { uncomputed: ["2026-Q1"] })!;
  assert.ok(p.caveats.some((k) => k.includes("Q1 2026")));
});

test("[BTW-RESERVERING] the stale-balance sentence carries the actual statement date", () => {
  const p = btwReservationPanel(
    reservation({ balanceAsOf: "2026-03-31", today: "2026-05-05" }),
    { balanceAsOf: "2026-03-31" },
  )!;
  assert.ok(p.caveats.some((k) => k.includes("31-03-2026")),
    "a sentence saying the balance is old without saying HOW old cannot be acted on");
});

// ─── [TAAL] ──────────────────────────────────────────────────────────────────────────

test("[TAAL] every note code produces a real sentence, in every language, never a key", () => {
  // A key rendered on screen ('btwres.notitie.saldoOnbekend') next to a tax figure is worse than
  // the same sentence in a language the owner reads less comfortably.
  const everything = reservation({
    balance: null,
    balanceIncomplete: true,
    balanceAsOf: "2026-01-01",
    quarters: [
      quarterAt({ year: 2026, quarter: 2, balance: 2_100, unverifiedPurchases: 2 }),
      quarterAt({ year: 2026, quarter: 1, balance: -300, filed: false }),
    ],
  });
  assert.ok(everything.notes.length >= 5, "this case is meant to fire nearly every note");

  for (const locale of ["nl", "en", "ar", "tr"]) {
    const p = btwReservationPanel(everything, { uncomputed: ["2025-Q4"], oldestConsidered: "2025-Q3" }, locale)!;
    for (const sentence of p.caveats) {
      assert.ok(sentence.length > 0, `empty sentence in ${locale}`);
      assert.ok(!sentence.startsWith("btwres."), `untranslated key leaked in ${locale}: ${sentence}`);
      assert.ok(!/\{\w+\}/.test(sentence), `unfilled placeholder in ${locale}: ${sentence}`);
    }
    for (const label of [p.heading, p.reserved.label, p.action]) {
      assert.ok(label.length > 0 && !label.startsWith("btwres."), `bare key in ${locale}: ${label}`);
    }
  }
});

test("[TAAL] Turkish falls back to Dutch rather than to a key or a blank", () => {
  const nl = btwReservationPanel(reservation(), {}, "nl")!;
  const tr = btwReservationPanel(reservation(), {}, "tr")!;
  assert.equal(tr.heading, nl.heading);
  assert.equal(tr.dir, "ltr");
});

test("[TAAL] direction travels with the words, on the same object", () => {
  // So a component cannot render Arabic text left-to-right by reading them from two places.
  assert.equal(btwReservationPanel(reservation(), {}, "ar")!.dir, "rtl");
  assert.equal(btwReservationPanel(reservation(), {}, "nl")!.dir, "ltr");
});
