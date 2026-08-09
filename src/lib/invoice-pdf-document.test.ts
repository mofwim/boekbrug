// [OFFERTE-IS-GEEN-PROFORMA] Behavioural test — run: npx tsx --test src/lib/invoice-pdf-document.test.ts
//
// WHY THIS RENDERS A REAL PDF INSTEAD OF READING THE SOURCE
//
// The defect this file exists for was invisible to every other kind of check. invoice-pdf.tsx had
// a complete, correct offerte: a "Geldig tot" row, a "Deze offerte is vrijblijvend" sentence, an
// "Offertenummer" label. All of it sat behind `const isOfferte = type === 'offerte'`, and EVERY
// quote this product creates is stored as 'pro_forma' (draft route, DB_TYPE). So not one of those
// branches had ever run on a real document.
//
// tsc type-checks it. eslint reads it. next build compiles it. A source-level gate asserting "the
// file contains a Geldig tot row" passes — the row is right there. The only thing that says the
// document is wrong is the document, so this test makes the document and reads it.
//
// It renders through the same server entry point the send routes use, and pulls the text back out
// with pdfjs-dist, which is already a direct dependency. Roughly two seconds for the whole file.
//
// NOTE ON LANGUAGE: identifiers, comments and test names are English (AGENTS.md). The strings
// being asserted are Dutch because they are what a customer reads.

import { test, before } from "node:test";
import assert from "node:assert/strict";

import { renderInvoicePdf } from "./invoice-pdf-server";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let getDocument: any;
before(async () => {
  // The legacy build is the one that runs outside a browser. Imported lazily so the cost lands on
  // this file rather than on every test run that does not touch a PDF.
  ({ getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs"));
});

/**
 * The text of a rendered PDF, in reading order.
 *
 * A home-made extractor was tried first and returned "not found" for EVERY string, including ones
 * that were certainly on the page — a broken instrument that reports absence is exactly the silent
 * failure this codebase keeps finding, so the assertions below would all have passed vacuously
 * had they been written as doesNotMatch. Hence a real parser, and hence the control test below it.
 */
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

// The lines from the quote that prompted all of this: prices typed inclusive of 9% btw, so every
// stored ex-price is a long fraction and every line_total is the rounded one.
const LINES = [
  { description: "Worstjes", quantity: 150, unit_price: 0.9 / 1.09, btw_rate: 9, line_total: 123.85 },
  { description: "Kip spies", quantity: 100, unit_price: 1.9 / 1.09, btw_rate: 9, line_total: 174.31 },
  { description: "Broodjes", quantity: 38, unit_price: 1.75 / 1.09, btw_rate: 9, line_total: 61.01 },
  { description: "Sauzen", quantity: 2, unit_price: 1.75 / 1.09, btw_rate: 9, line_total: 3.21 },
];

const QUOTE = {
  invoice_type: "pro_forma",
  invoice_number: null,
  invoice_date: "2026-08-08",
  due_date: "2026-09-07",
  client_name: "Stichting Contour de Twern",
  client_address: "Spoorlaan 444",
  client_postal_code: "5038CH",
  client_city: "Tilburg",
  client_email: "romeline@r-newt.nl",
  total_ex_btw: 362.38,
  btw_amount: 32.61,
  total_inc_btw: 394.99,
};

test("the extractor finds text that IS on the page — control for every assertion below", async () => {
  // Without this, a parser that silently returns "" turns every assert.ok(!text.includes(...))
  // below into a test that can never fail.
  const text = await pdfText(await renderInvoicePdf(QUOTE, LINES, PROFILE));
  assert.ok(text.length > 200, `the extractor returned ${text.length} characters — it is broken`);
  assert.ok(text.includes("Kiwi Food Market"), "the sender name must come back out of the PDF");
  assert.ok(text.includes("Worstjes"), "and the line descriptions");
});

test("a quote calls itself an Offerte, not a Pro forma", async () => {
  // A pro-formafactuur is a different document: a preliminary invoice for a prepayment or for
  // customs, which says "this is what you will be billed". The customer got a mail titled Offerte
  // asking them to agree, and an attachment headed Pro forma with an IBAN in the corner.
  const text = await pdfText(await renderInvoicePdf(QUOTE, LINES, PROFILE));
  assert.ok(text.includes("Offerte"), "the heading must be the word the rest of the product uses");
  assert.ok(!text.includes("Pro forma"), "the heading must not say Pro forma");
  assert.ok(
    !text.includes("pro-formafactuur"),
    "the pro-forma disclaimer belongs to a prepayment invoice, not to an offer",
  );
});

test("a quote prints its validity date — the row that never once rendered", async () => {
  const text = await pdfText(await renderInvoicePdf(QUOTE, LINES, PROFILE));
  assert.ok(text.includes("Geldig tot"), "the quote must state until when it holds");
  assert.ok(text.includes("07-09-2026"), "…with the date that was in the row all along");
  assert.ok(
    text.includes("Deze offerte is vrijblijvend en geldig tot 07-09-2026."),
    "…and say so in words as well, where the customer reads it",
  );
  assert.ok(!text.includes("Vervaldatum"), "a quote has nothing due — that word belongs on an invoice");
});

test("a quote with no validity date SAYS so instead of going quiet", async () => {
  // The sentence used to drop its clause and leave "Deze offerte is vrijblijvend." — an offer that
  // never expires, which the customer can accept a year later at last year's price.
  const text = await pdfText(await renderInvoicePdf({ ...QUOTE, due_date: null }, LINES, PROFILE));
  assert.ok(
    text.includes("Er is geen einddatum afgesproken"),
    "a missing expiry must be stated, not omitted",
  );
});

test("a quote tells the customer how to say yes", async () => {
  // "Vrijblijvend" says what is not required. Nothing said what to do.
  const text = await pdfText(await renderInvoicePdf(QUOTE, LINES, PROFILE));
  assert.ok(text.includes("Ga je akkoord?"), "the quote must name the next step");
  assert.ok(
    text.includes("Laat het weten via info@kiwifoodmarket.nl of 013-1234567"),
    "…and name the route back inside that sentence, not merely somewhere on the page",
  );
});

test("the sender block itself carries a way to reply", async () => {
  // Separate from the sentence above, and the negative control is why. Asserting only that the
  // address appears SOMEWHERE stayed green with both sender lines deleted — the acceptance
  // sentence names the same address, so the page still contained the string. The labels are what
  // distinguishes the two, so the labels are what this asserts.
  //
  // It matters because the PDF outlives the mail: it gets printed, forwarded and filed on its own,
  // and the block that held an address, a KvK number, a BTW number and an IBAN had no e-mail and
  // no phone on the one document whose whole purpose is to be answered.
  const text = await pdfText(await renderInvoicePdf(QUOTE, LINES, PROFILE));
  assert.ok(text.includes("E-mail: info@kiwifoodmarket.nl"), "the sender block must list the e-mail");
  assert.ok(text.includes("Tel.: 013-1234567"), "…and the phone number when the profile has one");
});

test("a sender without a phone number gets no empty label", async () => {
  // Only what is filled in. "Tel.: —" on a customer's document reads as a broken template.
  const noPhone = { ...PROFILE, phone: null };
  const text = await pdfText(await renderInvoicePdf(QUOTE, LINES, noPhone));
  assert.ok(text.includes("E-mail: info@kiwifoodmarket.nl"), "the e-mail is still there");
  assert.ok(!text.includes("Tel.:"), "…and no dangling phone label");
  assert.ok(
    text.includes("Laat het weten via info@kiwifoodmarket.nl —"),
    "and the acceptance sentence drops the phone clause cleanly rather than trailing an 'of'",
  );
});

test("a quote carries no invoice number, and no empty label pretending it might", async () => {
  // A quote is deliberately never numbered — Art. 35 has one unbroken series and it is for
  // invoices. The label was printed anyway, above nothing.
  const text = await pdfText(await renderInvoicePdf(QUOTE, LINES, PROFILE));
  assert.ok(!text.includes("Factuurnummer"), "a quote must not print an invoice-number label");
  assert.ok(!text.includes("Offertenummer"), "…nor a quote-number label above an empty value");
});

test("the printed column adds up to the printed total", async () => {
  // [REGEL-AFRONDING] 123,85 + 174,31 + 61,01 + 3,21 = 362,38. The document used to state 362,39
  // under it, and a btw of 32,61 that is 9% of neither.
  const text = await pdfText(await renderInvoicePdf(QUOTE, LINES, PROFILE));
  assert.ok(text.includes("362,38"), "the subtotal must be the sum of the lines above it");
  assert.ok(!text.includes("362,39"), "…and not a second opinion about the same number");
  assert.ok(text.includes("9,00% BTW over € 362,38"), "the btw must be stated over that same base");
  assert.ok(text.includes("32,61"), "…and 9% of 362,38 is 32,61");
  assert.ok(text.includes("394,99"), "so the total is 394,99 — the amount issuance produces");
});

test("a real factuur is untouched by all of this", async () => {
  // Everything above is scoped to quotes. An invoice is a legal document and none of it may leak
  // in — no validity date, no "vrijblijvend", and its own payment demand still present.
  const invoice = { ...QUOTE, invoice_type: "factuur", invoice_number: "2026-001" };
  const text = await pdfText(await renderInvoicePdf(invoice, LINES, PROFILE));
  assert.ok(text.includes("Factuurnummer"), "an invoice states its number");
  assert.ok(text.includes("2026-001"), "…the real one");
  assert.ok(text.includes("Vervaldatum"), "…and when it is due");
  assert.ok(text.includes("Wij verzoeken u vriendelijk"), "…and asks to be paid");
  assert.ok(!text.includes("Geldig tot"), "an invoice does not expire");
  assert.ok(!text.includes("vrijblijvend"), "an invoice is not an offer");
  assert.ok(!text.includes("Ga je akkoord?"), "an invoice does not ask for agreement");
});

test("[PRIJS-KOLOM] every price on the page multiplies out to the total beside it", async () => {
  // The reported document showed "150 x € 0,83" against a line total of € 123,85 — 65 cents on one
  // row, and € 1,14 across the four. unit_price stores the exact fraction on purpose (price-mode.ts);
  // printing it at two decimals is what made the column lie.
  const lines = [
    ...LINES,
    // An ordinary line, to prove nothing moved for the invoices that were always right.
    { description: "Uren", quantity: 2, unit_price: 75, btw_rate: 21, line_total: 150 },
  ];
  const text = await pdfText(await renderInvoicePdf(QUOTE, lines, PROFILE));

  // Parse the table back out of the page and do the multiplication a customer would do.
  //
  // SCOPED to the table. An unbounded match ran straight on into the totals and read
  // "21,00% BTW over € 362,38 … € 31,50" as a line of 362,38 units — the same mistake that made
  // the first UBL reader in this repo report a failure that was not there. Read the region you
  // mean, not the page.
  const euro = (s: string) => Number(s.replace(/\./g, "").replace(",", "."));
  const from = text.indexOf("Aantal Omschrijving Prijs Totaal");
  const to = text.indexOf("Subtotaal", from);
  assert.ok(from > 0 && to > from, "the line table must be locatable on the page");
  const table = text.slice(from, to);
  const rows = [...table.matchAll(/(\d+(?:,\d+)?) (\S[^€]*?) € ([\d.,]+) € ([\d.,]+)/g)];
  assert.ok(rows.length >= 5, `the five line rows must be readable from the page — found ${rows.length}`);
  for (const [, qty, name, price, total] of rows) {
    const product = Math.round(euro(qty) * euro(price) * 100 + 1e-9) / 100;
    assert.ok(
      Math.abs(product - euro(total)) < 0.005,
      `${name.trim()}: ${qty} x € ${price} = ${product.toFixed(2)}, but the row says € ${total}`,
    );
  }

  // The precise shapes, so a future "let's just use two decimals everywhere" is caught by name.
  assert.ok(text.includes("€ 0,82569"), "the fractional price is printed with the precision it needs");
  assert.ok(!text.includes("€ 0,83"), "…and not as the rounded price that does not multiply out");
  assert.ok(text.includes("€ 75,00"), "a round price keeps exactly two decimals");
});

// ─── [VRIJSTELLING-OP-PAPIER] An exempt supply must say on what ground it is exempt ─────────────
//
// Art. 226 punt 11 of directive 2006/112/EG (art. 35a lid 1 sub k Wet OB). The UBL for this same
// invoice already carried it — BR-E-10 of Peppol BIS 3.0 refuses the file without a
// TaxExemptionReason — so the e-invoice was compliant and the paper one was not.
//
// This renders the document rather than reading the source, for the reason at the top of this
// file: the summary row is BUILT from btwBreakdown(), which groups by rate alone and therefore
// prints one "0,00% BTW" line over a genuine 0% export and an exempt course together. Nothing at
// the source level looks wrong; only the page shows what the customer is told.

const EXEMPT_MIX = [
  // A genuine zero-rated supply — taxed, at 0%. Deduction right intact, category Z in the XML.
  { description: "Export handelsgoederen", quantity: 1, unit_price: 500, btw_rate: 0, line_total: 500, vat_treatment: null },
  // And an exempt one — art. 11, no BTW and no deduction right. Category E in the XML.
  { description: "Cursus voedselveiligheid", quantity: 1, unit_price: 500, btw_rate: 0, line_total: 500, vat_treatment: "exempt" },
];

const EXEMPT_INVOICE = {
  invoice_type: "factuur",
  invoice_number: "2026-0011",
  invoice_date: "2026-08-08",
  due_date: "2026-09-07",
  client_name: "Stichting Contour de Twern",
  client_address: "Spoorlaan 444",
  client_postal_code: "5038CH",
  client_city: "Tilburg",
  total_ex_btw: 1000,
  btw_amount: 0,
  total_inc_btw: 1000,
};

test("an exempt line puts the exemption reference on the page", async () => {
  const text = await pdfText(await renderInvoicePdf(EXEMPT_INVOICE, EXEMPT_MIX, PROFILE));
  // Control first — an extractor returning "" would make every assertion here vacuous.
  assert.ok(text.includes("Cursus voedselveiligheid"), "the extractor must find the exempt line");

  assert.ok(
    text.includes("Vrijgesteld van btw op grond van artikel 11 Wet OB 1968"),
    "the ground for the exemption is a mandatory element, not a courtesy",
  );
  // And WHICH part of the total it covers. On a mixed invoice the reference without an amount
  // leaves the reader unable to tell the exempt half from the zero-rated one.
  assert.ok(
    text.includes("€ 500,00"),
    "the sentence must name the exempt amount — the other € 500 is taxed, at 0%",
  );
});

test("an invoice with nothing exempt says nothing about exemption", async () => {
  // The direction this may never err in: a plain 21% invoice claiming an exemption would be a
  // false statement about the tax, on the document the customer files.
  const text = await pdfText(await renderInvoicePdf(QUOTE, LINES, PROFILE));
  assert.ok(!/vrijgesteld/i.test(text), "no exempt line, no exemption sentence");
  assert.ok(!/artikel 11/i.test(text), "…and no article reference either");
});

test("the sentence on the page is the same string the e-invoice sends", async () => {
  // The point of the shared constant. Two documents describing one sale must not describe it
  // differently — this repository has met that defect three times in one audit.
  const { taxExemptionReason } = await import("./ubl-export");
  const fromXml = taxExemptionReason("E");
  assert.ok(fromXml, "the UBL must still carry a reason for category E — BR-E-10");
  const text = await pdfText(await renderInvoicePdf(EXEMPT_INVOICE, EXEMPT_MIX, PROFILE));
  assert.ok(
    text.includes(fromXml!),
    `the PDF must print the XML's own reason text verbatim — XML says "${fromXml}"`,
  );
});

test("an offerte carries no exemption statement, exempt lines or not", async () => {
  // Same rule the reverse-charge sentence follows: an offer is not a legal invoice and may not
  // make a BTW statement at all.
  const text = await pdfText(
    await renderInvoicePdf({ ...EXEMPT_INVOICE, invoice_type: "pro_forma", invoice_number: null }, EXEMPT_MIX, PROFILE),
  );
  assert.ok(text.includes("Offerte"), "control — this really is the quote document");
  assert.ok(!/vrijgesteld/i.test(text), "a quote states no BTW ground");
});
