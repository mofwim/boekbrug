// [LEVENSLOOP] One invoice, every station — run: npx tsx --test src/lib/invoice-lifecycle.test.ts
//
// WHY A TEST THAT FOLLOWS A DOCUMENT INSTEAD OF A FUNCTION
//
// Every station of this app is tested where it lives, and each of them is right on its own. The
// defects this repo keeps finding are not inside a station — they are BETWEEN two of them, and
// they are invisible from either side:
//
//   · [CENT] the e-factuur stated one cent less BTW than the PDF, for two years. The XML was
//     internally consistent, so Peppol accepted it; the PDF added up, so the owner saw nothing.
//   · [PRIJS-KOLOM] the price column printed EUR 0,83 next to a line total of EUR 123,85. Both
//     numbers were correct; only their product was not.
//   · [MIN-REGEL] the exporter turned a credit line into a negative PriceAmount, which the PDF
//     renders perfectly and an access point refuses.
//
// So this file takes ONE invoice — the hardest ordinary one it could be given — and carries it
// through the whole life it has in this product: the totals the server computes, the PDF the
// customer keeps, the e-factuur the access point delivers, the rubrieken of the aangifte, the
// creditnota that takes it back, and that creditnota's own PDF, e-factuur and rubrieken. Every
// station is asked for the same figures.
//
// It earned its keep on the first run: the exporter was crediting a returned crate twice, because
// it took the MAGNITUDE of every line of a creditnota rather than flipping its sign. See the note
// at the creditnota flip in ubl-export.ts.
//
// THE INVOICE, and why each line is on it:
//
//   150 x EUR 0,825688…  9%   123,85   a price typed INCLUSIVE of btw — an endless fraction, and
//                                      the shape that made the price column disagree with itself
//   100 x EUR 1,743119…  9%   174,31   a second one, so the 9% group is a sum and not one line
//     2 x EUR 75,00     21%   150,00   an ordinary line at the other rate: mixed-rate arithmetic
//    -3 x EUR 23,95     21%   -71,85   a return settled on this invoice ([MIN-REGEL], ATAPACK)
//
//   9%   123,85 + 174,31 = 298,16   btw 26,83
//   21%  150,00 -  71,85 =  78,15   btw 16,41
//   ------------------------------------------
//   excl 376,31   btw 43,24   incl 419,55
//
// Every number below is worked out by hand from those four lines. A test that asked the code what
// the answer is would agree with any answer it gave.

import test, { before } from "node:test";
import assert from "node:assert/strict";

import { computeInvoiceTotals, round2 } from "./invoice-totals";
import { buildInvoiceUbl, type UblInvoiceHeader, type UblInvoiceLine, type UblSupplier } from "./ubl-export";
import { creditLinesFor } from "./creditnota-lines";
import { renderInvoicePdf } from "./invoice-pdf-server";
import { invoiceNetEx, staysAFactuur } from "./negative-line";
import { rateSharesFromLines } from "./btw-rate-split";
import { buildAangifte } from "./aangifte";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let getDocument: any;
before(async () => {
  ({ getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs"));
});

async function pdfText(buf: Buffer): Promise<string> {
  const doc = await getDocument({ data: new Uint8Array(buf), useSystemFonts: true }).promise;
  let out = "";
  for (let i = 1; i <= doc.numPages; i++) {
    const content = await (await doc.getPage(i)).getTextContent();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    out += content.items.map((it: any) => it.str + (it.hasEOL ? "\n" : "")).join("") + "\n";
  }
  return out;
}

// ── The document ────────────────────────────────────────────────────────────────────────────────

const LINES = [
  { description: "Worstjes", quantity: 150, unit_price: 0.9 / 1.09, btw_rate: 9, line_total: 123.85 },
  { description: "Kip spies", quantity: 100, unit_price: 1.9 / 1.09, btw_rate: 9, line_total: 174.31 },
  { description: "Uren", quantity: 2, unit_price: 75, btw_rate: 21, line_total: 150 },
  { description: "Retour kratten", quantity: -3, unit_price: 23.95, btw_rate: 21, line_total: -71.85 },
];

/** Worked out by hand from the four lines above. */
const EX = 376.31;
const BTW = 43.24;
const INC = 419.55;

const PROFILE = {
  company_name: "Kiwi Food Market",
  address: "Verdiplein 13-14",
  postal_code: "5049NM",
  city: "Tilburg",
  kvk_number: "94386676",
  btw_number: "NL005079680B23",
  iban: "NL73INGB0107197480",
  email: "info@kiwifoodmarket.nl",
  phone: "013-1234567",
};

const INVOICE = {
  invoice_type: "factuur",
  invoice_number: "2026-0044",
  invoice_date: "2026-08-12",
  due_date: "2026-09-11",
  client_name: "Stichting Contour de Twern",
  client_address: "Spoorlaan 444",
  client_postal_code: "5038CH",
  client_city: "Tilburg",
  total_ex_btw: EX,
  btw_amount: BTW,
  total_inc_btw: INC,
};

const SUPPLIER: UblSupplier = {
  company_name: PROFILE.company_name, full_name: "M. Eigenaar", kvk_number: PROFILE.kvk_number,
  btw_number: PROFILE.btw_number, iban: PROFILE.iban, address: PROFILE.address,
  postal_code: PROFILE.postal_code, city: PROFILE.city,
};

const ublHeader = (over: Partial<UblInvoiceHeader> = {}): UblInvoiceHeader => ({
  invoice_number: INVOICE.invoice_number, invoice_date: INVOICE.invoice_date, due_date: INVOICE.due_date,
  invoice_type: "factuur", total_ex_btw: EX, btw_amount: BTW, total_inc_btw: INC,
  client_name: INVOICE.client_name, client_address: INVOICE.client_address,
  client_postal_code: INVOICE.client_postal_code, client_city: INVOICE.client_city,
  client_btw_number: "NL001234567B01",
  ...over,
});

/** Every number inside a <cbc:…Amount> element, as it is written in the file. */
function amounts(xml: string): number[] {
  return [...xml.matchAll(/<cbc:[A-Za-z]*Amount[^>]*>(-?[\d.]+)<\/cbc:[A-Za-z]*Amount>/g)].map((m) => Number(m[1]));
}

// ── Station 1: what the server computes ─────────────────────────────────────────────────────────

test("[LEVENSLOOP] the totals are the hand-worked ones, per rate", () => {
  const t = computeInvoiceTotals(LINES);
  assert.equal(t.total_ex_btw, EX, "298,16 at 9% plus 78,15 at 21%");
  assert.equal(t.btw_amount, BTW, "26,83 + 16,41 — each rate rounded before they are added");
  assert.equal(t.total_inc_btw, INC);
  // The credit line is inside those numbers, not beside them.
  assert.equal(invoiceNetEx(LINES), EX, "the netted excl total, from the lines' own signs");
  assert.equal(staysAFactuur(LINES), true, "it still asks for money, so it is a factuur");
});

// ── Station 2: the paper the customer keeps ─────────────────────────────────────────────────────

test("[LEVENSLOOP] the PDF prints those totals, and a column that multiplies out", async () => {
  const text = await pdfText(await renderInvoicePdf(INVOICE, LINES, PROFILE));
  assert.ok(text.length > 200, "the extractor returned nothing — it is broken, not the PDF");

  assert.ok(text.includes("€ 376,31"), "the subtotal must be the netted one");
  assert.ok(text.includes("€ 419,55"), "and the amount due");
  // The BTW is stated PER RATE and never as one figure — which is the form the aangifte needs and
  // the customer's bookkeeper checks. So the paper is asked for both rows, and for their sum being
  // the number every other station calls the btw.
  assert.ok(text.includes("9,00% BTW over € 298,16"), "the 9% base");
  assert.ok(text.includes("€ 26,83"), "…and its btw");
  assert.ok(text.includes("21,00% BTW over € 78,15"), "the 21% base, with the return already off it");
  assert.ok(text.includes("€ 16,41"), "…and its btw");
  assert.equal(round2(26.83 + 16.41), BTW, "the two rows are the btw the totals call 43,24");
  assert.ok(text.includes("het bovenstaande bedrag van € 419,55"), "the payment sentence names the same total");

  // [PRIJS-KOLOM] Every printed price times its printed quantity must be its printed line total.
  const euro = (s: string) => Number(s.replace(/\./g, "").replace(",", "."));
  const from = text.indexOf("Aantal Omschrijving Prijs Totaal");
  const to = text.indexOf("Subtotaal", from);
  assert.ok(from > 0 && to > from, "the line table must be locatable");
  const rows = [...text.slice(from, to).matchAll(/(-?\d+(?:,\d+)?) (\S[^€]*?) € ([\d.,]+) € (-?[\d.,]+)/g)];
  assert.equal(rows.length, 4, `all four rows must be readable from the page — found ${rows.length}`);
  for (const [, qty, name, price, total] of rows) {
    const product = round2(euro(qty) * euro(price));
    assert.ok(
      Math.abs(product - euro(total)) < 0.005,
      `${name.trim()}: ${qty} x € ${price} = ${product.toFixed(2)}, but the row says € ${total}`,
    );
  }
  // The credit row specifically: a negative amount, a positive price. [MIN-REGEL]
  assert.ok(text.includes("€ -71,85"), "the return must show as money going back");
  assert.ok(text.includes("€ 23,95"), "…at the price the crates were sold for");
});

// ── Station 3: the file the access point delivers ───────────────────────────────────────────────

test("[LEVENSLOOP] the e-factuur states the same figures as the PDF", () => {
  const { xml, warnings } = buildInvoiceUbl(ublHeader(), LINES as UblInvoiceLine[], SUPPLIER);

  // [CENT] The defect that made this file necessary: the XML said one cent less BTW than the paper.
  const tax = /<cbc:TaxAmount[^>]*>(-?[\d.]+)</.exec(xml);
  const ex = /<cbc:LineExtensionAmount[^>]*>(-?[\d.]+)</.exec(xml);
  const inc = /<cbc:TaxInclusiveAmount[^>]*>(-?[\d.]+)</.exec(xml);
  assert.ok(tax && ex && inc, "the three totals must be in the file");
  assert.equal(Number(ex![1]), EX, "the same excl total as the PDF");
  assert.equal(Number(tax![1]), BTW, "the same btw, to the cent");
  assert.equal(Number(inc![1]), INC, "and the same amount payable");

  // [MIN-REGEL] BR-27 across the whole file: no item net price may be negative.
  const prices = [...xml.matchAll(/<cbc:PriceAmount[^>]*>(-?[\d.]+)</g)].map((m) => Number(m[1]));
  assert.equal(prices.length, 4, "one price per line");
  assert.ok(prices.every((p) => p >= 0), `BR-27 refuses this file: ${prices.join(", ")}`);
  assert.match(xml, /<cbc:InvoicedQuantity[^>]*>-3</, "the return keeps its minus in the quantity");

  // Both rates are present as their own TaxSubtotal, with the rounded amounts.
  assert.match(xml, /<cbc:TaxAmount[^>]*>26\.83</, "the 9% group");
  assert.match(xml, /<cbc:TaxAmount[^>]*>16\.41</, "the 21% group");
  assert.deepEqual(
    warnings.filter((w) => /differs from line sum/.test(w)), [],
    `the header must reconcile with the lines: ${warnings.join(" | ")}`,
  );
});

// ── Station 4: the creditnota that takes it back ────────────────────────────────────────────────

const CREDIT_LINES = creditLinesFor(LINES, "cn-1", "geannuleerde levering");

test("[LEVENSLOOP] the creditnota is the exact mirror, to the cent", () => {
  const t = computeInvoiceTotals(CREDIT_LINES);
  assert.equal(t.total_ex_btw, -EX, "a creditnota is stored negative — [CREDIT-SIGN]");
  assert.equal(t.btw_amount, -BTW, "and the btw mirrors exactly, or the aangifte keeps a remainder");
  assert.equal(t.total_inc_btw, -INC);
  // The credit line inside the invoice mirrors back to a delivery, or the correction would not
  // cancel the document it corrects.
  const retour = CREDIT_LINES.find((l) => l.description.includes("Retour"))!;
  assert.equal(retour.quantity, 3);
  assert.equal(retour.line_total, 71.85);
  assert.equal(retour.unit_price, 23.95, "prices never flip — BR-27");
});

test("[LEVENSLOOP] the creditnota's own PDF states the mirrored totals", async () => {
  const text = await pdfText(await renderInvoicePdf(
    { ...INVOICE, invoice_type: "creditnota", invoice_number: "CN-2026-0007", total_ex_btw: -EX, btw_amount: -BTW, total_inc_btw: -INC },
    CREDIT_LINES,
    PROFILE,
  ));
  assert.ok(text.includes("€ -376,31"), "the subtotal runs the other way");
  assert.ok(text.includes("€ -419,55"), "and so does the total");
  // Per rate here too, both mirrored — a creditnota that credited only one of the two rates would
  // still show a plausible total and leave the other rubriek standing.
  assert.ok(text.includes("9,00% BTW over € -298,16"), "the 9% base, mirrored");
  assert.ok(text.includes("€ -26,83"));
  assert.ok(text.includes("21,00% BTW over € -78,15"), "the 21% base, mirrored");
  assert.ok(text.includes("€ -16,41"));
  assert.ok(text.includes("[Creditnota] Worstjes"), "every line names what it takes back");
  assert.ok(text.includes("geannuleerde levering"), "…and why");
  // The line that was a return on the invoice is a delivery here, and prints as one.
  assert.ok(text.includes("€ 71,85"), "the credited return goes back the other way");
  // A creditnota asks for nothing, and must not carry the payment sentence.
  assert.ok(text.includes("Er is geen betaling vereist"), "it says so, rather than leaving it out");
  assert.ok(!text.includes("Wij verzoeken u vriendelijk"), "and never asks to be paid");
});

test("[LEVENSLOOP] the creditnota's e-factuur is type 381 with POSITIVE amounts", () => {
  // UBL conveys the direction with the type code, not with the sign — so the mirror is mirrored
  // back here. That double flip is the most reversible-looking line in the exporter.
  const { xml } = buildInvoiceUbl(
    ublHeader({ invoice_type: "creditnota", invoice_number: "CN-2026-0007", total_ex_btw: -EX, btw_amount: -BTW, total_inc_btw: -INC }),
    CREDIT_LINES as unknown as UblInvoiceLine[],
    SUPPLIER,
  );
  assert.match(xml, /<cbc:InvoiceTypeCode>381<\/cbc:InvoiceTypeCode>/);
  const nums = amounts(xml);
  assert.ok(nums.length > 0, "no amounts found — the extraction broke, not the export");

  // The totals are the invoice's, positive. This is the assertion that failed while the exporter
  // used Math.abs() per line: it sent 520,01 for a document whose header said 376,31 — the credited
  // return counted as a credit for the second time. [MIN-REGEL]
  const ex = /<cbc:LineExtensionAmount[^>]*>(-?[\d.]+)<\/cbc:LineExtensionAmount>[\s\S]*?<cbc:TaxExclusiveAmount/.exec(xml);
  const tax = /<cbc:TaxAmount[^>]*>(-?[\d.]+)</.exec(xml);
  const inc = /<cbc:TaxInclusiveAmount[^>]*>(-?[\d.]+)</.exec(xml);
  assert.ok(tax && inc, "the totals must be in the file");
  assert.equal(Number(tax![1]), BTW, "the same btw as the invoice, positive");
  assert.equal(Number(inc![1]), INC, "and the same amount, positive");
  assert.ok(nums.includes(EX), `the excl total must be the mirrored one: ${nums.join(", ")}`);
  assert.ok(ex === null || Number(ex[1]) >= 0, "the document's own line-extension total is positive");

  // Per line the direction is kept, because one of them is not a credit: the return that the
  // invoice took off is charged back here. A credit note where every line credits — the ordinary
  // one — therefore has no minus in it at all, and this one has exactly one.
  const lineAmounts = [...xml.matchAll(/<cbc:LineExtensionAmount[^>]*>(-?[\d.]+)</g)].map((m) => Number(m[1]));
  assert.deepEqual(
    lineAmounts.filter((n) => n < 0), [-71.85],
    `only the un-returned line may be negative: ${lineAmounts.join(", ")}`,
  );
  assert.equal(round2(lineAmounts.filter((n) => n !== EX).reduce((a, b) => a + b, 0)), EX,
    "and the lines must add up to the document total, or the access point refuses it (BR-CO-10)");

  // BR-27 still: no price may be negative, in either document.
  const prices = [...xml.matchAll(/<cbc:PriceAmount[^>]*>(-?[\d.]+)</g)].map((m) => Number(m[1]));
  assert.ok(prices.every((p) => p >= 0), `BR-27: ${prices.join(", ")}`);
});

// ── Station 5: the form the Belastingdienst reads ───────────────────────────────────────────────

test("[LEVENSLOOP] both rates reach their own rubriek, with the return already off the 21%", () => {
  // The last station, and the only one whose reader is not the owner or the customer. A credit
  // line has to be netted INSIDE its rate before the split, or the 21% rubriek declares 150,00 of
  // turnover that was partly given back — and 1a and 5a would both be too high while the invoice,
  // the PDF and the e-factuur all still say 419,55.
  const shares = rateSharesFromLines(LINES, EX, BTW);
  assert.ok(shares, "a two-rate invoice must produce buckets, or the whole invoice blends to one rate");
  assert.deepEqual(
    [...shares!].sort((a, b) => a.rate - b.rate),
    [{ rate: 9, ex: 298.16, btw: 26.83 }, { rate: 21, ex: 78.15, btw: 16.41 }],
    "150,00 minus the 71,85 return is what was supplied at 21%",
  );

  const concept = buildAangifte(
    { salesByRate: shares!.map((s) => ({ rate: s.rate, omzet: s.ex, btw: s.btw })), btwVoorbelasting: 0, cashOmzetZonderBtw: 0 },
    { turnoverDays: 90, quarterDays: 90, incomingInvoiceCount: 0, outgoingInvoiceCount: 1, hasEuPurchase: false },
    "Q3 2026",
  );
  const row = (c: string) => concept.rows.find((r) => r.code === c)!;
  assert.equal(row("1a").omzet, 78, "21% turnover, in whole euros as the form wants");
  assert.equal(row("1a").btw, 16);
  assert.equal(row("1b").omzet, 298, "9% turnover");
  assert.equal(row("1b").btw, 27);
  assert.equal(concept.verschuldigd, 43, "5a — and 43 is the btw every other station named");
});

test("[LEVENSLOOP] the creditnota takes the same rubrieken back down", () => {
  const shares = rateSharesFromLines(CREDIT_LINES, -EX, -BTW);
  assert.ok(shares, "the mirror must split by rate too");
  assert.deepEqual(
    [...shares!].sort((a, b) => a.rate - b.rate),
    [{ rate: 9, ex: -298.16, btw: -26.83 }, { rate: 21, ex: -78.15, btw: -16.41 }],
    "each rate comes off where it went on",
  );
  const concept = buildAangifte(
    { salesByRate: shares!.map((s) => ({ rate: s.rate, omzet: s.ex, btw: s.btw })), btwVoorbelasting: 0, cashOmzetZonderBtw: 0 },
    { turnoverDays: 90, quarterDays: 90, incomingInvoiceCount: 0, outgoingInvoiceCount: 1, hasEuPurchase: false },
    "Q3 2026",
  );
  assert.equal(concept.verschuldigd, -43, "5a runs the other way by exactly the same amount");
  // Rounding to whole euros is symmetric, or the pair would leave a euro standing in a rubriek.
  assert.equal(concept.rows.find((r) => r.code === "1a")!.btw, -16);
  assert.equal(concept.rows.find((r) => r.code === "1b")!.btw, -27);
});

// ── The whole line, in one assertion ────────────────────────────────────────────────────────────

test("[LEVENSLOOP] invoice and creditnota cancel to zero at every station", () => {
  // The property that matters to the Belastingdienst: after the correction, nothing is left. If any
  // station rounds the mirror differently — which is exactly what [CENT] was — a remainder of one
  // cent stays in a rubriek forever, on a document nobody looks at again.
  const factuur = computeInvoiceTotals(LINES);
  const credit = computeInvoiceTotals(CREDIT_LINES);
  assert.equal(round2(factuur.total_ex_btw + credit.total_ex_btw), 0);
  assert.equal(round2(factuur.btw_amount + credit.btw_amount), 0);
  assert.equal(round2(factuur.total_inc_btw + credit.total_inc_btw), 0);
});
