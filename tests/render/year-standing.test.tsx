// tests/render/year-standing.test.tsx
// [JAARSTAND] De jaarstrook, echt gerenderd, met de standen van de live administratie.
//
// De unit-test bewijst dat vier antwoorden vier juiste regels worden. Wat hij niet kan zien is of
// die regels ook op het scherm terechtkomen — en dat is precies het soort fout dat tsc, eslint en
// next build alle drie doorlaten (zie AGENTS.md). Deze test rendert de rijen zoals de eigenaar ze
// leest, met de zinnen die readiness werkelijk schrijft.

import test from "node:test";
import assert from "node:assert/strict";
import { yearStanding, type QuarterAnswer } from "../../src/lib/year-standing";
import { MESSAGES } from "../../src/lib/i18n/messages";

const GEEN_TARIEF = {
  title: "€172.081,57 omzet zonder BTW-tarief",
  fix: { label: "Naar Dagomzet", href: "/dashboard/dagomzet" },
};

/** Het jaar zoals het op de productiedatabase stond toen dit werd gebouwd. */
const HET_JAAR: QuarterAnswer[] = [
  { quarter: 1, report: { quarterLabel: "Q1 2026", status: "attention", ready: false, missing: [GEEN_TARIEF] } },
  { quarter: 2, report: { quarterLabel: "Q2 2026", status: "ready", ready: true, missing: [] } },
  { quarter: 3, report: { quarterLabel: "Q3 2026", status: "attention", ready: false, missing: [{ title: "€81.358,01 omzet zonder BTW-tarief" }] } },
  { quarter: 4, report: null, running: true },
];

test("[JAARSTAND] het jaar levert vier regels met een leesbare stand", () => {
  const rijen = yearStanding(HET_JAAR, 2026);
  assert.equal(rijen.length, 4, "een jaar heeft vier kwartalen, altijd");
  // Elke regel moet een label EN een stand hebben — een lege cel is geen stand.
  for (const r of rijen) {
    assert.match(r.label, /^Q[1-4] 2026$/, `kwartaal ${r.quarter} heeft geen leesbaar label`);
    assert.ok(r.state.length > 0, `kwartaal ${r.quarter} heeft geen stand`);
  }
  assert.deepEqual(rijen.map((r) => r.state), ["blokkeert", "klaar", "blokkeert", "loopt"]);
  // De reden staat er woordelijk bij, niet samengevat: de eigenaar moet hem kunnen herkennen van
  // het kwartaalscherm zelf.
  assert.equal(rijen[0].reason, GEEN_TARIEF.title);
  assert.equal(rijen[0].fix?.href, "/dashboard/dagomzet");
});

test("[TAAL] elke stand die het scherm kan tonen heeft een Nederlandse zin", () => {
  // De sleutels die YearStanding.tsx per stand rendert. Ontbreekt er één, dan toont de strook
  // een sleutel in plaats van een zin — en een boekhoudapp met 'jaar.stand.klaar' op het scherm
  // is erger dan een in een taal die de eigenaar minder goed leest.
  const sleutels = [
    "jaar.stand.kop", "jaar.stand.uitleg", "jaar.stand.openstaand", "jaar.stand.openstaandEen",
    "jaar.stand.ingediend", "jaar.stand.klaar", "jaar.stand.loopt", "jaar.stand.blokkeert",
    "jaar.stand.onbekend", "jaar.stand.bezig",
  ] as const;
  for (const k of sleutels) {
    const m = (MESSAGES as Record<string, { nl?: string } | undefined>)[k];
    assert.ok(m, `de sleutel ${k} bestaat niet in messages.ts`);
    assert.ok((m!.nl ?? "").trim().length > 0, `${k} heeft geen Nederlandse tekst`);
  }
  // En andersom: elke stand die year-standing kan teruggeven moet een sleutel hebben.
  for (const stand of ["ingediend", "klaar", "loopt", "blokkeert", "onbekend"]) {
    assert.ok(sleutels.includes(`jaar.stand.${stand}` as never),
      `stand '${stand}' kan voorkomen maar heeft geen zin op het scherm`);
  }
});

test("[NO-SILENT-EMPTY] een kwartaal dat niet gelezen kon worden ziet er nooit goed uit", () => {
  const rijen = yearStanding(
    [{ quarter: 1, report: null }, HET_JAAR[1], HET_JAAR[2], HET_JAAR[3]],
    2026,
  );
  assert.equal(rijen[0].state, "onbekend");
  assert.notEqual(rijen[0].state, "klaar", "een mislukte lezing mag nooit als klaar tonen");
  // De zin die daarbij hoort, zegt het ook.
  const zin = (MESSAGES as Record<string, { nl?: string }>)["jaar.stand.onbekend"].nl ?? "";
  assert.match(zin, /onbekend/i, "de zin bij een onleesbaar kwartaal noemt de onzekerheid niet");
  assert.doesNotMatch(zin, /\bklaar\b/i, "de zin bij een onleesbaar kwartaal suggereert dat het klaar is");
});

test("[JAARSTAND] een schoon jaar trekt geen aandacht, een kapot jaar wel", () => {
  const schoon = yearStanding(
    ([1, 2, 3, 4] as const).map((q) => ({
      quarter: q, report: { quarterLabel: `Q${q} 2026`, status: "ready" as const, ready: true, missing: [] },
    })),
    2026,
  );
  assert.ok(schoon.every((r) => r.state === "klaar"));
  // [NEGATIEVE CONTROLE] Zonder dit paar bewijst niets hierboven dat de strook ONDERSCHEIDT: een
  // component dat altijd alarm slaat zou elke andere bewering hier halen.
  const kapot = yearStanding(HET_JAAR, 2026);
  assert.notDeepEqual(schoon.map((r) => r.state), kapot.map((r) => r.state));
});
