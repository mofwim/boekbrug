// [BON-BETAALWIJZE] Pure node test — run: npx tsx --test src/lib/bon-betaalwijze.test.ts
//
// De drie fixtures hieronder zijn LETTERLIJK overgetypt van echte kassabonnen. Dat is bewust:
// een regel die werkt op een verzonnen bon bewijst niets over de bonnen die de app krijgt.
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  gokBetaalwijze,
  normaliseerBetaalwijze,
  leesKaartLaatste4,
  contantUitLade,
} from "./bon-betaalwijze";

// ── Echte bonnen ────────────────────────────────────────────────────────────────────────────

// Lidl Tilburg Kreverplein, 23-04-2026 — 7x trostomaten, met pinbon eronder.
const LIDL = `
Lidl Tilburg Kreverplein
Aantal            7 art.
Totaal                          70,29
Bankpas                         70,29
Kopie Kaarthouder
Terminal  87106041   Merchant  278508
AID       D00089     Transactie 049612
V PAY     A0000000032020
Kaart     xxxxxxxxxxxxxxxx6596
Volgnr.   0001       23-04-2026 11:13
Kaartbetaling  Totaal EUR 70,29
PIN            leesmethode CTL CHIP
Betaling gelukt
%   Bedr.Excl   BTW   Bedr.Incl
B 9     64,49   5,80      70,29
`;

// Nettorama Huizen, 22-04-2026 — 6x spitskool, contant.
const NETTORAMA = `
Nettorama Huizen
6  SPITSKOOL        1,79     10,74
6  SUBTOTAAL          E      10,74
TE BETALEN            E      10,74
   BETALEN MET:
      Kontant                10,75
      WISSELGELD              0,00
BTW%  BEDRAG EXCL. BTW   BEDRAG BTW
9 %        E   9,85        E   0,89
`;

// Omur Markt BV Amersfoort, 2026-04-21 — groente per kist, contant met afronding.
const OMUR = `
OMUR MARKT BV
NEPTUNUSPLEIN 66 A-K  3814BR AMERSFOORT
                 SUBTOTAAL  112,92 EUR
                   TOTAAL   112,92 EUR
                   KONTANT  120,00 EUR
                 Afronding    0,02 EUR
                 Wisselgeld   7,10 EUR
%        NETTO    BTW    BRUTO
A:9%    103,60   9,32   112,92
2026-04-21 13:35        medewerker 1
1/4 (991893-00)         BON: 2/667957
`;

// ── De kern: gok slim, vraag alleen als we het niet weten ───────────────────────────────────

test("een pinbon leest als bank, zonder vraag", () => {
  const g = gokBetaalwijze(LIDL);
  assert.equal(g.method, "bank");
  assert.equal(g.zeker, true, "Bankpas + PIN + Betaling gelukt is geen twijfelgeval");
  assert.ok(g.bewijs, "de gok moet naleesbaar zijn");
});

test("een contante bon leest als kas, zonder vraag", () => {
  for (const [naam, bon] of [["Nettorama", NETTORAMA], ["Omur", OMUR]] as const) {
    const g = gokBetaalwijze(bon);
    assert.equal(g.method, "kas", `${naam} is contant afgerekend`);
    assert.equal(g.zeker, true, `${naam}: kontant + wisselgeld laat niets te raden over`);
  }
});

test("de pas-cijfers komen mee — dat is wat de bankmatch later betrouwbaar maakt", () => {
  assert.equal(gokBetaalwijze(LIDL).kaartLaatste4, "6596");
  assert.equal(gokBetaalwijze(NETTORAMA).kaartLaatste4, null);
  assert.equal(leesKaartLaatste4("Kaart xxxxxxxxxxxxxxxx6596"), "6596");
  assert.equal(leesKaartLaatste4("PAS ****1234"), "1234");
  assert.equal(leesKaartLaatste4("geen pas op deze bon"), null);
});

test("tegenstrijdig bewijs beweert niets en vraagt het", () => {
  // Een bon met ZOWEL een contante tender als een kaartregel (deelbetaling, of een misread).
  // Hier is de juiste uitkomst: geen bewering, en de ondernemer krijgt de vraag.
  const gemengd = "TOTAAL 50,00\nKontant 20,00\nBankpas 30,00\nBetaling gelukt";
  const g = gokBetaalwijze(gemengd);
  assert.equal(g.method, null, "bij twijfel niets wegschrijven");
  assert.equal(g.zeker, false);
  assert.ok(g.bewijs?.includes("+"), "beide vondsten horen in het bewijs te staan");
});

test("zegt de bon niets, dan is er niets te weten", () => {
  const g = gokBetaalwijze("Bedankt voor uw bezoek\nTOTAAL 12,50");
  assert.equal(g.method, null);
  assert.equal(g.zeker, false);
});

test("het model mag invullen wat het papier niet zegt — maar nooit als zeker", () => {
  const g = gokBetaalwijze("TOTAAL 12,50", "pin");
  assert.equal(g.method, "bank");
  assert.equal(g.zeker, false, "een interpretatie is geen afdruk");
  assert.equal(g.bewijs, null);
});

test("het papier wint van het model", () => {
  // Het model zegt 'kas', de bon zegt Bankpas. De bon heeft gelijk.
  const g = gokBetaalwijze(LIDL, "kas");
  assert.equal(g.method, "bank");
  assert.equal(g.zeker, true);
});

// ── 'pin' mag de database niet in ───────────────────────────────────────────────────────────

test("'pin' wordt 'bank' — een derde waarde kent geen enkele reconciler", () => {
  // bank/confirm schrijft "bank", pay-toggle "bank"|"kas", cash-settle zoekt .eq(...,"kas").
  // Een rij met "pin" zit in geen van beide emmers en wordt door allebei genegeerd.
  assert.equal(normaliseerBetaalwijze("pin"), "bank");
  assert.equal(normaliseerBetaalwijze("pinpas"), "bank");
  assert.equal(normaliseerBetaalwijze("bankpas"), "bank");
  assert.equal(normaliseerBetaalwijze("kontant"), "kas");
  assert.equal(normaliseerBetaalwijze("kas"), "kas");
  assert.equal(normaliseerBetaalwijze("BANK"), "bank");

  // Onbekend blijft null — nooit doorgeven wat de rest van de app niet kan lezen.
  for (const raar of ["ideal", "tikkie", "", null, undefined, "onbekend"]) {
    assert.equal(normaliseerBetaalwijze(raar), null, `${String(raar)} mag niet doorglippen`);
  }
});

test("gokBetaalwijze geeft nooit iets anders terug dan bank | kas | null", () => {
  for (const bon of [LIDL, NETTORAMA, OMUR, "", "willekeurige tekst"]) {
    const m = gokBetaalwijze(bon).method;
    assert.ok(m === "bank" || m === "kas" || m === null, `onverwachte waarde: ${String(m)}`);
  }
});

// ── Afronding: wat er uit de la gaat is niet het bontotaal ──────────────────────────────────

test("contante afronding — de lade beweegt anders dan het bontotaal", () => {
  // Omur: totaal 112,92 · kontant 120,00 · afronding 0,02 · wisselgeld 7,10
  // 120,00 - 7,10 = 112,90 → er ging 2 cent MINDER uit de la dan de bon waard is.
  assert.equal(contantUitLade(112.92, 120.0, 7.1), 112.9);

  // Nettorama: te betalen 10,74 · kontant 10,75 · wisselgeld 0,00 → 1 cent MEER.
  assert.equal(contantUitLade(10.74, 10.75, 0), 10.75);

  // Zonder tendergegevens: bontotaal afgerond op 5 cent (de NL-regel voor contant).
  assert.equal(contantUitLade(112.92, null, null), 112.9);
  assert.equal(contantUitLade(10.74, null, null), 10.75);
  assert.equal(contantUitLade(null, null, null), null);
});

test("de bon blijft zijn eigen waarde houden — afronding verandert de kosten niet", () => {
  // Dit is de grens die niet mag schuiven: 112,92 is de kostenpost en de btw-grondslag
  // (103,60 + 9,32). De 2 cent is een kasverschil, geen korting.
  const uitLade = contantUitLade(112.92, 120.0, 7.1)!;
  assert.notEqual(uitLade, 112.92, "de lade en de bon zijn twee verschillende getallen");
  assert.equal(Math.round((112.92 - uitLade) * 100) / 100, 0.02);
});
