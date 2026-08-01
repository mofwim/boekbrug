// [BTW-RIJM] Pure node test — run: npx tsx --test src/lib/btw-reconcile.test.ts
//
// De tests zijn de DRIE ECHTE FACTUREN die dit bestand hebben veroorzaakt, met hun eigen bedragen.
// Dat is met opzet: een verzonnen voorbeeld bewijst dat de formule klopt, deze bewijzen dat hij het
// juiste antwoord geeft op de papieren die daadwerkelijk in de wachtrij vastliepen.
import { test } from "node:test";
import assert from "node:assert/strict";

import { reconcileBtw, reconcileHint, SUM_TOLERANCE, impliedBasesForBtw, rateHint } from "./btw-reconcile";

// D: aardappelgroothandel. Opgeslagen 26,00 / 13,42 / 39,42 — die drie KLOPPEN onderling, dus de
// somcontrole zwijgt en alleen het tarief (52%) valt op. Papier: goederen 149,00 @9% plus een
// geretourneerde container −408,00 @0% → Totaal excl. −123,00 en Totaal te voldoen −109,58.
const AARDAPPEL = { excl: 26.0, btw: 13.42, incl: 39.42, papierGrondslag: 149.0 };

test("[D · retour container] de som klopt, dus alleen het tarief kan iets aanwijzen", () => {
  // Eerst het bewijs dat de identiteit hier NIET helpt: de drie sluiten aan.
  const r = reconcileBtw(AARDAPPEL.excl, AARDAPPEL.btw, AARDAPPEL.incl);
  assert.equal(r.ok, true, "26,00 + 13,42 = 39,42 — de rekenpoort heeft niets te melden");
  assert.equal(reconcileHint(r), null);

  // Maar 13,42 over 26,00 is 52%, en dat tarief bestaat niet. De BTW zelf wijst de weg:
  const bases = impliedBasesForBtw(AARDAPPEL.btw);
  assert.deepEqual(bases.map((b) => b.rate), [9, 21]);
  // 13,42 / 0,09 = 149,11 — op het papier staat grondslag 149,00.
  assert.equal(bases[0].base, 149.11);
  assert.ok(Math.abs(bases[0].base - AARDAPPEL.papierGrondslag) < 0.2, "wijst de goede kolom aan");
  assert.equal(bases[1].base, 63.9);

  const hint = rateHint(AARDAPPEL.btw, AARDAPPEL.excl)!;
  assert.ok(hint.includes("149,11") && hint.includes("26,00"), hint);
  assert.ok(/retour container|statiegeld|emballage/i.test(hint), "noemt de post die het verschil maakt");
});

test("de tariefhint zwijgt als er niets te zeggen valt", () => {
  assert.deepEqual(impliedBasesForBtw(0), [], "zonder btw-bedrag hoort er geen grondslag bij");
  assert.deepEqual(impliedBasesForBtw(null), []);
  assert.deepEqual(impliedBasesForBtw(Number.NaN), []);
  assert.equal(rateHint(0, 100), null);
  assert.equal(rateHint(null, 100), null);
  // Een negatieve BTW (creditnota) levert een negatieve grondslag — met behoud van teken.
  assert.equal(impliedBasesForBtw(-13.42)[0].base, -149.11);
});

// ── De drie praktijkgevallen, met wat er OPGESLAGEN stond ──
// A: btw-tabel met 9% over 985,87 en 0% over 3,86 (E2-kratten). Papier: ex. BTW 989,73.
const VLEES = { excl: 985.87, btw: 88.73, incl: 1078.46, papierExcl: 989.73 };
// B: Subtotaal 1.610,34 + BTW 144,95 + Totaal Statiegeld 88,20. Papier-excl = 1.610,34 + 88,20.
const SNOEP = { excl: 1722.54, btw: 144.95, incl: 1843.49, papierExcl: 1698.54 };
// C: BTW 9% 233,20 + BTW 21% 172,70 = 405,90. Hier was de BTW fout, niet het excl-bedrag.
const HORECA = { excl: 3413.92, btw: 995.9, incl: 3819.82, papierBtw: 405.9 };

test("een kloppende factuur geeft geen enkele melding", () => {
  const r = reconcileBtw(1698.54, 144.95, 1843.49);
  assert.equal(r.ok, true);
  assert.equal(reconcileHint(r), null);
  // Ook precies op de marge blijft het goed — afrondingsruis is geen fout.
  assert.equal(reconcileBtw(100, 21, 121.02).ok, true);
  assert.equal(reconcileBtw(100, 21, 121 + SUM_TOLERANCE + 0.005).ok, false);
});

test("[A · kratten] het verschil is exact de 0%-post die wegviel", () => {
  const r = reconcileBtw(VLEES.excl, VLEES.btw, VLEES.incl);
  assert.equal(r.ok, false);
  // 1.078,46 − (985,87 + 88,73) = 3,86 — precies de E2-regel (6 kratten erin, 5 eruit).
  assert.equal(r.difference, 3.86);
  // En de lezing "het totaal klopt" wijst exact het bedrag aan dat op het papier staat.
  assert.equal(r.impliedExcl, VLEES.papierExcl);
  // Beide lezingen zijn hier rekenkundig mogelijk (9% resp. 9%), dus mag er niet gekozen worden.
  assert.equal(r.exclRepairPossible, true);
  assert.equal(r.btwRepairPossible, true);
  const hint = reconcileHint(r)!;
  assert.ok(hint.includes("989,73"), hint);
  assert.ok(/statiegeld|emballage|kratten/i.test(hint), "wijst de kant op waar het zit");
});

test("[B · statiegeld] hetzelfde patroon, andere kant van het verschil", () => {
  const r = reconcileBtw(SNOEP.excl, SNOEP.btw, SNOEP.incl);
  assert.equal(r.ok, false);
  // Hier stond er juist te VEEL in het excl-bedrag: −24,00.
  assert.equal(r.difference, -24);
  assert.equal(r.impliedExcl, SNOEP.papierExcl, "subtotaal 1.610,34 + statiegeld 88,20");
  assert.ok(reconcileHint(r)!.includes("1.698,54"));
});

test("[C · twee tarieven] hier valt één lezing af en mag het scherm hem BENOEMEN", () => {
  const r = reconcileBtw(HORECA.excl, HORECA.btw, HORECA.incl);
  assert.equal(r.ok, false);
  // De lezing "excl is fout" zou een btw-tarief van 35% impliceren — dat bestaat niet.
  assert.equal(r.exclRepairRate, 35);
  assert.equal(r.exclRepairPossible, false);
  // De andere lezing geeft 12% (mengsel van 9% en 21%) en levert exact de som van de twee
  // btw-regels op het papier: 233,20 + 172,70.
  assert.equal(r.impliedBtw, HORECA.papierBtw);
  assert.equal(r.btwRepairPossible, true);
  const hint = reconcileHint(r)!;
  assert.ok(hint.includes("405,90"), hint);
  // Precies één antwoord, dus GEEN "óf".
  assert.ok(!hint.includes("óf"), hint);
});

test("het tarief-argument is wat de keuze draagt — 21% mag, 22% niet", () => {
  // Op de grens: 21% is het hoogste Nederlandse tarief en moet blijven kunnen.
  const grens = reconcileBtw(0, 21, 121);
  assert.equal(grens.exclRepairRate, 21);
  assert.equal(grens.exclRepairPossible, true);
  // Eén tik erboven kan niet meer.
  const erover = reconcileBtw(0, 22, 122);
  assert.equal(erover.exclRepairRate, 22);
  assert.equal(erover.exclRepairPossible, false);
});

test("als geen van beide kan, belooft de melding geen reparatie", () => {
  // Twee getallen tegelijk fout: dan valt er niets aan te wijzen en zeggen we dat.
  const r = reconcileBtw(100, 900, 300);
  assert.equal(r.exclRepairPossible, false);
  assert.equal(r.btwRepairPossible, false);
  const hint = reconcileHint(r)!;
  assert.ok(/controleer de hele uitsplitsing/i.test(hint), hint);
  assert.ok(!hint.includes("hoort"), "geen reparatie beloven die we niet kunnen onderbouwen");
});

test("onzin komt er niet doorheen", () => {
  assert.equal(reconcileBtw(null, null, null).ok, true, "0 + 0 = 0 sluit aan");
  const r = reconcileBtw(undefined, 21, 121);
  assert.equal(r.impliedExcl, 100);
  // Een grondslag van 0 levert geen tarief op — dan is die lezing niet te onderbouwen.
  assert.equal(reconcileBtw(0, 0, 50).btwRepairRate, null);
  assert.equal(reconcileBtw(0, 0, 50).btwRepairPossible, false);
});

test("[POORT] de twee tips spreken elkaar niet tegen", async () => {
  const { evaluateArithmetic } = await import("./safecore");

  // C: som klopt NIET. De somtip wijst de BTW aan (€ 405,90). De tarieftip zou vanuit diezelfde,
  // net fout verklaarde € 995,90 een grondslag van € 11.065,56 voorstellen — dat mag hij niet meer.
  const c = evaluateArithmetic({ totalExBtw: HORECA.excl, btwAmount: HORECA.btw, totalIncBtw: HORECA.incl });
  assert.equal(c.ok, false);
  assert.ok(c.reason!.includes("405,90"), c.reason);
  assert.ok(!c.reason!.includes("11.065,56"), "geen grondslag afgeleid uit een fout bevonden BTW");

  // D: som klopt WEL, dus daar is de tarieftip het enige dat iets kan aanwijzen — en dan moet hij er staan.
  const d = evaluateArithmetic({ totalExBtw: AARDAPPEL.excl, btwAmount: AARDAPPEL.btw, totalIncBtw: AARDAPPEL.incl });
  assert.equal(d.ok, false);
  assert.ok(d.reason!.includes("149,11"), d.reason);

  // En een vrijgestelde factuur (pensioenpremie: 266,62 / 0 / 266,62) blijft volledig stil — geen
  // vals alarm op een document dat gewoon geen btw kent.
  const vrij = evaluateArithmetic({ totalExBtw: 266.62, btwAmount: 0, totalIncBtw: 266.62 });
  assert.equal(vrij.ok, true, vrij.reason ?? "");
});

test("[GELD] er wordt niets gerepareerd — de functie geeft alleen antwoord", () => {
  // Een leesbaarheidscontrole op de belofte in de kop: reconcileBtw is puur en geeft de INVOER
  // ongewijzigd terug in zijn afgeleiden. Wie hier ooit een schrijfactie aan hangt, komt langs
  // deze test.
  const before = { excl: VLEES.excl, btw: VLEES.btw, incl: VLEES.incl };
  reconcileBtw(before.excl, before.btw, before.incl);
  assert.deepEqual(before, { excl: 985.87, btw: 88.73, incl: 1078.46 });
});
