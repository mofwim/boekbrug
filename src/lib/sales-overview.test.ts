// [ACTING-FOR] Pure node test — run: npx tsx --test src/lib/sales-overview.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  stateOf,
  outstandingAmount,
  summarise,
  canRemind,
  nextManualOffset,
  MAX_MANUAL_REMINDERS,
  REMINDER_COOLDOWN_DAYS,
  type SalesInvoice,
} from "./sales-overview";
import { openAfterCredit } from "./credited-invoices";

const NOW = Date.parse("2026-08-15T12:00:00.000Z");
const day = (n: number) => new Date(NOW + n * 86_400_000).toISOString().slice(0, 10);

const f = (over: Partial<SalesInvoice> = {}): SalesInvoice => ({
  id: "x",
  invoice_number: "20260001",
  client_name: "Klant",
  client_email: "klant@voorbeeld.nl",
  invoice_date: day(-30),
  due_date: day(-1),
  total_inc_btw: 121,
  amount_paid: 0,
  status: "sent",
  ...over,
});

// ── the state ─────────────────────────────────────────────────────────────────────────────────

test("a draft is not an outstanding invoice", () => {
  assert.equal(stateOf(f({ status: "draft" }), NOW), "concept");
});

test("the DUE DATE decides whether something is late, not the status", () => {
  // status 'overdue' is set by a cron and therefore lags behind. An invoice that fell due
  // yesterday is late today, even while it still says 'sent' — otherwise the member sees it only
  // tomorrow, and that is exactly the day that counts with payments.
  assert.equal(stateOf(f({ status: "sent", due_date: day(-1) }), NOW), "te-laat");
  assert.equal(stateOf(f({ status: "sent", due_date: day(+1) }), NOW), "open");
  // And the other way round: 'overdue' with a due date in the future is simply open.
  assert.equal(stateOf(f({ status: "overdue", due_date: day(+5) }), NOW), "open");
});

test("the due day itself is not late yet", () => {
  // Someone may pay all day on the due date. Sending a reminder at 12:00 on that day is too
  // early and reads as distrust.
  assert.equal(stateOf(f({ due_date: day(0) }), NOW), "open");
});

test("paid and cancelled are states of their own", () => {
  assert.equal(stateOf(f({ status: "paid" }), NOW), "betaald");
  for (const s of ["archived", "cancelled", "credited"]) {
    assert.equal(stateOf(f({ status: s }), NOW), "vervallen", s);
  }
});

// ── the amount ────────────────────────────────────────────────────────────────────────────────

test("a partial payment counts, and the outstanding never drops below zero", () => {
  assert.equal(outstandingAmount(f({ total_inc_btw: 121, amount_paid: 50 })), 71);
  assert.equal(outstandingAmount(f({ total_inc_btw: 121, amount_paid: 121 })), 0);
  assert.equal(outstandingAmount(f({ total_inc_btw: 121, amount_paid: 500 })), 0, "no negative amount");
  assert.equal(outstandingAmount(f({ total_inc_btw: null, amount_paid: null })), 0);
});

test("a credit note (negative total) counts as an amount, not as a minus", () => {
  assert.equal(outstandingAmount(f({ total_inc_btw: -121 })), 121);
});

// ── the summary ───────────────────────────────────────────────────────────────────────────────

test("the work board adds up the right things", () => {
  const list = [
    f({ id: "1", status: "draft" }),
    f({ id: "2", due_date: day(+7), total_inc_btw: 100 }),                    // open
    f({ id: "3", due_date: day(-10), total_inc_btw: 200 }),                   // overdue
    f({ id: "4", due_date: day(-3), total_inc_btw: 300, amount_paid: 100 }),  // overdue, partly paid
    f({ id: "5", status: "paid", total_inc_btw: 999 }),
    f({ id: "6", status: "archived", total_inc_btw: 5000 }),                  // counts towards nothing
  ];
  const t = summarise(list, NOW);
  assert.equal(t.drafts, 1);
  assert.equal(t.open, 1);
  assert.equal(t.overdue, 2);
  assert.equal(t.paid, 1);
  assert.equal(t.outstanding, 100 + 200 + 200, "open + overdue, minus the partial payment");
  assert.equal(t.overdueAmount, 400, "only the overdue part");
});

test("an ignored €5000 invoice does not pollute the outstanding total", () => {
  // This is why 'vervallen' is a state of its own. Without that separation the work board would
  // show an amount that will never arrive, and people act on that.
  const t = summarise([f({ status: "archived", total_inc_btw: 5000, due_date: day(-40) })], NOW);
  assert.equal(t.outstanding, 0);
  assert.equal(t.overdue, 0);
});

// ── the reminder ──────────────────────────────────────────────────────────────────────────────

test("reminding is only allowed AFTER the due date", () => {
  const notYet = canRemind(f({ due_date: day(+3) }), NOW);
  assert.equal(notYet.allowed, false);
  if (!notYet.allowed) assert.match(notYet.reason, /vervaldatum/);
  assert.equal(canRemind(f({ due_date: day(-1) }), NOW).allowed, true);
});

test("never remind about money that already arrived", () => {
  // The most painful mail this product can send: a dunning notice for a paid invoice. Two routes
  // to it — the status says 'paid', or the amount is complete but the status lags behind.
  assert.equal(canRemind(f({ status: "paid" }), NOW).allowed, false);
  const fullyPaid = canRemind(f({ status: "sent", amount_paid: 121 }), NOW);
  assert.equal(fullyPaid.allowed, false);
  if (!fullyPaid.allowed) assert.match(fullyPaid.reason, /niets meer open/);
});

test("without the customer's e-mail address there is nothing to send", () => {
  const out = canRemind(f({ client_email: null }), NOW);
  assert.equal(out.allowed, false);
  if (!out.allowed) assert.match(out.reason, /e-mailadres/);
});

test("a draft cannot be reminded", () => {
  assert.equal(canRemind(f({ status: "draft" }), NOW).allowed, false);
});

test("there is a cooldown between two reminders — including after a cron mail", () => {
  const yesterday = new Date(NOW - 86_400_000).toISOString();
  const out = canRemind(f({ last_reminder_at: yesterday }), NOW);
  assert.equal(out.allowed, false);
  if (!out.allowed) assert.match(out.reason, /Wacht nog/);

  const longAgo = new Date(NOW - (REMINDER_COOLDOWN_DAYS + 1) * 86_400_000).toISOString();
  assert.equal(canRemind(f({ last_reminder_at: longAgo }), NOW).allowed, true);
});

test("an unreadable previous date turns the button OFF, not on", () => {
  // Failure direction: better a day late than a customer reminded twice in one day.
  const out = canRemind(f({ last_reminder_at: "not a date" }), NOW);
  assert.equal(out.allowed, false);
});

test("there is an upper limit — beyond it, it is no longer reminding", () => {
  const out = canRemind(f({ reminder_count: MAX_MANUAL_REMINDERS }), NOW);
  assert.equal(out.allowed, false);
  // [DEBITEUREN] The sentence is role-neutral now: the owner, a sales member and a mandated
  // accountant all reach this button, and what comes after three reminders is a decision with
  // legal consequences (art. 6:96 BW) rather than a next tap — whoever is reading.
  if (!out.allowed) assert.match(out.reason, /beslissing van de ondernemer/, "…and it says whose decision it is");
  if (!out.allowed) assert.doesNotMatch(out.reason, /werkgever/, "not 'your employer' — the owner reads this too");
  assert.equal(canRemind(f({ reminder_count: MAX_MANUAL_REMINDERS - 1 }), NOW).allowed, true);
});

test("every refusal says WHY, in a sentence a human reads", () => {
  const cases = [
    f({ status: "draft" }),
    f({ status: "paid" }),
    f({ client_email: null }),
    f({ due_date: day(+5) }),
    f({ reminder_count: 9 }),
  ];
  for (const c of cases) {
    const out = canRemind(c, NOW);
    assert.equal(out.allowed, false);
    if (!out.allowed) {
      assert.ok(out.reason.length > 15, "no bare 'not allowed'");
      assert.ok(/[.!]$/.test(out.reason), "a full sentence");
    }
  }
});

// ── the trail ─────────────────────────────────────────────────────────────────────────────────

test("manual reminders get NEGATIVE offsets, so they never block a cron tier", () => {
  // invoice_reminders has UNIQUE(invoice_id, day_offset) and the cron uses 14 and 30. Were a
  // manual send to take a positive number, it could occupy a cron tier — and then the automatic
  // reminder silently stays away.
  assert.equal(nextManualOffset([]), -1);
  assert.equal(nextManualOffset([14]), -1, "a cron tier does not count");
  assert.equal(nextManualOffset([-1]), -2);
  assert.equal(nextManualOffset([14, 30, -1, -2]), -3);
  assert.ok(nextManualOffset([14, 30]) < 0);
});

// ── [CREDITNOTA-NO-CHASE] / [DEEL-CREDIT] the credit that no total subtracted ──────────────────
//
// A credit note is written with status 'sent', a due date of today and a NEGATIVE total, and
// outstandingAmount takes the absolute value of it. summarise had no rule for that, so a € 50
// creditnota against a € 500 invoice did not reduce the € 500 — it ADDED to it. Every one of the
// six figures this screen shows was wrong at once, and by twice the credit.

test("[CREDITNOTA-NO-CHASE] a creditnota belongs in no count and no total", () => {
  const invoice = f({ id: "inv-1", total_inc_btw: 500, due_date: day(-5) });
  const credit = f({ id: "cn-1", invoice_type: "creditnota", total_inc_btw: -50, due_date: day(-5) });

  const t = summarise([invoice, credit], NOW);
  assert.equal(t.outstanding, 500, "the credit must not be added to what is owed");
  assert.equal(t.overdueAmount, 500, "…nor to what is late");
  assert.equal(t.overdue, 1, "one invoice is late, not two");

  // The invoice alone gives the same answer — which is the point: the creditnota changed nothing
  // by being in the list, so it can no longer change anything by being counted.
  assert.deepEqual(summarise([invoice], NOW), t, "a creditnota in the list is a no-op");
});

test("[DEEL-CREDIT] a partial credit reduces what is still owed, on the screen too", () => {
  const invoice = f({ id: "inv-1", total_inc_btw: 500, due_date: day(-5) });
  const credited = new Map([["inv-1", 50]]);

  assert.equal(outstandingAmount(invoice, 50), 450, "€ 500 minus a € 50 credit is € 450");
  assert.equal(summarise([invoice], NOW, credited).outstanding, 450);
  assert.equal(summarise([invoice], NOW, credited).overdueAmount, 450);

  // This is the number the reminder e-mail already named. The whole defect was that the screen
  // named a different one, so the equality IS the assertion.
  assert.equal(outstandingAmount(invoice, 50), openAfterCredit(500, 0, 50),
    "the screen and the e-mail must name the same amount");

  // Payments and credits stack — the customer paid € 200 and holds a € 50 credit.
  assert.equal(outstandingAmount(f({ total_inc_btw: 500, amount_paid: 200 }), 50), 250);
});

test("[DEEL-CREDIT] a fully credited invoice is settled, and every surface goes quiet", () => {
  const invoice = f({ id: "inv-1", total_inc_btw: 500, due_date: day(-5) });
  assert.equal(outstandingAmount(invoice, 500), 0);
  assert.equal(summarise([invoice], NOW, new Map([["inv-1", 500]])).outstanding, 0);
  const verdict = canRemind(invoice, NOW, 500);
  assert.equal(verdict.allowed, false, "there is nothing left to claim");
  if (!verdict.allowed) assert.match(verdict.reason, /niets meer open/);
  // …and over-crediting cannot turn the invoice into a debt the other way.
  assert.equal(outstandingAmount(invoice, 900), 0, "never negative");
});

test("[DEEL-CREDIT] without a credited amount every number is exactly what it was", () => {
  // The parameter defaults to 0 so a caller that holds no creditnota rows keeps its old answer.
  // A screen without the information must not start guessing at it.
  const invoice = f({ total_inc_btw: 500, amount_paid: 120, due_date: day(-5) });
  assert.equal(outstandingAmount(invoice), 380);
  assert.equal(outstandingAmount(invoice), outstandingAmount(invoice, 0));
  assert.equal(canRemind(invoice, NOW).allowed, canRemind(invoice, NOW, 0).allowed);
  assert.equal(outstandingAmount(f({ total_inc_btw: Number.NaN })), 0, "an unusable total is worth nothing");
  assert.equal(outstandingAmount(f({ total_inc_btw: 500, amount_paid: Number.POSITIVE_INFINITY })), 500);

  // A CORRUPT CREDIT must not settle a real invoice. Postgres numeric accepts 'Infinity', so one
  // bad creditnota row reaches openAfterCredit through creditedTotalsFrom; unguarded, 500 - Infinity
  // is negative and this whole chain reads negative as "nothing is owed". The invoice would stop
  // being claimed, dunned and counted because of a single column.
  assert.equal(outstandingAmount(f({ total_inc_btw: 500 }), Number.POSITIVE_INFINITY), 500,
    "an unusable credit is ignored, never treated as full settlement");
  assert.equal(summarise([f({ id: "inv-1", total_inc_btw: 500, due_date: day(-5) })], NOW,
    new Map([["inv-1", Number.POSITIVE_INFINITY]])).outstanding, 500);
});
