// src/lib/account-export.test.ts
// [BOEK-032] Tests for the export assembly + helpers (no network).
// Run:  npx tsx src/lib/account-export.test.ts
// (uses extensionless imports like the app; tsx resolves + strips types)

import test from "node:test";
import assert from "node:assert/strict";
import JSZip from "jszip";
import {
  assembleAccountExportZip,
  btwFilingsToCsv,
  periodFromDate,
  zipPathForFile,
  type BtwFilingRow,
  type ExportFile,
} from "./account-export";
import type { InvRow } from "./export";

const sampleInvoice: InvRow = {
  invoice_number: "2026-001",
  client_name: "Test Klant",
  client_email: "klant@example.nl",
  client_address: "Straat 1",
  client_postal_code: "1234 AB",
  client_city: "Amsterdam",
  status: "paid",
  direction: "outgoing",
  total_ex_btw: 100,
  btw_amount: 21,
  total_inc_btw: 121,
  invoice_date: "2026-05-14",
  due_date: "2026-06-14",
  created_at: "2026-05-14T00:00:00.000Z",
  invoice_type: "factuur",
};

test("periodFromDate derives NL quarter (UTC)", () => {
  assert.equal(periodFromDate("2026-05-14"), "2026-Q2");
  assert.equal(periodFromDate("2026-01-01"), "2026-Q1");
  assert.equal(periodFromDate("2026-12-31"), "2026-Q4");
  assert.equal(periodFromDate(null), "");
  assert.equal(periodFromDate("not-a-date"), "");
});

test("zipPathForFile strips userId prefix and keeps folder structure", () => {
  const f: ExportFile = {
    path: "u1/2026/Q1/doc.pdf",
    name: "doc.pdf",
    bytes: new Uint8Array(),
  };
  assert.equal(zipPathForFile("u1", f), "bestanden/2026/Q1/doc.pdf");
  // fallback to name when prefix doesn't match
  const g: ExportFile = { path: "weird", name: "x.pdf", bytes: new Uint8Array() };
  assert.equal(zipPathForFile("u1", g), "bestanden/x.pdf");
});

test("assembleAccountExportZip produces a readable ZIP with all parts", async () => {
  const files: ExportFile[] = [
    {
      path: "u1/2026/Q1/doc.pdf",
      name: "doc.pdf",
      bytes: new TextEncoder().encode("PDFDATA"),
    },
  ];
  const { zipBytes, summary } = await assembleAccountExportZip({
    userId: "u1",
    profile: { id: "u1", full_name: "Jan" },
    invoices: [sampleInvoice],
    files,
    skipped: [{ name: "kapot.pdf", reason: "leeg bestand" }],
  });

  assert.ok(zipBytes.length > 0);
  assert.equal(summary.invoiceCount, 1);
  assert.equal(summary.fileCount, 1);
  assert.equal(summary.skipped.length, 1);

  const zip = await JSZip.loadAsync(zipBytes);

  const csv = await zip.file("facturen.csv")!.async("string");
  assert.ok(csv.startsWith("\uFEFF")); // UTF-8 BOM for Excel NL
  assert.ok(csv.includes("Factuurnummer")); // header from export.ts
  assert.ok(csv.includes("2026-001"));
  assert.ok(csv.includes("21%")); // calcBtwRate(21,100) via export.ts

  const prof = JSON.parse(await zip.file("profiel.json")!.async("string"));
  assert.equal(prof.full_name, "Jan");

  const fileEntry = await zip.file("bestanden/2026/Q1/doc.pdf")!.async("string");
  assert.equal(fileEntry, "PDFDATA");

  const manifest = JSON.parse(await zip.file("manifest.json")!.async("string"));
  assert.equal(manifest.aantal_facturen, 1);
  assert.equal(manifest.aantal_bestanden, 1);
  assert.equal(manifest.overgeslagen_bestanden.length, 1);
});

test("assembleAccountExportZip handles an empty account", async () => {
  const { zipBytes, summary } = await assembleAccountExportZip({
    userId: "u2",
    profile: { id: "u2" },
    invoices: [],
    files: [],
  });
  assert.equal(summary.invoiceCount, 0);
  assert.equal(summary.fileCount, 0);
  assert.equal(summary.skipped.length, 0);

  const zip = await JSZip.loadAsync(zipBytes);
  const csv = await zip.file("facturen.csv")!.async("string");
  assert.ok(csv.includes("Factuurnummer")); // header-only CSV, no rows
  assert.ok(zip.file("profiel.json") !== null);
  assert.ok(zip.file("manifest.json") !== null);

  // [EXPORT-FILED] An account that never filed still gets the file, header-only. A MISSING file
  // and a dropped ledger look identical to whoever opens this ZIP in 2032.
  const btw = await zip.file("btw-aangiftes.csv")!.async("string");
  assert.ok(btw.includes("BTW saldo"));
  assert.equal(btw.split("\r\n").length, 1); // header, no rows
  assert.equal(summary.btwFilingCount, 0);
});

// ─── [EXPORT-FILED] the filed BTW-aangiftes ────────────────────────────────────

const sampleFilings: BtwFilingRow[] = [
  // Deliberately out of order: the CSV must not depend on the read order.
  {
    year: 2026,
    quarter: 2,
    filed_at: "2026-07-28T09:12:00.000Z",
    omzet: 12500.5,
    kosten: 3200,
    btw_verschuldigd: 2625.11,
    btw_voorbelasting: 672,
    btw_saldo: 1953.11,
  },
  {
    year: 2025,
    quarter: 4,
    filed_at: "2026-01-30T11:00:00.000Z",
    omzet: 8000,
    kosten: 1000,
    btw_verschuldigd: 1680,
    btw_voorbelasting: 210,
    btw_saldo: 1470,
  },
];

test("btwFilingsToCsv sorts by period and formats amounts the Dutch way", () => {
  const csv = btwFilingsToCsv(sampleFilings);
  const lines = csv.split("\r\n");

  assert.equal(
    lines[0],
    "Jaar;Kwartaal;Ingediend op;Omzet;Kosten;BTW verschuldigd;BTW voorbelasting;BTW saldo",
  );
  // 2025-Q4 was passed second but must come first.
  assert.ok(lines[1].startsWith("2025;Q4;"));
  assert.ok(lines[2].startsWith("2026;Q2;"));
  // Decimal comma, two decimals — what a Dutch Excel expects.
  assert.ok(lines[2].includes("12500,50"));
  assert.ok(lines[2].includes("1953,11"));
  // A whole number still carries its decimals.
  assert.ok(lines[1].includes("8000,00"));
});

test("btwFilingsToCsv leaves an unrecorded amount empty, never 0,00", () => {
  // A null saldo means "not recorded". Printing 0,00 would read as "declared nothing",
  // which is a different — and legally louder — statement.
  const csv = btwFilingsToCsv([
    { year: 2026, quarter: 1, filed_at: null, omzet: null, kosten: "", btw_verschuldigd: "n/a", btw_voorbelasting: 0, btw_saldo: null },
  ]);
  const cells = csv.split("\r\n")[1].split(";");
  assert.equal(cells[2], ""); // filed_at
  assert.equal(cells[3], ""); // omzet null
  assert.equal(cells[4], ""); // kosten ""
  assert.equal(cells[5], ""); // unparseable
  assert.equal(cells[6], "0,00"); // a REAL zero survives as a zero
  assert.equal(cells[7], ""); // saldo null
});

test("btwFilingsToCsv accepts numeric columns that arrive as strings", () => {
  // PostgREST hands `numeric` back as a JSON number today; a driver change must not
  // silently blank the money out of this file.
  const csv = btwFilingsToCsv([
    { year: 2026, quarter: 3, filed_at: "2026-10-20T00:00:00.000Z", omzet: "999.9", kosten: "0", btw_verschuldigd: "209.98", btw_voorbelasting: "0", btw_saldo: "209.98" },
  ]);
  assert.ok(csv.includes("999,90"));
  assert.ok(csv.includes("209,98"));
});

test("btwFilingsToCsv does not mutate the caller's array", () => {
  const input = [...sampleFilings];
  btwFilingsToCsv(input);
  assert.equal(input[0].year, 2026); // still the original order
});

test("assembleAccountExportZip ships the filed aangiftes as CSV and verbatim JSON", async () => {
  // An extra column that BtwFilingRow does not know about: the JSON must still carry it,
  // which is the whole point of shipping both files.
  const withExtra = [
    { ...sampleFilings[0], suppletie_van: "2026-Q1" },
  ] as unknown as BtwFilingRow[];

  const { zipBytes, summary } = await assembleAccountExportZip({
    userId: "u3",
    profile: { id: "u3" },
    invoices: [],
    files: [],
    btwFilings: withExtra,
  });

  assert.equal(summary.btwFilingCount, 1);

  const zip = await JSZip.loadAsync(zipBytes);

  const csv = await zip.file("btw-aangiftes.csv")!.async("string");
  assert.ok(csv.startsWith("﻿")); // UTF-8 BOM for Excel NL
  assert.ok(csv.includes("2026;Q2;"));
  assert.ok(csv.includes("1953,11"));

  const json = JSON.parse(await zip.file("btw-aangiftes.json")!.async("string"));
  assert.equal(json.length, 1);
  assert.equal(json[0].btw_saldo, 1953.11);
  assert.equal(json[0].suppletie_van, "2026-Q1"); // the unknown column survived

  const manifest = JSON.parse(await zip.file("manifest.json")!.async("string"));
  assert.equal(manifest.aantal_btw_aangiftes, 1);
  assert.equal(manifest.btw_aangiftes_gelezen, true);
  // The export states the obligation it does not take over.
  assert.ok(manifest.bewaarplicht.includes("7 jaar"));
});

test("an unreadable btw_filings ledger ships a note, never an empty overview", async () => {
  // The failure this guards: a read that fell over produces a header-only CSV, the owner opens it
  // in 2032 and concludes they never filed. "We could not look" and "you filed nothing" are
  // different statements and only one of them is ours to make.
  const { zipBytes, summary } = await assembleAccountExportZip({
    userId: "u4",
    profile: { id: "u4" },
    invoices: [],
    files: [],
    btwFilings: [],
    btwFilingsAvailable: false,
  });

  assert.equal(summary.btwFilingsAvailable, false);
  assert.equal(summary.btwFilingCount, 0);

  const zip = await JSZip.loadAsync(zipBytes);
  assert.equal(zip.file("btw-aangiftes.csv"), null); // no misleading empty overview
  assert.equal(zip.file("btw-aangiftes.json"), null);

  const note = await zip.file("BTW-AANGIFTES-NIET-GELEZEN.txt")!.async("string");
  assert.ok(note.includes("niet worden gelezen"));
  assert.ok(note.includes("7 jaar"));

  const manifest = JSON.parse(await zip.file("manifest.json")!.async("string"));
  // The count is 0 here, so the flag is the ONLY thing that distinguishes this ZIP from an
  // account that genuinely never filed. It has to be in the manifest, not just in the summary.
  assert.equal(manifest.aantal_btw_aangiftes, 0);
  assert.equal(manifest.btw_aangiftes_gelezen, false);
});