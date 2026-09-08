// tests/render/bank-lijn-factuur.test.tsx
// [REGEL-FACTUUR] The sheet renders both directions, and on a purchase without a document the
// rate chips are off and the reason is on screen.
import test from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import LijnFactuurSheet from "../../src/components/bank/LijnFactuurSheet";
import { translator } from "../../src/lib/i18n/t";

const t = translator("nl") as unknown as (k: string, v?: Record<string, string | number>) => string;
const noop = () => undefined;
const purchase = { transactionId: "t1", amount: -121, date: "2026-09-03", counterpartName: "Sligro", description: "Sligro Eindhoven", suggestedRate: 9, basedOn: 6 };

test("[REGEL-FACTUUR] a purchase: the document question, and no btw without it", () => {
  const html = renderToStaticMarkup(<LijnFactuurSheet prefill={purchase} t={t} onSubmit={noop} onClose={noop} />);
  assert.match(html, /Sligro/);
  assert.match(html, /€ 121,00/);
  assert.match(html, /Leverancier/);
  assert.match(html, /ergens anders/i, "the document question is asked");
  assert.match(html, /geen btw/i, "…and without it the reason is on screen");
  assert.match(html, /disabled=""[^>]*>21%|21%<\/button>/, "the chips render");
});

test("[REGEL-FACTUUR] a sale: no document question, btw is owed, the rate is live", () => {
  const html = renderToStaticMarkup(<LijnFactuurSheet prefill={{ ...purchase, amount: 242, counterpartName: "J. de Vries", suggestedRate: null, basedOn: 0 }} t={t} onSubmit={noop} onClose={noop} />);
  assert.match(html, /Klant/);
  assert.doesNotMatch(html, /ergens anders/i);
  assert.doesNotMatch(html, /Zonder document/);
});

test("[TAAL] the sheet holds no language of its own", () => {
  const ar = translator("ar") as unknown as (k: string, v?: Record<string, string | number>) => string;
  const html = renderToStaticMarkup(<LijnFactuurSheet prefill={purchase} t={ar} onSubmit={noop} onClose={noop} />);
  assert.doesNotMatch(html, /Leverancier|Boek deze regel|Annuleren/);
});

test("[LEVERANCIER-STANDAARD] a fixed rate seeds the chip and says it was set, not counted", async () => {
  const html = renderToStaticMarkup(
    // A sale, so the btw chips are live: on a purchase without a document the btw is off and no
    // rate sentence is shown at all — that rule stands above this one.
    <LijnFactuurSheet prefill={{ ...purchase, amount: 242, suggestedRate: 0, basedOn: 0, rateSource: "supplier" }} t={t} onSubmit={noop} onClose={noop} />,
  );
  assert.match(html, /het vaste tarief dat je voor deze leverancier hebt ingesteld/);
  assert.doesNotMatch(html, /eerdere facturen/, "no history is claimed for a set rate");
});
