// src/lib/ochtend-digest.test.ts
// [OCHTEND] The morning mail's one hard rule is restraint, so restraint is what gets tested:
// a quiet day says nothing, and a mail that IS sent leads with the money.
// Run: npx tsx --test src/lib/ochtend-digest.test.ts

import { test } from "node:test";
import assert from "node:assert/strict";

import { planOchtendMail, type OchtendInput } from "./ochtend-digest";

const base = (over: Partial<OchtendInput> = {}): OchtendInput => ({
  gisteren: "2026-08-24",
  payments: [],
  newIncomingCount: 0,
  baseUrl: "https://boekbrug.nl",
  ...over,
});

test("[OCHTEND] a quiet day produces NO mail — not an empty one", () => {
  assert.equal(planOchtendMail(base()), null);
  // Garbage counts as quiet, never as news: a NaN amount or a negative count is not an event.
  assert.equal(
    planOchtendMail(base({ payments: [{ invoiceNumber: "1", clientName: "X", amount: NaN }], newIncomingCount: -3 })),
    null,
  );
  assert.equal(
    planOchtendMail(base({ payments: [{ invoiceNumber: "1", clientName: "X", amount: 0 }] })),
    null,
    "a zero payment is not money that came in",
  );
});

test("[OCHTEND] a payment day leads with the money, in the subject", () => {
  const mail = planOchtendMail(base({
    payments: [
      { invoiceNumber: "20260046", clientName: "Vermeulen BV", amount: 1210 },
      { invoiceNumber: "20260047", clientName: "Bakker & Zn", amount: 250.5 },
    ],
  }));
  assert.ok(mail, "two payments are a mail");
  assert.match(mail.subject, /1\.460,50/, "the subject carries the total — the line that gets opened");
  assert.match(mail.html, /Vermeulen BV/, "…and the body names who paid");
  assert.match(mail.html, /20260046/, "…and which invoice");
  assert.match(mail.html, /1\.210,00/, "…and how much");
  assert.match(mail.html, /https:\/\/boekbrug\.nl\/dashboard/, "one click target, into the app");
});

test("[OCHTEND] an incoming-only day speaks about the arrivals, without inventing money", () => {
  const een = planOchtendMail(base({ newIncomingCount: 1 }));
  assert.ok(een);
  assert.match(een.subject, /1 nieuwe inkomende factuur/, "singular");
  const drie = planOchtendMail(base({ newIncomingCount: 3 }));
  assert.ok(drie);
  assert.match(drie.subject, /3 nieuwe inkomende facturen/, "plural");
  assert.doesNotMatch(drie.html, /binnengekomen op/, "no payment block on a day without payments");
});

test("[OCHTEND] a payer's name is content, never markup", () => {
  const mail = planOchtendMail(base({
    payments: [{ invoiceNumber: null, clientName: '<img src=x onerror=alert(1)>', amount: 10 }],
  }));
  assert.ok(mail);
  assert.doesNotMatch(mail.html, /<img src=x/, "the stored name is escaped on the way into the mail");
  assert.match(mail.html, /Onbekende betaler|&lt;img/, "…and still shown as text");
});
