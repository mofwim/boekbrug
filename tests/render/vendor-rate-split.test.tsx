// tests/render/vendor-rate-split.test.tsx
// [TARIEF-GEHEUGEN] De uitsplitsing die niet gelezen is, en wat het scherm daarover mag zeggen.
//
// Productie: 44 facturen staan vast met excl. BTW 0 en BTW 0 tegenover een echt totaal — € 49.963
// aan inkoop zonder één cent voorbelasting. Het scherm bood daar één ding aan: "het bedrag excl.
// BTW hoort € 1.560,42 te zijn". Dat is het ontbrekende getal, teruggegeven als feit: 0 % is een
// geldig Nederlands tarief, dus reconcileBtw noemde het een reparatie en het kreeg dezelfde knop
// als twee voorstellen die wél ergens uit volgen. Eén tik en de factuur staat geboekt met nul BTW.
//
// Twee helften, en ze moeten allebei kloppen: die knop hoort weg, en wat de administratie zelf
// weet hoort ervoor in de plaats.

import test from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

const GEHOUDEN = {
  id: "s1", client_name: "Sumer Food B.V.", client_email: null, invoice_type: "factuur",
  // De vorm van alle 44: het totaal is gelezen, de uitsplitsing niet.
  total_ex_btw: 0, btw_amount: 0, total_inc_btw: 1560.42, amount_paid: 0,
  invoice_date: "2026-05-15", invoice_number: "2670428", source: "email",
  pdf_url: null, document_id: null, created_at: "2026-05-15T10:00:00Z",
  folder_id: null, folder_name: null, field_confidence: null,
};

async function render(extra: Record<string, unknown>) {
  const { ConfirmPaidModal } = await import("../../src/app/dashboard/incoming/IncomingInvoicesClient");
  const { ToastProvider } = await import("../../src/components/ui/Toast");
  const { DialogProvider } = await import("../../src/components/ui/Dialog");
  const { classifyImportHealth } = await import("../../src/lib/import-health");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const invoice = { ...GEHOUDEN, health: classifyImportHealth(GEHOUDEN as any) };
  return renderToStaticMarkup(
    React.createElement(DialogProvider, null,
      React.createElement(ToastProvider, null,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        React.createElement(ConfirmPaidModal as any, {
          invoice, onVerify() {}, onPay() {}, onCancel() {}, ...extra,
        }))),
  );
}

test("[TARIEF-GEHEUGEN] de nul-BTW 'reparatie' staat er niet meer", async () => {
  // Zonder tarief-geheugen, want deze helft mag niet van het voorstel afhangen: ook een
  // leverancier zonder geschiedenis hoort deze knop niet te krijgen.
  const html = await render({ vendorRate: undefined });
  assert.ok(!html.includes("Excl. BTW = "),
    "de app biedt weer aan om excl. BTW op het hele totaal te zetten — dat is het ontbrekende " +
      "getal als feit, en accepteren boekt een groothandelsfactuur met nul voorbelasting");
  assert.ok(!html.includes("Welk bedrag klopt"),
    "…en de vraag 'welk van deze twee klopt' hoort er niet te staan als er niets te kiezen is");
});

test("[TARIEF-GEHEUGEN] wat de leverancier altijd rekent, mét het bewijs erbij", async () => {
  // Sumer Food: twaalf eerdere facturen, elke keer 9,00 %.
  const html = await render({ vendorRate: { rate: 9, basedOn: 12 } });

  assert.match(html, /12 keer eerder 9%/,
    "de zin moet het BEWIJS noemen — een getal dat de eigenaar kan nalezen. 'wij denken 9%' is " +
      "een machine die om vertrouwen vraagt");
  // 1560,42 bij 9% → excl 1431,58 · BTW 128,84, en die twee tellen exact op tot het totaal.
  assert.ok(html.includes("1.431,58"), "het voorgestelde bedrag excl. BTW hoort op de knop te staan");
  assert.ok(html.includes("128,84"), "…en de BTW ernaast, zodat de eigenaar het narekent vóór hij tikt");
});

test("[TARIEF-GEHEUGEN] een gemengde leverancier krijgt niets — de tegenproef", async () => {
  // Enka Horeca mengt 9% en 21% op één factuur (9,45 · 10,07 · 11,10 · 11,89 gemeten). Dan is er
  // geen tarief, dus geen vendorRate, dus geen voorstel. Dit is de duurste groep in productie
  // (13 facturen, € 18.698) en juist daarom moet het scherm hier stil blijven: één tarief op een
  // gemengde factuur is een verkeerd getal in de btw-aangifte.
  const html = await render({ vendorRate: undefined });
  assert.ok(!html.includes("keer eerder"),
    "er staat een tariefvoorstel op een factuur waarvan de leverancier geen vast tarief heeft");
  // En de factuur blijft gewoon tegengehouden — er is niets stilletjes goedgekeurd.
  assert.match(html, /uitsplitsing/i,
    "het scherm hoort nog steeds te zeggen dat de uitsplitsing ontbreekt");
});

test("[TARIEF-GEHEUGEN] een uitsplitsing die WEL gelezen is maar niet klopt, krijgt de reconciliatie — niet het tarief", async () => {
  // Dit is de tak die de poort echt test. Excl € 1.000 en BTW € 90 tegenover een totaal van
  // € 1.150: gelezen, maar het telt niet op. Dan is er iets ECHTS te reconciliëren uit de bedragen
  // zelf, en dat is een sterker antwoord dan wat de leverancier meestal rekent — het gaat over
  // DEZE factuur. Zonder de splitWasRead-poort zou het tariefvoorstel hier ook verschijnen en zou
  // de eigenaar twee knoppen krijgen die elkaar tegenspreken.
  const { ConfirmPaidModal } = await import("../../src/app/dashboard/incoming/IncomingInvoicesClient");
  const { ToastProvider } = await import("../../src/components/ui/Toast");
  const { DialogProvider } = await import("../../src/components/ui/Dialog");
  const { classifyImportHealth } = await import("../../src/lib/import-health");
  const halfGelezen = { ...GEHOUDEN, total_ex_btw: 1000, btw_amount: 90, total_inc_btw: 1150 };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const invoice = { ...halfGelezen, health: classifyImportHealth(halfGelezen as any) };
  const html = renderToStaticMarkup(
    React.createElement(DialogProvider, null,
      React.createElement(ToastProvider, null,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        React.createElement(ConfirmPaidModal as any, {
          invoice, onVerify() {}, onPay() {}, onCancel() {},
          vendorRate: { rate: 9, basedOn: 12 },
        }))),
  );
  assert.ok(!html.includes("keer eerder"),
    "het tariefvoorstel verschijnt op een factuur waarvan de uitsplitsing wél gelezen is. Die " +
      "factuur heeft een eigen antwoord uit haar eigen bedragen; een tweede knop met een ander " +
      "getal ernaast maakt van een reparatie een keuze tussen twee beweringen");
  assert.ok(html.includes("Excl. BTW = ") || html.includes("BTW = "),
    "…en de echte reconciliatie hoort er dan juist wél te staan: deze factuur heeft haar eigen " +
      "antwoord, en dat is sterker dan wat de leverancier meestal doet");
});

test("[TARIEF-GEHEUGEN] een factuur die WEL is gelezen krijgt geen voorstel", async () => {
  // De poort staat op "de uitsplitsing is niet gelezen", niet op "er is een tarief bekend".
  // Anders zou het voorstel ook verschijnen op een factuur die zichzelf prima uitlegt.
  const { ConfirmPaidModal } = await import("../../src/app/dashboard/incoming/IncomingInvoicesClient");
  const { ToastProvider } = await import("../../src/components/ui/Toast");
  const { DialogProvider } = await import("../../src/components/ui/Dialog");
  const { classifyImportHealth } = await import("../../src/lib/import-health");
  const gelezen = { ...GEHOUDEN, total_ex_btw: 1431.58, btw_amount: 128.84 };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const invoice = { ...gelezen, health: classifyImportHealth(gelezen as any) };
  const html = renderToStaticMarkup(
    React.createElement(DialogProvider, null,
      React.createElement(ToastProvider, null,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        React.createElement(ConfirmPaidModal as any, {
          invoice, onVerify() {}, onPay() {}, onCancel() {},
          vendorRate: { rate: 9, basedOn: 12 },
        }))),
  );
  assert.ok(!html.includes("keer eerder"),
    "een factuur waarvan de uitsplitsing gewoon op het papier stond, hoort geen voorstel te krijgen");
});
