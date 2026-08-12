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

// ─── [BTW-VERKLARING] Why there is no btw ───────────────────────────────────────────────────────
//
// Four invoices were rendered, all with EUR 0,00 btw, and three printed text that was
// character-for-character identical: nothing. Only the EU reverse-charge case said anything. So a
// KOR invoice, an exempt supply and a plain 0% invoice were one document, and a customer's
// bookkeeper had no way to tell them apart.

const INVOICE = {
  invoice_type: "factuur",
  invoice_number: "2026-001",
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
const ZERO_LINE = [{ description: "Advies", quantity: 1, unit_price: 1000, btw_rate: 0, line_total: 1000 }];
const NOTE = "Vrijgesteld van btw op grond van artikel 11-1-o Wet OB (onderwijs).";

test("[BTW-VERKLARING] a KOR invoice says why it charges nothing", async () => {
  const text = await pdfText(
    await renderInvoicePdf(INVOICE, ZERO_LINE, { ...PROFILE, kor_active: true }),
  );
  assert.ok(text.includes("kleineondernemersregeling (KOR)"), "the scheme must be named");
});

test("[BTW-VERKLARING] an exempt supply carries the owner's own legal ground", async () => {
  // The app knows THAT it is exempt, never WHICH exemption — art. 11 has a provision per trade.
  const text = await pdfText(
    await renderInvoicePdf(
      INVOICE,
      [{ ...ZERO_LINE[0], vat_treatment: "exempt" }],
      { ...PROFILE, vat_exempt_activity: true, vat_statement_note: NOTE },
    ),
  );
  assert.ok(text.includes(NOTE), "the sentence the owner wrote must be on the document");
});

test("[BTW-VERKLARING] an exempt supply without a note still says the true part", async () => {
  const text = await pdfText(
    await renderInvoicePdf(INVOICE, [{ ...ZERO_LINE[0], vat_treatment: "exempt" }], PROFILE),
  );
  assert.ok(text.includes("Vrijgesteld van btw."), "incomplete beats absent, and it is not false");
});

test("[BTW-VERKLARING] plain 0% with nothing to go on stays silent", async () => {
  // Export, intra-EU goods and several services are all 0%. Printing a guessed ground on a
  // customer's invoice is the one outcome worse than saying nothing.
  const text = await pdfText(await renderInvoicePdf(INVOICE, ZERO_LINE, PROFILE));
  assert.ok(!text.includes("Vrijgesteld"), "no exemption is claimed");
  assert.ok(!text.includes("kleineondernemersregeling"), "…nor a scheme the owner is not in");
});

test("[BTW-VERKLARING] the reverse-charge sentence is never spoken over", async () => {
  // icp.ts derives that from the customer's EU VAT number — the one zero the app can PROVE. Two
  // sentences giving different reasons for one zero is worse than either alone.
  const text = await pdfText(
    await renderInvoicePdf(
      { ...INVOICE, client_btw_number: "DE123456789" },
      ZERO_LINE,
      { ...PROFILE, vat_statement_note: NOTE },
    ),
  );
  assert.ok(text.includes("Btw verlegd"), "the provable reason wins");
  assert.ok(!text.includes(NOTE), "…and the owner's note does not appear beside it");
});

test("[BTW-VERKLARING] KOR and an EU customer give the KOR sentence, not verlegging", async () => {
  // Written after the previous test failed on a premise I had not checked: the two cannot both
  // apply. icp.ts refuses to claim verlegging for an owner in the KOR — "a statement about a
  // regime the owner is not in" — so the reverse-charge line is absent and this one must fill the
  // gap rather than leave the customer with a bare zero.
  const text = await pdfText(
    await renderInvoicePdf(
      { ...INVOICE, client_btw_number: "DE123456789" },
      ZERO_LINE,
      { ...PROFILE, kor_active: true, vat_statement_note: NOTE },
    ),
  );
  assert.ok(!text.includes("Btw verlegd"), "no verlegging is claimed under the KOR");
  assert.ok(text.includes("kleineondernemersregeling (KOR)"), "the real reason is stated");
  assert.ok(!text.includes(NOTE), "…and the scheme is a complete explanation on its own");
});

test("[BTW-VERKLARING] an invoice that DOES charge btw explains nothing", async () => {
  // The per-rate rows already say what was charged. "Geen btw" beside EUR 210,00 of btw is a
  // contradiction the customer would rightly phone about.
  const text = await pdfText(
    await renderInvoicePdf(
      { ...INVOICE, btw_amount: 210, total_inc_btw: 1210 },
      [{ ...ZERO_LINE[0], btw_rate: 21 }],
      { ...PROFILE, vat_statement_note: NOTE, kor_active: true },
    ),
  );
  assert.ok(text.includes("21,00% BTW"), "the rate row is there");
  assert.ok(!text.includes(NOTE), "and no explanation of an absence that is not happening");
  assert.ok(!text.includes("kleineondernemersregeling"));
});

// ─── [KLANT-EXTRA] The two free lines under the customer's name ────────────────────────────────
//
// Read off a rendered document, because the claim is about ORDER on a page: the lines have to sit
// between the customer's name and their street. A source-level check can see that the JSX exists;
// only the document can say where the text came out.

test("[KLANT-EXTRA] all four lines print between the customer name and the street", async () => {
  const text = await pdfText(await renderInvoicePdf(
    {
      ...INVOICE,
      client_extra_line1: "t.a.v. mevrouw Jansen",
      client_extra_line2: "Afdeling Inkoop",
      client_extra_line3: "PO-2026-114",
      client_extra_line4: "Summervibes Festival Tilburg noord",
    },
    ZERO_LINE, PROFILE,
  ));
  assert.match(text, /t\.a\.v\. mevrouw Jansen/, "the addressee must be on the page");
  assert.match(text, /Afdeling Inkoop/, "…the department");
  assert.match(text, /PO-2026-114/, "…the reference the customer's system needs");
  assert.match(text, /Summervibes Festival Tilburg noord/, "…and the fourth line");

  // ORDER is the whole point — under the name, above the address, in the order typed.
  const at = (s: string) => text.indexOf(s);
  const name = at("Stichting Contour de Twern");
  const seq = [at("t.a.v. mevrouw Jansen"), at("Afdeling Inkoop"), at("PO-2026-114"), at("Summervibes Festival Tilburg noord")];
  assert.ok(name >= 0 && seq[0] > name, "line 1 must follow the customer name");
  assert.ok(seq[1] > seq[0] && seq[2] > seq[1] && seq[3] > seq[2], "the four must keep the order they were typed");
  assert.ok(at("Spoorlaan 444") > seq[3], "…and the street must still come after all four");
});

test("[KLANT-EXTRA] a gap in the middle closes up on the page", async () => {
  // The third line arrived after the first two shipped. What must not change: a line left empty
  // does not leave a blank row in the address block of a document that goes to a customer.
  const text = await pdfText(await renderInvoicePdf(
    { ...INVOICE, client_extra_line1: "t.a.v. mevrouw Jansen", client_extra_line2: null, client_extra_line3: "PO-2026-114" },
    ZERO_LINE, PROFILE,
  ));
  const one = text.indexOf("t.a.v. mevrouw Jansen");
  const three = text.indexOf("PO-2026-114");
  assert.ok(one >= 0 && three > one);
  assert.doesNotMatch(
    text.slice(one + "t.a.v. mevrouw Jansen".length, three), /\S/,
    "an empty middle line must leave nothing between the two that are filled",
  );
});

test("[KLANT-EXTRA] only the second filled leaves no blank line above it", async () => {
  const text = await pdfText(await renderInvoicePdf(
    { ...INVOICE, client_extra_line1: null, client_extra_line2: "Afdeling Inkoop" },
    ZERO_LINE, PROFILE,
  ));
  const name = text.indexOf("Stichting Contour de Twern");
  const dept = text.indexOf("Afdeling Inkoop");
  const street = text.indexOf("Spoorlaan 444");
  assert.ok(dept > name && street > dept, "the filled line must sit directly under the name");
  // Nothing empty rendered between them: the text between the name and the department is only the
  // line break, never a second one for a row that was left blank.
  assert.doesNotMatch(text.slice(name + "Stichting Contour de Twern".length, dept), /\S/);
});

test("[KLANT-EXTRA] an invoice without them renders exactly the block it always had", async () => {
  // Every invoice that exists today has both columns null. This is the regression that matters.
  const before = await pdfText(await renderInvoicePdf(INVOICE, ZERO_LINE, PROFILE));
  const after = await pdfText(await renderInvoicePdf(
    { ...INVOICE, client_extra_line1: null, client_extra_line2: "", client_extra_line3: null }, ZERO_LINE, PROFILE,
  ));
  assert.equal(after, before, "a null/empty pair must change nothing on the page");
  assert.match(before, /Stichting Contour de Twern/);
});

test("[KLANT-EXTRA] a pasted paragraph cannot push the address block down the page", async () => {
  // Bounded at 60 characters — roughly one rendered line in a block that is 48% of an A4 page.
  const text = await pdfText(await renderInvoicePdf(
    { ...INVOICE, client_extra_line1: "R".repeat(400) }, ZERO_LINE, PROFILE,
  ));
  assert.doesNotMatch(text, /R{61}/, "the line must not reach the page unbounded");
  assert.match(text, /R{60}/, "…and what fits must still be printed");
  // The rest of the document must survive it.
  assert.match(text, /Spoorlaan 444/);
  assert.match(text, /Advies/);
});
