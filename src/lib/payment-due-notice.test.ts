// src/lib/payment-due-notice.test.ts
// Run: npx tsx --test src/lib/payment-due-notice.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import {
  lastBankingDay, daysBetween, tierFor, bucketsFor, noticesFor, noticeFor, pushWorthy,
  type PayableInvoice,
} from "./payment-due-notice";

const inv = (over: Partial<PayableInvoice> = {}): PayableInvoice => ({
  id: over.id ?? "i1",
  supplierName: over.supplierName !== undefined ? over.supplierName : "CAN Vleesgroothandel B.V.",
  invoiceNumber: over.invoiceNumber !== undefined ? over.invoiceNumber : "2034488",
  dueDate: over.dueDate !== undefined ? over.dueDate : "2026-08-29",
  amountIncBtw: over.amountIncBtw !== undefined ? over.amountIncBtw : 1165.73,
  autoDebit: over.autoDebit ?? false,
});

test("[BETAALHERINNERING] the banking day moves back out of the weekend, and only then", () => {
  // 2026-08-29 is a Saturday, 2026-08-30 a Sunday, 2026-08-28 a Friday.
  assert.equal(lastBankingDay("2026-08-29"), "2026-08-28", "a Saturday due date is payable on Friday");
  assert.equal(lastBankingDay("2026-08-30"), "2026-08-28", "a Sunday due date too");
  assert.equal(lastBankingDay("2026-08-28"), "2026-08-28", "a Friday stays a Friday");
  assert.equal(lastBankingDay("2026-08-31"), "2026-08-31", "a Monday stays a Monday");
  assert.equal(lastBankingDay("niet-een-datum"), null, "an unparseable date has no banking day");
  // Across a month and a year boundary — the arithmetic must not be a string cut.
  assert.equal(lastBankingDay("2027-01-03"), "2027-01-01", "a Sunday on the 3rd goes back into the previous week");
  assert.equal(daysBetween("2026-12-30", "2027-01-02"), 3, "days are counted across the year boundary");
  // And across a DST switch: the Netherlands moves the clock on the last Sunday of October.
  assert.equal(daysBetween("2026-10-24", "2026-10-26"), 2, "a DST weekend is still two days");
});

test("[BETAALHERINNERING] the ladder has three rungs and is silent between them", () => {
  const t = (due: string, today: string) => tierFor(inv({ dueDate: due }), today);
  // 2026-09-04 is a Friday, so no weekend shift muddies these.
  assert.equal(t("2026-09-04", "2026-09-01"), "in_three_days");
  assert.equal(t("2026-09-04", "2026-09-03"), "tomorrow");
  assert.equal(t("2026-09-04", "2026-09-04"), "today");
  // Two days out says nothing on purpose — three tiks on three consecutive days trains the owner
  // to wave all three away, and then the one that mattered goes with them.
  assert.equal(t("2026-09-04", "2026-09-02"), null, "two days out is deliberately silent");
  assert.equal(t("2026-09-04", "2026-08-25"), null, "far away says nothing");
  // Past due is NOT on this ladder: another message, another action.
  assert.equal(t("2026-09-04", "2026-09-05"), null, "overdue is not this module's job");
});

test("[BETAALHERINNERING] an invoice that pays itself is never chased", () => {
  // The "Automatisch" badge on the card. Telling the owner to pay it invites a real double payment.
  assert.equal(tierFor(inv({ autoDebit: true, dueDate: "2026-09-04" }), "2026-09-04"), null);
  // …and it is checked BEFORE the date, so it is silent on every rung, not just the last.
  for (const today of ["2026-09-01", "2026-09-03", "2026-09-04"]) {
    assert.equal(tierFor(inv({ autoDebit: true, dueDate: "2026-09-04" }), today), null, `still silent on ${today}`);
  }
  assert.equal(tierFor(inv({ dueDate: null }), "2026-09-04"), null, "no due date, no rung");
});

test("[BETAALHERINNERING] the weekend case is the one from the report", () => {
  // The card that started this: due 29 aug, and the owner learned on the day itself. 29 aug 2026
  // is a Saturday, so the last day a transfer still arrives on time is Friday the 28th.
  const f = inv({ dueDate: "2026-08-29" });
  assert.equal(tierFor(f, "2026-08-28"), "today", "Friday IS the last day for a Saturday due date");
  assert.equal(tierFor(f, "2026-08-26"), null, "and the 26th is two days out — silent");
  assert.equal(tierFor(f, "2026-08-25"), "in_three_days");
  const [notice] = noticesFor([f], "2026-08-28");
  assert.match(notice.body, /weekend/, "the message explains why 'today' is not the date on the invoice");
});

test("[BETAALHERINNERING] one message per rung, largest first, with the amount in the title", () => {
  const today = "2026-09-04";
  const rows = [
    inv({ id: "a", supplierName: "Klein", amountIncBtw: 40, dueDate: "2026-09-04" }),
    inv({ id: "b", supplierName: "Groot", amountIncBtw: 900, dueDate: "2026-09-04" }),
    inv({ id: "c", supplierName: "Morgen BV", amountIncBtw: 100, dueDate: "2026-09-07" }),
  ];
  // 2026-09-07 is a Monday, so 'tomorrow' from Sunday the 6th — from Friday the 4th it is 3 days.
  const notices = noticesFor(rows, today);
  assert.equal(notices.length, 2, "two rungs speak, each once — never once per invoice");
  assert.equal(notices[0].tier, "today", "the sharpest rung comes first");
  assert.deepEqual(notices[0].invoiceIds, ["b", "a"], "largest amount first inside a rung");
  assert.match(notices[0].title, /€ 940,00/, "the title carries the TOTAL, so it answers 'does this matter'");
  assert.match(notices[0].title, /2 facturen/);
  assert.match(notices[0].body, /Groot[\s\S]*Klein/, "the body names who, in the same order");
  // A single invoice names the supplier itself rather than counting to one.
  const [een] = noticesFor([rows[1]], today);
  assert.match(een.title, /€ 900,00 aan Groot/);
  assert.doesNotMatch(een.title, /1 factuur/);
});

test("[BETAALHERINNERING] only the rungs the owner can still act on tonight push", () => {
  assert.equal(pushWorthy("today"), true);
  assert.equal(pushWorthy("tomorrow"), true);
  // Three days out is worth an in-app notification and not worth a buzz — that is the difference
  // between a reminder people keep switched on and one they turn off.
  assert.equal(pushWorthy("in_three_days"), false);
  assert.equal(noticeFor({ tier: "in_three_days", invoices: [inv()], totalIncBtw: 1 }).push, false);
});

test("[BETAALHERINNERING] a nameless invoice is described, never blank", () => {
  const zonder = inv({ supplierName: null, invoiceNumber: "F-77", dueDate: "2026-09-04" });
  assert.match(noticesFor([zonder], "2026-09-04")[0].title, /factuur F-77/);
  const niets = inv({ supplierName: null, invoiceNumber: null, dueDate: "2026-09-04" });
  assert.match(noticesFor([niets], "2026-09-04")[0].title, /zonder afzender/);
  // An unreadable amount must not render as "NaN" on a card about money.
  const geenBedrag = inv({ amountIncBtw: null, dueDate: "2026-09-04" });
  assert.doesNotMatch(noticesFor([geenBedrag], "2026-09-04")[0].title, /NaN/);
});

test("[BETAALHERINNERING] a quiet day is the normal day", () => {
  assert.deepEqual(noticesFor([], "2026-09-04"), [], "no invoices, no message");
  assert.deepEqual(bucketsFor([inv({ dueDate: "2026-12-01" })], "2026-09-04"), [], "nothing near, nothing said");
});
