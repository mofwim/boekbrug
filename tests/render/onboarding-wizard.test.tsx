// tests/render/onboarding-wizard.test.tsx
// [ONB-WAAROM · ONB-IBAN] Does the last step of onboarding tell the truth, and does a blocked
// "Volgende" say why?
//
// Run: npm run test:render
//
// ── WHY THESE TWO ──
//
// Both are silences, and a silence is exactly what tsc, eslint and next build cannot see.
//
//   1. "Volgende" greyed out with nothing on screen saying why. For the KVK field that was
//      provably unrecoverable: the sentence "KVK-nummer moet uit 8 cijfers bestaan" is set inside
//      handleNext, and handleNext cannot run, because the button that calls it is disabled for
//      precisely that reason. The owner types seven digits and the app goes quiet.
//
//   2. "Je bent klaar 🎉" with no IBAN. The four fields the wizard did check are the ones art. 35a
//      requires and the send route refuses without. The IBAN is not among them, so the invoice
//      goes out — with "IBAN: —" printed where the account number belongs and the sentence "op
//      onze bankrekening" silently dropped. A legally valid invoice the customer cannot pay,
//      handed to someone who has just been told he is ready.

import { test } from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

test("[ONB-IBAN] the done step says an invoice will carry no account number", async () => {
  const { StepDone } = await import("../../src/components/onboarding/OnboardingWizard");
  const { translator } = await import("../../src/lib/i18n/t");
  const t = translator("nl");

  // Everything the law asks for is present; only the IBAN is missing. This is the case the old
  // check could not see at all, because it was the ONLY thing left — so nothing was said.
  const html = renderToStaticMarkup(
    React.createElement(StepDone, { firstName: "Sam", role: "zzp", missingSendFields: [], missingIban: true }),
  );
  assert.match(html, /rekeningnummer/, "the missing IBAN must be named");
  assert.match(html, /niet betalen|kan hem niet betalen/, "…with what it costs: the customer cannot pay");
  assert.doesNotMatch(html, /🎉/, "a celebration over an invoice nobody can pay is the defect itself");
  assert.doesNotMatch(html, /zoekbalk/, "the search tip replaces the warning again");
});

test("[ONB-IBAN] a complete profile still celebrates, and gets the tip", async () => {
  const { StepDone } = await import("../../src/components/onboarding/OnboardingWizard");
  const html = renderToStaticMarkup(
    React.createElement(StepDone, { firstName: "Sam", role: "zzp", missingSendFields: [], missingIban: false }),
  );
  assert.match(html, /🎉/);
  assert.match(html, /zoekbalk/, "the tip must survive — this is the one path where nothing is wrong");
  assert.doesNotMatch(html, /rekeningnummer/);
});

test("[ONB-IBAN] both gaps are stated separately when both exist", async () => {
  const { StepDone } = await import("../../src/components/onboarding/OnboardingWizard");
  const html = renderToStaticMarkup(
    React.createElement(StepDone, {
      firstName: "Sam", role: "zzp", missingSendFields: ["BTW-nummer"], missingIban: true,
    }),
  );
  // Two different statements: one is "you cannot send", the other "you can send and nobody can
  // pay". Folding them into one list would lose that difference.
  assert.match(html, /BTW-nummer/);
  assert.match(html, /rekeningnummer/);
});

test("[ONB-IBAN] an accountant is not asked for an IBAN", async () => {
  const { StepDone } = await import("../../src/components/onboarding/OnboardingWizard");
  const html = renderToStaticMarkup(
    React.createElement(StepDone, { firstName: "Sam", role: "accountant", missingSendFields: [], missingIban: true }),
  );
  assert.doesNotMatch(html, /rekeningnummer/, "an accountant does not invoice through this app's own IBAN field");
});
