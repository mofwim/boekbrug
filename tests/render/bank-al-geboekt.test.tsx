// tests/render/bank-al-geboekt.test.tsx
// [AL-GEBOEKT] De kiezer moet WEG zijn als de betaling een al afgeboekte factuur noemt.
//
// Dit is precies de klasse fout die tsc en next build niet zien: het scherm rendert prima, de
// kandidaten staan er, en alleen wie de bedragen náást elkaar legt merkt dat er niets klopt. De
// enige manier om het vast te houden is de kaart écht renderen met de rijen uit productie.

import test from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

const NOOP = () => {};

// De regel uit de schermafbeelding: € 797,86 naar HVO Meat, omschrijving USTD//2919045/, en drie
// voorgestelde facturen die geen van drieën dat bedrag hebben.
const HVO = {
  transactionId: "tx-1",
  date: "2026-08-17",
  amount: -797.86,
  counterpartName: "HVO Meat",
  description: "USTD//2919045/",
  reference: "2919045",
  outcome: "choice" as const,
  best: null,
  candidates: [
    { invoiceId: "i1", invoiceNumber: "3420623", amount: 2449.64, invoiceDate: "2026-08-21", confidence: 0.55, signals: ["date", "counterpart"], reason: "", nameSim: 1, nameIdentity: true, clientName: "HVO Meat", amountPaid: 0, remaining: 2449.64 },
    { invoiceId: "i2", invoiceNumber: "3219996", amount: 2822.27, invoiceDate: "2026-08-07", confidence: 0.54, signals: ["date", "counterpart"], reason: "", nameSim: 1, nameIdentity: true, clientName: "HVO Meat", amountPaid: 0, remaining: 2822.27 },
  ],
};

async function render(extra: Record<string, unknown>) {
  const { TxCard } = await import("../../src/app/dashboard/bank/BankClient");
  return renderToStaticMarkup(
    React.createElement(TxCard as never, {
      s: { ...HVO, ...extra },
      selectedInvoiceId: undefined, processing: false, isIgnoredTab: false,
      confirmedNumbers: [], batchEligible: false, batchChecked: false,
      onBatchToggle: NOOP, onSelect: NOOP, onConfirm: NOOP, onAttach: NOOP,
      onIgnore: NOOP, onRestore: NOOP, onOpenFile: NOOP, onCorrect: NOOP,
    } as never),
  );
}

test("[AL-GEBOEKT] zonder de vlag staat de kiezer er — anders meet deze test niets", () => {
  // De tegenproef hoort vóór de proef: als de kiezer er ook zónder quotedSettled niet staat, dan
  // bewijst "de kiezer is weg" hieronder niets.
  return render({ quotedSettled: null }).then((html) => {
    assert.match(html, /3420623/, "de kandidaat hoort er in de oude situatie gewoon te staan");
    assert.match(html, /Bevestig betaling/, "…met de knop die hem zou boeken");
    // [WAAROM-DEZE] En de kop is hier meteen de tweede helft van de melding: GEEN van deze
    // kandidaten matcht op bedrag, dus "Meerdere facturen passen bij deze betaling" was een
    // bewering die niet klopte. Deze assertie faalde toen die zin nog stond — precies wat een
    // tegenproef hoort te doen.
    assert.match(html, /Geen van deze facturen heeft dit bedrag/,
      "de kop belooft nog steeds een match die er niet is");
  });
});

test("[AL-GEBOEKT] met de vlag verdwijnen de kandidaten en komt de zin ervoor in de plaats", async () => {
  const html = await render({
    quotedSettled: {
      invoiceId: "paid-1", invoiceNumber: "2919045", amount: 797.86,
      clientName: "HVO Meat", amountAgrees: true, lockedByAccountant: false,
    },
  });

  // 1. De gevaarlijke helft: geen enkele andere factuur mag nog aanklikbaar zijn.
  assert.doesNotMatch(html, /3420623/,
    "factuur 3420623 (€ 2.449,64) staat nog op een kaart voor een betaling van € 797,86 — " +
    "bevestigen zet een openstaande factuur op betaald met geld dat er niet voor was");
  assert.doesNotMatch(html, /3219996/, "en de tweede evenmin");

  // 2. De eerlijke helft: zeg wát er dan wel aan de hand is, met naam en nummer.
  assert.match(html, /2919045/, "de factuur die de betaling noemt hoort er te staan");
  assert.match(html, /al is afgeboekt|already booked/,
    "en de kaart moet zeggen dat hij al afgeboekt is");
  assert.match(html, /niet twee keer is betaald/,
    "en waar de ondernemer dan wél naar moet kijken");
});

test("[AL-GEBOEKT] een ander bedrag krijgt een andere zin dan een gelijk bedrag", async () => {
  const gelijk = await render({
    quotedSettled: { invoiceId: "p", invoiceNumber: "2919045", amount: 797.86, clientName: "HVO Meat", amountAgrees: true, lockedByAccountant: false },
  });
  const anders = await render({
    quotedSettled: { invoiceId: "p", invoiceNumber: "2919045", amount: 500, clientName: "HVO Meat", amountAgrees: false, lockedByAccountant: false },
  });
  assert.match(gelijk, /tot op de cent/);
  assert.match(anders, /deelbetaling|tweede termijn/);
  assert.notEqual(gelijk, anders, "twee verschillende situaties, twee verschillende zinnen");
});

test("[AL-GEBOEKT] een door de boekhouder verwerkte factuur stuurt naar de boekhouder", async () => {
  const html = await render({
    quotedSettled: { invoiceId: "p", invoiceNumber: "600001", amount: 250, clientName: "X", amountAgrees: true, lockedByAccountant: true },
  });
  assert.match(html, /boekhouder/, "verwerkt betekent: eerst overleggen, niet zelf iets omzetten");
});
