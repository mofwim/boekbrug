// [KASBOEK-LEZEN] Run: npx tsx --test src/lib/kasboek-import.test.ts
//
// De vorm hieronder is niet verzonnen: het is regel voor regel de "Kiwi 2de kw 2026.xlsx" die een
// echte klant aanleverde — 91 dagen, datums als Excel-serienummers, de omschrijving van een uitgave
// waar DRIE facturen in één bedrag zitten, en een blad dat op de cent klopt.
//
// Wat hier misgaat is duur en stil. Een kasboek dat verkeerd wordt gelezen verlaagt of verhoogt een
// kassaldo, en een kassaldo is het eerste waar de Belastingdienst een contante administratie op
// afwijst. Daarom wordt hier ook getest wat het NIET doet: het schrijft niets, het kiest niet welke
// van twee bronnen gelijk heeft, en het poetst geen minteken weg.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  parseKasboekSheet,
  looksLikeKasboekSheet,
  compareKasboek,
  kasboekDate,
} from "./kasboek-import";
import type { Cell } from "./turnover-import";

/** De koprij zoals het kantoor hem schrijft — inclusief de spatie achter "Ontvangsten ". */
const KOP: Cell[] = [null, "april", "Beginsaldo", "Uitgaven", "Omschrijving", null, "Ontvangsten ", "Omschrijving", "Eindsaldo"];

/** 46113 = 1 april 2026 in Excel-serienummers, precies zoals in het echte bestand. */
const dag = (serial: number, begin: number, uit: number, uitOms: string | null, ont: number, eind: number): Cell[] =>
  [serial, serial, begin, uit || null, uitOms, null, ont || null, null, eind];

const BLAD: Cell[][] = [
  [null, "Kasboek", 46113],
  KOP,
  dag(46113, 1018.32, 0, null, 267.849991, 1286.169991),
  dag(46114, 1286.169991, 0, null, 279.799999, 1565.96999),
  // De regel waar drie facturen in één bedrag zitten — de reden dat dit module niets boekt.
  dag(46120, 1565.96999, 1754.35, "hano 006220 en 006305 : 1.591,83 ,,  famzfood : 162,52", 341.899994, 153.519984),
];

test("[KASBOEK-LEZEN] het blad van de boekhouder wordt herkend en klopt op de cent", () => {
  assert.equal(looksLikeKasboekSheet(BLAD), true);
  const r = parseKasboekSheet(BLAD)!;
  assert.equal(r.rows.length, 3);
  assert.equal(r.rows[0].date, "2026-04-01", "een serienummer is een kalenderdag, geen tijdstip");
  assert.equal(r.openingBalance, 1018.32);
  assert.equal(r.closingBalance, 153.52);
  assert.equal(r.totalReceived, 889.55);
  assert.equal(r.totalSpent, 1754.35);
  assert.deepEqual(r.warnings, [], "een blad dat optelt mag niets te melden hebben");
  // De omschrijving blijft ONGEWIJZIGD: daar staat welke facturen erin zitten, en dat is het enige
  // wat een mens straks kan gebruiken om ze uit elkaar te halen.
  assert.match(r.rows[2].spentDescription ?? "", /hano 006220 en 006305/);
});

test("[KASBOEK-LEZEN] een regel die niet optelt wordt benoemd, niet gladgestreken", () => {
  const stuk: Cell[][] = [KOP, dag(46113, 1000, 100, "x", 50, 1000)]; // 1000 + 50 − 100 = 950
  const r = parseKasboekSheet(stuk)!;
  assert.equal(r.warnings.length, 1);
  assert.equal(r.warnings[0].code, "regel_telt_niet_op");
  assert.match(r.warnings[0].message, /950\.00/);
  assert.match(r.warnings[0].message, /1000\.00/);
  // En de regel blijft staan zoals het bestand hem schrijft. Hem "corrigeren" zou betekenen dat de
  // app kiest welk van de twee getallen de boekhouder bedoelde.
  assert.equal(r.rows[0].closing, 1000);
});

test("[KASBOEK-LEZEN] een ontbrekende dag wordt gevonden door de keten, niet door de regels", () => {
  // DE BELANGRIJKSTE. Beide regels tellen perfect op; er zit alleen een dag tussen die er niet is.
  // Een controle die alleen per regel rekent ziet hier niets — en juist zo verdwijnt een hele
  // week omzet uit een kasboek zonder dat één getal er verkeerd uitziet.
  const gat: Cell[][] = [KOP, dag(46113, 1000, 0, null, 100, 1100), dag(46115, 1450, 0, null, 50, 1500)];
  const r = parseKasboekSheet(gat)!;
  assert.equal(r.warnings.length, 1);
  assert.equal(r.warnings[0].code, "keten_breekt");
  assert.match(r.warnings[0].message, /1100\.00/);
  assert.match(r.warnings[0].message, /1450\.00/);
});

test("[KASBOEK-LEZEN] maandkoppen, lege regels en totalen worden stil overgeslagen", () => {
  // Een kasboek staat er vol mee. Elk daarvan als waarschuwing melden maakt de lijst onleesbaar,
  // en een lijst die niemand leest is hetzelfde als geen controle.
  const met: Cell[][] = [
    KOP,
    dag(46113, 1000, 0, null, 100, 1100),
    [null, "Mei", null, null, null, null, null, null, null],
    [null, null, null, null, null, null, null, null, null],
    dag(46114, 1100, 0, null, 200, 1300),
    [null, "TOTAAL", null, 0, null, null, 300, null, null],
  ];
  const r = parseKasboekSheet(met)!;
  assert.equal(r.rows.length, 2);
  assert.deepEqual(r.warnings, []);
});

test("[KASBOEK-LEZEN] een blad dat geen kasboek is, is geen kasboek", () => {
  // Null is informatie, geen fout: de aanroeper probeert de andere lezers en bewaart het bestand
  // anders ongelezen. Een grootboekoverzicht kent óók uitgaven en ontvangsten — het lopende SALDO
  // is wat een kasboek onderscheidt, en daarom eist de herkenning begin- én eindsaldo.
  const grootboek: Cell[][] = [["Datum", "Omschrijving", "Uitgaven", "Ontvangen"], ["2026-04-01", "x", 10, 20]];
  assert.equal(looksLikeKasboekSheet(grootboek), false);
  assert.equal(parseKasboekSheet(grootboek), null);

  // En de scherpe variant: een blad dat WÉL "Uitgaven" en "Ontvangsten" heet en géén lopend saldo
  // draagt. Dat is een dagstaat of een grootboekoverzicht, en het hoort naar de andere lezer. Zonder
  // deze regel zou de kasboeklezer hem inpikken en er begin- en eindsaldi bij verzinnen die er niet
  // staan — precies het soort saldo dat later niemand kan verklaren.
  const zonderSaldi: Cell[][] = [["Datum", "Uitgaven", "Omschrijving", "Ontvangsten"], ["2026-04-01", 10, "x", 20]];
  assert.equal(looksLikeKasboekSheet(zonderSaldi), false, "zonder lopend saldo is het geen kasboek");
  assert.equal(parseKasboekSheet(zonderSaldi), null);
});

test("[KASBOEK-LEZEN] datums komen binnen als serienummer én als tekst", () => {
  assert.equal(kasboekDate(46113), "2026-04-01");
  assert.equal(kasboekDate("2026-04-01"), "2026-04-01");
  assert.equal(kasboekDate("1-4-2026"), "2026-04-01", "de Nederlandse schrijfwijze is dag-maand-jaar");
  assert.equal(kasboekDate("01/04/2026"), "2026-04-01");
  assert.equal(kasboekDate("geen datum"), null);
  assert.equal(kasboekDate(null), null);
});

// ─── De vergelijking: het bestand naast de app ───────────────────────────────────────

const gelezen = (over: Partial<ReturnType<typeof parseKasboekSheet>> = {}) => ({
  rows: [], openingBalance: 1018.32, closingBalance: 3850.35,
  totalReceived: 25209.05, totalSpent: 22377.02, warnings: [],
  ...(over as object),
}) as NonNullable<ReturnType<typeof parseKasboekSheet>>;

test("[KASBOEK-LEZEN] het verschil wordt benoemd, en niemand wordt tot winnaar verklaard", () => {
  // De echte cijfers van het aangeleverde kwartaal, tegen wat de app op dat moment had.
  const c = compareKasboek(gelezen(), { received: 25209.05, spent: 1402.87, opening: -892.86 });
  assert.equal(c.receivedDelta, 0, "de ontvangstenkant klopte tot op de cent — daar hoort niets over gezegd te worden");
  assert.equal(c.spentDelta, 20974.15);
  assert.equal(c.openingDelta, 1911.18);
  assert.equal(c.findings.length, 2, "alleen de twee verschillen die er zijn");
  assert.match(c.findings[0], /20\.974,15 aan contante uitgaven die de app niet kent/);
  assert.match(c.findings[0], /kassaldo te hoog/, "en wat dat betekent, niet alleen dat er iets verschilt");
});

test("[KASBOEK-LEZEN] een negatieve lade houdt zijn minteken", () => {
  // De eerste versie van deze zin gebruikte Math.abs op BEIDE saldi, en las daardoor als een gewoon
  // verschil tussen twee normale bedragen — terwijl "de lade staat op −892,86" fysiek onmogelijk is
  // en het eerste is waar een kasadministratie op wordt afgewezen.
  const c = compareKasboek(gelezen(), { received: 25209.05, spent: 22377.02, opening: -892.86 });
  const zin = c.findings.find((f) => f.includes("openingsstand"))!;
  assert.match(zin, /−€ 892,86/, "het minteken is de helft van het bericht");
  assert.match(zin, /kan niet/, "…en het moet erbij staan dat dat onmogelijk is");
});

test("[KASBOEK-LEZEN] gelijk is gelijk, en dat wordt ook gezegd", () => {
  // Een vergelijking die alleen spreekt als er iets mis is, bewijst nooit dat ze gedraaid heeft.
  const c = compareKasboek(gelezen(), { received: 25209.05, spent: 22377.02, opening: 1018.32 });
  assert.deepEqual([c.receivedDelta, c.spentDelta, c.openingDelta], [0, 0, 0]);
  assert.equal(c.findings.length, 1);
  assert.match(c.findings[0], /zeggen hetzelfde/);
});

test("[KASBOEK-LEZEN] een openingsstand die de app niet kent is null, nooit nul", () => {
  const c = compareKasboek(gelezen(), { received: 25209.05, spent: 22377.02, opening: null });
  assert.equal(c.openingDelta, null, "niet gemeten is iets anders dan geen verschil");
  // En de geruststelling mag NIET beweren dat de openingsstand klopt: dat is niet gekeken.
  assert.match(c.findings[0], /konden we niet vergelijken/);
  assert.ok(!c.findings.some((f) => /openingsstand komen overeen/.test(f)));
});

// ─── De poort: gelezen, en met opzet niet geboekt ────────────────────────────────────

test("[KASBOEK-LEZEN] de uploaddeur herkent het kasboek en boekt er niets van", () => {
  // Twee dingen, en de tweede is de gevaarlijke.
  //
  // Herkennen: zonder dit blijft het bestand een dichtgeplakt document, zoals het bij een echte
  // klant ging — 91 dagen kasboek, bewaard en ongelezen.
  //
  // Niets boeken: de kasregels van de eigenaar bevatten al een deel van deze uitgaven, geboekt via
  // de facturen waarmee ze betaald zijn. Een import die de kolom 'Uitgaven' overneemt boekt die
  // dubbel, en een dubbele uitgave VERLAAGT het kassaldo — het valt pas op als de lade niet meer
  // klopt, maanden later. Deze poort valt zodra iemand hier een boekfunctie naast zet.
  const intake = readFileSync("src/app/api/intake/route.ts", "utf8");
  assert.match(intake, /plan\.kind === "kasboek" && plan\.kasboek/, "de uploaddeur leest het kasboek niet meer");
  assert.match(intake, /sheet_kind: "kasboek_review"/, "…of vertelt het resultaat niet terug aan het scherm");

  // Het blok mag geen enkele schrijver aanroepen. bookTurnoverRows/bookLedgerRows bestaan een paar
  // regels verderop, dus dit is geen theoretisch risico maar een kopieer-plak weg.
  // Vanaf het BLOK zelf, niet vanaf de eerste vermelding: 'plan.kind === "kasboek"' staat ook in
  // de regel die het bestandstype voor de opslag kiest, tientallen regels eerder — een slice
  // vanaf daar sleept het turnover-blok mee en betrapt dít blok op een schrijver die niet van hem
  // is. De eerste versie deed precies dat en faalde terecht.
  const blok = intake.slice(intake.indexOf('if (plan.kind === "kasboek" && plan.kasboek)'), intake.indexOf("── LEDGER:"));
  assert.ok(blok.length > 200, "het kasboek-blok is verdwenen");
  for (const schrijver of ["bookTurnoverRows", "bookLedgerRows", ".insert(", ".upsert("]) {
    assert.ok(!blok.includes(schrijver), `het kasboek-blok schrijft nu (${schrijver}) — dat boekt dubbel in de kas`);
  }
  // En het spoor moet zeggen dát er niets is geboekt, want een spoor dat een import suggereert
  // wordt later verkeerd gelezen.
  assert.match(blok, /kasboek\.imported_read_only/);

  // De herkenning zelf: op het lopende SALDO, want uitgaven en ontvangsten heeft een
  // grootboekoverzicht ook — en dat hoort naar de andere lezer te gaan.
  const detect = readFileSync("src/lib/detect-file.ts", "utf8");
  assert.match(detect, /\^beginsaldo\$[\s\S]{0,120}?\^eindsaldo\$/, "de herkenning eist begin- én eindsaldo niet meer");
  assert.match(detect, /if \(hasSaldi\) return "kasboek";/);
});

test("[KAS-TEKEN] een negatief bedrag is een correctie, geen uitgave", () => {
  // Het blad zoals een winkelier het schrijft: een teruggave van 50, met een minteken, in de kolom
  // Uitgaven. Math.abs() maakte daar 50 van die de lade UIT ging in plaats van 50 die erin kwam —
  // de fout is 100 en hij keert de richting om. Erger nog: matchKasboekDays vergelijkt file.spent
  // met wat de app die dag aan uitgaven kent en meldde dus 50 euro uitgave die "in BoekBrug
  // ontbreekt", terwijl er 50 euro binnenkwam.
  const blad: Cell[][] = [KOP, dag(46113, 100, -50, "Retour leverancier", 0, 150)];
  const r = parseKasboekSheet(blad)!;
  assert.equal(r.rows[0].received, 50, "de teruggave staat als ONTVANGST in de boeken");
  assert.equal(r.rows[0].spent, 0, "…en niet als uitgave");
  assert.equal(
    r.rows[0].opening + r.rows[0].received - r.rows[0].spent, r.rows[0].closing,
    "beginsaldo + ontvangsten − uitgaven = eindsaldo, met de bedragen zoals ze nu staan",
  );
  // De regel klopt na de verplaatsing, dus de rekenwaarschuwing hoort weg te blijven: een melding
  // naast een verkeerd getal was geen rem — de eigenaar keek naar zijn eigen blad, zag netjes −50
  // staan, en boekte het "ontbrekende" gat weg.
  assert.equal(r.warnings.some((w) => w.code === "regel_telt_niet_op"), false);
  // Maar hij hoort wél te weten hoe zijn blad gelezen is, juist omdat er niets aan te zien is.
  const gemeld = r.warnings.find((w) => w.code === "negatief_bedrag");
  assert.ok(gemeld, "een negatief bedrag wordt benoemd");
  assert.match(gemeld!.message, /50\.00/, "…met het bedrag erbij, zodat het na te kijken is");
  assert.match(gemeld!.message, /Uitgaven/, "…en de kolom waar het stond");
});

test("[KAS-TEKEN] een negatieve ontvangst is een uitgave — dezelfde vergelijking, andere kolom", () => {
  const blad: Cell[][] = [KOP, dag(46114, 150, 0, null, -30, 120)];
  const r = parseKasboekSheet(blad)!;
  assert.equal(r.rows[0].spent, 30);
  assert.equal(r.rows[0].received, 0);
  assert.equal(r.rows[0].opening + r.rows[0].received - r.rows[0].spent, r.rows[0].closing);
  assert.equal(r.warnings.some((w) => w.code === "regel_telt_niet_op"), false);
});

test("[KAS-TEKEN] een gewone dag verandert door niets van dit alles", () => {
  // De enige manier om te weten dat de reparatie de 99% niet raakt.
  const blad: Cell[][] = [KOP, dag(46115, 120, 60, "inkoop", 400, 460)];
  const r = parseKasboekSheet(blad)!;
  assert.equal(r.rows[0].spent, 60);
  assert.equal(r.rows[0].received, 400);
  assert.deepEqual(r.warnings, [], "een blad dat optelt mag niets te melden hebben");
});
