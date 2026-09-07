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
  newIncoming: [],
  baseUrl: "https://boekbrug.nl",
  ...over,
});

test("[OCHTEND] a quiet day produces NO mail — not an empty one", () => {
  assert.equal(planOchtendMail(base()), null);
  // Garbage counts as quiet, never as news: a NaN amount or a negative count is not an event.
  assert.equal(
    planOchtendMail(base({ payments: [{ invoiceNumber: "1", clientName: "X", amount: NaN }], newIncoming: [{ id: "", supplierName: "X", amount: 1, dueDate: null }] })),
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

// ── [POST-WAARD] The mail names the invoice it is about, and its button opens it ───────────────
//
// The owner's own words on the old mail: what did I gain from a mail with general information,
// whose button opens the front page and not the invoice — an invoice I cannot even identify,
// because the mail names nothing. So: who, how much, when it is due, in the SUBJECT, and one tap
// onto that row.
const enka = { id: "7a2133f5-3ace-4cf4-bdee-f5bb3e4f1b37", supplierName: "Enka Horeca B.V.", amount: 1559.97, dueDate: "2026-09-27" };

test("[POST-WAARD] one arrival: the subject carries the facts and the button opens that invoice", () => {
  const mail = planOchtendMail(base({ newIncoming: [enka] }));
  assert.ok(mail);
  // The mailbox preview alone answers "do I need to act": who, how much, when.
  assert.equal(mail.subject, "Enka Horeca B.V. · € 1.559,97 · vervalt 27-09-2026");
  assert.doesNotMatch(mail.subject, /nieuwe inkomende factuur/, "the count is not the news; the invoice is");
  // The button lands on the row, on the screen where it is paid — the same deep link the
  // dashboard's attention list uses, so a mail and a tile never send the owner two places.
  assert.equal(mail.target, "/dashboard/incoming/manage?focus=7a2133f5-3ace-4cf4-bdee-f5bb3e4f1b37");
  assert.match(mail.html, /href="https:\/\/boekbrug\.nl\/dashboard\/incoming\/manage\?focus=7a2133f5-3ace-4cf4-bdee-f5bb3e4f1b37"/);
  assert.match(mail.html, /Open deze factuur/, "the button says what it opens");
  assert.doesNotMatch(mail.html, /binnengekomen op/, "no payment block on a day without payments");
});

test("[POST-WAARD] several arrivals: a list with a door per line, and the button opens the pay screen", () => {
  const mail = planOchtendMail(base({ newIncoming: [
    enka,
    { id: "b", supplierName: "Sumer Food", amount: 348.8, dueDate: "2026-09-20" },
    { id: "c", supplierName: "KPN", amount: 105.79, dueDate: null },
  ] }));
  assert.ok(mail);
  assert.equal(mail.subject, "3 nieuwe inkomende facturen · samen € 2.014,56");
  assert.equal(mail.target, "/dashboard/incoming/manage");
  for (const naam of ["Enka Horeca B.V.", "Sumer Food", "KPN"]) assert.match(mail.html, new RegExp(naam.replace(/\./g, "\\.")), naam);
  assert.match(mail.html, /focus=b"/, "each line is its own door");
  assert.match(mail.html, /Bekijk de facturen/);
});

test("[POST-WAARD] an amount the reader has not established is said, never invented", () => {
  const mail = planOchtendMail(base({ newIncoming: [{ ...enka, amount: null }] }));
  assert.ok(mail);
  assert.equal(mail.subject, "Enka Horeca B.V. · vervalt 27-09-2026", "no amount in the subject");
  assert.match(mail.html, /bedrag nog niet gelezen/);
  // And a total over several is only stated when EVERY amount is known.
  const deels = planOchtendMail(base({ newIncoming: [enka, { id: "b", supplierName: "KPN", amount: null, dueDate: null }] }));
  assert.ok(deels);
  assert.equal(deels.subject, "2 nieuwe inkomende facturen", "a sum missing a document is not a sum");
});

test("[POST-WAARD] the second lock: this mail can never read as an invoice to our own sync", () => {
  // [EIGEN-POST] refuses our sender before reading. Belt and braces: even if that guard were
  // gone, bodyLooksLikeInvoice demands a whole-word tax term, and this mail never carries one —
  // it names amounts and the word "factuur", which is exactly the pair that used to be missing.
  const mail = planOchtendMail(base({ newIncoming: [enka], payments: [{ invoiceNumber: "20260046", clientName: "Vermeulen BV", amount: 1210 }] }));
  assert.ok(mail);
  assert.doesNotMatch(mail.html, /\b(btw|vat|omzetbelasting)\b/i, "a tax word would make our own mail an invoice candidate");
  assert.doesNotMatch(mail.subject, /\b(btw|vat)\b/i);
});

test("[POST-WAARD] a supplier's name is content, never markup", () => {
  const mail = planOchtendMail(base({ newIncoming: [{ ...enka, supplierName: '<img src=x onerror=alert(1)>' }] }));
  assert.ok(mail);
  assert.doesNotMatch(mail.html, /<img src=x/);
  assert.match(mail.html, /&lt;img/);
});

test("[OCHTEND] a payer's name is content, never markup", () => {
  const mail = planOchtendMail(base({
    payments: [{ invoiceNumber: null, clientName: '<img src=x onerror=alert(1)>', amount: 10 }],
  }));
  assert.ok(mail);
  assert.doesNotMatch(mail.html, /<img src=x/, "the stored name is escaped on the way into the mail");
  assert.match(mail.html, /Onbekende betaler|&lt;img/, "…and still shown as text");
});
