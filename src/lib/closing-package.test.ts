// src/lib/closing-package.test.ts
// [BTW-RATE-GUARD] + [BANK-COVERAGE] Tests for the closing-package assembly.
// Pure / node-testable (JSZip only, no network).
// Run:  npx tsx src/lib/closing-package.test.ts
// (extensionless imports like the app; tsx resolves + strips types)

import test from "node:test";
import assert from "node:assert/strict";
import JSZip from "jszip";
import {
  buildOverviewCsv,
  assembleClosingPackageZip,
  effectiveDirection,
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
