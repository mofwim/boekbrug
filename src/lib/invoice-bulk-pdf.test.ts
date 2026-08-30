// [BULK-PDF] Pure node test — run: npx tsx --test src/lib/invoice-bulk-pdf.test.ts

import { test } from "node:test";
import assert from "node:assert/strict";

import { planBulkPdf, bulkZipName, BULK_PDF_MAX } from "./invoice-bulk-pdf";

test("[BULK-PDF] the name is the invoice number first, then the counterparty", () => {
  const p = planBulkPdf([{ id: "a", invoice_number: "20260012", client_name: "Kiwi Food Market" }]);
  assert.ok(p.ok);
  if (!p.ok) return;
  assert.equal(p.names.get("a"), "20260012 - Kiwi Food Market.pdf");
  // One invoice is the pdf itself — nobody should unpack an archive for a single file.
  assert.equal(p.single, true);
});

test("[BULK-PDF] two invoices without a number do not silently become one file", () => {
  // THE POINT of doing this here. A draft has no number, so both would be named the same, and
  // every zip library keeps the LAST write. The owner asks for three and receives two, with
  // nothing anywhere saying so.
  const p = planBulkPdf([
    { id: "a", invoice_number: null, client_name: "Kiwi" },
    { id: "b", invoice_number: "", client_name: "Kiwi" },
    { id: "c", invoice_number: null, client_name: "Kiwi" },
  ]);
  assert.ok(p.ok);
  if (!p.ok) return;
  const namen = [...p.names.values()];
  assert.equal(new Set(namen.map((n) => n.toLowerCase())).size, 3, `collided: ${namen.join(", ")}`);
  assert.equal(p.single, false);
});

test("[BULK-PDF] a name a file system would refuse never reaches the archive", () => {
  const p = planBulkPdf([{ id: "a", invoice_number: "2026/12", client_name: 'A/B: "C" <D>' }]);
  assert.ok(p.ok);
  if (!p.ok) return;
  const naam = p.names.get("a")!;
  for (const bad of ["/", "\\", ":", "*", "?", '"', "<", ">", "|"]) {
    assert.equal(naam.includes(bad), false, `${JSON.stringify(bad)} survived in ${naam}`);
  }
  assert.match(naam, /\.pdf$/);
});

test("[BULK-PDF] nothing selected, and too much selected, both say what to do", () => {
  const leeg = planBulkPdf([]);
  assert.equal(leeg.ok, false);
  if (!leeg.ok) assert.match(leeg.error, /Selecteer eerst/);

  const teveel = planBulkPdf(
    Array.from({ length: BULK_PDF_MAX + 1 }, (_, i) => ({ id: String(i), invoice_number: String(i) })),
  );
  assert.equal(teveel.ok, false);
  if (teveel.ok) return;
  assert.match(teveel.error, new RegExp(String(BULK_PDF_MAX)), "the refusal must name the limit");
  assert.match(teveel.error, /Selecteer er minder/, "…and what to do about it");

  // Exactly at the limit is allowed — an off-by-one here refuses a legitimate download.
  const precies = planBulkPdf(
    Array.from({ length: BULK_PDF_MAX }, (_, i) => ({ id: String(i), invoice_number: String(i) })),
  );
  assert.equal(precies.ok, true);
});

test("[BULK-PDF] the archive is named after the OWNER's day, not the server's", () => {
  // This test used to assert UTC, on the argument that "a name that disagrees with the invoices
  // inside it is a small thing that costs trust" — and that argument is the one against UTC. The
  // invoice dates inside are Amsterdam dates (amsterdamToday, everywhere in this app), so between
  // midnight and 01:00 or 02:00 the UTC name disagreed with every one of them.
  //
  // amsterdamToday is not a "local getter" either — the thing the old note was right to refuse. It
  // is a fixed timeZone, so the name still does not move with wherever the server happens to run.
  assert.equal(bulkZipName(new Date("2026-03-01T00:00:00.000Z")), "facturen-2026-03-01.zip");
  // 23:59:59 UTC on 31 December is 00:59 on 1 January in the Netherlands. An owner downloading
  // then is in the new year, and so is every invoice they create in that hour.
  assert.equal(bulkZipName(new Date("2026-12-31T23:59:59.000Z")), "facturen-2027-01-01.zip");
  // …and the summer offset is +2, so the same hour in July is a day earlier in UTC terms.
  assert.equal(bulkZipName(new Date("2026-06-30T22:30:00.000Z")), "facturen-2026-07-01.zip");
});
