// src/lib/xaf-export.test.ts
// [XAF] The auditfile is a projection of sources into balanced journals — these tests pin the
// three iron rules (sum-of-parts balance, vraagposten for the unattributable, voorbelasting only
// where documented) and the XML shape an importing package validates.
// Run: npx tsx --test src/lib/xaf-export.test.ts

import { test } from "node:test";
import assert from "node:assert/strict";

import { buildXafFile, snapRate, xmlCommentSafe, type XafInput } from "./xaf-export";

function baseInput(): XafInput {
  return {
    year: 2026,
    dateCreated: "2026-08-25",
    company: { name: "Kiwi Food Market", kvkNumber: "12345678", btwNumber: "NL123456789B01", address: "Dorpsstraat 1", postalCode: "1234 AB", city: "Utrecht" },
    endDate: "2026-12-31",
    regimeNotes: [],
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
    { id: "c1", date: "2026-06-02", direction: "in", amount: 121, category: "omzet", btwRate: 21, documentId: null, invoiceId: null, coveredByTurnover: true },
    { id: "c2", date: "2026-06-03", direction: "in", amount: 121, category: "omzet", btwRate: 21, documentId: null, invoiceId: null, coveredByTurnover: false },
    { id: "c3", date: "2026-06-04", direction: "out", amount: 60.5, category: "kosten", btwRate: null, documentId: null, invoiceId: null, coveredByTurnover: false },
    // The settle case rides on cash_entries.INVOICE_id — the audit found the old fixture
    // inventing a documentId↔invoice-id equality production never has, certifying dead code.
    { id: "c4", date: "2026-06-05", direction: "out", amount: 60.5, category: "betaling", btwRate: null, documentId: null, invoiceId: "p-doc", coveredByTurnover: false },
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
  input.turnover.push({ date: "2026-07-01", base0: 0, base9: 100, base21: 200, btw9: 9, btw21: 42, pinAmount: 250, cashAmount: 100, otherAmount: 0, totalIncl: 351 });
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

test("[XAF-KAS] prive/transfer/tax never book as cost; a settle clears the sub-administration", () => {
  const input = baseInput();
  input.cash.push(
    { id: "k1", date: "2026-03-01", direction: "out", amount: 500, category: "prive", btwRate: null, documentId: null, invoiceId: null, coveredByTurnover: false },
    { id: "k2", date: "2026-03-02", direction: "out", amount: 300, category: "transfer", btwRate: null, documentId: null, invoiceId: null, coveredByTurnover: false },
    { id: "k3", date: "2026-03-03", direction: "out", amount: 100, category: "tax", btwRate: null, documentId: null, invoiceId: null, coveredByTurnover: false },
    { id: "k4", date: "2026-03-04", direction: "out", amount: 121, category: "betaling", btwRate: null, documentId: null, invoiceId: "buiten-jaar", coveredByTurnover: false },
  );
  const r = buildXafFile(input);
  const got = lines(r.xml);
  assert.ok(!got.some(([a]) => a === "4000"),
    "a prive-opname, a bank deposit and a tax payment are NOT deductible costs — the audit found all three booked as 4000");
  // [XAF-KRUIS] Via 2100, NOT 1100: the bank journal books the same movement's statement line as
  // 1100 against 2100, so booking 1100 here too counted the deposit twice on the bank account.
  // The two 2100 legs cancel; 1100 moves exactly once, on the statement's side.
  assert.ok(got.some(([a, amt, tp]) => a === "2100" && amt === "300.00" && tp === "D"), "a transfer is a kruispost, not a cost and not a second bank booking");
  assert.ok(!got.some(([a, amt]) => a === "1100" && amt === "300.00"), "…and the cash journal never touches 1100 — that is the statement's booking");
  assert.ok(got.some(([a, amt]) => a === "2100" && amt === "500.00"), "prive is a NAMED question");
  assert.ok(got.some(([a, amt, tp]) => a === "1600" && amt === "121.00" && tp === "D"),
    "a settle of an out-of-year invoice still clears crediteuren, never a phantom cost");
});

test("[XAF-KAS] a cash refund of a sale is NEGATIVE omzet, mirroring the engine — never a cost", () => {
  const input = baseInput();
  input.cash.push(
    { id: "r1", date: "2026-04-01", direction: "out", amount: 121, category: "omzet", btwRate: 21, documentId: null, invoiceId: null, coveredByTurnover: false },
    { id: "r2", date: "2026-04-02", direction: "out", amount: 50, category: "omzet", btwRate: 21, documentId: null, invoiceId: null, coveredByTurnover: true },
  );
  const r = buildXafFile(input);
  assert.equal(r.turnoverWitnessCount, 1, "a refund rung on a Z-day is inside that day's net — witness, both directions");
  const got = lines(r.xml);
  assert.ok(got.some(([a, amt, tp]) => a === "8000" && amt === "100.00" && tp === "D"), "the refund DEBITS omzet");
  assert.ok(got.some(([a, amt, tp]) => a === "1500" && amt === "21.00" && tp === "D"), "…and reverses its BTW");
  assert.ok(!got.some(([a]) => a === "4000"), "money handed back is not a cost");
});

test("[FIN-5] a Z-day with only a printed total still books its revenue", () => {
  const input = baseInput();
  input.turnover.push({ date: "2026-07-02", base0: 0, base9: 0, base21: 0, btw9: 0, btw21: 0, pinAmount: 0, cashAmount: 500, otherAmount: 0, totalIncl: 500 });
  const r = buildXafFile(input);
  assert.equal(r.skipped.length, 0, "the day existed in neither journal before — €500 lived only in an XML comment");
  const got = lines(r.xml);
  assert.ok(got.some(([a, amt, tp]) => a === "8020" && amt === "500.00" && tp === "C"), "the remainder books as unrated turnover, named");
  assert.ok(got.some(([a, amt, tp]) => a === "1000" && amt === "500.00" && tp === "D"));
});

test("[XAF-PERIODE] the header never declares days that have not happened", () => {
  const input = baseInput();
  input.endDate = "2026-05-15";
  const r = buildXafFile(input);
  assert.match(r.xml, /<endDate>2026-05-15<\/endDate>/);
  assert.doesNotMatch(r.xml, /<periodNumber>6<\/periodNumber>/, "period 6 has not happened — declaring it empty is a false statement");
  assert.match(r.xml, /<periodNumber>5<\/periodNumber>/);
});

test("[XAF-DIFF] the cash journal agrees with the result engine, category by category", async () => {
  // The one test the audit said would have caught findings 1-5 in a single stroke: feed one
  // cash fixture per category/direction through BOTH projections and hold their nets against
  // each other. Every earlier defect was a disagreement between exactly these two numbers.
  const { computeResult } = await import("./financial-result");
  const cash = [
    { id: "d1", date: "2026-02-01", direction: "in" as const,  amount: 121,  category: "omzet",    btwRate: 21,   documentId: null, invoiceId: null, coveredByTurnover: false },
    { id: "d2", date: "2026-02-02", direction: "out" as const, amount: 60.5, category: "kosten",   btwRate: 21,   documentId: "doc-1", invoiceId: null, coveredByTurnover: false },
    { id: "d3", date: "2026-02-03", direction: "out" as const, amount: 40,   category: "kosten",   btwRate: null, documentId: null, invoiceId: null, coveredByTurnover: false },
    { id: "d4", date: "2026-02-04", direction: "out" as const, amount: 500,  category: "prive",    btwRate: null, documentId: null, invoiceId: null, coveredByTurnover: false },
    { id: "d5", date: "2026-02-05", direction: "out" as const, amount: 300,  category: "transfer", btwRate: null, documentId: null, invoiceId: null, coveredByTurnover: false },
    { id: "d6", date: "2026-02-06", direction: "out" as const, amount: 121,  category: "omzet",    btwRate: 21,   documentId: null, invoiceId: null, coveredByTurnover: false },
  ];
  const input = baseInput();
  input.cash.push(...cash);
  const r = buildXafFile(input);
  const got = lines(r.xml);
  const net = (acc: string) => got
    .filter(([a]) => a === acc || (acc === "8xxx" && a.startsWith("80")))
    .reduce((s, [, amt, tp]) => s + (tp === "C" ? 1 : -1) * Number(amt), 0);

  const engine = computeResult(
    [], [],
    cash.map((c) => ({ direction: c.direction, amount: c.amount, category: c.category, btw_rate: c.btwRate, date: c.date, document_id: c.documentId })),
    [], new Set<string>(), 0, new Map(),
  );
  // omzet: engine nets the sale ex 100 against the refund ex -100 → 0; the 8xxx credits-minus-
  // debits in the file must land on the same number.
  assert.equal(Math.round(net("8xxx") * 100) / 100, Math.round(engine.omzet * 100) / 100, "omzet agrees");
  // kosten: documented 50 ex + undocumented 40 gross = 90; prive/transfer excluded on BOTH sides.
  assert.equal(Math.round(-net("4000") * 100) / 100, Math.round(engine.kosten * 100) / 100, "kosten agree");
  // voorbelasting: only the documented bon claims (10.50).
  assert.equal(Math.round(-net("1400") * 100) / 100, Math.round(engine.btwVoorbelasting * 100) / 100, "voorbelasting agrees");
});

test("[XAF-LENGTE] a long customer name is clamped, because one of them refuses the WHOLE file", () => {
  // custSupName is a String50 in XAF 3.2. A single customer with a long statutory name — a VvE, a
  // stichting; over fifty characters is ordinary — made every XSD-validating importer reject the
  // entire auditfile. The accountant then gets nothing at all: not a smaller administration, no
  // administration, and an afternoon of hand-typing that the package exists to prevent.
  const input = baseInput();
  const langeNaam = "Vereniging van Eigenaren Residentie Beatrixpark te Amsterdam-Zuid";
  assert.ok(langeNaam.length > 50, "the fixture is actually too long");
  input.sales.push({
    id: "inv-1", invoiceNumber: "20260001", invoiceDate: "2026-03-10", clientName: langeNaam,
    totalExBtw: 1000, btwAmount: 210, invoiceType: "factuur", rateLines: null,
  });
  const r = buildXafFile(input);
  const naam = /<custSupName>(.*?)<\/custSupName>/.exec(r.xml)?.[1] ?? "";
  assert.ok(naam.length > 0, "the customer is still in the file");
  assert.ok(naam.length <= 50, `custSupName is ${naam.length} characters, the schema allows 50`);
  assert.ok(langeNaam.startsWith(naam), "…and it is the start of the real name, not something else");

  // The clamp is on the RAW value, before escaping. "&" is one character on paper and five in the
  // string, so cutting at the fiftieth string position would slice an entity in half — no longer
  // too long, and no longer valid XML either. Same failure, louder.
  const metAmpersand = "Stichting Onderwijs & Opvang Midden-Nederland en Omstreken Regio Oost";
  assert.ok(metAmpersand.length > 50);
  const input2 = baseInput();
  input2.sales.push({
    id: "inv-2", invoiceNumber: "20260002", invoiceDate: "2026-03-11", clientName: metAmpersand,
    totalExBtw: 100, btwAmount: 21, invoiceType: "factuur", rateLines: null,
  });
  const xml2 = buildXafFile(input2).xml;
  const naam2 = /<custSupName>(.*?)<\/custSupName>/.exec(xml2)?.[1] ?? "";
  assert.doesNotMatch(naam2, /&(?!(amp|lt|gt|quot|apos);)/, "no half-written entity survived the cut");
  assert.match(naam2, /&amp;/, "…and the ampersand that IS in the first fifty characters is whole");

  // The company's own city is the same String50 and the same typed-by-hand risk.
  const input3 = baseInput();
  input3.company.city = "Sint Anthonis gemeente Land van Cuijk provincie Noord-Brabant";
  assert.ok(input3.company.city.length > 50);
  const stad = /<city>(.*?)<\/city>/.exec(buildXafFile(input3).xml)?.[1] ?? "";
  assert.ok(stad.length <= 50, `city is ${stad.length} characters`);
});

// ── [XAF-NIET-STIL] Wat er NIET in staat, staat erin ───────────────────────────────────────────
//
// Een auditbestand dat onvolledig is ziet er precies zo uit als een dat compleet is. De boekhouder
// importeert het, de aansluiting met de aangifte klopt niet, en niemand weet waarom. Het aantal
// reisde al mee in een HTTP-header — en beide plekken die dit bestand ophalen zijn een gewone
// downloadlink, waar een browser geen responsheaders van toont. Die kop bereikte dus niemand.

test("[XAF-NIET-STIL] een geweigerde post staat als waarschuwing boven in het bestand", () => {
  const input = baseInput();
  // Twee die het wél halen, zodat het bestand niet leeg is en de waarschuwing niet het enige is.
  input.sales.push({
    id: "ok-1", invoiceNumber: "20260001", invoiceDate: "2026-03-10", clientName: "Vermeulen BV",
    totalExBtw: 1000, btwAmount: 210, invoiceType: "factuur", rateLines: null,
  });
  // Geen factuurdatum → niet in een periode te plaatsen.
  input.sales.push({
    id: "weg-1", invoiceNumber: "20260002", invoiceDate: null, clientName: "Vermeulen BV",
    totalExBtw: 500, btwAmount: 105, invoiceType: "factuur", rateLines: null,
  });
  // Tarief niet herleidbaar: 500 → 75 is 15%, en dat is geen Nederlands tarief.
  input.sales.push({
    id: "weg-2", invoiceNumber: "20260003", invoiceDate: "2026-04-01", clientName: "Vermeulen BV",
    totalExBtw: 500, btwAmount: 75, invoiceType: "factuur", rateLines: null,
  });

  const r = buildXafFile(input);
  assert.equal(r.skipped.length, 2, "twee posten geweigerd");

  // Het bestand zegt het zelf, vóór het <auditfile>-element.
  const kop = r.xml.slice(0, r.xml.indexOf("<auditfile"));
  assert.match(kop, /LET OP: 2 post\(en\) staan NIET in dit auditbestand/);
  assert.match(kop, /geen factuurdatum/);
  assert.match(kop, /btw-tarief niet herleidbaar/);
  assert.match(kop, /sluit daardoor niet aan op de aangifte/,
    "de gevolgzin hoort erbij — een telling zonder betekenis leest als ruis");

  // En het blijft een geldig XAF-document: het commentaar staat buiten de grammatica.
  assert.match(r.xml, /^<\?xml version="1\.0" encoding="utf-8"\?>/);
  assert.ok(r.xml.indexOf("<!--") < r.xml.indexOf("<auditfile"), "boven het document, niet erin");
  assert.ok(r.xml.indexOf("-->") < r.xml.indexOf("<auditfile"), "en het is afgesloten");
  assert.equal(r.totalDebit, r.totalCredit, "de rest van het bestand blijft in balans");
});

test("[XAF-NIET-STIL] een compleet bestand zwijgt", () => {
  // Zwijgen is hier het juiste antwoord: een regel "0 overgeslagen" boven elk bestand is ruis, en
  // ruis is precies wat een waarschuwing waardeloos maakt op de dag dat ze wél iets betekent.
  const input = baseInput();
  input.sales.push({
    id: "ok-1", invoiceNumber: "20260001", invoiceDate: "2026-03-10", clientName: "Vermeulen BV",
    totalExBtw: 1000, btwAmount: 210, invoiceType: "factuur", rateLines: null,
  });
  const r = buildXafFile(input);
  assert.equal(r.skipped.length, 0);
  assert.doesNotMatch(r.xml, /LET OP/);
  assert.ok(!r.xml.slice(0, r.xml.indexOf("<auditfile")).includes("<!--"));
});

test("[XAF-NIET-STIL] een reden met streepjes kan het commentaar niet afsluiten", () => {
  // Rechtstreeks op de functie, niet op de huidige redenen. Geen enkele reden in dit bestand
  // bevat vandaag een `--`, dus een test die alleen de gebouwde uitvoer bekijkt kan niet falen —
  // en een test die niet kan falen bewaakt niets. Dit is wat er straks misgaat, nu al gesteld.
  assert.equal(xmlCommentSafe("geen datum"), "geen datum", "gewone tekst blijft heel");
  assert.equal(xmlCommentSafe("bedrag -- nul"), "bedrag - nul");
  assert.equal(xmlCommentSafe("balans --> stuk"), "balans -> stuk", "de afsluiter kan niet ontstaan");
  assert.equal(xmlCommentSafe("a-----b"), "a-b");
  assert.ok(!xmlCommentSafe("x -- y --- z").includes("--"));
  // …en de em-dash die de echte redenen wél gebruiken is geen koppelteken en blijft dus staan.
  assert.equal(xmlCommentSafe("geen factuurdatum — niet te plaatsen"), "geen factuurdatum — niet te plaatsen");
});

// ─── [XAF-REGIME] De notities staan waar ze gelezen worden ───────────────────────────────────────

test("[XAF-REGIME] the regime notes stand ABOVE the auditfile, not behind its transactions", () => {
  // Ze zeggen onder welk BTW-stelsel de datums in dit bestand gelezen moeten worden en wat er niet
  // in gesplitst is — uitspraken die bepalen hoe alles eronder telt. Achter </company> stonden ze
  // technisch in het bestand en praktisch achter duizenden regels journaalposten.
  const r = buildXafFile({
    ...baseInput(),
    regimeNotes: ["Deze onderneming voert het KASSTELSEL. De journaalposten staan op factuurdatum."],
  });
  const noteAt = r.xml.indexOf("KASSTELSEL");
  const openAt = r.xml.indexOf("<auditfile");
  assert.ok(noteAt >= 0, "the regime note is not in the file at all");
  assert.ok(noteAt < openAt, "the regime note sits after the opening tag — a reader meets it last");
});

test("[XAF-REGIME] a note with a double hyphen cannot break the file", () => {
  // Een XML-commentaar eindigt bij `--`. esc() ontsnapt & < >, en juist niet dit — en in een
  // commentaar is esc() bovendien verkeerd om: &amp; komt er letterlijk als "&amp;" te staan.
  const r = buildXafFile({
    ...baseInput(),
    regimeNotes: ["Stelsel -- let op -- gewijzigd per 1 juli & daarna"],
  });
  // Het commentaar ZELF begint met `<!--` en eindigt met `-->`, dus de test moet naar de INHOUD
  // kijken en niet naar de afbakening. (Eerste versie deed dat niet en viel over zijn eigen
  // openingsteken — een test die zijn eigen delimiters aanziet voor de fout die hij zoekt.)
  const body = r.xml.slice(r.xml.indexOf("<!--") + 4, r.xml.indexOf("-->"));
  assert.doesNotMatch(body, /--/, "a raw double hyphen inside the comment makes the XML invalid");
  assert.doesNotMatch(body, /&amp;/, "escaping & inside a comment shows the reader '&amp;' instead of '&'");
  assert.match(body, /& daarna/, "the ampersand must survive as itself");
});

test("[XAF-REGIME] no notes means no empty comment block", () => {
  const r = buildXafFile({ ...baseInput(), regimeNotes: [] });
  assert.doesNotMatch(r.xml.slice(0, r.xml.indexOf("<auditfile")), /<!--/);
});

// ── [XAF-NULBOEKING] Een inkoop zonder bedragen is geen inkoop van nul ───────
//
// De toestand: total_ex_btw 0, btw_amount 0, en een brutobedrag dat er wél is (een controleur die
// 0 in het excl.-veld typt, of een lezing die alleen het totaal vond). Drie regels van 0,00
// balanceren keurig — 0 = 0 — dus de push-helper liet ze door, en er stond een INK-boeking in het
// auditbestand met de leverancier voluit en 0,00 op zowel de kosten- als de crediteurenregel.
//
// Een lezer kan daar één ding uit opmaken: deze inkoop was gratis. Terwijl de facturenlijst en het
// afsluitpakket hetzelfde stuk voor het volle bedrag noemen — het auditbestand spreekt dan de
// administratie tegen op precies de plek waar het bewijs van hoort te zijn.

test("[XAF-NULBOEKING] een inkoop zonder bedragen wordt overgeslagen, niet als 0,00 geboekt", () => {
  const input = baseInput();
  input.purchases = [{
    id: "leeg", invoiceNumber: "2026-0042", invoiceDate: "2026-03-14",
    vendorName: "Leverancier BV", totalExBtw: 0, btwAmount: 0, totalIncBtw: 150,
  } as XafInput["purchases"][number]];
  const r = buildXafFile(input);

  assert.deepEqual(r.skipped.map((s) => s.id), ["leeg"], "de factuur staat niet in de weglatingslijst");
  assert.match(r.skipped[0].reason, /geen bedragen/, "de reden zegt niet wat er ontbrak");
  // NIET op de leveranciersnaam toetsen: die hoort in de stamgegevens te staan, ook wanneer er
  // geen boeking van komt. Waar het om gaat is dat er geen BOEKING is — geen trLine die naar dit
  // factuurnummer verwijst, en geen inkoopjournaalpost.
  assert.ok(!r.xml.includes("2026-0042"),
    "er staat nog een boeking met dit factuurnummer in het auditbestand");
  assert.ok(!/<trLine>/.test(r.xml.slice(r.xml.indexOf("<journal") === -1 ? 0 : r.xml.indexOf("<journal"))),
    "er staat nog een journaalregel in het bestand terwijl de enige inkoop is overgeslagen");
});

test("[XAF-NULBOEKING] en een inkoop die alleen BTW draagt wordt gewoon geboekt", () => {
  // De grens de andere kant op: nul is alleen een weigering wanneer er NIETS te boeken valt. Een
  // verlegde of gecorrigeerde regel met alleen voorbelasting is een echte boeking.
  const input = baseInput();
  input.purchases = [{
    id: "alleen-btw", invoiceNumber: "2026-0043", invoiceDate: "2026-03-14",
    vendorName: "Leverancier BV", totalExBtw: 0, btwAmount: 21, totalIncBtw: 21,
  } as XafInput["purchases"][number]];
  const r = buildXafFile(input);
  assert.deepEqual(r.skipped, [], "een boeking met een echt bedrag werd geweigerd");
  assert.ok(r.xml.includes("Leverancier BV"));
});
