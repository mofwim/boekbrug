// tests/render/bank-som-klopt.test.tsx
// [SOM-KLOPT] Eén betaling, drie genoemde facturen, en de som die klopt.
//
// De regel uit de melding, met de echte productiecijfers: € 466,30 naar Al-Malika Bakkerij,
// omschrijving "2601695, 2601826, 2601291". Die drie facturen zijn 162,19 + 148,68 + 155,43 =
// 466,30 en stonden alle drie al betaald. Het scherm zei "Geen factuur gevonden voor deze
// transactie", zette er "Facturen koppelen (3)" onder, en daaronder een kaart over ÉÉN van de drie
// met de mededeling dat het bedrag niet overeenkwam.
//
// Waarom dit een RENDER-test moet zijn en geen unit-test: bank-quoted-invoice.test.ts bewijst dat
// de som klopt, en dat bewees het al terwijl het scherm nog steeds de kiezer toonde. De fout zat in
// de vraag WIE die uitkomst leest. Alleen het echte scherm kan dat laten zien.

import test from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

const NOOP = () => {};

const DRIE = {
  settled: [
    { invoiceId: "a", invoiceNumber: "2601695", amount: 162.19, clientName: "Al-Malika Bakkerij B.V.", amountAgrees: false, lockedByAccountant: false },
    { invoiceId: "b", invoiceNumber: "2601826", amount: 148.68, clientName: "Al-Malika Bakkerij B.V.", amountAgrees: false, lockedByAccountant: false },
    { invoiceId: "c", invoiceNumber: "2601291", amount: 155.43, clientName: "Al-Malika Bakkerij B.V.", amountAgrees: false, lockedByAccountant: false },
  ],
  open: [] as never[],
  total: 466.3,
  coversPayment: true,
  unknownNumbers: [] as string[],
  fullySettled: true,
};

const AL_MALIKA = {
  transactionId: "tx-am",
  date: "2026-08-16",
  amount: -466.3,
  counterpartName: "Al-Malika Bakkerij B.V.",
  description: "2601695, 2601826, 2601291",
  reference: "2601695, 2601826, 2601291",
  outcome: "choice" as const,
  best: null,
  candidates: [
    { invoiceId: "x1", invoiceNumber: "2602010", amount: 311.5, invoiceDate: "2026-08-02", confidence: 0.5, signals: ["counterpart"], reason: "", nameSim: 1, nameIdentity: true, clientName: "Al-Malika Bakkerij B.V.", amountPaid: 0, remaining: 311.5 },
  ],
};

async function render(extra: Record<string, unknown>) {
  const { TxCard } = await import("../../src/app/dashboard/bank/BankClient");
  return renderToStaticMarkup(
    React.createElement(TxCard as never, {
      s: { ...AL_MALIKA, ...extra },
      selectedInvoiceId: undefined, processing: false, isIgnoredTab: false,
      confirmedNumbers: [], batchEligible: false, batchChecked: false,
      onBatchToggle: NOOP, onSelect: NOOP, onConfirm: NOOP, onAttach: NOOP,
      onIgnore: NOOP, onRestore: NOOP, onOpenFile: NOOP, onCorrect: NOOP,
    } as never),
  );
}

test("[SOM-KLOPT] de tegenproef: zonder de som staat er wél iets te koppelen", async () => {
  // Hoort vóór de proef. Verdwijnt de kiezer ook zonder quotedSet, dan bewijst "hij is weg"
  // hieronder niets — dezelfde volgorde als in bank-al-geboekt.test.tsx, en om dezelfde reden.
  const html = await render({ quotedSet: null, quotedSettled: null });
  assert.match(html, /2602010/, "de losse kandidaat hoort er in de oude situatie te staan");
});

test("[SOM-KLOPT] drie genoemde facturen die optellen: geen kiezer, wél de optelsom", async () => {
  const html = await render({ quotedSet: DRIE, quotedSettled: null });

  // 1. Alle drie staan er, met hun eigen bedrag — een totaal zonder de posten erboven is een
  //    bewering en geen bewijs; de ondernemer moet het kunnen narekenen.
  for (const [nummer, bedrag] of [["2601695", "162,19"], ["2601826", "148,68"], ["2601291", "155,43"]]) {
    assert.ok(html.includes(nummer), `factuur ${nummer} hoort op de kaart te staan`);
    assert.ok(html.includes(bedrag), `het bedrag ${bedrag} van ${nummer} hoort erbij te staan`);
  }

  // 2. De som staat er, en zegt dat hij klopt.
  assert.ok(html.includes("466,30"), "de optelsom hoort op de kaart te staan");
  assert.match(html, /precies het bedrag van deze betaling/,
    "de kaart moet zeggen dat de som klopt — anders leest hij als 'bijna', en bijna is op een " +
      "geldscherm geen antwoord");

  // 3. En er valt niets meer te koppelen: elke kandidaat hieronder is een ANDERE, nog openstaande
  //    factuur, en die bevestigen zou hem als betaald wegzetten met geld dat er niet voor was.
  assert.ok(!html.includes("2602010"),
    "de kiezer staat er nog — bevestigen zou een andere, nog open factuur als betaald wegzetten");
});

test("[SOM-KLOPT] telt de som NIET op, dan zegt de kaart dat en blijft koppelen mogelijk", async () => {
  // Het gewone halve geval: twee van de drie ingeboekt. Dit mag nooit als 'afgehandeld' lezen.
  const half = {
    settled: DRIE.settled.slice(0, 2),
    open: [] as never[],
    total: 310.87,
    coversPayment: false,
    unknownNumbers: ["2601291"],
    fullySettled: false,
  };
  const html = await render({ quotedSet: half, quotedSettled: null });
  assert.ok(html.includes("310,87"), "de som die er wél is hoort genoemd te worden");
  assert.ok(html.includes("466,30"), "…naast het bedrag van de betaling, zodat het verschil zichtbaar is");
  assert.match(html, /2601291/, "het ontbrekende nummer moet met naam genoemd worden");
  assert.match(html, /staat nog niet in je administratie/,
    "'voeg hem toe' zonder te zeggen wélke is geen opdracht");
  assert.ok(html.includes("2602010"),
    "de som klopt niet, dus er valt hier nog wél iets te kiezen — deze kaart mag de kiezer niet " +
      "wegnemen op een betaling die maar half verklaard is");
});

test("[SOM-KLOPT] een genoemde factuur die nog OPENSTAAT houdt zijn kiezer", async () => {
  // De fout die deze test uit het model heeft geduwd. Het eerste model kende maar twee bakjes —
  // "afgeboekt" en "niet gevonden" — en een genoemde factuur die gewoon nog openstond viel in het
  // tweede. Dan zegt de kaart "staat nog niet in je administratie" over een factuur die er wél is,
  // én verdwijnt de knop waarmee je hem koppelt. Twee fouten in één zin, en allebei van dezelfde
  // soort als de melding waar deze taak mee begon.
  const metOpen = {
    settled: DRIE.settled.slice(0, 2),
    open: [{ invoiceId: "c", invoiceNumber: "2601291", amount: 155.43, clientName: "Al-Malika Bakkerij B.V.", amountAgrees: false, lockedByAccountant: false }],
    total: 466.3,
    coversPayment: true,
    unknownNumbers: [] as string[],
    fullySettled: false,
  };
  const html = await render({ quotedSet: metOpen, quotedSettled: null });

  assert.ok(!html.includes("staat nog niet in je administratie"),
    "een factuur die openstaat 'ontbreekt' niet — dat stuurt de ondernemer naar de schoenendoos " +
      "voor papier dat hij al heeft");
  assert.match(html, /nog open/, "de kaart hoort te zeggen dat die ene nog gekoppeld moet worden");
  assert.ok(!html.includes("Deze betaling hoort bij facturen die al zijn afgeboekt"),
    "de kop mag niet 'al afgeboekt' zeggen zolang er één van de genoemde facturen openstaat");
  assert.ok(html.includes("2602010"),
    "en de kiezer moet blijven staan — die openstaande factuur moet nog gekoppeld kunnen worden");
});

// ── [CREDIT-TEKEN] De creditnota die als rekening werd opgeteld ────────────────────────────────
//
// Aardappelgroothandel Altena, afschrijving € 170,27, omschrijving "2034 26700644 26700603".
// 26700644 is € 306,27 en 26700603 is een creditnota van € 136,00 — samen precies de betaling. Het
// scherm zei "Samen € 442,27, en deze betaling is € 170,27", drukte de creditnota af als € 136,00
// zonder minteken, en zette daaronder in oranje dat 26700644 niet in de administratie staat —
// direct ónder een regel waarop diezelfde factuur met haar bedrag stond.
//
// Waarom dit hier hoort en niet alleen in de unit-test: de unit-test bewijst de SOM. Wat zij niet
// kan zien is of het scherm de post afdrukt met het teken waarmee zij is opgeteld, en of de twee
// panelen van deze ene kaart elkaar nog tegenspreken.

const ALTENA_SET = {
  settled: [
    { invoiceId: "f", invoiceNumber: "26700644", amount: 306.27, clientName: "Aardappelgroothandel Altena B.V.", amountAgrees: false, lockedByAccountant: false, isCredit: false },
  ],
  open: [
    { invoiceId: "c1", invoiceNumber: "26700603", amount: -136, clientName: "Aardappelgroothandel Altena B.V.", amountAgrees: false, lockedByAccountant: false, isCredit: true },
  ],
  total: 170.27,
  coversPayment: true,
  unknownNumbers: [] as string[],
  fullySettled: false,
  totalUnknownReason: null,
};

const ALTENA = {
  transactionId: "tx-altena",
  date: "2026-03-18",
  amount: -170.27,
  counterpartName: "Aardappelgroothandel Altena Bv",
  description: "2034 26700644 26700603",
  reference: null,
  outcome: "choice" as const,
  best: null,
  candidates: [] as never[],
};

test("[CREDIT-TEKEN] de creditnota staat op de kaart MET haar minteken", async () => {
  const html = renderToStaticMarkup(
    React.createElement((await import("../../src/app/dashboard/bank/BankClient")).TxCard as never, {
      s: { ...ALTENA, quotedSet: ALTENA_SET, quotedSettled: null },
      selectedInvoiceId: undefined, processing: false, isIgnoredTab: false,
      confirmedNumbers: [], batchEligible: false, batchChecked: false,
      onBatchToggle: NOOP, onSelect: NOOP, onConfirm: NOOP, onAttach: NOOP,
      onIgnore: NOOP, onRestore: NOOP, onOpenFile: NOOP, onCorrect: NOOP,
    } as never),
  );

  // Het teken zelf. Zonder minteken leest een document dat geld TERUGGEEFT als een rekening, en de
  // optelsom eronder is met de hand niet meer na te rekenen: 306,27 + 136,00 is niet 170,27.
  assert.match(html, /[-−]136,00/,
    "de creditnota staat zonder minteken op de kaart — precies de melding waar dit mee begon");
  assert.ok(html.includes("306,27"), "de factuur hoort er met haar eigen bedrag bij te staan");
  assert.ok(html.includes("170,27"), "en de som die er werkelijk uitkomt");
  assert.ok(!html.includes("442,27"),
    "442,27 is de som mét de creditnota erbij opgeteld — de fout zelf, terug op het scherm");
  assert.match(html, /precies het bedrag van deze betaling/,
    "306,27 − 136,00 IS deze betaling; de kaart moet dat zeggen in plaats van om een factuur te vragen");
  assert.ok(!html.includes("staat niet in je administratie"),
    "geen enkele van deze twee ontbreekt: ze staan allebei op deze kaart");
});

test("[CREDIT-TEKEN] tegenproef: een gewone factuur wordt NIET van een minteken voorzien", async () => {
  // Zonder deze test slaagt de test hierboven ook als het scherm elk bedrag negatief afdrukt.
  // Twee posten, want met één regel toont de kaart zichzelf niet — dan bewijst "geen minteken" niets.
  const geenCredit = {
    ...ALTENA_SET,
    open: [{ ...ALTENA_SET.open[0], invoiceNumber: "26700605", amount: 136, isCredit: false }],
    total: 442.27, coversPayment: false,
  };
  const html = renderToStaticMarkup(
    React.createElement((await import("../../src/app/dashboard/bank/BankClient")).TxCard as never, {
      s: { ...ALTENA, quotedSet: geenCredit, quotedSettled: null },
      selectedInvoiceId: undefined, processing: false, isIgnoredTab: false,
      confirmedNumbers: [], batchEligible: false, batchChecked: false,
      onBatchToggle: NOOP, onSelect: NOOP, onConfirm: NOOP, onAttach: NOOP,
      onIgnore: NOOP, onRestore: NOOP, onOpenFile: NOOP, onCorrect: NOOP,
    } as never),
  );
  assert.ok(html.includes("306,27"), "de factuur staat er");
  assert.doesNotMatch(html, /[-−]306,27|[-−]136,00/,
    "een gewone factuur mag geen minteken krijgen — dan zegt het teken niets meer");
});

test("[NO-SILENT-EMPTY] een onleesbaar bedrag zegt DAT er niets is opgeteld", async () => {
  const html = renderToStaticMarkup(
    React.createElement((await import("../../src/app/dashboard/bank/BankClient")).TxCard as never, {
      s: {
        ...ALTENA,
        quotedSet: { ...ALTENA_SET, total: null, coversPayment: false, totalUnknownReason: "amount" },
        quotedSettled: null,
      },
      selectedInvoiceId: undefined, processing: false, isIgnoredTab: false,
      confirmedNumbers: [], batchEligible: false, batchChecked: false,
      onBatchToggle: NOOP, onSelect: NOOP, onConfirm: NOOP, onAttach: NOOP,
      onIgnore: NOOP, onRestore: NOOP, onOpenFile: NOOP, onCorrect: NOOP,
    } as never),
  );
  assert.match(html, /is het bedrag niet gelezen/,
    "hier stond een zin over andere facturen van deze leverancier — een antwoord op een vraag die " +
      "niemand had gesteld, terwijl de gestelde vraag onbeantwoord bleef");
  assert.ok(!html.includes("precies het bedrag van deze betaling"),
    "zonder som mag er niets over kloppen beweerd worden");
});

test("[CREDIT-TEKEN] de kaart noemt geen factuur ontbrekend die er zelf op staat", async () => {
  // De tweede helft van dezelfde schermafbeelding. De kandidaat is de creditnota 26700603 (open,
  // 8 cijfers); haar lengte is het anker waarmee namedInvoiceNumbers 26700644 als een genoemde
  // factuur herkent. Die factuur staat betaald in de administratie — quotedSet heeft haar zelfs
  // opgezocht en met bedrag afgedrukt — maar stond niet in de lijst waaruit de zin werd gebouwd.
  // Resultaat: "€ 306,27" en "staat niet in je administratie" over hetzelfde nummer, vier regels
  // uit elkaar. Op een geldscherm is dat het moment waarop een boekhouder ophoudt met kijken.
  const html = renderToStaticMarkup(
    React.createElement((await import("../../src/app/dashboard/bank/BankClient")).TxCard as never, {
      s: {
        ...ALTENA,
        quotedSet: ALTENA_SET,
        quotedSettled: null,
        candidates: [
          { invoiceId: "c1", invoiceNumber: "26700603", amount: -136, invoiceDate: "2026-02-26", confidence: 0.5, signals: ["counterpart"], reason: "", nameSim: 1, nameIdentity: true, clientName: "Aardappelgroothandel Altena B.V.", amountPaid: 0, remaining: -136 },
        ],
      },
      selectedInvoiceId: undefined, processing: false, isIgnoredTab: false,
      confirmedNumbers: [], batchEligible: false, batchChecked: false,
      onBatchToggle: NOOP, onSelect: NOOP, onConfirm: NOOP, onAttach: NOOP,
      onIgnore: NOOP, onRestore: NOOP, onOpenFile: NOOP, onCorrect: NOOP,
    } as never),
  );
  assert.ok(html.includes("306,27"), "de factuur staat met haar bedrag op de kaart");
  assert.ok(!html.includes("26700644, en die staat niet in je administratie"),
    "de kaart drukt 26700644 af én zegt dat we hem niet hebben — twee panelen van één kaart die " +
      "elkaar tegenspreken over dezelfde factuur");
});

test("[PAYMENT-NAMES-MISSING] tegenproef: een écht ontbrekende factuur wordt nog steeds genoemd", async () => {
  // Zonder deze test slaagt de test hierboven ook als de zin nooit meer verschijnt — en dan is de
  // deadlock terug waar [PAYMENT-NAMES-MISSING] voor bestaat: het hele bedrag op de ene factuur.
  const html = renderToStaticMarkup(
    React.createElement((await import("../../src/app/dashboard/bank/BankClient")).TxCard as never, {
      s: {
        ...ALTENA,
        description: "2034 26700644 26700603",
        // quotedSet kent alleen de creditnota; 26700644 is nergens in de administratie.
        quotedSet: { ...ALTENA_SET, settled: [], total: -136, coversPayment: false },
        quotedSettled: null,
        candidates: [
          { invoiceId: "c1", invoiceNumber: "26700603", amount: -136, invoiceDate: "2026-02-26", confidence: 0.5, signals: ["counterpart"], reason: "", nameSim: 1, nameIdentity: true, clientName: "Aardappelgroothandel Altena B.V.", amountPaid: 0, remaining: -136 },
        ],
      },
      selectedInvoiceId: undefined, processing: false, isIgnoredTab: false,
      confirmedNumbers: [], batchEligible: false, batchChecked: false,
      onBatchToggle: NOOP, onSelect: NOOP, onConfirm: NOOP, onAttach: NOOP,
      onIgnore: NOOP, onRestore: NOOP, onOpenFile: NOOP, onCorrect: NOOP,
    } as never),
  );
  assert.match(html, /26700644, en die staat niet in je administratie/,
    "een factuur die de betaling noemt en die we werkelijk niet hebben moet genoemd blijven — " +
      "anders boekt de ondernemer het hele bedrag op de factuur die hij wél heeft");
});

// ── [SLOT-WAAR] Eén rij per factuurnummer, en de lezing is geen grens ──────────────────────────
//
// Gemeld: ipekci slachterij, afschrijving € 3.624,25, kenmerk "202604231", omschrijving "Deel twee
// factuur 202604231". De kaart zei "2 facturen" en de knop "Facturen koppelen (2)" — voor een
// betaling die er ÉÉN noemt, twee keer. In de administratie staat een tweede bankregel van exact
// hetzelfde bedrag met "Deel 1 helft": één factuur, in twee helften betaald.

const IPEKCI = {
  transactionId: "tx-ipekci",
  date: "2026-06-09",
  amount: -3624.25,
  counterpartName: "ipekci slachterij bv",
  description: "Deel twee factuur 202604231",
  reference: "202604231",
  // Zoals op de melding: "Geen factuur gevonden voor deze transactie". Dat is de tak waarin de
  // knoppen uit de schermafbeelding staan — "Facturen koppelen (N)" en "Verdelen over facturen".
  outcome: "none" as const,
  best: null,
  candidates: [] as never[],
  quotedSet: null,
  quotedSettled: null,
};

async function ipekciKaart(extra: Record<string, unknown> = {}) {
  const { TxCard } = await import("../../src/app/dashboard/bank/BankClient");
  return renderToStaticMarkup(
    React.createElement(TxCard as never, {
      s: { ...IPEKCI, ...extra },
      selectedInvoiceId: undefined, processing: false, isIgnoredTab: false,
      confirmedNumbers: [], batchEligible: false, batchChecked: false,
      onBatchToggle: NOOP, onSelect: NOOP, onConfirm: NOOP, onAttach: NOOP,
      onIgnore: NOOP, onRestore: NOOP, onOpenFile: NOOP, onCorrect: NOOP,
    } as never),
  );
}

test("[SLOT-WAAR] één genoemd factuurnummer is één factuur, hoe vaak de bank het ook schrijft", async () => {
  const html = await ipekciKaart();
  assert.ok(html.includes("202604231"), "het nummer hoort op de kaart te staan");
  assert.ok(!html.includes("2 facturen"),
    "de kaart telt hetzelfde nummer twee keer — één keer omdat de betaling het NOEMT en één keer " +
      "omdat het in het bankkenmerk staat");
  assert.ok(!html.includes("Facturen koppelen (2)"),
    "en de knop belooft twee facturen te koppelen waar er één is");
  // Het nummer staat er precies één keer als rij — twee rijen delen anders ook nog dezelfde key.
  assert.equal((html.match(/202604231/g) ?? []).length, 1,
    "het factuurnummer staat meer dan één keer op de kaart");
});

test("[SLOT-WAAR] tegenproef: een betaling die er écht twee noemt toont er twee", async () => {
  // Zonder deze test slaagt de test hierboven ook als het scherm nooit meer dan één rij toont — en
  // dan is de bundelweergave stuk, wat een veel duurdere fout is dan de gemelde.
  const html = await ipekciKaart({
    description: "factuur 202604231 en factuur 202604232",
    reference: "202604231, 202604232",
  });
  assert.ok(html.includes("202604231") && html.includes("202604232"),
    "een echte bundel hoort beide nummers te tonen");
  assert.match(html, /2 facturen|Facturen koppelen \(2\)/,
    "…en zich als bundel te gedragen");
});

test("[SLOT-WAAR] de lezing is geen grens — ook op de kaart uit de melding", async () => {
  // De vraag van de eigenaar: "en als er méér facturen bij horen dan jullie hebben gelezen?"
  //
  // Op DEZE kaart (één genoemd nummer, dus geen slotweergave) is het antwoord er al: het
  // verdeelscherm kent onze lezing niet als grens. Dat vast te leggen is de helft die telt — het is
  // de weg die de melding zocht, en hij mag niet stilletjes van deze kaart verdwijnen.
  const html = await ipekciKaart();
  assert.match(html, /Verdelen over facturen/,
    "de weg voorbij onze lezing staat niet op de kaart — dan is ons aantal wél een grens");
  assert.match(html, /\/dashboard\/bank\/verdelen\/tx-ipekci/,
    "…en die weg wijst naar het verdeelscherm van déze regel");
});

test("[SLOT-WAAR] en in de slotweergave staat het met zoveel woorden", async () => {
  // Daar is de grens echt voelbaar: een lijst met precies de nummers die wij lazen, elk met een
  // knop, en niets dat zegt wat je doet als er een factuur bij hoort die er niet in staat.
  const html = await ipekciKaart({
    description: "factuur 202604231 en factuur 202604232",
    reference: "202604231, 202604232",
  });
  assert.match(html, /Horen er meer facturen bij deze betaling/,
    "de slotweergave eindigt bij ons aantal zonder te zeggen dat er een weg voorbij is");
  assert.match(html, /Zelf over facturen verdelen/, "…met de handeling erbij, niet alleen de vraag");
});
