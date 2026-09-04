// tests/render/btw-soort.test.tsx
// [GEEN-BTW-SOORT] De waarschuwing die op het scherm hoort, en de 64 leveranciers waar hij
// NIET hoort te staan.
//
// Aanleiding: factuur 142257742 van Coöperatie Univé Zuid-Nederland, € 195,28 + € 41,01 = € 236,29,
// status 'received'. Netjes gelezen, netjes opgeteld, langs elke poort in deze app — en die
// € 41,01 is assurantiebelasting. Ook 21%, staat op precies de plek waar BTW zou staan, en is niet
// terug te vragen.

import test from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

const UNIVE = {
  id: "u1", client_name: "Coöperatie Univé Zuid-Nederland U.A.", client_email: null,
  invoice_type: "factuur", total_ex_btw: 195.28, btw_amount: 41.01, total_inc_btw: 236.29,
  amount_paid: 0, invoice_date: "2026-08-14", invoice_number: "142257742", source: "email",
  pdf_url: null, document_id: null, created_at: "2026-08-14T10:00:00Z",
  folder_id: null, folder_name: null, field_confidence: null,
};

async function render(over: Record<string, unknown>) {
  const { ConfirmPaidModal } = await import("../../src/app/dashboard/incoming/IncomingInvoicesClient");
  const { ToastProvider } = await import("../../src/components/ui/Toast");
  const { DialogProvider } = await import("../../src/components/ui/Dialog");
  const { classifyImportHealth } = await import("../../src/lib/import-health");
  const base = { ...UNIVE, ...over };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const invoice = { ...base, health: classifyImportHealth(base as any) };
  return renderToStaticMarkup(
    React.createElement(DialogProvider, null,
      React.createElement(ToastProvider, null,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        React.createElement(ConfirmPaidModal as any, {
          invoice, onVerify() {}, onPay() {}, onCancel() {},
        }))),
  );
}

test("[GEEN-BTW-SOORT] de verzekeringsnota wordt genoemd, mét het wetsartikel", async () => {
  const html = await render({});
  assert.match(html, /assurantiebelasting/,
    "de eigenaar moet het WOORD zien — 'controleer dit bedrag' zonder de reden is een taak zonder " +
      "antwoord, en hij kan niet weten dat 21% hier een andere belasting is");
  assert.match(html, /niet terugvragen/, "…en wat het gevolg is");
  assert.match(html, /11-1-k/,
    "het wetsartikel hoort erbij, zodat een boekhouder de bewering kan controleren in plaats van " +
      "hem te moeten geloven");
});

test("[GEEN-BTW-SOORT] zonder teruggevraagde BTW is er niets te melden", async () => {
  // Dezelfde nota, correct geboekt op € 0 BTW. Een waarschuwing hier zou over niets gaan.
  const html = await render({ btw_amount: 0, total_ex_btw: 236.29 });
  assert.ok(!html.includes("assurantiebelasting"),
    "een melding op een factuur die al goed staat, is precies hoe een melding ophoudt gelezen te worden");
});

test("[GEEN-BTW-SOORT] de echte leveranciers van deze eigenaar krijgen niets", async () => {
  // De tegenproef die telt. Twee zitten er met opzet bij: 'Enka Horeca B.V.' is een GROOTHANDEL
  // (16 geboekte facturen met volledig aftrekbare BTW) en 'HorecaRama BV' verkoopt apparatuur.
  // Zou het woord 'horeca' de melding aanzetten, dan stond hij op zeventien goede facturen.
  for (const naam of [
    "Enka Horeca B.V.", "HorecaRama BV", "GROOTHANDEL M.H. BAL V.O.F.", "HVO Meat",
    "W.KETELS & ZN EIERHANDEL", "Trimex International", "KPN B.V.", "ONS IT",
    "BAKKERIJ SAADA", "Recycling Continue", "Rentokil Initial B.V.", "Mollie B.V.",
  ]) {
    const html = await render({ client_name: naam, id: `x-${naam}` });
    assert.ok(!html.includes("assurantiebelasting") && !html.includes("mag je niet terugvragen"),
      `${naam} kreeg een waarschuwing die er niet hoort te staan`);
  }
});

test("[GEEN-BTW-SOORT] huur VRAAGT, en beschuldigt niet", async () => {
  // De enige familie waar 21% heel vaak gewoon klopt: huurder en verhuurder mogen kiezen voor
  // btw-belaste verhuur. Een oordeel zou hier een echte aftrek weggooien.
  const html = await render({ client_name: "Atalantix Vastgoed CV", total_ex_btw: 2000, btw_amount: 420, total_inc_btw: 2420 });
  assert.match(html, /kunnen kiezen voor/, "de zin hoort de mogelijkheid te noemen");
  assert.match(html, /huurcontract/, "…en te wijzen waar het antwoord staat");
  assert.ok(!html.includes("mag je niet terugvragen"),
    "huur mag nooit botweg als niet-aftrekbaar worden neergezet");
});
