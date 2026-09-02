// src/lib/hold-reasons.test.ts
// [WAAROM-VASTGEHOUDEN] Rows that hit the branches — an empty queue agrees with every ranking.

import test from "node:test";
import assert from "node:assert/strict";
import {
  judgeHoldReasons, handsOffPct, holdLabel, readMarkers, HOLD_LABELS, type HeldDocument,
} from "./hold-reasons";

const NU = Date.UTC(2026, 8, 1, 12, 0, 0);
const dag = 24 * 60 * 60 * 1000;
const opts = { nowMs: NU, windowDays: 90 };

function doc(
  id: string,
  velden: Partial<Omit<HeldDocument, "id">> = {},
): HeldDocument {
  return {
    id,
    supplierName: "Hano B.V.",
    createdAtMs: NU - 10 * dag,
    autoAdvanced: false,
    holdReason: null,
    ...velden,
  };
}

test("[WAAROM-VASTGEHOUDEN] the ranking puts the most expensive refusal first", () => {
  const s = judgeHoldReasons(
    [
      ...Array.from({ length: 7 }, (_, i) => doc(`a${i}`, { holdReason: "no_reliable_total" })),
      ...Array.from({ length: 3 }, (_, i) => doc(`b${i}`, { holdReason: "creditnota" })),
      doc("c", { holdReason: "statement" }),
    ],
    opts,
  );
  assert.deepEqual(s.reasons.map((r) => r.reason), ["no_reliable_total", "creditnota", "statement"]);
  assert.equal(s.reasons[0].count, 7);
  assert.equal(s.held, 11);
});

test("[WAAROM-VASTGEHOUDEN] a held document with no recorded reason is counted apart, never merged", () => {
  // Alles van vóór deze meting draagt geen reden. Zou dat in de ranglijst meelopen als "onbekend",
  // dan zou de grootste categorie een verklaring lijken te hebben die er niet is.
  const s = judgeHoldReasons(
    [
      doc("a", { holdReason: "creditnota" }),
      doc("oud1"), doc("oud2"), doc("oud3"),
    ],
    opts,
  );
  assert.equal(s.held, 4);
  assert.equal(s.recorded, 1);
  assert.equal(s.unrecorded, 3);
  assert.equal(s.reasons.length, 1, "the unrecorded three may not appear as a reason of their own");
});

test("[WAAROM-VASTGEHOUDEN] the share is of ALL held work, not of the explained part", () => {
  // Delen door de vastgelegde deelverzameling zou 100% verklaard werk melden terwijl het meeste
  // onverklaard is — precies de geruststelling die dit paneel moet weerleggen.
  const s = judgeHoldReasons(
    [doc("a", { holdReason: "creditnota" }), doc("b"), doc("c"), doc("d")],
    opts,
  );
  assert.equal(s.reasons[0].sharePct, 25);
});

test("[WAAROM-VASTGEHOUDEN] an auto-booked document is not held work", () => {
  const s = judgeHoldReasons(
    [
      doc("a", { autoAdvanced: true }),
      doc("b", { autoAdvanced: true }),
      doc("c", { holdReason: "statement" }),
    ],
    opts,
  );
  assert.equal(s.total, 3);
  assert.equal(s.advanced, 2);
  assert.equal(s.held, 1);
  assert.equal(handsOffPct(s), 66.7);
});

test("[WAAROM-VASTGEHOUDEN] one refusal concentrated on one supplier surfaces that supplier", () => {
  // Twintig keer dezelfde weigering verspreid over twintig leveranciers is de grens van de lezer;
  // twintig keer bij één leverancier is één sjabloon, en sjablonen worden daadwerkelijk gemaakt.
  const s = judgeHoldReasons(
    [
      ...Array.from({ length: 5 }, (_, i) =>
        doc(`x${i}`, { holdReason: "creditnota", supplierName: "Dutch Sweets Company B.V." })),
      ...Array.from({ length: 2 }, (_, i) =>
        doc(`y${i}`, { holdReason: "creditnota", supplierName: "Andere B.V." })),
      doc("z", { holdReason: "creditnota", supplierName: "Eenmalig B.V." }),
    ],
    opts,
  );
  assert.deepEqual(s.reasons[0].topSuppliers, [
    { supplierName: "Dutch Sweets Company B.V.", count: 5 },
    { supplierName: "Andere B.V.", count: 2 },
  ], "a supplier hit once is chance and stays out");
});

test("[WAAROM-VASTGEHOUDEN] a document outside the window counts nowhere", () => {
  const s = judgeHoldReasons(
    [
      doc("oud", { createdAtMs: NU - 200 * dag, holdReason: "creditnota" }),
      doc("nieuw", { holdReason: "creditnota" }),
      doc("ongedateerd", { createdAtMs: null, holdReason: "creditnota" }),
    ],
    opts,
  );
  assert.equal(s.total, 1);
  assert.equal(s.reasons[0].count, 1);
});

test("[WAAROM-VASTGEHOUDEN] an empty queue gives no percentage, not a confident 100%", () => {
  const s = judgeHoldReasons([], opts);
  assert.equal(handsOffPct(s), null,
    "'100% hands-off' over zero documents is a claim the data does not support");
  assert.deepEqual(s.reasons, []);
});

test("[WAAROM-VASTGEHOUDEN] a tag this module does not know still shows, under its own name", () => {
  // Wegvallen zou de categorie onzichtbaar maken die per definitie nieuw is — en dus interessant.
  const s = judgeHoldReasons([doc("a", { holdReason: "iets_nieuws" })], opts);
  assert.equal(s.reasons[0].reason, "iets_nieuws");
  assert.equal(s.reasons[0].label, "iets_nieuws");
  assert.equal(holdLabel("creditnota"), HOLD_LABELS.creditnota);
});

test("[WAAROM-VASTGEHOUDEN] an empty string is not a reason", () => {
  const s = judgeHoldReasons([doc("a", { holdReason: "   " })], opts);
  assert.equal(s.unrecorded, 1);
  assert.equal(s.reasons.length, 0);
});

// ── De rij zoals hij echt uit de database komt ──────────────────────────────────

test("[WAAROM-VASTGEHOUDEN] the markers are read out of the stored jsonb, in every shape", () => {
  const basis = { id: "a", client_name: "Hano", created_at: "2026-08-20T10:00:00Z" };
  assert.deepEqual(readMarkers({ ...basis, field_confidence: null }), {
    id: "a", supplierName: "Hano", createdAtMs: Date.parse("2026-08-20T10:00:00Z"),
    autoAdvanced: false, holdReason: null,
  });
  assert.equal(readMarkers({ ...basis, field_confidence: "kapot" }).autoAdvanced, false);
  assert.equal(
    readMarkers({ ...basis, field_confidence: { _auto_verified: { at: "x", reason: "clean_high_confidence" } } }).autoAdvanced,
    true,
  );
  assert.equal(
    readMarkers({ ...basis, field_confidence: { _auto_hold: { at: "x", reason: "creditnota" } } }).holdReason,
    "creditnota",
  );
  assert.equal(
    readMarkers({ ...basis, field_confidence: { _auto_hold: { at: "x" } } }).holdReason,
    null,
    "a hold without a reason is not a reason",
  );
  assert.equal(readMarkers({ ...basis, field_confidence: null, created_at: null }).createdAtMs, null);
});
