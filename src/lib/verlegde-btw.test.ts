// Run: npx tsx --test src/lib/verlegde-btw.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import { verlegdeBtwOpInkoop, totaalVerlegd, VERLEGD_DEFAULT_RATE } from "./verlegde-btw";

const bouwfactuur = (tekst: string, ex = 5000) => ({ text: tekst, totalExBtw: ex, btwAmount: 0 });

test("[VERLEGD-NAAR-MIJ] de zinnen die een onderaannemer echt op zijn factuur zet", () => {
  for (const zin of [
    "BTW verlegd",
    "btw-verlegd naar de aannemer",
    "Verleggingsregeling van toepassing",
    "Omzetbelasting verlegd op grond van artikel 24b Uitvoeringsbesluit OB 1968",
    "BTW verlegd naar opdrachtgever",
    "Reverse charge",
    "Heffing verlegd, art. 12 lid 5 Wet OB",
  ]) {
    const v = verlegdeBtwOpInkoop(bouwfactuur(zin));
    assert.ok(v, `"${zin}" werd niet herkend als verlegde BTW`);
    assert.equal(v!.voorgesteldTarief, VERLEGD_DEFAULT_RATE);
    assert.equal(v!.bedrag, 1050, "21% over € 5.000 is € 1.050 — dat bedrag hoort in 2a én in 5b");
  }
});

test("[VERLEGD-NAAR-MIJ] een factuur die WEL BTW rekent is niet verlegd, wat de kleine lettertjes ook zeggen", () => {
  // De tegenstelling zelf is iets om naar te kijken, niet iets om te herinterpreteren: een
  // leverancier die 21% rekent én 'verleggingsregeling' in zijn voorwaarden heeft staan, heeft
  // gewoon BTW gerekend. Dit als 2a boeken zou de BTW twee keer laten meetellen.
  assert.equal(verlegdeBtwOpInkoop({ text: "BTW verlegd", totalExBtw: 5000, btwAmount: 1050 }), null);
});

test("[VERLEGD-NAAR-MIJ] geen grondslag, geen rubriek", () => {
  assert.equal(verlegdeBtwOpInkoop({ text: "BTW verlegd", totalExBtw: 0, btwAmount: 0 }), null);
  assert.equal(verlegdeBtwOpInkoop({ text: "", totalExBtw: 5000, btwAmount: 0 }), null);
  assert.equal(verlegdeBtwOpInkoop({ text: null, totalExBtw: 5000, btwAmount: 0 }), null);
});

test("[VERLEGD-NAAR-MIJ] een gewone 0%-factuur is geen verlegging", () => {
  // Export en vrijgestelde prestaties dragen ook geen BTW. Zonder de zin op het papier is er geen
  // verlegging, en 2a vullen zou omzet declareren die de eigenaar niet verschuldigd is.
  for (const zin of [
    "Levering binnen de EU, 0% BTW",
    "Vrijgesteld van omzetbelasting art. 11",
    "Uitvoer naar Zwitserland",
    "Levering met 0% tarief",
  ]) {
    assert.equal(verlegdeBtwOpInkoop(bouwfactuur(zin)), null, `"${zin}" is geen verlegging`);
  }
});

test("[VERLEGD-NAAR-MIJ] het tarief komt NIET van het papier, en het voorstel is te overrulen", () => {
  // Een verlegde factuur draagt geen BTW en dus geen tarief. Het tarief volgt uit wat er geleverd
  // is — een oordeel over het werk, niet iets om af te lezen. De module stelt het vak-standaardtarief
  // voor en neemt het antwoord van de eigenaar zodra dat er is.
  const voorstel = verlegdeBtwOpInkoop(bouwfactuur("BTW verlegd", 1000));
  assert.equal(voorstel!.voorgesteldTarief, 21);
  assert.equal(voorstel!.bedrag, 210);

  const bevestigd = verlegdeBtwOpInkoop({ ...bouwfactuur("BTW verlegd", 1000), bevestigdTarief: 9 });
  assert.equal(bevestigd!.voorgesteldTarief, 9);
  assert.equal(bevestigd!.bedrag, 90, "het antwoord van de eigenaar wint van het voorstel");
});

test("[VERLEGD-NAAR-MIJ] de gevonden zin reist mee, zodat het scherm het papier kan citeren", () => {
  const v = verlegdeBtwOpInkoop(bouwfactuur("Factuurbedrag exclusief. BTW verlegd naar de aannemer."));
  assert.match(v!.marker, /verlegd/i,
    "zonder de gevonden zin kan het scherm alleen beweren; met de zin kan het aanwijzen");
});

test("[VERLEGD-NAAR-MIJ] 2a en 5b zijn HETZELFDE getal — daar hangt de hele regeling aan", () => {
  // Ze horen tegen elkaar weg te vallen bij volledige aftrek. Apart afronden is precies hoe twee
  // bedragen die moeten wegvallen dat niet meer doen, en dan staat er een saldo van een paar cent
  // op een aangifte waar niets te betalen was.
  const vondsten = [
    verlegdeBtwOpInkoop(bouwfactuur("BTW verlegd", 1234.56))!,
    verlegdeBtwOpInkoop(bouwfactuur("verleggingsregeling", 987.65))!,
    verlegdeBtwOpInkoop(bouwfactuur("reverse charge", 0.05))!,
  ];
  const t = totaalVerlegd(vondsten)!;
  assert.equal(t.aantal, 3);
  assert.equal(t.grondslag, 2222.26);
  // 259,26 + 207,41 + 0,01 = 466,68
  assert.equal(t.btw, 466.68);
  assert.equal(Math.round(t.btw * 100) / 100, t.btw, "het 2a-bedrag moet exact op centen staan");
});

test("[VERLEGD-NAAR-MIJ] niets gevonden is een lege rubriek, geen nul-regel", () => {
  // Een 2a van € 0 op een aangifte van een bakker is ruis; de rubriek hoort dan gewoon weg te zijn.
  assert.equal(totaalVerlegd([]), null);
});

test("[VERLEGD-NAAR-MIJ] een creditnota keert de kant om", () => {
  // Een gecrediteerde verlegde factuur haalt de eerder aangegeven BTW er weer af, in dezelfde twee
  // rubrieken. Zonder het teken zou een creditering de 2a juist verhogen.
  const v = verlegdeBtwOpInkoop({ text: "BTW verlegd", totalExBtw: -1000, btwAmount: 0 })!;
  assert.equal(v.bedrag, -210);
  assert.equal(totaalVerlegd([v])!.btw, -210);
});
