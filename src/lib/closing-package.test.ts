// src/lib/closing-package.test.ts
// [BTW-RATE-GUARD] + [BANK-COVERAGE] Tests for the closing-package assembly.
// Pure / node-testable (JSZip only, no network).
// Run:  npx tsx src/lib/closing-package.test.ts
// (extensionless imports like the app; tsx resolves + strips types)

import test from "node:test";
import assert from "node:assert/strict";
import JSZip from "jszip";
import { readFileSync } from "node:fs";
import {
  buildOverviewCsv,
  costWithoutInvoiceWarning,
  cashCostWithoutReceiptWarning,
  cashCostsWithoutReceipt,
  assembleClosingPackageZip,
  effectiveDirection,
  datelessWarning,
  sharedOutsideWarning,
  type PackageInvoice,
  type PaymentDateInfo,
} from "./closing-package";
import { buildAangifte } from "./aangifte";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function invoice(over: Partial<PackageInvoice>): PackageInvoice {
  return {
    id: over.id ?? "inv-1",
    invoice_number: over.invoice_number ?? "2026-001",
    client_name: over.client_name ?? "Test Klant",
    status: over.status ?? "sent",
    invoice_type: over.invoice_type ?? "factuur",
    direction: over.direction ?? "outgoing",
    total_ex_btw: over.total_ex_btw ?? 100,
    btw_amount: over.btw_amount ?? 21,
    total_inc_btw: over.total_inc_btw ?? 121,
    invoice_date: over.invoice_date ?? "2026-02-10",
    due_date: over.due_date ?? "2026-03-10",
    pdf_url: over.pdf_url ?? null,
    document_id: over.document_id ?? null,
    client_btw_number: over.client_btw_number ?? null,
    marked_paid_at: over.marked_paid_at ?? null,
    sender_id: over.sender_id ?? null,
    receiver_id: over.receiver_id ?? null,
  };
}

const noPayDates = new Map<string, PaymentDateInfo>();

// ─── [BTW-RATE-GUARD] A mixed/odd rate must NOT be silently dropped ────────────

test("buildOverviewCsv keeps a standard 21% rate row", () => {
  const csv = buildOverviewCsv("Q1 2026", [invoice({})], [], [], noPayDates);
  assert.match(csv, /Uitgaand \(verkoop\);21%;100,00;21,00/);
});

test("buildOverviewCsv surfaces a blended (mixed-rate) invoice instead of dropping it", () => {
  // total_ex_btw=100, btw_amount=17 → derived rate = 17% (not a standard NL
  // rate). Before the guard, the [21,9,0]-only loop dropped this from the
  // overview entirely. It must now appear as a 17% row so the accountant can
  // trace it back to the source invoice.
  const blended = invoice({ id: "inv-mixed", total_ex_btw: 100, btw_amount: 17, total_inc_btw: 117 });
  const csv = buildOverviewCsv("Q1 2026", [blended], [], [], noPayDates);
  assert.match(csv, /Uitgaand \(verkoop\);17%;100,00;17,00/);
});

test("buildOverviewCsv prints standard rates before non-standard ones", () => {
  const std = invoice({ id: "std", total_ex_btw: 200, btw_amount: 42, total_inc_btw: 242 }); // 21%
  const odd = invoice({ id: "odd", total_ex_btw: 100, btw_amount: 17, total_inc_btw: 117 }); // 17%
  const csv = buildOverviewCsv("Q1 2026", [std, odd], [], [], noPayDates);
  const idx21 = csv.indexOf("Uitgaand (verkoop);21%");
  const idx17 = csv.indexOf("Uitgaand (verkoop);17%");
  assert.ok(idx21 !== -1 && idx17 !== -1, "both rate rows present");
  assert.ok(idx21 < idx17, "standard 21% row comes before the non-standard 17% row");
});

// ─── [BANK-COVERAGE] Honest bank warnings ──────────────────────────────────────

async function warningsFor(opts: { hasBankData: boolean; withFile: boolean }) {
  const { summary } = await assembleClosingPackageZip({
    year: 2026,
    quarter: 1,
    clientName: "Test Klant",
    outgoing: [],
    incoming: [],
    pdfByInvoice: new Map(),
    bankFiles: opts.withFile
      ? [{ path: "p", name: "afschrift.pdf", bytes: new Uint8Array([1, 2, 3]) }]
      : [],
    kilometerFiles: [],
    sharedFiles: [],
    paymentDates: noPayDates,
    hasBankData: opts.hasBankData,
    warnings: [],
  });
  return summary.warnings.map((w) => w.code);
}

test("no bank data → 'bank_missing' (real gap)", async () => {
  const codes = await warningsFor({ hasBankData: false, withFile: false });
  assert.ok(codes.includes("bank_missing"), "warns bank_missing");
  assert.ok(!codes.includes("bank_file_missing"), "not the softer file-only warning");
});

test("bank data present but file not attached → 'bank_file_missing', NOT 'bank_missing'", async () => {
  const codes = await warningsFor({ hasBankData: true, withFile: false });
  assert.ok(codes.includes("bank_file_missing"), "warns bank_file_missing");
  assert.ok(!codes.includes("bank_missing"), "must not claim the data is missing");
});

test("bank file attached → no bank warning at all", async () => {
  const codes = await warningsFor({ hasBankData: true, withFile: true });
  assert.ok(!codes.includes("bank_missing"), "no bank_missing");
  assert.ok(!codes.includes("bank_file_missing"), "no bank_file_missing");
});

// ─── [FIN-4] Null-direction rows are attributed by ownership, not dropped ──────

test("effectiveDirection keeps a stored direction", () => {
  assert.equal(effectiveDirection({ direction: "incoming", receiver_id: "x" }, "owner"), "incoming");
  assert.equal(effectiveDirection({ direction: "outgoing", receiver_id: "owner" }, "owner"), "outgoing");
});

test("effectiveDirection infers incoming when the owner is the receiver", () => {
  // A verified purchase saved with a null direction must NOT be dropped: the
  // owner receiving it makes it incoming.
  assert.equal(effectiveDirection({ direction: null, receiver_id: "owner" }, "owner"), "incoming");
});

test("effectiveDirection infers outgoing when the owner is not the receiver", () => {
  assert.equal(effectiveDirection({ direction: null, receiver_id: "someone-else" }, "owner"), "outgoing");
  assert.equal(effectiveDirection({ direction: null, receiver_id: null }, "owner"), "outgoing");
});

// ─── Kilometers is not a tracked feature → never warn (was 100%-fire noise) ────

test("kilometers_missing is never warned", async () => {
  // Every combination — there is no kilometer feature, so the package must not
  // claim a kilometer registration is "missing" on any package.
  for (const hasBankData of [true, false]) {
    for (const withFile of [true, false]) {
      const codes = await warningsFor({ hasBankData, withFile });
      assert.ok(!codes.includes("kilometers_missing"), "no kilometers_missing warning");
    }
  }
});

// ─── [AANGIFTE] The concept BTW-aangifte travels in the ZIP, traceable ──────────

const emptyAssemble = {
  year: 2026,
  quarter: 1 as const,
  clientName: "Kiwi Food Market",
  outgoing: [] as PackageInvoice[],
  incoming: [] as PackageInvoice[],
  pdfByInvoice: new Map(),
  bankFiles: [],
  kilometerFiles: [],
  sharedFiles: [],
  paymentDates: noPayDates,
  hasBankData: true,
  warnings: [],
};

test("concept-btw-aangifte.csv is written when a concept is present, matching the app figures", async () => {
  // The REAL Kiwi Q1 sales/voorbelasting → the concept that must land in the ZIP.
  const concept = buildAangifte(
    {
      salesByRate: [
        { rate: 21, omzet: 1185, btw: 249 },
        { rate: 9, omzet: 176604, btw: 15894 },
        { rate: 0, omzet: 222, btw: 0 },
      ],
      btwVoorbelasting: 15130,
      cashOmzetZonderBtw: 0,
    },
    { turnoverDays: 90, quarterDays: 90, incomingInvoiceCount: 40, outgoingInvoiceCount: 0, hasEuPurchase: false },
    "Q1 2026",
  );
  const { zipBytes } = await assembleClosingPackageZip({ ...emptyAssemble, conceptAangifte: concept });
  const zip = await JSZip.loadAsync(zipBytes);
  const csv = await zip.file("concept-btw-aangifte.csv")!.async("string");
  assert.match(csv, /GEEN ingediende aangifte/);
  assert.match(csv, /5g;Concept te betalen;;1013,00/);

  // overzicht.json carries the same concept block (5g = 1013), for machine reading.
  const json = JSON.parse(await zip.file("overzicht.json")!.async("string"));
  assert.equal(json.concept_btw_aangifte.saldo_5g, 1013);
  assert.equal(json.concept_btw_aangifte.is_concept, true);
});

test("no concept → no concept-btw-aangifte.csv (never an invented empty filing)", async () => {
  const { zipBytes } = await assembleClosingPackageZip({ ...emptyAssemble, conceptAangifte: null });
  const zip = await JSZip.loadAsync(zipBytes);
  assert.equal(zip.file("concept-btw-aangifte.csv"), null, "no concept file when nothing to declare");
  const json = JSON.parse(await zip.file("overzicht.json")!.async("string"));
  assert.equal(json.concept_btw_aangifte, null);
});

test("[TRIANGLE] card reconciliation is written to the ZIP and a gross mismatch warns", async () => {
  const cardReconciliation = {
    days: [
      { date: "2026-03-01", tillPin: 1000, eftGross: 1000, bankNet: 985, grossMatch: true, grossDiff: 0, commission: 15, status: "ok" as const, breaks: [], notes: [] },
      { date: "2026-03-02", tillPin: 800, eftGross: 750, bankNet: 745, grossMatch: false, grossDiff: -50, commission: null, status: "gross_mismatch" as const, breaks: [], notes: [] },
    ],
    totalCommission: 15,
    grossMismatchDays: 1,
    incompleteDays: 0,
    commissionIssueDays: 0,
    eftGrossByDay: new Map([["2026-03-01", 1000], ["2026-03-02", 750]]),
  };
  const { zipBytes, summary } = await assembleClosingPackageZip({ ...emptyAssemble, cardReconciliation });
  const zip = await JSZip.loadAsync(zipBytes);
  const csv = await zip.file("kaart-reconciliatie.csv")!.async("string");
  assert.match(csv, /1000,00;1000,00;;985,00;15,00;sluit aan/, "the reconciled day shows in the CSV");
  assert.match(csv, /verschil kassa\/terminal/, "the mismatch day is flagged");
  assert.ok(summary.warnings.some((w) => w.code === "card_gross_mismatch"), "a gross-mismatch warning is raised");
});

test("[TRIANGLE] no card reconciliation → no kaart-reconciliatie.csv", async () => {
  const { zipBytes } = await assembleClosingPackageZip({ ...emptyAssemble, cardReconciliation: null });
  const zip = await JSZip.loadAsync(zipBytes);
  assert.equal(zip.file("kaart-reconciliatie.csv"), null, "no card file when there is nothing to reconcile");
});

// ─── [NO-EMPTY-LEDGER] Een onleesbaar grootboek levert géén compleet ogend concept ────────────
//
// Het gevaarlijkste wat dit pakket kan doen is er compleet uitzien terwijl er een been ontbreekt.
// De kas- en banklezingen in buildClosingPackage eindigden op `.catch(() => [])`: een mislukte
// lezing werd een LEGE la, en de concept-BTW-aangifte rekende daar gewoon mee door — de
// boekhouder kreeg een aangifte waarin het contante kwartaal simpelweg niet bestond, zonder één
// teken dat er iets mis was.
//
// buildClosingPackage zelf heeft een Supabase-client nodig en valt buiten deze poort. Wat hier
// wél te bewaken is, is het CONTRACT dat de reparatie oplegt en dat een latere wijziging stil
// zou kunnen breken: verschijnt er een leesfout-waarschuwing, dan hoort er geen concept in de
// ZIP te zitten. De bewijsstukken blijven wél gewoon meegaan.

const LEESFOUT_CODES = ["cash_read_failed", "bank_read_failed", "kasboek_unavailable"] as const;

test("[NO-EMPTY-LEDGER] een leesfout-waarschuwing gaat nooit samen met een concept in de ZIP", async () => {
  for (const code of LEESFOUT_CODES) {
    const { zipBytes, summary } = await assembleClosingPackageZip({
      year: 2026,
      quarter: 1,
      clientName: "Test Klant",
      outgoing: [],
      incoming: [],
      pdfByInvoice: new Map(),
      bankFiles: [{ path: "p", name: "afschrift.pdf", bytes: new Uint8Array([1, 2, 3]) }],
      kilometerFiles: [],
      sharedFiles: [],
      paymentDates: noPayDates,
      hasBankData: true,
      // Dit is wat buildClosingPackage doet zodra een grootboeklezing faalt: de reden meesturen
      // en het concept weglaten.
      conceptAangifte: null,
      warnings: [{ code, message: "De boekingen konden niet volledig worden gelezen." }],
    });

    const zip = await JSZip.loadAsync(zipBytes);
    assert.equal(
      zip.file("concept-btw-aangifte.csv"),
      null,
      `${code}: er mag geen concept-aangifte in het pakket zitten`,
    );
    assert.ok(
      summary.warnings.some((w) => w.code === code),
      `${code}: de reden moet de boekhouder bereiken, niet stilzwijgend verdwijnen`,
    );
    // En het bewijs gaat wél mee — kijken en exporteren blijft altijd werken.
    assert.ok(zip.file("bankafschrift/afschrift.pdf"), `${code}: het bankafschrift hoort gewoon mee te gaan`);
    assert.ok(zip.file("overzicht.csv"), `${code}: het overzicht hoort er te zijn`);
  }
});

test("[NO-EMPTY-LEDGER] de waarschuwing staat leesbaar in overzicht.csv", async () => {
  // De boekhouder opent overzicht.csv, niet de JSON. Staat de reden daar niet, dan is hij stil.
  const csv = buildOverviewCsv("Q1 2026", [], [], [
    { code: "cash_read_failed", message: "De kasboekingen konden niet volledig worden gelezen." },
  ], noPayDates);
  assert.ok(csv.includes("kasboekingen konden niet volledig worden gelezen"),
    "de reden hoort in het overzicht te staan dat de boekhouder daadwerkelijk opent");
});

// ─── [PACKAGE-VOORBELASTING] Costs paid by bank with no purchase invoice ──────
//
// THE SILENT LOSS THIS GUARDS
// Rent, telecom, insurance paid straight from the account. A bare bank line carries no BTW
// document, so the euro lands in the costs and the deductible BTW does NOT — the owner pays
// more BTW than they owe. Nothing looks wrong from the app's side: the line has a category,
// it is placed, every total adds up. That is exactly why it needs to be said out loud.
//
// readiness.ts warns the OWNER. This test is about the ACCOUNTANT: the warning has to reach
// the package too, because a risk does not block a hand-over.

test("[VOORBELASTING] costs without a purchase invoice produce a warning for the accountant", () => {
  const w = costWithoutInvoiceWarning(3, 1250.5);
  assert.ok(w, "three coded costs without an invoice must warn");
  assert.equal(w!.code, "bank_cost_without_invoice");
  assert.match(w!.message, /3 banktransactie/);
  assert.match(w!.message, /voorbelasting/, "the consequence must be named, not just the count");
  assert.match(w!.message, /5b/, "and the rubriek, so the accountant can place it");
});

test("[VOORBELASTING] the AMOUNT is in the message — a count alone does not convey the size", () => {
  // "2 transactions" reads the same whether it is €40 or €40.000. The euro figure is what makes
  // an owner go and look for the invoices.
  const w = costWithoutInvoiceWarning(2, 4000);
  assert.ok(w!.message.includes("4.000") || w!.message.includes("4000"), w!.message);
});

test("[VOORBELASTING] nothing to report stays silent — no invented warning", () => {
  // A package full of warnings that are not real teaches the owner to skip the list, and then
  // the ONE that matters is skipped too.
  assert.equal(costWithoutInvoiceWarning(0, 0), null);
  assert.equal(costWithoutInvoiceWarning(-1, 0), null, "a negative count is a bug, not a warning");
});

test("[VOORBELASTING] the message says the cost DID count — only the BTW did not", () => {
  // The trap in wording this: an owner who reads "no invoice" may conclude the amount fell out
  // of the books entirely and start correcting a thing that is already right. The cost counts;
  // the voorbelasting is what is missing.
  const w = costWithoutInvoiceWarning(1, 100);
  assert.match(w!.message, /telt wel mee in de kosten/);
});

// ─── [PACKAGE-VOORBELASTING-KAS] Cash costs booked without a receipt ──────────
//
// The same silent loss as the bank case, one drawer over: financial-result claims voorbelasting
// on a cash cost ONLY when a bon is linked AND a rate is set. Without both, the FULL GROSS books
// as cost and the BTW is gone. Correct behaviour — never invent a deduction — but nobody is told.

test("[VOORBELASTING-KAS] a cash cost without a bon is counted, with its amount", () => {
  const { count, total } = cashCostsWithoutReceipt([
    { direction: "out", amount: 60, category: "kosten", document_id: null },
    { direction: "out", amount: 40.5, category: "kosten" },
  ]);
  assert.equal(count, 2);
  assert.equal(total, 100.5);
  assert.match(cashCostWithoutReceiptWarning(count, total)!.message, /voorbelasting/);
});

test("[VOORBELASTING-KAS] a cost WITH a bon is not flagged — its BTW is already claimed", () => {
  const { count } = cashCostsWithoutReceipt([
    { direction: "out", amount: 60, category: "kosten", document_id: "doc-1" },
  ]);
  assert.equal(count, 0, "a documented cash cost has nothing to warn about");
});

test("[VOORBELASTING-KAS] sales and refunds are not costs", () => {
  // A cash SALE needs no purchase document, and money IN under 'kosten' is a refund OF a cost —
  // it has no voorbelasting of its own to reclaim. Counting either would be a false alarm, and a
  // false alarm in this list is what teaches an owner to stop reading it.
  const { count } = cashCostsWithoutReceipt([
    { direction: "in", amount: 200, category: "omzet", document_id: null },
    { direction: "in", amount: 25, category: "kosten", document_id: null },
    { direction: "out", amount: 50, category: "prive", document_id: null },
  ]);
  assert.equal(count, 0);
});

test("[VOORBELASTING-KAS] an empty drawer says nothing", () => {
  assert.equal(cashCostWithoutReceiptWarning(0, 0), null);
  assert.deepEqual(cashCostsWithoutReceipt([]), { count: 0, total: 0 });
});


// [NO-SILENT-EMPTY] A verified invoice with no invoice_date sits in NO quarter package and NO
// concept aangifte — Postgres range filters drop NULL rows — so its BTW simply vanishes. This
// warning exists to catch that. When its own query fails it used to report count 0, which the
// package then presented as "there are none": the invoices still vanished, and now the package had
// actively said they did not exist.
test("[NO-SILENT-EMPTY] a dateless check that could not run warns instead of reporting none", () => {
  const unchecked = datelessWarning({ count: 0, labels: [], checked: false });
  assert.ok(unchecked, "a failed check must still produce a warning");
  assert.equal(unchecked!.code, "invoice_no_date");
  assert.match(unchecked!.message, /konden niet nagaan/);

  // A check that RAN and found nothing stays silent — otherwise the warning is on every package
  // and means nothing.
  assert.equal(datelessWarning({ count: 0, labels: [], checked: true }), null);

  // And a real find still names the invoices, which is what makes it actionable.
  const found = datelessWarning({ count: 2, labels: ["F-1", "F-2"], checked: true });
  assert.match(found!.message, /F-1, F-2/);
  assert.doesNotMatch(found!.message, /konden niet nagaan/);
});

test("[NO-SILENT-EMPTY] shared documents that could not be read are named, not assumed absent", () => {
  // This read decides BOTH what goes into the ZIP and what the package warns about. A dropped error
  // shipped the accountant a quarter with its shared documents missing and nothing saying they were
  // ever expected.
  const unchecked = sharedOutsideWarning(0, false);
  assert.ok(unchecked, "a failed read must still produce a warning");
  assert.match(unchecked!.message, /konden de gedeelde bestanden nu niet ophalen/);

  // A read that RAN with everything in this quarter stays silent.
  assert.equal(sharedOutsideWarning(0, true), null);
  // And a real count still says how many sit outside.
  assert.match(sharedOutsideWarning(3, true)!.message, /3 gedeeld/);
});

// ─── [SLUIS] The supplier's own e-factuur, next to his PDF ────────────────────

// The one thing in this package that no accounting package has to SCAN. A purchase invoice in
// UBL/CII is read mechanically straight into a booking; a PDF is OCR'd and then corrected by a
// human. The supplier already sent the XML and the e-mail import already stored it — this is only
// about handing it over.
//
// The base name is the whole trick and it is easy to get subtly wrong: intake services pair a PDF
// and an XML BY FILENAME and treat the pair as one document. Two names make two documents out of
// one invoice, and then a failed XML no longer falls back to the PDF — it becomes a second,
// half-read record of a bill that exists once.

const incomingInvoice = (over: Partial<PackageInvoice> = {}) =>
  invoice({
    id: "in-1",
    direction: "incoming",
    invoice_number: "F-9911",
    client_name: "Sligro",
    invoice_date: "2026-02-04",
    status: "paid",
    document_id: "doc-1",
    ...over,
  });

const bytes = (s: string) => new TextEncoder().encode(s);

async function entriesOf(zipBytes: Uint8Array): Promise<string[]> {
  const zip = await JSZip.loadAsync(zipBytes);
  return Object.keys(zip.files).filter((n) => !zip.files[n].dir);
}

test("[SLUIS] the e-factuur lands beside its PDF under the SAME base name", async () => {
  const inv = incomingInvoice();
  const { zipBytes, summary } = await assembleClosingPackageZip({
    ...emptyAssemble,
    incoming: [inv],
    pdfByInvoice: new Map([[inv.id, { path: "u/incoming/1-f9911.pdf", name: "f9911.pdf", bytes: bytes("%PDF-1.7") }]]),
    xmlByInvoice: new Map([[inv.id, { path: "u/incoming/2-f9911.xml", name: "f9911.xml", bytes: bytes("<Invoice/>") }]]),
    paymentDates: noPayDates,
  });

  const names = await entriesOf(zipBytes);
  const pdf = names.find((n) => n.endsWith(".pdf") && n.startsWith("facturen-en-bonnen/"));
  const xml = names.find((n) => n.endsWith(".xml") && n.startsWith("facturen-en-bonnen/"));
  assert.ok(pdf, "the invoice PDF is missing from the package");
  assert.ok(xml, "the supplier's e-factuur was not added");
  assert.equal(
    xml!.replace(/\.xml$/, ""),
    pdf!.replace(/\.pdf$/, ""),
    "the two files must share one base name — a service that pairs them by name sees two documents otherwise",
  );
  // Same folder, so a drag-and-drop of one directory carries the pair together.
  assert.match(xml!, /^facturen-en-bonnen\/inkomend\/betaald\//);

  const zip = await JSZip.loadAsync(zipBytes);
  const overzicht = JSON.parse(await zip.file("overzicht.json")!.async("string"));
  assert.equal(overzicht.e_facturen_bijgevoegd, 1, "the count the accountant reads must say one");
  assert.equal(summary.filesIncluded, 2, "the XML is a file in the package, not a free rider");
});

test("[SLUIS] an e-factuur that IS the only evidence is written once, not twice", async () => {
  // A supplier who sends nothing but UBL. Then the invoice's stored document is that XML, so the
  // ordinary evidence line already wrote it — under its own .xml extension, thanks to
  // [EVIDENCE-EXT]. Writing it again would put a second entry with the identical name into the
  // archive: JSZip keeps the last, nothing looks broken, and the count would claim a file the ZIP
  // does not separately contain.
  const inv = incomingInvoice({ id: "in-2" });
  const same = { path: "u/incoming/3-only.xml", name: "only.xml", bytes: bytes("<Invoice/>") };
  const { zipBytes, summary } = await assembleClosingPackageZip({
    ...emptyAssemble,
    incoming: [inv],
    pdfByInvoice: new Map([[inv.id, same]]),
    xmlByInvoice: new Map([[inv.id, same]]),
  });

  const names = await entriesOf(zipBytes);
  const inFolder = names.filter((n) => n.startsWith("facturen-en-bonnen/"));
  assert.equal(inFolder.length, 1, `expected one evidence file, got: ${inFolder.join(", ")}`);
  assert.match(inFolder[0], /\.xml$/, "and it keeps its real extension");
  assert.equal(summary.filesIncluded, 1);

  const zip = await JSZip.loadAsync(zipBytes);
  const overzicht = JSON.parse(await zip.file("overzicht.json")!.async("string"));
  assert.equal(overzicht.e_facturen_bijgevoegd, 1, "it still counts — it is simply not written twice");
});

test("[SLUIS] an invoice without an e-factuur gets none, and the count stays honest", async () => {
  const withXml = incomingInvoice({ id: "in-3", invoice_number: "F-1" });
  const without = incomingInvoice({ id: "in-4", invoice_number: "F-2" });
  const { zipBytes } = await assembleClosingPackageZip({
    ...emptyAssemble,
    incoming: [withXml, without],
    pdfByInvoice: new Map([
      [withXml.id, { path: "u/incoming/a.pdf", name: "a.pdf", bytes: bytes("%PDF") }],
      [without.id, { path: "u/incoming/b.pdf", name: "b.pdf", bytes: bytes("%PDF") }],
    ]),
    xmlByInvoice: new Map([[withXml.id, { path: "u/incoming/a.xml", name: "a.xml", bytes: bytes("<Invoice/>") }]]),
  });

  const names = await entriesOf(zipBytes);
  assert.equal(names.filter((n) => n.endsWith(".xml")).length, 1);
  const zip = await JSZip.loadAsync(zipBytes);
  const overzicht = JSON.parse(await zip.file("overzicht.json")!.async("string"));
  assert.equal(overzicht.e_facturen_bijgevoegd, 1);
});

test("[SLUIS] a package built without the map is unchanged, never broken", async () => {
  // Optional on purpose: every existing caller and every test above passes no map at all. It must
  // mean "there were none", and it must not mean a crash halfway through an accountant's download.
  const inv = incomingInvoice({ id: "in-5" });
  const { zipBytes } = await assembleClosingPackageZip({
    ...emptyAssemble,
    incoming: [inv],
    pdfByInvoice: new Map([[inv.id, { path: "u/incoming/c.pdf", name: "c.pdf", bytes: bytes("%PDF") }]]),
  });
  const names = await entriesOf(zipBytes);
  assert.equal(names.filter((n) => n.endsWith(".xml")).length, 0);
  const zip = await JSZip.loadAsync(zipBytes);
  const overzicht = JSON.parse(await zip.file("overzicht.json")!.async("string"));
  assert.equal(overzicht.e_facturen_bijgevoegd, 0);
});

// ─── [SLUIS] The gate the value tests cannot be ────────────────────────────────

test("[SLUIS] the orchestrator really hands the e-facturen over, and really checks them", () => {
  // xmlByInvoice is OPTIONAL, which is right for callers that have none — and is exactly why this
  // gate exists. Drop the one line that passes the map and every test above still passes: they
  // call the assembler directly. What ships is a package with no e-facturen in it, identical in
  // every visible way to a quarter that genuinely had none.
  //
  // The other three claims are the ones that make the XML safe to put next to a PDF under that
  // PDF's name. Together they say: this file belongs to THIS invoice (documents.invoice_id), it
  // sits in THIS owner's folder, the owner has not thrown it away, and its CONTENT is an invoice
  // rather than a CAMT.053 statement that happens to end in .xml.
  const src = readFileSync("src/lib/closing-package.ts", "utf8");

  assert.match(
    src,
    /^\s*xmlByInvoice,\s*$/m,
    "the orchestrator no longer passes xmlByInvoice — every package now ships without e-facturen, silently",
  );
  assert.match(src, /looksLikeInvoiceXmlBytes\(/, "the content check is no longer CALLED — any .xml would be shipped as an e-factuur");
  assert.match(src, /\.in\("invoice_id", incomingIds\)/, "the e-facturen are no longer tied to their own invoice");
  assert.match(src, /if \(!pathBelongsToOwner\(pad, ownerId\)\) continue;/, "[SEC-STORAGE-PATH] the owner-folder check on the e-factuur path is gone");
  assert.match(src, /\.eq\("trashed", false\)\s*\n\s*\.in\("invoice_id"/, "a discarded file is being delivered to the accountant again");
});
