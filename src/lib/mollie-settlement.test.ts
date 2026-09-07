// [MOLLIE-AFREKENING] Run: npx tsx --test src/lib/mollie-settlement.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  feeInvoiceFrom, isPayoutOf, payoutLineVerdict, splitPayments, summarizeSettlement, paymentsCoverRevenue, holdReason, feeClientKey,
  type MollieSettlement,
} from "./mollie-settlement";

const eur = (value: string) => ({ currency: "EUR", value });

/** A settlement as the API returns it: two iDEAL payments, one fee line at 21%. */
function settlement(over: Partial<MollieSettlement> = {}): MollieSettlement {
  return {
    id: "stl_jDk30akdN",
    reference: "1234567.2609.01",
    status: "paidout",
    amount: eur("1509.42"),
    settledAt: "2026-09-04T06:00:00+00:00",
    periods: {
      "2026": {
        "09": {
          invoiceId: "inv_FrvewDA3Pr",
          revenue: [{ description: "iDEAL", method: "ideal", count: 2, amountNet: eur("1510.00"), amountVat: null, amountGross: eur("1510.00") }],
          costs: [{ description: "iDEAL", method: "ideal", count: 2, amountNet: eur("0.48"), amountVat: eur("0.10"), amountGross: eur("0.58") }],
        },
      },
    },
    ...over,
  };
}

test("[MOLLIE-AFREKENING] a settlement that reconciles becomes cents-exact totals", () => {
  const v = summarizeSettlement(settlement());
  assert.ok(v.ok);
  assert.equal(v.summary.revenueGross, 1510);
  assert.equal(v.summary.costsNet, 0.48);
  assert.equal(v.summary.costsVat, 0.1);
  assert.equal(v.summary.costsGross, 0.58);
  assert.equal(v.summary.payout, 1509.42);
  assert.equal(v.summary.settledOn, "2026-09-04");
  assert.deepEqual(v.summary.invoiceIds, ["inv_FrvewDA3Pr"]);
  assert.equal(v.summary.oddVatLines, 0);
});

test("[MOLLIE-AFREKENING] a settlement that does not add up is refused, never booked", () => {
  const v = summarizeSettlement(settlement({ amount: eur("1509.00") }));
  assert.ok(!v.ok);
  assert.match(v.reason, /≠ uitbetaald/);
  const bad = settlement();
  bad.periods!["2026"]["09"].costs![0].amountGross = eur("0.60");
  const w = summarizeSettlement(bad);
  assert.ok(!w.ok && /telt niet op/.test(w.reason));
  const open = summarizeSettlement(settlement({ status: "open" }));
  assert.ok(!open.ok && /nog niet uitbetaald/.test(open.reason));
  const gbp = summarizeSettlement(settlement({ amount: { currency: "GBP", value: "1509.42" } }));
  assert.ok(!gbp.ok && /GBP/.test(gbp.reason));
});

test("[MOLLIE-AFREKENING] the fee invoice is a purchase from Mollie keyed on the settlement, and absent when there is no fee", () => {
  const v = summarizeSettlement(settlement());
  assert.ok(v.ok);
  const fee = feeInvoiceFrom(v.summary)!;
  assert.equal(fee.clientName, "Mollie B.V.");
  assert.equal(fee.invoiceNumber, "MOLLIE-1234567.2609.01");
  assert.equal(fee.invoiceDate, "2026-09-04");
  assert.deepEqual([fee.totalExBtw, fee.btwAmount, fee.totalIncBtw], [0.48, 0.1, 0.58]);
  // No costs → no invoice: a fee of 0.00 is a document that says Mollie worked for free.
  const free = settlement({ amount: eur("1510.00") });
  free.periods!["2026"]["09"].costs = [];
  const f = summarizeSettlement(free);
  assert.ok(f.ok);
  assert.equal(feeInvoiceFrom(f.summary), null);
});

test("[MOLLIE-AFREKENING] payments split into ours and not ours; unreadable ones are named", () => {
  const split = splitPayments(
    [
      { id: "tr_a", amount: eur("1000.00") },
      { id: "tr_b", amount: eur("510.00") },
      { id: "tr_c", amount: eur("25.00") },
      { id: "tr_d", amount: null },
    ],
    new Set(["tr_a", "tr_b"]),
  );
  assert.equal(split.linkedGross, 1510);
  assert.equal(split.linkedCount, 2);
  assert.equal(split.unlinkedGross, 25);
  assert.equal(split.unlinkedCount, 1);
  assert.deepEqual(split.unreadable, ["tr_d"]);
  assert.equal(payoutLineVerdict(split), "hold");
  assert.equal(payoutLineVerdict({ linkedGross: 1510, linkedCount: 2, unlinkedGross: 0, unlinkedCount: 0, unreadable: [] }), "transfer");
  // One unreadable payment is enough to hold: money the app cannot place is not a transfer.
  assert.equal(payoutLineVerdict({ linkedGross: 1510, linkedCount: 2, unlinkedGross: 0, unlinkedCount: 0, unreadable: ["tr_x"] }), "hold");
});

test("[MOLLIE-AFREKENING] the payout line needs the amount, the name and the date — all three", () => {
  const v = summarizeSettlement(settlement());
  assert.ok(v.ok);
  const s = v.summary;
  const line = { amount: 1509.42, date: "2026-09-05", description: "Mollie Payments 1234567.2609.01", counterpart_name: "Stichting Mollie Payments" };
  assert.ok(isPayoutOf(line, s));
  assert.ok(!isPayoutOf({ ...line, amount: 1509.41 }, s), "a cent off is another settlement");
  assert.ok(!isPayoutOf({ ...line, description: "Overboeking", counterpart_name: "J. Jansen" }, s), "no Mollie in the text");
  assert.ok(isPayoutOf({ ...line, description: "1234567.2609.01", counterpart_name: null }, s), "the bank reference alone names it");
  assert.ok(!isPayoutOf({ ...line, date: "2026-09-20" }, s), "sixteen days later is a different settlement");
});

test("[MOLLIE-AFREKENING] a refund or chargeback inside the settlement holds it, even when every payment is ours", () => {
  const v = summarizeSettlement(settlement());
  assert.ok(v.ok);
  const payments = [{ id: "tr_a", amount: eur("1000.00") }, { id: "tr_b", amount: eur("510.00") }];
  const split = splitPayments(payments, new Set(["tr_a", "tr_b"]));
  assert.equal(payoutLineVerdict(split), "transfer", "the old verdict: every payment is ours");
  assert.equal(payoutLineVerdict(split, { summary: v.summary, adjustments: 0 }), "transfer");
  assert.equal(payoutLineVerdict(split, { summary: v.summary, adjustments: 1 }), "hold", "one refund → hold");
  // The payments do not explain the revenue: something else (a refund line) sits in it.
  const short = splitPayments([{ id: "tr_a", amount: eur("1000.00") }], new Set(["tr_a"]));
  assert.equal(paymentsCoverRevenue(short, v.summary), false);
  assert.equal(payoutLineVerdict(short, { summary: v.summary, adjustments: 0 }), "hold");
  assert.equal(paymentsCoverRevenue(split, v.summary), true);
  const reason = holdReason(split, v.summary, 1);
  assert.match(reason, /terugbetaling/);
  assert.match(reason, /één netto bedrag/, "the owner is told the line is netted, so nobody codes it whole as omzet");
  assert.match(holdReason(splitPayments(payments, new Set(["tr_a"])), v.summary, 0), /€ 510\.00 van de betalingen hoort niet bij een BoekBrug-factuur/);
});

test("[MOLLIE-AFREKENING] the fee payment key is one per (settlement row, invoice), deterministic, uuid-shaped", () => {
  const k1 = feeClientKey("11111111-2222-3333-4444-555555555555", "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee");
  assert.match(k1, /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-a[0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.equal(feeClientKey("11111111-2222-3333-4444-555555555555", "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"), k1, "a retry replays the same booking");
  assert.notEqual(feeClientKey("11111111-2222-3333-4444-555555555555", "ffffffff-bbbb-cccc-dddd-eeeeeeeeeeee"), k1, "a recreated invoice gets its own key");
});
