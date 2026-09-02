// [KAS-SAMENSTELLING] The four decisions that turn three database reads into the invoices the cash
// reconcile is allowed to act on — asserted against rows, not grepped for in source.
//
// MONEY_PATH_AUDIT_2026-08.md §6 item 4 asked for behavioural tests on cash-settle.ts. §8 answered
// the half that was reachable and left this: not the I/O, but the ASSEMBLY welded to it. Every one
// of these decisions can be silently wrong about somebody's money while the arithmetic downstream
// stays perfect, which is why each test is named for the cost rather than the field.
//
// Run: npx tsx --test src/lib/cash-settle-assemble.test.ts

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  assembleSettleableInvoices, indexCashInstalments, openCashInvoiceIds, readableDirection,
  type CashInvoiceRow, type KasLinkRow,
} from "./cash-settle-assemble";
import { settlementGross, buildCashSettlements } from "./cash";

const link = (over: Partial<KasLinkRow> = {}): KasLinkRow => ({
  id: "t1", invoice_id: "inv-1", amount_applied: 100, paid_on: "2026-07-01", ...over,
});

const invoice = (over: Partial<CashInvoiceRow> = {}): CashInvoiceRow => ({
  id: "inv-1",
  direction: "incoming",
  total_inc_btw: 500,
  amount_paid: 0,
  payment_date: "2026-09-30",
  invoice_number: "F-1",
  client_name: "Leverancier",
  ...over,
});

const one = (rows: CashInvoiceRow[], links: KasLinkRow[], perInstalment = true) =>
  assembleSettleableInvoices({ invoiceRows: rows, index: indexCashInstalments(links), perInstalment })[0];

// ── 1. HOW MUCH cash the invoice holds ─────────────────────────────────────

test("[KAS-SAMENSTELLING] the cash is the sum of the handovers, not what is left over after the bank", () => {
  // The formula this replaced was gross − amount_paid. amount_paid now INCLUDES cash, so for an
  // invoice paid entirely from the till it computed €0 — and a €0 settlement is not "leave it
  // alone", it is settlementGross returning null and the reconcile deleting the drawer entry that
  // recorded the money. €500 really did come out of the till.
  const inv = one([invoice({ amount_paid: 500 })], [link({ id: "t1", amount_applied: 200 }), link({ id: "t2", amount_applied: 300 })]);
  assert.equal(inv.cash_paid, 500);
  assert.equal(settlementGross(inv), 500, "the drawer would have been told nothing moved");
});

test("[KAS-SAMENSTELLING] a handover stored negative is still money that left the till", () => {
  // amount_applied carries a sign in some write paths. Letting it through would subtract one
  // handover from another, and the invoice would hold, on paper, less cash than the till took.
  const inv = one([invoice()], [link({ id: "t1", amount_applied: 200 }), link({ id: "t2", amount_applied: -300 })]);
  assert.equal(inv.cash_paid, 500);
});

test("[KAS-SAMENSTELLING] an unreadable amount counts as nothing, never as NaN", () => {
  // A NaN here does not stay in this field: it reaches settlementGross, which compares it, and a
  // comparison against NaN is false — so the invoice silently settles for nothing.
  const inv = one([invoice()], [link({ id: "t1", amount_applied: null }), link({ id: "t2", amount_applied: 250 })]);
  assert.equal(inv.cash_paid, 250);
  assert.ok(Number.isFinite(inv.cash_paid as number));
});

// ── 2. WHETHER it holds any at all — the difference between undefined and 0 ──

test("[KAS-SAMENSTELLING] an invoice with no handovers says 'unknown', not 'nothing'", () => {
  // This is the sharpest line in the file. settlementGross treats any non-null cash_paid as the
  // whole truth, so a 0 written where nothing is known means "no cash moved" — and the reconcile
  // carries that out by removing the entry. `undefined` sends it to the legacy inference instead,
  // which is what a pre-instalment invoice needs.
  const inv = one([invoice({ amount_paid: 300 })], []);
  assert.equal(inv.cash_paid, undefined, "a 0 here deletes the drawer entry of every legacy cash invoice");
  assert.equal(settlementGross(inv), 200, "the legacy remainder (gross 500 − 300 by bank) is no longer inferred");
});

test("[KAS-SAMENSTELLING] …and a handover of genuinely zero still says zero", () => {
  // The other side of the same line: a link that exists and applied nothing is a KNOWN nothing,
  // and inferring a remainder from the bank total on top of it would invent a movement.
  const inv = one([invoice({ amount_paid: 300 })], [link({ amount_applied: 0 })]);
  assert.equal(inv.cash_paid, 0);
  assert.equal(settlementGross(inv), null, "a known-zero cash portion was inflated into a drawer movement");
});

// ── 3. WHICH DAY the money moved ───────────────────────────────────────────

test("[KAS-SAMENSTELLING] with the column, every handover keeps its own day", () => {
  const inv = one([invoice()], [
    link({ id: "t1", amount_applied: 200, paid_on: "2026-07-01" }),
    link({ id: "t2", amount_applied: 300, paid_on: "2026-08-15" }),
  ]);
  assert.deepEqual((inv.cash_instalments ?? []).map((i) => i.paid_on), ["2026-07-01", "2026-08-15"]);
  const rows = buildCashSettlements(inv);
  assert.deepEqual(rows.map((r) => r.entry_date), ["2026-07-01", "2026-08-15"]);
});

test("[KAS-SAMENSTELLING] without it, the one entry is dated by the LAST till handover", () => {
  // The pre-migration model books a single aggregate movement, and it must land on the day the
  // till last moved — not on the invoice's payment_date, which can be the day a BANK instalment
  // arrived. Across a quarter boundary those are two different BTW-aangiftes.
  const inv = one([invoice({ payment_date: "2026-09-30" })], [
    link({ id: "t1", amount_applied: 200, paid_on: "2026-07-01" }),
    link({ id: "t2", amount_applied: 300, paid_on: "2026-08-15" }),
  ], false);
  assert.equal(inv.payment_date, "2026-08-15");
  assert.equal(inv.cash_instalments, undefined, "per-instalment rows without a settlement_id to write them against");
});

test("[KAS-SAMENSTELLING] the last day is the latest one, not the last row read", () => {
  // The links arrive ordered by id so the read can page past PostgREST's 1000-row cap. Id order is
  // not date order, and taking the last row seen would date a July movement in August — or, one
  // quarter over, put the euro in the wrong aangifte.
  const inv = one([invoice()], [
    link({ id: "a", amount_applied: 100, paid_on: "2026-08-15" }),
    link({ id: "b", amount_applied: 100, paid_on: "2026-07-01" }),
  ], false);
  assert.equal(inv.payment_date, "2026-08-15");
});

test("[KAS-SAMENSTELLING] a handover stamped with a time is booked on its day", () => {
  // paid_on can arrive as a timestamp. The drawer books days, and an entry_date carrying a time
  // sorts and groups differently from every other row in the kasboek.
  const inv = one([invoice()], [link({ paid_on: "2026-07-01T22:30:00.000Z" })]);
  assert.equal((inv.cash_instalments ?? [])[0].paid_on, "2026-07-01");
});

test("[KAS-SAMENSTELLING] with no dated handover at all it falls back to the invoice", () => {
  const inv = one([invoice({ payment_date: "2026-09-30" })], [link({ paid_on: null })], false);
  assert.equal(inv.payment_date, "2026-09-30");
  const undated = one([invoice({ payment_date: null })], [link({ paid_on: null })], false);
  assert.equal(undated.payment_date, null, "an invented date is worse than a missing one");
});

// ── 4. WHICH WAY it moved ──────────────────────────────────────────────────

test("[KAS-SAMENSTELLING] a readable direction is never guessed at", () => {
  for (const d of ["incoming", "outgoing"] as const) {
    assert.equal(readableDirection(d, () => assert.fail("a readable direction was reported as a guess")), d);
  }
});

test("[KAS-SAMENSTELLING] an unreadable one books as a purchase, and says so every time", () => {
  // The default is deliberate — dropping the invoice would delete a real movement rather than
  // mis-sign it — so what has to hold is that it is never silent.
  const heard: unknown[] = [];
  const rows = assembleSettleableInvoices({
    invoiceRows: [invoice({ id: "a", direction: null }), invoice({ id: "b", direction: "verkoop" })],
    index: indexCashInstalments([]),
    perInstalment: true,
    onUnreadableDirection: (id, v) => heard.push([id, v]),
  });
  assert.deepEqual(rows.map((r) => r.direction), ["incoming", "incoming"]);
  assert.deepEqual(heard, [["a", null], ["b", "verkoop"]]);
});

// ── Who the reconcile is allowed to look at ────────────────────────────────

test("[MANUAL-PARTIAL-PAY] an invoice holding cash while still open is not left behind", () => {
  // €200 of a €500 invoice taken from the till: the invoice is OPEN, so the status-paid query
  // never sees it, and the drawer really moved. It has to be found by its handover instead.
  const index = indexCashInstalments([link({ invoice_id: "open-1" }), link({ id: "t2", invoice_id: "paid-1" })]);
  assert.deepEqual(openCashInvoiceIds(index, new Set(["paid-1"])), ["open-1"]);
});

test("[MANUAL-PARTIAL-PAY] and an invoice already read is not read twice", () => {
  const index = indexCashInstalments([link({ invoice_id: "paid-1" })]);
  assert.deepEqual(openCashInvoiceIds(index, new Set(["paid-1"])), []);
});

test("[KAS-SAMENSTELLING] a link pointing at no invoice is skipped, not turned into one", () => {
  const index = indexCashInstalments([link({ invoice_id: null }), link({ id: "t2", invoice_id: "inv-1" })]);
  assert.deepEqual([...index.cashByInvoice.keys()], ["inv-1"]);
  assert.deepEqual(openCashInvoiceIds(index, new Set()), ["inv-1"]);
});

test("[KAS-SAMENSTELLING] the invoice's own columns survive the assembly untouched", () => {
  // The reconcile reads total_inc_btw, invoice_number and client_name off these rows to build the
  // drawer entry's amount and description. A spread that dropped them would leave the entry
  // describing nothing, and settlementGross with no gross to work from.
  const inv = one([invoice({ total_inc_btw: 500, invoice_number: "F-42", client_name: "De Bakker" })], []);
  assert.equal(inv.total_inc_btw, 500);
  assert.equal(inv.invoice_number, "F-42");
  assert.equal(inv.client_name, "De Bakker");
});
