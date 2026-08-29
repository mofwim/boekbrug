// [TRUTH-SEAM] Run: npx tsx --test src/lib/result-range-assemble.test.ts
//
// The FIRST behavioural test of the engine behind /dashboard/waarheid — the screen called "je
// financiële waarheid". MONEY_PATH_AUDIT_2026-08.md §3: 485 lines, one source gate, no behavioural
// test, "the single largest untested money surface in the repo". It had none because every path in
// began with an await against Supabase; now it takes rows, so this file can exist.
//
// What is asserted here is deliberately not arithmetic — triangle.ts, card-reconcile.ts and
// financial-result.ts each have their own tests for that, with 40, 33 and more assertions. What
// had no cover at all is the ASSEMBLY: which rows reach which engine, which window they are
// clipped to, and which of the two VAT bases is in force. Every defect this file is written
// against is a wiring defect, and each one moves real money on a real screen.

import { test } from "node:test";
import assert from "node:assert/strict";
import { assembleRangeResult, type RangeInputs, type RangeInvoiceRow } from "./result-range-assemble";

const OWNER = "owner-1";
const Q1 = { start: "2026-01-01", end: "2026-03-31" };

/** A window with nothing in it. Each test overrides only the rows it is about. */
function inputs(over: Partial<RangeInputs> = {}): RangeInputs {
  return {
    ownerId: OWNER, start: Q1.start, end: Q1.end,
    scheme: "factuur", span: null,
    invRows: [], exemption: { active: false, deductionByInvoice: new Map() },
    rateSharesByInvoice: new Map(), exemptExByInvoice: new Map(),
    bankBufRows: [], cashRows: [], turnoverRows: [], eftRows: [],
    pinLedgerRows: [], pinLedgerAvailable: true, kas: null, datelessRows: [],
    ...over,
  };
}

const sale = (over: Partial<RangeInvoiceRow> = {}): RangeInvoiceRow => ({
  id: "s1", direction: "outgoing", status: "paid", total_ex_btw: 1000, btw_amount: 210,
  invoice_date: "2026-02-01", sender_id: OWNER, receiver_id: null, client_name: "Klant", ...over,
});

const turnoverDay = (date: string, over: Record<string, number | null> = {}) => ({
  turnover_date: date, base_0: 0, base_9: 0, base_21: 1000, btw_9: 0, btw_21: 210,
  total_incl: 1210, pin_amount: 1210, cash_amount: 0, other_amount: 0, ...over,
});

const eftDay = (date: string, gross: number) => ({
  settlement_date: date, terminal_id: "T1", period_nr: "1", shift_nr: null,
  period_start: null, period_end: null, first_trx: null, last_trx: null,
  gross_total: gross, tx_count: 10, by_scheme: null,
});

// ── The window ────────────────────────────────────────────────────────────────────────────────

test("a bank line in the buffer but outside the window books no money", () => {
  // The ±5-day buffer exists to ANCHOR the triangle across a quarter edge. If a buffer day's money
  // reached computeResult, every quarter would book five days of the next one — and the year would
  // not equal the sum of its quarters, on a screen whose whole promise is that it does.
  const inWindow = assembleRangeResult(inputs({
    bankBufRows: [{ amount: 500, category: "omzet", invoice_id: null, date: "2026-03-31", description: "verkoop", counterpart_name: null }],
  }));
  const inBuffer = assembleRangeResult(inputs({
    bankBufRows: [{ amount: 500, category: "omzet", invoice_id: null, date: "2026-04-02", description: "verkoop", counterpart_name: null }],
  }));
  assert.ok(inWindow.result.omzet > 0, "the last day of the quarter is in the quarter");
  assert.equal(inBuffer.result.omzet, 0, "two days into the next quarter is not");
});

test("a bank line with no date belongs to no window at all", () => {
  const r = assembleRangeResult(inputs({
    bankBufRows: [{ amount: 900, category: "omzet", invoice_id: null, date: null, description: "verkoop", counterpart_name: null }],
  }));
  assert.equal(r.result.omzet, 0, "a date-less line cannot be placed, so it is not placed");
});

test("turnover outside the window is an anchor, never revenue", () => {
  const r = assembleRangeResult(inputs({
    turnoverRows: [turnoverDay("2026-04-02"), turnoverDay("2026-02-10")],
  }));
  assert.equal(r.result.omzet, 1000, "only the in-window till day is revenue");
});

// ── The two legs that must agree ──────────────────────────────────────────────────────────────

test("[ONE-BANK-READ] a payout the owner tapped as plain 'omzet' still books its commission", () => {
  // The defect this guards: the result leg recognised an acquirer payout from its text, while the
  // triangle leg asked the database for category = 'pos_income'. A mis-categorised payout was
  // therefore suppressed as "already counted by the till" AND invisible to the triangle — so the
  // acquirer commission, a real deductible cost, was silently dropped and resultaat overstated.
  const r = assembleRangeResult(inputs({
    turnoverRows: [turnoverDay("2026-02-10")],
    eftRows: [eftDay("2026-02-10", 1210)],
    bankBufRows: [{
      amount: 1185.8, category: "omzet", invoice_id: null, date: "2026-02-11",
      description: "CCV afrekening", counterpart_name: "CCV Group",
    }],
  }));
  assert.ok(r.reconciliation.totalCommission > 0, "the commission is measured");
  assert.equal(r.reconciliation.commissionBooked, r.reconciliation.totalCommission, "and booked as a cost");
  assert.ok(r.result.kosten > 0, "so it reaches kosten instead of vanishing into a tolerance");
});

test("an acquirer fee INVOICE already booked is not charged a second time", () => {
  const withoutInvoice = assembleRangeResult(inputs({
    turnoverRows: [turnoverDay("2026-02-10")],
    eftRows: [eftDay("2026-02-10", 1210)],
    bankBufRows: [{ amount: 1185.8, category: "pos_income", invoice_id: null, date: "2026-02-11", description: "afrekening", counterpart_name: null }],
  }));
  const withInvoice = assembleRangeResult(inputs({
    invRows: [sale({ id: "fee", direction: "incoming", status: "paid", client_name: "CCV Group", total_ex_btw: 20, btw_amount: 0, sender_id: null, receiver_id: OWNER })],
    turnoverRows: [turnoverDay("2026-02-10")],
    eftRows: [eftDay("2026-02-10", 1210)],
    bankBufRows: [{ amount: 1185.8, category: "pos_income", invoice_id: null, date: "2026-02-11", description: "afrekening", counterpart_name: null }],
  }));
  assert.ok(withInvoice.reconciliation.acquirerFeeInvoices > 0, "the fee invoice is recognised");
  assert.ok(
    withInvoice.reconciliation.commissionBooked < withoutInvoice.reconciliation.commissionBooked,
    "and the auto-booked delta shrinks by exactly what the invoice already carries",
  );
});

// ── The two VAT bases ─────────────────────────────────────────────────────────────────────────

test("under kas the triangle delta is measured but never auto-booked", () => {
  // Its cost is deductible when the acquirer's own invoice is PAID, through that invoice's
  // settlement. Auto-booking it here would place the same cost in the wrong period, twice.
  const rows = {
    turnoverRows: [turnoverDay("2026-02-10")],
    eftRows: [eftDay("2026-02-10", 1210)],
    bankBufRows: [{ amount: 1185.8, category: "pos_income", invoice_id: null, date: "2026-02-11", description: "afrekening", counterpart_name: null }],
  };
  const factuur = assembleRangeResult(inputs(rows));
  const kas = assembleRangeResult(inputs({
    ...rows, scheme: "kas",
    kas: { events: [], priorByInvoice: new Map(), undatedPaidCount: 2, estimatedCount: 1,
      settledSales: [], settledShares: new Map(), settledExempt: new Map(), settledDeductionByInvoice: new Map() },
  }));
  assert.ok(kas.reconciliation.totalCommission > 0, "still measured — the owner must see it");
  assert.equal(kas.reconciliation.commissionBooked, 0, "never claimed as booked under kas");
  assert.ok(factuur.reconciliation.commissionBooked > 0, "while accrual does book it");
  assert.equal(kas.undatedPaidCount, 2, "the money we could not date travels out, to block the filing");
  assert.equal(kas.estimatedPortionCount, 1);
});

test("the dateless count is a FACTUUR signal and is silent under kas", () => {
  const dateless: RangeInvoiceRow[] = [
    { id: "d1", direction: "outgoing", status: "sent", total_ex_btw: 100, btw_amount: 21, receiver_id: null },
    { id: "d2", direction: "outgoing", status: "draft", total_ex_btw: 100, btw_amount: 21, receiver_id: null },
  ];
  const factuur = assembleRangeResult(inputs({ datelessRows: dateless }));
  assert.equal(factuur.datelessVerifiedCount, 1, "a draft is not verified money; a sent invoice is");

  const kas = assembleRangeResult(inputs({
    scheme: "kas", datelessRows: dateless,
    kas: { events: [], priorByInvoice: new Map(), undatedPaidCount: 0, estimatedCount: 0,
      settledSales: [], settledShares: new Map(), settledExempt: new Map(), settledDeductionByInvoice: new Map() },
  }));
  assert.equal(kas.datelessVerifiedCount, 0, "under kas the invoice date is irrelevant, so it says nothing");
});

// ── [FIN-4] The rule that a NULL direction is inferred from ownership ─────────────────────────

test("a purchase invoice with a NULL direction is still counted as unconfirmed", () => {
  // The gate used to filter on `direction = 'incoming'` and simply did not see these rows — so an
  // owner reached "Markeer als ingediend" and met a 409 about a problem no screen had shown.
  const r = assembleRangeResult(inputs({
    invRows: [
      sale({ id: "p1", direction: null, status: "processing", sender_id: null, receiver_id: OWNER }),
      sale({ id: "p2", direction: "incoming", status: "processing", sender_id: null, receiver_id: OWNER }),
      sale({ id: "s1", direction: null, status: "processing", sender_id: OWNER, receiver_id: null }),
    ],
  }));
  assert.equal(r.unconfirmedIncomingCount, 2, "both purchase invoices, however their column reads");
});

// ── What the response must be able to say about itself ────────────────────────────────────────

test("a failed PIN-ledger read is reported, because it makes the reconciliation look cleaner", () => {
  const r = assembleRangeResult(inputs({ pinLedgerAvailable: false }));
  assert.equal(r.reconciliation.pinLedgerAvailable, false, "a weakened all-clear must never pass for a real one");
});

test("a window that straddles the scheme switch says so", () => {
  const r = assembleRangeResult(inputs({
    span: { spansSchemeChange: true, schemeSince: "2026-02-01" },
  }));
  assert.equal(r.spansSchemeChange, true);
  assert.equal(r.schemeSince, "2026-02-01");
  const single = assembleRangeResult(inputs());
  assert.equal(single.spansSchemeChange, false, "an explicitly-passed scheme read no profile to straddle against");
  assert.equal(single.schemeSince, null);
});

test("an empty window is an empty result, not a crash and not a null", () => {
  const r = assembleRangeResult(inputs());
  assert.equal(r.result.omzet, 0);
  assert.equal(r.result.kosten, 0);
  assert.equal(r.result.resultaat, 0);
  assert.equal(r.reconciliation.eftSettlements, 0);
  assert.equal(r.reconciliation.totalCommission, 0);
  assert.equal(r.scheme, "factuur");
});
