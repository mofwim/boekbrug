// src/lib/financial-result-assets.test.ts — run: npx tsx --test src/lib/financial-result-assets.test.ts
// [BEDRIJFSMIDDEL] A registered asset leaves the costs and comes back only as depreciation —
// under both btw schemes — and its btw is deducted exactly as before.
import { test } from "node:test";
import assert from "node:assert/strict";
import { computeResult, type ResultInvoice } from "./financial-result";
import { buildSettlementEvents } from "./kas-payment-events";

const near = (a: number, b: number) => Math.abs(a - b) < 0.005;
const oven: ResultInvoice = { id: "oven", direction: "incoming", status: "paid", total_ex_btw: 3000, btw_amount: 630 };
const meat: ResultInvoice = { id: "meat", direction: "incoming", status: "paid", total_ex_btw: 2500, btw_amount: 225 };
const sale: ResultInvoice = { id: "sale", direction: "outgoing", status: "paid", total_ex_btw: 10000, btw_amount: 2100 };

test("[BEDRIJFSMIDDEL] accrual: the registered purchase is an investment, not a cost; its btw is still deducted", () => {
  const before = computeResult([oven, meat, sale], [], [], []);
  assert.ok(near(before.kosten, 5500), "without a register the oven is a cost, as before");
  assert.equal(before.investeringen, 0);
  assert.equal(before.afschrijvingen, 0);
  assert.equal(before.assetsUnreadable, false);

  const after = computeResult([oven, meat, sale], [], [], [], undefined, 0, undefined, {
    assetInvoiceIds: new Set(["oven"]), afschrijvingen: 150,
  });
  assert.ok(near(after.kosten, 2500 + 150), "the meat stays a cost; the oven is replaced by its depreciation");
  assert.ok(near(after.investeringen, 3000));
  assert.equal(after.afschrijvingen, 150);
  assert.ok(near(after.resultaat, 10000 - 2650));
  assert.ok(near(after.btwVoorbelasting, before.btwVoorbelasting), "the btw-aangifte does not move");
  assert.ok(near(after.btwSaldo, before.btwSaldo));
});

test("[BEDRIJFSMIDDEL] kasstelsel: the settlement slice of a registered purchase is an investment too", () => {
  const hdr = { invoiceId: "oven", direction: "incoming" as const, totalEx: 3000, totalBtw: 630, totalInc: 3630 };
  const events = buildSettlementEvents(hdr, 0, [{ payDate: "2026-03-01", amountApplied: 3630, estimated: false }]);
  const plain = computeResult([], [], [], [], undefined, 0, undefined, { scheme: "kas", settlements: events });
  assert.ok(near(plain.kosten, 3000));
  const reg = computeResult([], [], [], [], undefined, 0, undefined, {
    scheme: "kas", settlements: events, assetInvoiceIds: new Set(["oven"]), afschrijvingen: 50,
  });
  assert.ok(near(reg.kosten, 50), "only the depreciation is a cost");
  assert.ok(near(reg.investeringen, 3000));
  assert.ok(near(reg.btwVoorbelasting, plain.btwVoorbelasting), "btw unchanged under kas as well");
});

test("[BEDRIJFSMIDDEL] a failed register read is said, and the figures fall back to the old treatment", () => {
  const r = computeResult([oven], [], [], [], undefined, 0, undefined, { assetsUnreadable: true });
  assert.equal(r.assetsUnreadable, true);
  assert.ok(near(r.kosten, 3000), "no register → the purchase is a cost, exactly as before");
});

test("[BEDRIJFSMIDDEL] negative controls — the id is the key, and a row without one books as a cost", () => {
  const noId: ResultInvoice = { direction: "incoming", status: "paid", total_ex_btw: 3000, btw_amount: 630 };
  const r = computeResult([noId], [], [], [], undefined, 0, undefined, { assetInvoiceIds: new Set(["oven"]) });
  assert.ok(near(r.kosten, 3000), "a caller that omits the id cannot have its purchase excluded");
  const wrongId = computeResult([oven], [], [], [], undefined, 0, undefined, { assetInvoiceIds: new Set(["other"]) });
  assert.ok(near(wrongId.kosten, 3000));
  const negative = computeResult([oven], [], [], [], undefined, 0, undefined, { afschrijvingen: -500 });
  assert.equal(negative.afschrijvingen, 0, "depreciation is never negative");
});
