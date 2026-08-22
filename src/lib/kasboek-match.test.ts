// [KASBOEK-NAAST-KAS] Run: npx tsx --test src/lib/kasboek-match.test.ts
//
// Deze vergelijking beslist welk bedrag een ondernemer in zijn kas bijboekt. Twee manieren om
// duur fout te zijn, en ze zijn elkaars tegenpool:
//   · te weinig melden → het gat blijft, de lade staat te hoog, en de aangifte klopt niet;
//   · te veel boeken   → een uitgave staat er twee keer in, het saldo zakt, en niemand vindt het
//                        terug omdat allebei de regels er correct uitzien.
// Alles hieronder gaat over die tweede, want die is stil.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { matchKasboekDays, matchHeadline, bookableAmount } from "./kasboek-match";
import type { KasboekImportRow } from "./kasboek-import";

const dag = (date: string, spent: number, description: string | null = null, received = 0): KasboekImportRow => ({
  date, opening: 0, spent, spentDescription: description, received, receivedDescription: null, closing: 0,
});

const app = (spent: Record<string, number>, received: Record<string, number> = {}) => ({
  spent: new Map(Object.entries(spent)),
  received: new Map(Object.entries(received)),
});

test("[KASBOEK-NAAST-KAS] alleen het VERSCHIL is boekbaar, nooit het hele bedrag van de regel", () => {
  // DE BELANGRIJKSTE, en het is de echte regel uit het aangeleverde bestand: € 1.754,35 met drie
  // betalingen erin, waarvan de app er één al kent (€ 698,97 via de factuur). Het hele bedrag
  // boeken zet die 698,97 er een tweede keer in — en een dubbele uitgave VERLAAGT het kassaldo.
  const { days } = matchKasboekDays(
    [dag("2026-04-08", 1754.35, "hano 006220 en 006305 : 1.591,83 ,,  famzfood : 162,52")],
    app({ "2026-04-08": 698.97 }),
  );
  assert.equal(days[0].verdict, "ontbreekt");
  assert.equal(days[0].delta, 1055.38, "1754,35 − 698,97");
  assert.equal(bookableAmount(days[0]), 1055.38);
  // En de omschrijving reist ONGEWIJZIGD mee: dat is het enige waaraan de eigenaar kan zien wat
  // die 1.055,38 was.
  assert.match(days[0].description ?? "", /famzfood/);
});

test("[KASBOEK-NAAST-KAS] een dag die klopt is geen bevinding", () => {
  const { days, summary } = matchKasboekDays([dag("2026-04-01", 100, "x")], app({ "2026-04-01": 100 }));
  assert.equal(days[0].verdict, "gelijk");
  assert.equal(bookableAmount(days[0]), null, "er valt niets te boeken op een dag die al klopt");
  assert.equal(summary.missingDays, 0);
  assert.equal(summary.equalDays, 1);
});

test("[KASBOEK-NAAST-KAS] een cent verschil is afronding, geen bevinding", () => {
  // Een lijst die op halve centen aanslaat, is een lijst die niemand afloopt — en dan wordt de dag
  // met een echt gat ook overgeslagen.
  const { days } = matchKasboekDays([dag("2026-04-01", 100.004, "x")], app({ "2026-04-01": 100 }));
  assert.equal(days[0].verdict, "gelijk");
});

test("[KASBOEK-NAAST-KAS] een uitgave die de app wél kent en het kasboek niet, wordt gemeld en nooit verwijderd", () => {
  // De app besluit hier niet dat de boekhouder gelijk heeft. Die boeking hangt meestal aan een
  // factuur met een bon eronder; weghalen zou bewijs vernietigen op grond van een blad.
  const { days, summary } = matchKasboekDays([dag("2026-04-02", 0)], app({ "2026-04-02": 250 }));
  assert.equal(days[0].verdict, "app_meer");
  assert.equal(days[0].delta, -250);
  assert.equal(bookableAmount(days[0]), null, "hier valt niets te boeken — en zeker niets te wissen");
  assert.equal(summary.extraDays, 1);
  assert.equal(summary.extraTotal, 250, "als grootte, niet als min");
});

test("[KASBOEK-NAAST-KAS] een dag die de app helemaal niet kent, is een gat en geen nul", () => {
  const { days } = matchKasboekDays([dag("2026-04-17", 1306.36, "Mohammad Ibrahim deel salaris apr 2026")], app({}));
  assert.equal(days[0].appSpent, 0);
  assert.equal(days[0].verdict, "ontbreekt");
  assert.equal(bookableAmount(days[0]), 1306.36);
});

test("[KASBOEK-NAAST-KAS] élke dag komt terug, ook de goede", () => {
  // Het scherm filtert. Alvast weglaten maakt het onmogelijk om "84 van de 91 dagen kloppen" te
  // zeggen — en precies díe zin geeft vertrouwen in de zeven die niet kloppen.
  const rows = [dag("2026-04-01", 100), dag("2026-04-02", 200), dag("2026-04-03", 0)];
  const { days, summary } = matchKasboekDays(rows, app({ "2026-04-01": 100, "2026-04-02": 50 }));
  assert.equal(days.length, 3);
  assert.deepEqual(days.map((d) => d.verdict), ["gelijk", "ontbreekt", "gelijk"]);
  assert.equal(summary.days, 3);
  assert.equal(summary.missingTotal, 150);
});

test("[KASBOEK-NAAST-KAS] ontvangsten reizen mee als informatie en zijn nergens boekbaar", () => {
  // Contante omzet komt uit de dagomzet, mét btw-tarief. Een tweede weg zou hem dubbel in de
  // aangifte zetten.
  const { days } = matchKasboekDays([dag("2026-04-01", 0, null, 267.85)], app({}, { "2026-04-01": 267.85 }));
  assert.equal(days[0].fileReceived, 267.85);
  assert.equal(days[0].appReceived, 267.85);
  assert.equal(days[0].verdict, "gelijk", "de ontvangsten mogen het oordeel over de UITGAVEN niet kleuren");
  assert.equal(bookableAmount(days[0]), null);
});

// ─── De zin boven de lijst ───────────────────────────────────────────────────────────

test("[KASBOEK-NAAST-KAS] de kop noemt eerst wat er klopt", () => {
  // Een scherm dat opent met zeven problemen over een kasboek waarvan 84 dagen in orde zijn, leest
  // als "je administratie is stuk". Dat is niet waar, en het is ook niet wat er moet gebeuren.
  const zin = matchHeadline({ days: 91, missingDays: 7, missingTotal: 20974.15, extraDays: 0, extraTotal: 0, equalDays: 84 });
  assert.match(zin, /^84 van de 91 dagen kloppen/);
  assert.match(zin, /7 dagen mist je kas samen € 20\.974,15/);
});

test("[KASBOEK-NAAST-KAS] alles gelijk zegt dat ook, en enkelvoud leest als Nederlands", () => {
  assert.match(
    matchHeadline({ days: 91, missingDays: 0, missingTotal: 0, extraDays: 0, extraTotal: 0, equalDays: 91 }),
    /Alle 91 dagen kloppen/,
  );
  assert.match(
    matchHeadline({ days: 5, missingDays: 1, missingTotal: 40, extraDays: 1, extraTotal: 10, equalDays: 3 }),
    /op 1 dag mist je kas samen € 40,00.*op 1 dag kent je kas € 10,00/,
  );
  assert.match(matchHeadline({ days: 0, missingDays: 0, missingTotal: 0, extraDays: 0, extraTotal: 0, equalDays: 0 }), /geen dagen/);
});

// ─── De poort: de deur boekt alleen het verschil, en alleen wat de eigenaar mag ───────

test("[KASBOEK-NAAST-KAS] de deur schrijft alleen aangevinkte dagen, en nooit een gesloten categorie", () => {
  const route = readFileSync("src/app/api/kasboek/vergelijk/route.ts", "utf8");

  // Twee stappen, nooit één. De reden staat voluit in de kop van de route: het bestand zet drie
  // betalingen op één regel en de app kent er soms al een van.
  assert.match(route, /contentType\.includes\("application\/json"\)/, "de boekstap is verdwenen");
  assert.match(route, /matchKasboekDays\(/, "de vergelijkstap is verdwenen");

  // De categorie loopt langs DEZELFDE twee functies als de handmatige kasdeur. Een eigen kopie van
  // die lijst hier zou betekenen dat er één deur is waar wél een onverwijderbare 'betaling'
  // doorheen komt — een regel die geen reconcile ziet en die de verwijderknop weigert.
  assert.match(route, /isCashCategory\(category\)/);
  assert.match(route, /closedCashCategoryReason\(category\)/);

  // De kasleesbeurt MOET pagineren: een afgekapt kwartaal meldt bestaande uitgaven als ontbrekend,
  // waarna de eigenaar ze een tweede keer boekt — precies de fout die dit scherm voorkomt.
  assert.match(route, /fetchAllRows<[\s\S]{0,200}?\.from\("cash_entries"\)/, "[PAGINATION] de kaslezing is geen paginering meer");
  // En een mislukte kaslezing weigert, in plaats van "alles ontbreekt" te melden over een lezing
  // die niet is gelukt.
  assert.match(route, /kas_onleesbaar/);

  // Het spoor: dit IS geld, en het moet terug te vinden zijn.
  assert.match(route, /action: "kasboek\.gap_booked"/);

  const paneel = readFileSync("src/components/kas/KasboekVergelijken.tsx", "utf8");
  // Wat er wordt meegestuurd is d.delta — het verschil — en niet d.fileSpent.
  assert.match(paneel, /amount: d\.delta/, "het paneel stuurt het hele bedrag van de regel mee — dat boekt dubbel");
  assert.ok(!/amount: d\.fileSpent/.test(paneel));

  const scherm = readFileSync("src/app/dashboard/kas/KasClient.tsx", "utf8");
  assert.match(scherm, /<KasboekVergelijken \/>/, "het paneel bestaat en staat op geen scherm");
});
