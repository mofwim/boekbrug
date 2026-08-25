// src/lib/xaf-export.test.ts
// [XAF] The auditfile is a projection of sources into balanced journals — these tests pin the
// three iron rules (sum-of-parts balance, vraagposten for the unattributable, voorbelasting only
// where documented) and the XML shape an importing package validates.
// Run: npx tsx --test src/lib/xaf-export.test.ts

import { test } from "node:test";
import assert from "node:assert/strict";

import { buildXafFile, snapRate, type XafInput } from "./xaf-export";

function baseInput(): XafInput {
  return {
    year: 2026,
    dateCreated: "2026-08-25",
    company: { name: "Kiwi Food Market", kvkNumber: "12345678", btwNumber: "NL123456789B01", address: "Dorpsstraat 1", postalCode: "1234 AB", city: "Utrecht" },
    sales: [], purchases: [], bank: [], cash: [], turnover: [],
  };
}

/** All trLine amounts of the file, as [accID, amnt, amntTp] triples in document order. */
function lines(xml: string): Array<[string, string, string]> {
  const out: Array<[string, string, string]> = [];
  const re = /<trLine>[\s\S]*?<accID>(.*?)<\/accID>[\s\S]*?<amnt>(.*?)<\/amnt>\s*<amntTp>(.*?)<\/amntTp>/g;
  for (let m = re.exec(xml); m; m = re.exec(xml)) out.push([m[1], m[2], m[3]]);
  return out;
}

test("a sales invoice books gross debiteuren as the SUM of its parts, per rate, balanced", () => {
  const input = baseInput();
  input.sales.push({
    id: "inv-1", invoiceNumber: "20260001", invoiceDate: "2026-03-10", clientName: "Vermeulen BV",
    totalExBtw: 1000, btwAmount: 120, invoiceType: "factuur",
    rateLines: [{ rate: 21, ex: 400, btw: 84 }, { rate: 9, ex: 400, btw: 36 }, { rate: 0, ex: 200, btw: 0 }],
  });
  const r = buildXafFile(input);
  assert.equal(r.skipped.length, 0);
  assert.equal(r.totalDebit, r.totalCredit);
  const got = lines(r.xml);
  assert.deepEqual(got[0], ["1300", "1120.00", "D"], "debiteuren carries the sum of the parts");
  assert.ok(got.some(([a, amt, tp]) => a === "8000" && amt === "400.00" && tp === "C"));
  assert.ok(got.some(([a, amt, tp]) => a === "8010" && amt === "400.00" && tp === "C"));
  assert.ok(got.some(([a, amt, tp]) => a === "8020" && amt === "200.00" && tp === "C"));
  assert.ok(got.some(([a, amt, tp]) => a === "1500" && amt === "120.00" && tp === "C"));
  assert.match(r.xml, /<custSupID>D00001<\/custSupID>/, "the debiteur reaches the sub-administration");
});

test("a creditnota (stored negative, [CREDIT-SIGN]) flips every side and still balances", () => {
  const input = baseInput();
  input.sales.push({
    id: "cn-1", invoiceNumber: "20260002", invoiceDate: "2026-04-01", clientName: "Vermeulen BV",
    totalExBtw: -100, btwAmount: -21, invoiceType: "creditnota", rateLines: null,
  });
  const r = buildXafFile(input);
  assert.equal(r.skipped.length, 0);
  const got = lines(r.xml);
  assert.deepEqual(got[0], ["1300", "121.00", "C"], "the debiteur is credited, not debited");
  assert.ok(got.some(([a, amt, tp]) => a === "8000" && amt === "100.00" && tp === "D"));
});

test("an unherleidbaar rate and a total that does not add up are REFUSED, and the file says so", () => {
  const input = baseInput();
  input.sales.push(
    { id: "bad-rate", invoiceNumber: "X1", invoiceDate: "2026-05-01", clientName: "A", totalExBtw: 100, btwAmount: 15, invoiceType: "factuur", rateLines: null },
    { id: "bad-sum", invoiceNumber: "X2", invoiceDate: "2026-05-02", clientName: "A", totalExBtw: 1000, btwAmount: 210, invoiceType: "factuur", rateLines: [{ rate: 21, ex: 500, btw: 105 }] },
    { id: "no-date", invoiceNumber: "X3", invoiceDate: null, clientName: "A", totalExBtw: 10, btwAmount: 2.1, invoiceType: "factuur", rateLines: null },
  );
  const r = buildXafFile(input);
  assert.equal(r.entryCount, 0);
  assert.deepEqual(r.skipped.map((s) => s.id).sort(), ["bad-rate", "bad-sum", "no-date"]);
  assert.match(r.xml, /BoekBrug: 3 regel\(s\) niet opgenomen/, "refusals are said inside the file itself");
});

test("a purchase invoice books kosten + voorbelasting against crediteuren", () => {
  const input = baseInput();
  input.purchases.push({ id: "p-1", invoiceNumber: "F-88", invoiceDate: "2026-02-02", vendorName: "Sligro", totalExBtw: 200, btwAmount: 18 });
  const r = buildXafFile(input);
  const got = lines(r.xml);
  assert.ok(got.some(([a, amt, tp]) => a === "4000" && amt === "200.00" && tp === "D"));
  assert.ok(got.some(([a, amt, tp]) => a === "1400" && amt === "18.00" && tp === "D"));
  assert.ok(got.some(([a, amt, tp]) => a === "1600" && amt === "218.00" && tp === "C"));
  assert.match(r.xml, /<custSupID>C00001<\/custSupID>/);
});

test("bank counter-accounts follow what the app KNOWS: link, card payout, else vraagposten", () => {
  const input = baseInput();
  input.bank.push(
    { id: "b1", date: "2026-01-05", amount: 121, description: "ontvangst factuur", category: null, linkedInvoiceDirection: "outgoing", posSettlement: false },
    { id: "b2", date: "2026-01-06", amount: -218, description: "betaling sligro", category: null, linkedInvoiceDirection: "incoming", posSettlement: false },
    { id: "b3", date: "2026-01-07", amount: 500.5, description: "CCV batch 12", category: "omzet", linkedInvoiceDirection: null, posSettlement: true },
    { id: "b4", date: "2026-01-08", amount: -40, description: "parkeren", category: "kosten", linkedInvoiceDirection: null, posSettlement: false },
  );
  const r = buildXafFile(input);
  const got = lines(r.xml);
  assert.ok(got.some(([a, amt, tp]) => a === "1300" && amt === "121.00" && tp === "C"), "linked sale settles debiteuren");
  assert.ok(got.some(([a, amt, tp]) => a === "1600" && amt === "218.00" && tp === "D"), "linked purchase settles crediteuren");
  assert.ok(got.some(([a, amt, tp]) => a === "1350" && amt === "500.50" && tp === "C"), "a card payout waits on kruisposten");
  assert.ok(got.some(([a, amt, tp]) => a === "2100" && amt === "40.00" && tp === "D"), "an unlinked cost line is a QUESTION, not a booking");
  assert.match(r.xml, /\[kosten\]/, "the owner's category travels as a hint on the vraagpost");
});

test("cash: covered omzet is a witness; voorbelasting books ONLY on a documented cost", () => {
  const input = baseInput();
  input.purchases.push({ id: "p-doc", invoiceNumber: "F-1", invoiceDate: "2026-06-01", vendorName: "Sligro", totalExBtw: 50, btwAmount: 10.5 });
  input.cash.push(
    { id: "c1", date: "2026-06-02", direction: "in", amount: 121, category: "omzet", btwRate: 21, documentId: null, coveredByTurnover: true },
    { id: "c2", date: "2026-06-03", direction: "in", amount: 121, category: "omzet", btwRate: 21, documentId: null, coveredByTurnover: false },
    { id: "c3", date: "2026-06-04", direction: "out", amount: 60.5, category: "kantoor", btwRate: null, documentId: null, coveredByTurnover: false },
    { id: "c4", date: "2026-06-05", direction: "out", amount: 60.5, category: "kosten", btwRate: 21, documentId: "p-doc", coveredByTurnover: false },
  );
  const r = buildXafFile(input);
  assert.equal(r.turnoverWitnessCount, 1, "the covered row is a witness, not a second booking");
  const got = lines(r.xml);
  assert.ok(got.some(([a, amt, tp]) => a === "8000" && amt === "100.00" && tp === "C"), "rated cash sale splits ex");
  assert.ok(got.some(([a, amt, tp]) => a === "1500" && amt === "21.00" && tp === "C"), "…and its BTW");
  // c3: undocumented → GROSS on kosten, and NO voorbelasting line for it.
  assert.ok(got.some(([a, amt, tp]) => a === "4000" && amt === "60.50" && tp === "D"), "undocumented cost books gross");
  const voorbelasting = got.filter(([a]) => a === "1400");
  assert.equal(voorbelasting.length, 1, "exactly one voorbelasting line in the whole file: the purchase invoice's own");
  // c4: pays a purchase that is in the inkoopboek → settles the crediteur, claims nothing again.
  assert.ok(got.some(([a, amt, tp]) => a === "1600" && amt === "60.50" && tp === "D"), "documented payment settles crediteuren");
});

test("a Z-day whose money side differs from its sales side books the difference as kasverschil", () => {
  const input = baseInput();
  input.turnover.push({ date: "2026-07-01", base0: 0, base9: 100, base21: 200, btw9: 9, btw21: 42, pinAmount: 250, cashAmount: 100, otherAmount: 0 });
  const r = buildXafFile(input);
  assert.equal(r.skipped.length, 0);
  assert.equal(r.totalDebit, r.totalCredit, "the plug keeps the day balanced");
  const got = lines(r.xml);
  assert.ok(got.some(([a, amt, tp]) => a === "2100" && amt === "1.00" && tp === "D"), "the missing euro is a NAMED question");
  assert.ok(got.some(([a, amt, tp]) => a === "1350" && amt === "250.00" && tp === "D"), "pin waits on kruisposten");
});

test("the XML shape holds: escaping, ids within 35 chars, linesCount counting trLines", () => {
  const input = baseInput();
  input.company.name = "K&W <Horeca> B.V.";
  input.sales.push({ id: "s", invoiceNumber: "1", invoiceDate: "2026-01-01", clientName: "A&B", totalExBtw: 100, btwAmount: 21, invoiceType: "factuur", rateLines: null });
  const r = buildXafFile(input);
  assert.match(r.xml, /K&amp;W &lt;Horeca&gt; B\.V\./);
  assert.doesNotMatch(r.xml, /<custSupID>[^<]{36,}</, "IdentificationString35 would refuse a raw uuid");
  const declared = Number(/<linesCount>(\d+)<\/linesCount>/.exec(r.xml)![1]);
  const actual = (r.xml.match(/<trLine>/g) ?? []).length;
  assert.equal(declared, actual, "the declared count is the real count");
  assert.match(r.xml, /<leadReference>BLimKasKas<\/leadReference>/, "verified RGS travels on the account");
});

test("snapRate derives only the rates that are really there", () => {
  assert.equal(snapRate(100, 21), 21);
  assert.equal(snapRate(100, 9), 9);
  assert.equal(snapRate(100, 0), 0);
  assert.equal(snapRate(100, 15), null);
  assert.equal(snapRate(0, 5), null);
});
