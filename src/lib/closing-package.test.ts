// src/lib/closing-package.test.ts
// [BTW-RATE-GUARD] + [BANK-COVERAGE] Tests for the closing-package assembly.
// Pure / node-testable (JSZip only, no network).
// Run:  npx tsx src/lib/closing-package.test.ts
// (extensionless imports like the app; tsx resolves + strips types)

import test from "node:test";
import assert from "node:assert/strict";
import {
  buildOverviewCsv,
  assembleClosingPackageZip,
  effectiveDirection,
  type PackageInvoice,
  type PaymentDateInfo,
} from "./closing-package";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function invoice(over: Partial<PackageInvoice>): PackageInvoice {
  return {
    id: over.id ?? "inv-1",
    invoice_number: over.invoice_number ?? "2026-001",
    client_name: over.client_name ?? "Test Klant",
    status: over.status ?? "sent",
    direction: over.direction ?? "outgoing",
    total_ex_btw: over.total_ex_btw ?? 100,
    btw_amount: over.btw_amount ?? 21,
    total_inc_btw: over.total_inc_btw ?? 121,
    invoice_date: over.invoice_date ?? "2026-02-10",
    due_date: over.due_date ?? "2026-03-10",
    pdf_url: over.pdf_url ?? null,
    document_id: over.document_id ?? null,
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
