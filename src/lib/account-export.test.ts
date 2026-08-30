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

test("[KASSA] the export carries the sales behind the day, or says it could not read them", async () => {
  // A shop without a till has no Z-report file behind its day, so till_sales is the ONLY record of
  // what was actually sold. An export of "al je gegevens" that ships the aggregate and drops the
  // detail is the harm this module is written against.
  const sale = {
    id: "s1", ticket_id: "t1", sale_date: "2026-08-20", description: "Knippen",
    quantity: 1, unit_price_incl: 25, btw_rate: 21, method: "pin",
  };
  const { zipBytes } = await assembleAccountExportZip({
    userId: "u1", profile: null, invoices: [], files: [],
    dailyTurnover: [{ turnover_date: "2026-08-20", total_incl: 25 }],
    tillSales: [sale],
  });
  const zip = await JSZip.loadAsync(zipBytes);
  const sales = JSON.parse(await zip.file("kassaverkopen.json")!.async("string"));
  assert.equal(sales.length, 1);
  assert.equal(sales[0].description, "Knippen");
  // Beside the day it aggregates into, never instead of it.
  assert.ok(zip.file("dagomzet.json"), "the day itself is still exported");

  // And the failure direction: an empty file would CLAIM nothing was ever rung up.
  const { zipBytes: degraded } = await assembleAccountExportZip({
    userId: "u1", profile: null, invoices: [], files: [],
    tillSales: [], tillSalesAvailable: false,
  });
  const zip2 = await JSZip.loadAsync(degraded);
  assert.equal(zip2.file("kassaverkopen.json"), null, "no empty file that would read as 'none'");
  const note = await zip2.file("KASSAVERKOPEN-NIET-GELEZEN.txt")!.async("string");
  assert.match(note, /niet worden gelezen/, "…a note saying so instead");
  assert.match(note, /support@boekbrug\.nl/, "…and what the owner can do about it");
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
test("[KAS-SPOOR] the exported cash book carries the movements that were removed from it", async () => {
  // Every other ledger in this ZIP keeps its own history: an archived invoice is still a row, a bank
  // line is never destroyed, a removed turnover day can be re-imported from its Z-report. A
  // cash_entries delete is a HARD delete and a cash movement has no source document to re-read — the
  // owner typed it. So kas.json without this trail hands someone a cash book that cannot answer what
  // the app answers on screen and in the accountant's quarterly sheet: what did this period hold that
  // it no longer holds.
  const { zipBytes, summary } = await assembleAccountExportZip({
    userId: "u9",
    profile: { id: "u9", kas_opening_balance: 250 },
    invoices: [],
    files: [],
    cashEntries: [{ id: "c1", amount: 40, direction: "in", category: "omzet" }],
    cashTrail: [
      { action: "cash.entry_removed", created_at: "2026-04-02T09:00:00Z", old_value: { entry_date: "2026-02-14", direction: "out", amount: 90, category: "kosten", description: "bloemen" } },
      { action: "cash.opening_balance_set", created_at: "2026-04-03T09:00:00Z", old_value: { kas_opening_balance: 0 }, new_value: { kas_opening_balance: 250 } },
    ],
  });

  const zip = await JSZip.loadAsync(zipBytes);
  const trail = JSON.parse(await zip.file("kas-spoor.json")!.async("string"));
  assert.equal(trail.length, 2);

  // The removed movement survives with the two things that make it a movement: its day and its
  // amount. Without those the row records that something was deleted and nothing more.
  const removed = trail.find((r: { action: string }) => r.action === "cash.entry_removed");
  assert.equal(removed.old_value.amount, 90);
  assert.equal(removed.old_value.entry_date, "2026-02-14");
  assert.equal(removed.old_value.description, "bloemen");

  // And the beginsaldo's history, which profiel.json cannot carry: it holds the CURRENT float, while
  // this one number shifts every eindsaldo in the owner's entire history, filed quarters included.
  const float = trail.find((r: { action: string }) => r.action === "cash.opening_balance_set");
  assert.equal(float.old_value.kas_opening_balance, 0);
  assert.equal(float.new_value.kas_opening_balance, 250);

  // Separate from kas.json, never merged into it: these are not cash entries, they are the record of
  // what happened to them. Anything else would put a deleted movement back into the ledger.
  const entries = JSON.parse(await zip.file("kas.json")!.async("string"));
  assert.equal(entries.length, 1);

  // The manifest counts it, so whoever opens this ZIP in 2032 knows the trail is in here at all.
  const manifest = JSON.parse(await zip.file("manifest.json")!.async("string"));
  assert.equal(manifest.aantal_kas_spoorregels, 2);
  assert.equal(summary.cashTrailCount, 2);
  assert.match(manifest.beschrijving, /verwijderde kasboekingen/);
});

test("[KAS-SPOOR] an account that never removed anything still gets the file, empty", async () => {
  // A MISSING file and a dropped ledger look identical to whoever opens this ZIP later — the same
  // reasoning the filed-aangiftes CSV is built on. An empty list here is a real answer: nothing was
  // ever taken out of this cash book.
  const { zipBytes, summary } = await assembleAccountExportZip({
    userId: "u10", profile: { id: "u10" }, invoices: [], files: [],
  });
  const zip = await JSZip.loadAsync(zipBytes);
  assert.deepEqual(JSON.parse(await zip.file("kas-spoor.json")!.async("string")), []);
  assert.equal(summary.cashTrailCount, 0);
});

test("[EXPORT-REGISTERS] the ZIP carries the tables the owner filled, not just the invoice headers", async () => {
  // The defect: facturen.csv held a header — a client NAME and a total — and nothing else. The
  // lines that make up that total, the address the invoice was addressed to, the supplier register,
  // and the link saying which bank payment settled which invoice were all absent. That is not a
  // smaller export; it is one an owner cannot reconstruct a single invoice from, while
  // /api/account/delete treats it as permission to destroy the original.
  const { zipBytes, summary } = await assembleAccountExportZip({
    userId: "u20",
    profile: { id: "u20" },
    invoices: [sampleInvoice],
    files: [],
    registers: {
      invoiceLines: [{ id: "l1", invoice_id: "i1", description: "Advieswerk", quantity: 2, unit_price: 50 }],
      clients: [{ id: "c1", user_id: "u20", name: "Test Klant", btw_number: "NL123456789B01" }],
      suppliers: [{ id: "s1", user_id: "u20", name: "Groothandel", iban: "NL91ABNA0417164300" }],
      bankInvoiceLinks: [{ id: "b1", user_id: "u20", invoice_id: "i1", amount: 121 }],
      invoiceReminders: [{ id: "r1", user_id: "u20", invoice_id: "i1", sent_at: "2026-06-20" }],
      timeEntries: [{ id: "t1", user_id: "u20", hours: 2 }],
    },
  });
  const zip = await JSZip.loadAsync(zipBytes);

  // The line that makes the invoice reconstructable at all.
  const lines = JSON.parse(await zip.file("factuurregels.json")!.async("string"));
  assert.equal(lines.length, 1);
  assert.equal(lines[0].description, "Advieswerk");

  // The registers behind the names on the invoice.
  assert.equal(JSON.parse(await zip.file("klanten.json")!.async("string"))[0].btw_number, "NL123456789B01");
  assert.equal(JSON.parse(await zip.file("leveranciers.json")!.async("string"))[0].iban, "NL91ABNA0417164300");
  // The reconciliation itself — which payment settled which invoice.
  assert.equal(JSON.parse(await zip.file("bank-factuur-koppelingen.json")!.async("string")).length, 1);
  // The WIK trail. Nothing else in the ZIP records when a reminder went out.
  assert.equal(JSON.parse(await zip.file("herinneringen.json")!.async("string")).length, 1);

  // A register with nothing in it still SHIPS its file. A missing file and a dropped ledger look
  // identical to whoever opens this ZIP in 2032 — the same rule kas-spoor.json is built on. It is
  // an honest answer here because a failed read throws in the orchestrator rather than emptying.
  for (const name of ["artikelen.json", "voertuigen.json", "mappen.json",
                      "leveranciers-schrijfwijzen.json", "tegenpartij-geheugen.json"]) {
    assert.ok(zip.file(name), `${name} must exist even when empty`);
    assert.deepEqual(JSON.parse(await zip.file(name)!.async("string")), []);
  }

  // And the manifest counts every one of them, per FILE, so the number and the archive cannot drift.
  const manifest = JSON.parse(await zip.file("manifest.json")!.async("string"));
  assert.equal(manifest.aantallen_per_bestand["factuurregels.json"], 1);
  assert.equal(manifest.aantallen_per_bestand["artikelen.json"], 0);
  assert.equal(summary.registerCounts["klanten.json"], 1);
  assert.match(manifest.beschrijving, /klanten- en leveranciersbestand/);
  // What is deliberately NOT in the ZIP is stated, so an absence is never an open question.
  assert.match(manifest.niet_meegeleverd.logboek, /kasspoor/);
});
