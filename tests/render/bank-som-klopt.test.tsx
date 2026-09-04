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
