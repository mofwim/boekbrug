// src/lib/account-export.test.ts
// [BOEK-032] Tests for the export assembly + helpers (no network).
// Run:  npx tsx src/lib/account-export.test.ts
// (uses extensionless imports like the app; tsx resolves + strips types)

import test from "node:test";
import assert from "node:assert/strict";
import JSZip from "jszip";
import {
  assembleAccountExportZip,
  periodFromDate,
  zipPathForFile,
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
});