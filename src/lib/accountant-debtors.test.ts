// [DEBITEUREN] Pure node test — run: npx tsx --test src/lib/accountant-debtors.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";

import { buildDebtorBoard, boardTotals, daysLate, type DebtorInput } from "./accountant-debtors";
import { canRemindInvoice } from "./acting-for";
import { canRemind } from "./sales-overview";
import { resolveAccountantActing } from "./accountant-mandate";

const NOW = Date.parse("2026-08-04T12:00:00Z");
const A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"; // the accountant
const K1 = "11111111-1111-1111-1111-111111111111";
const K2 = "22222222-2222-2222-2222-222222222222";

/** A day offset from NOW, as a date string. */
const day = (n: number) => new Date(NOW + n * 86_400_000).toISOString().slice(0, 10);

const inv = (over: Partial<DebtorInput> = {}): DebtorInput => ({
  ownerId: K1,
  id: "f1",
  invoice_number: "2026-001",
  client_name: "Afnemer BV",
  client_email: "afnemer@example.com",
  invoice_date: day(-40),
  due_date: day(-10),
  total_inc_btw: 500,
  amount_paid: 0,
  status: "sent",
  last_reminder_at: null,
  reminder_count: 0,
  ...over,
});

const names = { [K1]: "Bakkerij Yilmaz", [K2]: "Loodgieter De Vries" };

test("only genuine debt reaches the board", () => {
  const board = buildDebtorBoard(
    [
      inv({ id: "laat" }),
      // Not yet due — chasing this is how an accountant damages a relationship they were hired
      // to protect.
      inv({ id: "nog-niet", due_date: day(+5) }),
      inv({ id: "concept", status: "draft" }),
      inv({ id: "betaald", status: "paid" }),
      inv({ id: "vervallen", status: "archived" }),
      // Paid in full while the status still lags. sales-overview.ts calls a reminder here the most
      // painful mail this product can send.
      inv({ id: "al-binnen", amount_paid: 500 }),
    ],
    names,
    NOW,
  );
  assert.equal(board.length, 1, "one client has real debt");
  assert.deepEqual(board[0].rows.map((r) => r.invoice.id), ["laat"]);
});

test("a partial payment leaves the remainder as the debt", () => {
  const board = buildDebtorBoard([inv({ total_inc_btw: 500, amount_paid: 180 })], names, NOW);
  assert.equal(board[0].rows[0].outstanding, 320);
  assert.equal(board[0].totalOutstanding, 320);
});

test("oldest debt first — not the biggest", () => {
  // The whole point of the screen: €120 from January is a worse sign than €4.000 from last week.
  const board = buildDebtorBoard(
    [
      inv({ id: "groot-recent", due_date: day(-2), total_inc_btw: 4000 }),
      inv({ id: "klein-oud", due_date: day(-200), total_inc_btw: 120 }),
    ],
    names,
    NOW,
  );
  assert.deepEqual(board[0].rows.map((r) => r.invoice.id), ["klein-oud", "groot-recent"]);
});

test("the client with the oldest debt sits on top", () => {
  const board = buildDebtorBoard(
    [
      inv({ ownerId: K1, id: "a", due_date: day(-5) }),
      inv({ ownerId: K2, id: "b", due_date: day(-90) }),
    ],
    names,
    NOW,
  );
  assert.deepEqual(board.map((g) => g.clientName), ["Loodgieter De Vries", "Bakkerij Yilmaz"]);
});

test("an unreadable due date never sorts itself to the top", () => {
  // It would get someone's customer mailed first, on the strength of a broken string.
  assert.equal(daysLate({ ...inv(), due_date: "geen-datum" }, NOW), 0);
  assert.equal(daysLate({ ...inv(), due_date: null }, NOW), 0);
});

test("rows that cannot be reminded stay visible, with the reason", () => {
  // A board that shows only actionable rows says "nothing is late" when the truth is "three are
  // late and none can be mailed today". Those are different facts.
  const board = buildDebtorBoard(
    [
      inv({ id: "geen-mail", client_email: null }),
      inv({ id: "net-gehad", last_reminder_at: new Date(NOW - 86_400_000).toISOString() }),
      inv({ id: "kan" }),
    ],
    names,
    NOW,
  );
  const rows = board[0].rows;
  assert.equal(rows.length, 3, "all three are debt, whatever the verdict");
  assert.equal(board[0].remindable, 1, "but only one is actionable now");
  const geenMail = rows.find((r) => r.invoice.id === "geen-mail")!;
  assert.equal(geenMail.verdict.allowed, false);
  if (!geenMail.verdict.allowed) assert.match(geenMail.verdict.reason, /e-mailadres/);
});

test("the totals line adds up over every client", () => {
  const board = buildDebtorBoard(
    [
      inv({ ownerId: K1, id: "a", total_inc_btw: 100 }),
      inv({ ownerId: K1, id: "b", total_inc_btw: 200, client_email: null }),
      inv({ ownerId: K2, id: "c", total_inc_btw: 50 }),
    ],
    names,
    NOW,
  );
  assert.deepEqual(boardTotals(board), {
    outstanding: 350,
    invoices: 3,
    clients: 2,
    // The only actionable number: the one without an e-mail address cannot be mailed.
    remindable: 2,
  });
});

test("a client without a profile name still shows their money", () => {
  const board = buildDebtorBoard([inv({ ownerId: K2 })], {}, NOW);
  assert.equal(board[0].clientName, "Klant");
  assert.equal(board[0].totalOutstanding, 500);
});

test("a paused invoice is off-limits to the accountant, not to the owner", () => {
  // reminders_paused is how the owner says "not this one" — a disputed invoice, a customer they
  // are handling by phone. The cron obeys it; a third party with a button must too.
  const acting = resolveAccountantActing(
    A,
    K1,
    { callerRole: "accountant", linked: true, mandate: { zzper_id: K1, accountant_id: A, revoked_at: null } },
    NOW,
  )!;
  const paused = { sender_id: K1, created_by: K1, reminders_paused: true };
  const verdict = canRemindInvoice(acting, paused);
  assert.equal(verdict.allowed, false);
  if (!verdict.allowed) assert.match(verdict.reason, /stilgezet/);

  // The owner is not blocked: pausing the automatic mails and then sending one by hand is a
  // coherent thing to want, and it is their relationship.
  const owner = { ownerId: K1, actorId: K1, role: "eigenaar" as const };
  assert.equal(canRemindInvoice(owner, paused).allowed, true);
});

test("the accountant may chase invoices the CLIENT made — that is the whole job", () => {
  const acting = resolveAccountantActing(
    A,
    K1,
    { callerRole: "accountant", linked: true, mandate: { zzper_id: K1, accountant_id: A, revoked_at: null } },
    NOW,
  )!;
  // Made by the client, not by the accountant. Scoped to their own typing this screen would be
  // a list of nothing.
  assert.equal(canRemindInvoice(acting, { sender_id: K1, created_by: K1 }).allowed, true);
  // But never another client's invoice, mandate or no mandate.
  assert.equal(canRemindInvoice(acting, { sender_id: K2, created_by: K2 }).allowed, false);
});

test("a sales member stays narrow — reminding is not a licence to chase the boss's customers", () => {
  const member = { ownerId: K1, actorId: "m1", role: "verkoop" as const };
  assert.equal(canRemindInvoice(member, { sender_id: K1, created_by: "m1" }).allowed, true);
  const other = canRemindInvoice(member, { sender_id: K1, created_by: "collega" });
  assert.equal(other.allowed, false);
  if (!other.allowed) assert.match(other.reason, /zelf hebt gemaakt/);
});

test("a paused invoice is still debt on the board, just not a button", () => {
  // Hiding it would make the total lie; offering the button would answer 409 on the first click.
  // Both are worse than showing it grey with the reason.
  const board = buildDebtorBoard(
    [inv({ id: "stil", reminders_paused: true }), inv({ id: "gewoon" })],
    names,
    NOW,
  );
  assert.equal(board[0].rows.length, 2, "both are real debt");
  assert.equal(board[0].totalOutstanding, 1000, "…and both count toward the money");
  assert.equal(board[0].remindable, 1, "but only one can be mailed");
  const stil = board[0].rows.find((r) => r.invoice.id === "stil")!;
  assert.equal(stil.verdict.allowed, false);
  if (!stil.verdict.allowed) assert.match(stil.verdict.reason, /stilgezet/);
});

test("paused beats every timing rule — waiting does not make it allowed", () => {
  // Without this, a paused invoice that is merely inside the cooldown would look like it becomes
  // sendable in three days. It never does.
  const board = buildDebtorBoard(
    [inv({ id: "stil", reminders_paused: true, due_date: day(-400), last_reminder_at: null })],
    names,
    NOW,
  );
  const v = board[0].rows[0].verdict;
  assert.equal(v.allowed, false);
  if (!v.allowed) assert.match(v.reason, /stilgezet/, "not a cooldown sentence");
});

test("[CREDITNOTA-NO-CHASE] a credit note is never dunned as a receivable", () => {
  // The defect this pins: a creditnota is written with status 'sent', a due_date of its own issue
  // date and a NEGATIVE total — and outstandingAmount() takes the absolute value. Every gate in
  // canRemind() passed, so the board showed it as overdue debt with a live Herinner button, and
  // pressing it mailed the client's customer a demand for money that customer is owed BACK.
  const board = buildDebtorBoard(
    [inv({ id: "cn", invoice_type: "creditnota", total_inc_btw: -500, due_date: day(-1) })],
    names,
    NOW,
  );
  // It is not debt at all, so it does not belong on the board or in the total.
  assert.equal(board.length, 0, "a credit note is not a receivable");
});

test("[CREDITNOTA-NO-CHASE] canRemind refuses any type that is not 'factuur'", () => {
  const cn = canRemind({ ...inv(), invoice_type: "creditnota" }, NOW);
  assert.equal(cn.allowed, false);
  if (!cn.allowed) assert.match(cn.reason, /geen openstaande vordering/);
  assert.equal(canRemind({ ...inv(), invoice_type: "pro_forma" }, NOW).allowed, false, "an offerte is not owed either");
  // A missing column keeps the old behaviour — a caller that does not select it is unaffected.
  assert.equal(canRemind({ ...inv(), invoice_type: undefined }, NOW).allowed, true);
  assert.equal(canRemind({ ...inv(), invoice_type: "factuur" }, NOW).allowed, true);
});
