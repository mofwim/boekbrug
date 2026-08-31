// src/lib/reader-quality.test.ts
// [LEESKWALITEIT] Rows that exercise the branches — an empty list agrees with every implementation.

import test from "node:test";
import assert from "node:assert/strict";
import { judgeReaderQuality, caughtErrorPct, type ReadInvoice, type CorrectionRow } from "./reader-quality";

const NU = Date.UTC(2026, 7, 31, 12, 0, 0); // 31 augustus 2026
const dag = 24 * 60 * 60 * 1000;

function factuur(id: string, supplier: string | null, dagenGeleden: number, status = "received"): ReadInvoice {
  return { id, supplierName: supplier, createdAtMs: NU - dagenGeleden * dag, status };
}
function correctie(
  invoiceId: string,
  dagenGeleden: number,
  velden: Partial<Omit<CorrectionRow, "invoiceId" | "atMs">> = {},
): CorrectionRow {
  return {
    invoiceId,
    atMs: NU - dagenGeleden * dag,
    amountBefore: null, amountAfter: null, ibanBefore: null, ibanAfter: null,
    ...velden,
  };
}
const opts = { nowMs: NU, windowDays: 90 };

test("[LEESKWALITEIT] a changed amount counts, an unchanged one does not", () => {
  const q = judgeReaderQuality(
    [factuur("a", "Hano", 10), factuur("b", "Hano", 9)],
    [
      correctie("a", 5, { amountBefore: "33.87", amountAfter: "-33.87" }),
      correctie("b", 4, { amountBefore: "10.00", amountAfter: "10.00" }), // adres gewijzigd, bedrag niet
    ],
    opts,
  );
  assert.equal(q.read, 2);
  assert.equal(q.amountCorrected, 1);
  assert.equal(q.ibanCorrected, 0);
});

test("[LEESKWALITEIT] a null on either side is not a change — that is a field being filled in", () => {
  const q = judgeReaderQuality(
    [factuur("a", "Hano", 10)],
    [correctie("a", 5, { ibanBefore: null, ibanAfter: "NL91ABNA0417164300" })],
    opts,
  );
  assert.equal(q.ibanCorrected, 0, "an IBAN that was empty and got filled is not a misread");
});

test("[LEESKWALITEIT] one invoice corrected three times is ONE invoice the reader got wrong", () => {
  const q = judgeReaderQuality(
    [factuur("a", "Hano", 10)],
    [
      correctie("a", 7, { amountBefore: "1", amountAfter: "2" }),
      correctie("a", 6, { amountBefore: "2", amountAfter: "3" }),
      correctie("a", 5, { amountBefore: "3", amountAfter: "4" }),
    ],
    opts,
  );
  assert.equal(q.amountCorrected, 1);
  assert.equal(q.recent.length, 1);
  assert.equal(q.recent[0].amountAfter, "4", "the newest correction is the one shown");
});

test("[LEESKWALITEIT] amount on one visit and IBAN on another makes it both", () => {
  const q = judgeReaderQuality(
    [factuur("a", "Hano", 10)],
    [
      correctie("a", 7, { amountBefore: "1", amountAfter: "2" }),
      correctie("a", 5, { ibanBefore: "NL01", ibanAfter: "NL02" }),
    ],
    opts,
  );
  assert.equal(q.recent[0].what, "beide");
  assert.equal(q.amountCorrected, 1);
  assert.equal(q.ibanCorrected, 1);
});

// ── De vondst die dit paneel bestaat om te tonen ────────────────────────────────
//
// Vijf creditnota's van één leverancier, allemaal in één zitting rechtgezet. Als percentage is dat
// 0,9% en dus niets; per leverancier is het één sjabloon dat de lezer niet aankan.

test("[LEESKWALITEIT] five corrections on one supplier surface as that supplier, not as a percentage", () => {
  const facturen = [
    ...Array.from({ length: 100 }, (_, i) => factuur(`ok${i}`, "Andere B.V.", 30)),
    ...["c1", "c2", "c3", "c4", "c5"].map((id) => factuur(id, "Dutch Sweets Company B.V.", 40)),
  ];
  const correcties = ["c1", "c2", "c3", "c4", "c5"].map((id, i) =>
    correctie(id, 20, { amountBefore: "33.87", amountAfter: `-${33 + i}.87` }),
  );
  const q = judgeReaderQuality(facturen, correcties, opts);

  assert.equal(q.read, 105);
  assert.equal(caughtErrorPct(q), 4.8, "…and the percentage alone would not point anywhere");
  assert.deepEqual(q.troubleSuppliers, [
    { supplierName: "Dutch Sweets Company B.V.", corrected: 5, read: 5 },
  ], "one supplier, five of five wrong — that is a template, not noise");
});

test("[LEESKWALITEIT] a supplier corrected once is chance and stays out of the trouble list", () => {
  const q = judgeReaderQuality(
    [factuur("a", "Eenmalig B.V.", 10), factuur("b", "Eenmalig B.V.", 9)],
    [correctie("a", 5, { amountBefore: "1", amountAfter: "2" })],
    opts,
  );
  assert.deepEqual(q.troubleSuppliers, []);
});

test("[LEESKWALITEIT] the denominator is per supplier, so 2-of-3 cannot look like 2-of-400", () => {
  const q = judgeReaderQuality(
    [
      factuur("a", "Klein B.V.", 10), factuur("b", "Klein B.V.", 10), factuur("c", "Klein B.V.", 10),
      ...Array.from({ length: 400 }, (_, i) => factuur(`g${i}`, "Groot B.V.", 10)),
    ],
    [
      correctie("a", 5, { amountBefore: "1", amountAfter: "2" }),
      correctie("b", 5, { amountBefore: "1", amountAfter: "2" }),
      correctie("g1", 5, { amountBefore: "1", amountAfter: "2" }),
      correctie("g2", 5, { amountBefore: "1", amountAfter: "2" }),
    ],
    opts,
  );
  const klein = q.troubleSuppliers.find((s) => s.supplierName === "Klein B.V.");
  const groot = q.troubleSuppliers.find((s) => s.supplierName === "Groot B.V.");
  assert.deepEqual(klein, { supplierName: "Klein B.V.", corrected: 2, read: 3 });
  assert.deepEqual(groot, { supplierName: "Groot B.V.", corrected: 2, read: 400 });
});

test("[LEESKWALITEIT] a correction on a PAID invoice is counted apart — that is money already gone", () => {
  const q = judgeReaderQuality(
    [factuur("a", "Hano", 10, "paid"), factuur("b", "Hano", 10, "received")],
    [
      correctie("a", 5, { amountBefore: "100", amountAfter: "90" }),
      correctie("b", 5, { amountBefore: "100", amountAfter: "90" }),
    ],
    opts,
  );
  assert.equal(q.afterPayment, 1);
});

test("[LEESKWALITEIT] both sides are scoped to the same window, or the ratio passes 100%", () => {
  const q = judgeReaderQuality(
    [factuur("oud", "Hano", 200), factuur("nieuw", "Hano", 10)],
    [
      correctie("oud", 150, { amountBefore: "1", amountAfter: "2" }), // buiten het venster
      correctie("nieuw", 5, { amountBefore: "1", amountAfter: "2" }),
    ],
    opts,
  );
  assert.equal(q.read, 1, "the old invoice is outside the window");
  assert.equal(q.amountCorrected, 1, "…and so is its correction");
});

test("[LEESKWALITEIT] nothing read means no percentage, not a confident zero", () => {
  const q = judgeReaderQuality([], [], opts);
  assert.equal(q.read, 0);
  assert.equal(caughtErrorPct(q), null,
    "'0.0% wrong' over zero invoices is a claim the data does not support");
});

test("[LEESKWALITEIT] an invoice with no supplier still counts, under a name that says so", () => {
  const q = judgeReaderQuality(
    [factuur("a", null, 10), factuur("b", "   ", 10)],
    [
      correctie("a", 5, { amountBefore: "1", amountAfter: "2" }),
      correctie("b", 5, { amountBefore: "1", amountAfter: "2" }),
    ],
    opts,
  );
  assert.equal(q.amountCorrected, 2);
  assert.equal(q.troubleSuppliers[0].supplierName, "(zonder leverancier)");
  assert.equal(q.troubleSuppliers[0].corrected, 2);
});
