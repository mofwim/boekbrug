// [PDF-BETAAL-QR] Real render test — run: npx tsx --test src/lib/invoice-pdf-server.test.ts
//
// The unit tests pin WHO gets a QR; this renders the actual PDF through the same entry the send
// route uses and proves the image really lands in the bytes. Assertions on size, not on pixels:
// a ~240px QR PNG embeds as a couple of kilobytes, so the QR-carrying document is measurably
// bigger than the identical document whose owner has no IBAN — and both must still be real PDFs.
// Without this, the wiring could pass every source-level gate while react-pdf quietly rejected
// the data URI at render time.

import { test } from "node:test";
import assert from "node:assert/strict";

import { renderInvoicePdf } from "./invoice-pdf-server";

const lines = [
  { description: "Advieswerk", quantity: 2, unit_price: 250, btw_rate: 21, line_total: 500 },
];
const invoice = (over: Record<string, unknown> = {}) => ({
  invoice_type: "factuur",
  invoice_number: "2026-0042",
  invoice_date: "2026-08-01",
  due_date: "2026-08-15",
  client_name: "Restaurant De Brug",
  client_address: "Kade 1",
  client_postal_code: "1234 AB",
  client_city: "Tilburg",
  total_ex_btw: 500,
  btw_amount: 105,
  total_inc_btw: 605,
  ...over,
});
const profile = (over: Record<string, unknown> = {}) => ({
  company_name: "Kiwi Food Market",
  full_name: "K. Iwi",
  address: "Marktstraat 2",
  postal_code: "5678 CD",
  city: "Tilburg",
  kvk_number: "12345678",
  btw_number: "NL123456789B01",
  iban: "NL91ABNA0417164300",
  email: "info@kiwi.example",
  ...over,
});

test("[PDF-BETAAL-QR] the rendered factuur carries the QR image — and without an IBAN it renders clean without one", async () => {
  const withQr = await renderInvoicePdf(invoice(), lines, profile());
  const withoutQr = await renderInvoicePdf(invoice(), lines, profile({ iban: null }));

  assert.equal(withQr.subarray(0, 5).toString("latin1"), "%PDF-", "QR variant is not a PDF");
  assert.equal(withoutQr.subarray(0, 5).toString("latin1"), "%PDF-", "no-IBAN variant is not a PDF");
  assert.ok(
    withQr.length > withoutQr.length + 500,
    `QR image did not land in the bytes: ${withQr.length} vs ${withoutQr.length}`,
  );
});

test("[PDF-BETAAL-QR] a creditnota renders QR-free through the same entry", async () => {
  const credit = await renderInvoicePdf(
    invoice({ invoice_type: "creditnota", total_inc_btw: -605, total_ex_btw: -500, btw_amount: -105 }),
    [{ ...lines[0], quantity: -2, line_total: -500 }],
    profile(),
  );
  const plain = await renderInvoicePdf(invoice(), lines, profile({ iban: null }));
  assert.equal(credit.subarray(0, 5).toString("latin1"), "%PDF-");
  // Same no-image ballpark as the QR-free factuur — a QR PNG would add kilobytes.
  assert.ok(Math.abs(credit.length - plain.length) < 2000,
    `creditnota unexpectedly differs by an image-sized amount: ${credit.length} vs ${plain.length}`);
});
