// src/modules/accountant/work-grouping.test.ts
// run: npx tsx --test src/modules/accountant/work-grouping.test.ts
//
// [KANTOOR-BESLUIT] The titles below are readiness' real sentences, taken from src/lib/readiness.ts
// and from the live administration — including the two that made the year strip red today
// (Q1 € 172.081,57 and Q3 € 81.358,01 omzet zonder BTW-tarief).

import { test } from "node:test";
import assert from "node:assert/strict";
import { workKey, groupWork, workCount, type ClientWork } from "./work-grouping";

// The real shapes, from readiness.ts.
const OMZET_Q1 = "€172.081,57 omzet zonder BTW-tarief";
const OMZET_Q3 = "€81.358,01 omzet zonder BTW-tarief";
const KASSA_0 = "0 van 90 kassadagen geïmporteerd";
const KASSA_12 = "12 van 91 kassadagen geïmporteerd";
const BETAALDATUM_1 = "1 betaalde factuur zonder betaaldatum";
const BETAALDATUM_3 = "3 betaalde facturen zonder betaaldatum";
const CLAWBACK = "4 onbetaalde inkoopfacturen >1 jaar — €522,71 voorbelasting terugbetalen";

test("[KANTOOR-BESLUIT] two amounts of the same gap are one kind of work", () => {
  assert.equal(workKey(OMZET_Q1), workKey(OMZET_Q3),
    "two clients with omzet-zonder-tarief land in two rows, and the office does the same job twice");
  assert.equal(workKey(KASSA_0), workKey(KASSA_12),
    "the kassadagen gap splits by how many days happen to be missing");
});

test("[KANTOOR-BESLUIT] singular and plural of one gap are one kind of work", () => {
  // Without the -en/-s strip every counted gap appears twice on the board.
  assert.equal(workKey(BETAALDATUM_1), workKey(BETAALDATUM_3),
    "'1 betaalde factuur' and '3 betaalde facturen' are two different kinds of work");
});

test("[KANTOOR-BESLUIT] different gaps stay different", () => {
  // [NEGATIEVE CONTROLE] Everything above also passes if workKey returns a constant. These are
  // the assertions that catch that.
  const keys = [workKey(OMZET_Q1), workKey(KASSA_0), workKey(BETAALDATUM_1), workKey(CLAWBACK)];
  assert.equal(new Set(keys).size, 4,
    `four unrelated gaps collapsed into ${new Set(keys).size} kinds — the key has stopped ` +
      "discriminating, and the board would show one row for everything");
  assert.notEqual(workKey(OMZET_Q1), workKey(KASSA_0));
});

test("[KANTOOR-BESLUIT] the office sees the work, and who it belongs to", () => {
  const clients: ClientWork[] = [
    { id: "a", name: "Kiwi Food", missingTitles: [OMZET_Q1, KASSA_0] },
    { id: "b", name: "Bakkerij Hendriks", missingTitles: [OMZET_Q3] },
    { id: "c", name: "Café De Brug", missingTitles: [BETAALDATUM_3, OMZET_Q3] },
    { id: "d", name: "Fysio Zonnehof", missingTitles: [] },
  ];
  const groups = groupWork(clients);

  assert.equal(groups[0].clients.length, 3, "the omzet gap covers three clients and must lead");
  assert.deepEqual(groups[0].clients.map((c) => c.name), ["Kiwi Food", "Bakkerij Hendriks", "Café De Brug"]);
  assert.equal(groups[0].label, OMZET_Q1,
    "the label is not one of readiness' own sentences, verbatim");

  // A client with nothing blocking contributes nothing — it is not an empty row.
  assert.ok(!groups.some((g) => g.clients.some((c) => c.id === "d")),
    "a client with no gaps appears in the work list");

  assert.equal(groups.length, 3, "three kinds of work: omzet, kassadagen, betaaldatum");
  assert.equal(workCount(groups), 5, "five pieces of work across four clients");
});

test("[KANTOOR-BESLUIT] one client with the same gap twice is one piece of work", () => {
  // readiness can name the same kind more than once for one client (two quarters, two amounts).
  // From the office's point of view that is one habit to apply, once, at that client.
  const groups = groupWork([{ id: "a", name: "Kiwi Food", missingTitles: [OMZET_Q1, OMZET_Q3] }]);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].clients.length, 1,
    "the same client is listed twice under one kind, so the office count is inflated");
});

test("[KANTOOR-BESLUIT] a gap nobody has taught this file still groups itself", () => {
  // The whole reason the key is derived and not a list of patterns: a readiness gap added
  // tomorrow must group without anyone editing this file.
  const nieuw1 = "7 bonnen zonder tegenpartij gevonden";
  const nieuw2 = "2 bonnen zonder tegenpartij gevonden";
  assert.equal(workKey(nieuw1), workKey(nieuw2));
  const groups = groupWork([
    { id: "a", name: "A", missingTitles: [nieuw1] },
    { id: "b", name: "B", missingTitles: [nieuw2] },
  ]);
  assert.equal(groups.length, 1, "an unknown gap fell into two rows");
  assert.equal(groups[0].clients.length, 2);
});

test("[KANTOOR-BESLUIT] an empty or number-only title never makes a group", () => {
  assert.equal(workKey(""), "");
  assert.equal(workKey("€ 12,00"), "");
  const groups = groupWork([{ id: "a", name: "A", missingTitles: ["", "€ 12,00"] }]);
  assert.equal(groups.length, 0,
    "a title with no words became a group — the board would show a row with no sentence on it");
});
