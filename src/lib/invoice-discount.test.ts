// [KORTING] Run: npx tsx --test src/lib/invoice-discount.test.ts
//
// The tests that carry weight are the mixed-rate ones and the cent ones. A discount subtracted
// from the total instead of apportioned per rate puts both aangifte boxes wrong on every
// mixed-rate invoice, and a cent that does not land makes the UBL fail BR-CO-10 at the receiving
// access point — both silent, both only visible to an accountant a year later.

import { test } from "node:test";
import assert from "node:assert/strict";
import { applyDiscount, parseDiscount, discountLabel } from "./invoice-discount";
import { computeInvoiceTotals } from "./invoice-totals";

const line = (ex: number, rate: number) => ({ line_total: ex, btw_rate: rate });

test("no discount gives exactly the totals the app computed before", () => {
  // One path, not two: a caller uses this unconditionally, so it must be identical when off.
  const lines = [line(1000, 21), line(500, 9)];
  const d = applyDiscount(lines, null);
  const plain = computeInvoiceTotals(lines);
  assert.equal(d.total_ex_btw, plain.total_ex_btw);
  assert.equal(d.btw_amount, plain.btw_amount);
  assert.equal(d.total_inc_btw, plain.total_inc_btw);
  assert.equal(d.discount_ex_btw, 0);
  assert.deepEqual(d.allowances, []);
});

test("a percentage on a single rate", () => {
  const d = applyDiscount([line(1000, 21)], { type: "percent", value: 10 });
  assert.equal(d.subtotal_ex_btw, 1000);
  assert.equal(d.discount_ex_btw, 100);
  assert.equal(d.total_ex_btw, 900);
  assert.equal(d.btw_amount, 189, "21% over the REDUCED base, not over 1000");
  assert.equal(d.total_inc_btw, 1089);
});

test("an amount on a single rate", () => {
  const d = applyDiscount([line(1000, 21)], { type: "amount", value: 250 });
  assert.equal(d.total_ex_btw, 750);
  assert.equal(d.btw_amount, 157.5);
  assert.equal(d.total_inc_btw, 907.5);
});

test("MIXED RATES: the discount is apportioned, not taken off the total", () => {
  // EUR 1.000 at 21% and EUR 1.000 at 9%, EUR 200 off. Subtracting 200 from the 2.000 total and
  // then computing BTW would owe the wrong amount in BOTH aangifte boxes, in opposite directions.
  const d = applyDiscount([line(1000, 21), line(1000, 9)], { type: "amount", value: 200 });
  assert.equal(d.discount_ex_btw, 200);
  assert.deepEqual(
    d.allowances.map((a) => [a.rate, a.amount]).sort(),
    [[21, 100], [9, 100]].sort(),
    "half from each group, because each contributed half",
  );
  assert.equal(d.total_ex_btw, 1800);
  // 900 × 21% = 189 ; 900 × 9% = 81
  assert.equal(d.btw_amount, 270);
  assert.equal(d.total_inc_btw, 2070);
});

test("MIXED RATES, uneven split: each group loses its own share", () => {
  const d = applyDiscount([line(1500, 21), line(500, 9)], { type: "percent", value: 10 });
  assert.equal(d.discount_ex_btw, 200);
  const by = new Map(d.allowances.map((a) => [a.rate, a.amount]));
  assert.equal(by.get(21), 150, "the 21% group carries three quarters, because it is three quarters");
  assert.equal(by.get(9), 50);
  assert.equal(d.total_ex_btw, 1800);
  assert.equal(d.btw_amount, round2(1350 * 0.21) + round2(450 * 0.09));
});

test("the apportioned parts ALWAYS sum to the discount, to the cent", () => {
  // The failure this guards: a UBL whose allowances and totals disagree by a cent is rejected at
  // the receiving access point (Peppol BIS 3.0, BR-CO-10). Fractions are the normal case here.
  const cases: Array<[Array<ReturnType<typeof line>>, number]> = [
    [[line(33.33, 21), line(33.33, 9), line(33.34, 0)], 10],
    [[line(0.01, 21), line(99.99, 9)], 33.33],
    [[line(7, 21), line(11, 9), line(13, 0)], 5],
    [[line(1, 21), line(1, 9), line(1, 0)], 1],
  ];
  for (const [lines, amount] of cases) {
    const d = applyDiscount(lines, { type: "amount", value: amount });
    const sum = d.allowances.reduce((s, a) => s + a.amount, 0);
    assert.equal(
      round2(sum), d.discount_ex_btw,
      `parts ${JSON.stringify(d.allowances)} must sum to ${d.discount_ex_btw}`,
    );
  }
});

test("a percentage that lands on a fraction of a cent still balances", () => {
  const d = applyDiscount([line(100, 21), line(100, 9), line(100, 0)], { type: "percent", value: 3.33 });
  const sum = round2(d.allowances.reduce((s, a) => s + a.amount, 0));
  assert.equal(sum, d.discount_ex_btw);
  assert.equal(d.total_ex_btw, round2(300 - d.discount_ex_btw));
});

test("a discount bigger than the invoice is capped, never negative", () => {
  // A EUR 500 discount on a EUR 400 invoice is a typo. Turning it into a negative total would
  // invent a credit note; capping keeps the document a document, and the applied figure is
  // returned so a screen can show what really came off.
  const d = applyDiscount([line(400, 21)], { type: "amount", value: 500 });
  assert.equal(d.discount_ex_btw, 400);
  assert.equal(d.total_ex_btw, 0);
  assert.equal(d.btw_amount, 0);
  assert.equal(d.total_inc_btw, 0);
});

test("100% is allowed and empties the invoice; more than 100% is not a percentage", () => {
  const d = applyDiscount([line(400, 21)], { type: "percent", value: 100 });
  assert.equal(d.total_inc_btw, 0);
  assert.equal(parseDiscount("percent", 101), null);
});

test("a creditnota keeps its own arithmetic — a discount does not touch negative lines", () => {
  // Halving a negative is arithmetic nobody can check by eye, and a discount on a correction is
  // not something anyone asks for.
  const d = applyDiscount([line(-1000, 21)], { type: "percent", value: 10 });
  assert.equal(d.discount_ex_btw, 0);
  assert.deepEqual(d.allowances, []);
  assert.equal(d.total_ex_btw, -1000);
  assert.equal(d.btw_amount, -210);
});

test("a group with a negative share carries no part of the discount", () => {
  // A negative allowance reads as a SURCHARGE in UBL — the opposite of what was typed.
  const d = applyDiscount([line(1000, 21), line(-100, 9)], { type: "amount", value: 100 });
  assert.ok(d.allowances.every((a) => a.amount > 0), "no negative allowance");
  assert.deepEqual(d.allowances, [{ rate: 21, amount: 100 }]);
});

test("an empty or zero discount is no discount", () => {
  // Number("") is 0 — and a zero discount stored would print "Korting: € 0,00" on a customer's
  // invoice. Same trap as the payment term, same answer.
  for (const v of ["", "   ", 0, "0", null, undefined, "abc", -5]) {
    assert.equal(parseDiscount("percent", v), null, `percent ${String(v)}`);
    assert.equal(parseDiscount("amount", v), null, `amount ${String(v)}`);
  }
});

test("a discount needs a KIND, or it is not one", () => {
  assert.equal(parseDiscount("", 10), null);
  assert.equal(parseDiscount("procent", 10), null, "only the two stored spellings count");
  assert.deepEqual(parseDiscount("percent", "12,5"), { type: "percent", value: 12.5 }, "Dutch comma");
  assert.deepEqual(parseDiscount("amount", "99,999"), { type: "amount", value: 100 }, "money is rounded to cents");
});

test("the label says which kind it was", () => {
  assert.equal(discountLabel({ type: "percent", value: 10 }), "Korting (10%)");
  assert.equal(discountLabel({ type: "percent", value: 12.5 }), "Korting (12,5%)", "Dutch decimal comma");
  assert.equal(discountLabel({ type: "amount", value: 50 }), "Korting");
  assert.equal(discountLabel(null), null);
});

function round2(n: number): number {
  return Math.round(n * 100 + 1e-9) / 100;
}

// ── The UBL shape, end to end. A discount in the wrong place is not a cosmetic problem: the
// receiving access point rejects the file and the invoice never arrives. ──

test("[KORTING] the UBL carries one AllowanceCharge per rate, and its totals balance", async () => {
  const { buildInvoiceUbl } = await import("./ubl-export");
  const { xml } = buildInvoiceUbl(
    {
      invoice_number: "2026-001", invoice_date: "2026-08-08", due_date: "2026-09-07",
      client_name: "Klant BV", client_address: "Straat 1", client_city: "Amsterdam",
      client_postal_code: "1000 AA", client_btw_number: null, invoice_type: "factuur",
      total_ex_btw: 1800, btw_amount: 270, total_inc_btw: 2070,
      discount_type: "amount", discount_value: 200,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any,
    [
      { description: "Werk 21", quantity: 1, unit_price: 1000, btw_rate: 21, line_total: 1000 },
      { description: "Werk 9", quantity: 1, unit_price: 1000, btw_rate: 9, line_total: 1000 },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ] as any,
    {
      company_name: "Mijn BV", address: "Weg 2", city: "Utrecht", postal_code: "3500 AA",
      btw_number: "NL001234567B01", kvk_number: "12345678", iban: "NL91ABNA0417164300",
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any,
  );

  const allowances = [...xml.matchAll(/<cac:AllowanceCharge>[\s\S]*?<\/cac:AllowanceCharge>/g)];
  assert.equal(allowances.length, 2, "one per rate — an AllowanceCharge carries exactly one TaxCategory");
  for (const a of allowances) {
    assert.match(a[0], /<cbc:ChargeIndicator>false<\/cbc:ChargeIndicator>/, "false = discount, not surcharge");
    assert.match(a[0], /<cbc:Amount currencyID="EUR">100\.00<\/cbc:Amount>/, "half each, pro rata");
  }
  assert.match(xml, /<cbc:LineExtensionAmount currencyID="EUR">2000\.00</, "lines stay undiscounted");
  assert.match(xml, /<cbc:AllowanceTotalAmount currencyID="EUR">200\.00</);
  assert.match(xml, /<cbc:TaxExclusiveAmount currencyID="EUR">1800\.00</, "lines − allowances");
  assert.match(xml, /<cbc:PayableAmount currencyID="EUR">2070\.00</);

  // BR-CO-10 in one line: LineExtension − AllowanceTotal must equal TaxExclusive, or the file is
  // refused at the receiving access point and the invoice simply never arrives.
  const num = (re: RegExp) => Number(re.exec(xml)![1]);
  assert.equal(
    round2(num(/<cbc:LineExtensionAmount currencyID="EUR">([\d.]+)</) - num(/<cbc:AllowanceTotalAmount currencyID="EUR">([\d.]+)</)),
    num(/<cbc:TaxExclusiveAmount currencyID="EUR">([\d.]+)</),
    "the file must add up with itself",
  );
  // And AllowanceCharge must precede TaxTotal — UBL sequence is not free.
  assert.ok(
    xml.indexOf("<cac:AllowanceCharge>") < xml.indexOf("<cac:TaxTotal>"),
    "AllowanceCharge before TaxTotal, or the file is not schema-valid",
  );
});

test("[KORTING] without a discount the UBL is byte-identical to before the feature", async () => {
  const { buildInvoiceUbl } = await import("./ubl-export");
  const build = (extra: Record<string, unknown>) => buildInvoiceUbl(
    { invoice_number: "2026-002", invoice_date: "2026-08-08", due_date: "2026-09-07",
      client_name: "Klant BV", client_address: "Straat 1", client_city: "Amsterdam",
      client_postal_code: "1000 AA", client_btw_number: null, invoice_type: "factuur",
      total_ex_btw: 1000, btw_amount: 210, total_inc_btw: 1210, ...extra,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    [{ description: "Werk", quantity: 1, unit_price: 1000, btw_rate: 21, line_total: 1000 }] as any,
    { company_name: "Mijn BV", address: "Weg 2", city: "Utrecht", postal_code: "3500 AA",
      btw_number: "NL001234567B01", kvk_number: "12345678", iban: "NL91ABNA0417164300",
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any,
  ).xml;
  const none = build({});
  assert.equal(none, build({ discount_type: null, discount_value: null }));
  assert.doesNotMatch(none, /AllowanceCharge|AllowanceTotalAmount/, "no discount, no allowance elements");
});
