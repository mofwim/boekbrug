// [BETAALGEDRAG] Run: npx tsx --test src/lib/client-payment-behaviour-copy.test.ts
//
// The engine keeps the SIGN, because the sign is the fact. This file's job is that the sign never
// reaches a human: nobody should have to work out that "−23 dagen na de vervaldatum" is good news.

import { test } from "node:test";
import assert from "node:assert/strict";
import { clientPaymentBehaviour, type BehaviourInvoice } from "./client-payment-behaviour";
import { paymentBehaviourPanel } from "./client-payment-behaviour-copy";
import { dayNumberFromIso } from "./invoice-reminders";
import { LOCALES } from "./i18n/locale";

const TODAY = dayNumberFromIso("2026-08-29") as number;

function paid(invoice_date: string, due_date: string, payment_date: string | null): BehaviourInvoice {
  return { invoice_date, due_date, payment_date, status: "paid", total_inc_btw: 121 };
}

test("a customer who pays early gets a sentence about being early, with no minus sign", () => {
  const b = clientPaymentBehaviour(
    [
      paid("2026-01-01", "2026-01-31", "2026-01-08"),
      paid("2026-02-01", "2026-03-03", "2026-02-08"),
      paid("2026-03-01", "2026-03-31", "2026-03-08"),
    ],
    TODAY,
  );
  const p = paymentBehaviourPanel(b, "nl");
  assert.match(p.pace, /vóór de vervaldatum/);
  assert.match(p.pace, /23/);
  assert.ok(!p.pace.includes("-23") && !p.pace.includes("−23"), "the sign never reaches the screen");
});

test("a customer who pays late gets the other sentence, and the worst case is named", () => {
  const b = clientPaymentBehaviour(
    [
      paid("2026-01-01", "2026-01-31", "2026-02-10"), // 10 past
      paid("2026-02-01", "2026-03-03", "2026-03-13"), // 10 past
      paid("2026-03-01", "2026-03-31", "2026-06-29"), // 90 past
    ],
    TODAY,
  );
  const p = paymentBehaviourPanel(b, "nl");
  assert.match(p.pace, /na de vervaldatum/);
  assert.ok(p.basis);
  assert.match(p.basis, /90/, "the slowest invoice is stated, not averaged away");
});

test("paying exactly on the due date is its own sentence, not '0 dagen te laat'", () => {
  const b = clientPaymentBehaviour(
    [
      paid("2026-01-01", "2026-01-31", "2026-01-31"),
      paid("2026-02-01", "2026-03-03", "2026-03-03"),
      paid("2026-03-01", "2026-03-31", "2026-03-31"),
    ],
    TODAY,
  );
  const p = paymentBehaviourPanel(b, "nl");
  assert.match(p.pace, /precies op de vervaldatum/);
  assert.ok(p.basis);
  assert.match(p.basis, /allemaal op tijd/);
});

test("every absence renders a real sentence in every language — never a key, never a blank", () => {
  const cases: BehaviourInvoice[][] = [
    [], // no_invoices
    [{ invoice_date: "2026-01-01", due_date: "2026-01-31", payment_date: null, status: "sent", total_inc_btw: 121 }], // none_paid
    [paid("2026-01-01", "2026-01-31", null), paid("2026-02-01", "2026-03-03", null)], // no_payment_dates
    [paid("2026-01-01", "2026-01-31", "2026-01-08")], // too_few
  ];
  for (const invoices of cases) {
    for (const locale of LOCALES) {
      const p = paymentBehaviourPanel(clientPaymentBehaviour(invoices, TODAY), locale);
      assert.ok(p.pace.trim().length > 0, `empty pace for ${locale}`);
      // A key that fell through the catalogue arrives as the key ITSELF — a dotted identifier
      // with no whitespace. Matching on the substring "betaalgedrag." instead would flag the
      // Dutch sentence that legitimately ends on that word, which is the product's own term.
      assert.ok(/\s/.test(p.pace) && !/^\S+\.\S+$/.test(p.pace), `a key reached the screen in ${locale}: ${p.pace}`);
      assert.equal(p.basis, null, "no basis where there is no verdict");
    }
  }
});

test("one unmeasurable invoice reads as one, not as '1 facturen'", () => {
  const b = clientPaymentBehaviour(
    [
      paid("2026-01-01", "2026-01-31", null), // the one without a date
      paid("2026-02-01", "2026-03-03", "2026-02-08"),
      paid("2026-03-01", "2026-03-31", "2026-03-08"),
      paid("2026-04-01", "2026-05-01", "2026-04-08"),
    ],
    TODAY,
  );
  const p = paymentBehaviourPanel(b, "nl");
  assert.equal(p.caveats.length, 1);
  assert.match(p.caveats[0], /Eén betaalde factuur/);
  assert.ok(!p.caveats[0].includes("1 betaalde facturen"));
});

test("both kinds of unmeasurable invoice each get their own line", () => {
  const b = clientPaymentBehaviour(
    [
      paid("2026-01-01", "2026-01-31", null),
      paid("2026-01-02", "2026-02-01", null),
      paid("2026-05-10", "2026-06-09", "2026-05-01"), // impossible
      paid("2026-02-01", "2026-03-03", "2026-02-08"),
      paid("2026-03-01", "2026-03-31", "2026-03-08"),
      paid("2026-04-01", "2026-05-01", "2026-04-08"),
    ],
    TODAY,
  );
  const p = paymentBehaviourPanel(b, "nl");
  assert.equal(p.caveats.length, 2, "two different problems are two lines, never one merged sentence");
  assert.match(p.caveats[0], /2 betaalde facturen/);
  assert.match(p.caveats[1], /Eén factuur/);
});

test("one overdue invoice reads as one; the amount is formatted, not raw", () => {
  const b = clientPaymentBehaviour(
    [{ invoice_date: "2026-01-01", due_date: "2026-08-01", payment_date: null, status: "sent", total_inc_btw: 1210 }],
    TODAY,
  );
  const p = paymentBehaviourPanel(b, "nl");
  assert.ok(p.overdue);
  assert.match(p.overdue, /één factuur/);
  assert.match(p.overdue, /1\.210,00/, "a euro amount is never printed raw");
  assert.match(p.overdue, /28/);
});

test("the Arabic panel is Arabic and carries its own direction", () => {
  const b = clientPaymentBehaviour(
    [
      paid("2026-01-01", "2026-01-31", "2026-01-08"),
      paid("2026-02-01", "2026-03-03", "2026-02-08"),
      paid("2026-03-01", "2026-03-31", "2026-03-08"),
    ],
    TODAY,
  );
  const nl = paymentBehaviourPanel(b, "nl");
  const ar = paymentBehaviourPanel(b, "ar");
  assert.equal(ar.dir, "rtl", "direction travels with the words, on the same object");
  assert.equal(nl.dir, "ltr");
  assert.notEqual(ar.heading, nl.heading);
  assert.ok(!ar.pace.includes("vervaldatum"), "no Dutch left inside the translated panel");
  assert.ok(ar.basis && !ar.basis.includes("Op basis van"));
});
