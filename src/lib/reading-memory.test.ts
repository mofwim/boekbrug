// [READING-MEMORY] Pure node test — run: npx tsx --test src/lib/reading-memory.test.ts
//
// The memory has to be right about two things or it is worse than nothing:
//   1. it must record only what the human actually CHANGED. The verify screen posts every field on
//      every confirm, so a naive version learns "the owner corrects everything" — which points at
//      every field and therefore at none;
//   2. it must stay quiet until a pattern exists. A hint on every card is noise, and noise on this
//      screen is expensive: it is the screen where wrong amounts are supposed to be caught.
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  correctedFields,
  buildReadingMemory,
  readingHint,
  readingHintFor,
  vendorKey,
  MEMORY_THRESHOLD,
} from "./reading-memory";

// ── correctedFields ───────────────────────────────────────────────────────────

test("a confirm that changed nothing records nothing", () => {
  const read = { total_ex_btw: 800, btw_amount: 72, total_inc_btw: 872, client_name: "Groothandel" };
  assert.deepEqual(correctedFields(read, { ...read }), []);
});

test("only the fields that really changed are recorded", () => {
  const before = { total_ex_btw: 1722.54, btw_amount: 144.95, total_inc_btw: 1843.49, client_name: "Elegance Brands" };
  // The reviewer repaired the btw and the total; the supplier name was right and comes back as-is.
  const after = { total_ex_btw: 1722.54, btw_amount: 120.95, total_inc_btw: 1843.49, client_name: "Elegance Brands" };
  assert.deepEqual(correctedFields(before, after), ["btw_amount"]);
});

test("[CENTS] a rounding-sized difference is not a correction", () => {
  // 0.001 apart is the same number arriving through a float, not a human changing anything.
  assert.deepEqual(correctedFields({ btw_amount: 72 }, { btw_amount: 72.001 }), []);
  assert.deepEqual(correctedFields({ btw_amount: 72 }, { btw_amount: 72.01 }), ["btw_amount"]);
});

test("filling an empty field is not correcting a wrong one", () => {
  // The reader produced no btw at all. The human typing one is a GAP being closed — import-health
  // already says that in its own words. Counting it here would teach the memory that this supplier's
  // btw is always wrong, when really it was never read.
  assert.deepEqual(correctedFields({ btw_amount: null }, { btw_amount: 72 }), []);
  assert.deepEqual(correctedFields({}, { btw_amount: 72 }), []);
  // And the reverse: a field the screen did not send back is unchanged, not cleared.
  assert.deepEqual(correctedFields({ btw_amount: 72 }, {}), []);
});

test("text fields compare trimmed, so whitespace is not a correction", () => {
  assert.deepEqual(correctedFields({ client_name: "Altena " }, { client_name: "Altena" }), []);
  assert.deepEqual(correctedFields({ client_name: "Altena" }, { client_name: "Altena B.V." }), ["client_name"]);
});

test("changing the KIND of document is a correction worth remembering", () => {
  // The reader structurally under-sees a positively printed credit note. If a supplier's documents
  // keep needing this, that is exactly the thing to point at next time.
  assert.deepEqual(correctedFields({ invoice_type: "factuur" }, { invoice_type: "creditnota" }), ["invoice_type"]);
});

test("a non-numeric amount is not compared at all", () => {
  // Rather than coercing "" to 0 and recording a €72 correction that never happened.
  assert.deepEqual(correctedFields({ btw_amount: "" }, { btw_amount: 72 }), []);
});

// ── buildReadingMemory ────────────────────────────────────────────────────────

test("corrections are counted per INVOICE, not per field", () => {
  // One badly read invoice with three wrong amounts is ONE invoice the reader got wrong. Counting
  // three would make a single bad scan look like a standing pattern.
  const memory = buildReadingMemory([
    { vendor: "Elegance Brands", fields: ["total_ex_btw", "btw_amount", "total_inc_btw"], at: "2026-07-30T10:00:00Z" },
  ]);
  const m = memory.get("elegance brands")!;
  assert.equal(m.corrections, 1);
  assert.equal(m.byField.length, 3);
});

test("the same supplier written differently is one supplier", () => {
  const memory = buildReadingMemory([
    { vendor: "Elegance Brands", fields: ["btw_amount"] },
    { vendor: " elegance brands ", fields: ["btw_amount"] },
  ]);
  assert.equal(memory.size, 1);
  assert.equal(memory.get("elegance brands")!.corrections, 2);
});

test("a confirm with no changed fields does not enter the memory", () => {
  const memory = buildReadingMemory([{ vendor: "Groothandel", fields: [] }]);
  assert.equal(memory.size, 0);
});

test("an unknown field name is ignored, not counted", () => {
  // The audit trail is written by routes that may change. A field this version does not know about
  // must not inflate the count of a supplier whose invoices are actually read fine.
  const memory = buildReadingMemory([{ vendor: "X", fields: ["something_else"] }]);
  assert.equal(memory.size, 0);
});

test("fields rank by how often they were corrected", () => {
  const memory = buildReadingMemory([
    { vendor: "Enka", fields: ["btw_amount", "total_inc_btw"] },
    { vendor: "Enka", fields: ["btw_amount"] },
    { vendor: "Enka", fields: ["btw_amount"] },
  ]);
  const m = memory.get("enka")!;
  assert.equal(m.corrections, 3);
  assert.deepEqual(m.byField.map((b) => b.field), ["btw_amount", "total_inc_btw"]);
  assert.equal(m.byField[0].count, 3);
});

test("the most recent correction is kept, whatever order they arrive in", () => {
  const memory = buildReadingMemory([
    { vendor: "Enka", fields: ["btw_amount"], at: "2026-06-01T10:00:00Z" },
    { vendor: "Enka", fields: ["btw_amount"], at: "2026-07-30T10:00:00Z" },
    { vendor: "Enka", fields: ["btw_amount"], at: "2026-07-03T10:00:00Z" },
  ]);
  assert.equal(memory.get("enka")!.lastAt, "2026-07-30T10:00:00Z");
});

test("a nameless supplier cannot be remembered", () => {
  // There is nothing to key on, and guessing would attach one supplier's history to another's card.
  assert.equal(buildReadingMemory([{ vendor: null, fields: ["btw_amount"] }]).size, 0);
  assert.equal(buildReadingMemory([{ vendor: "   ", fields: ["btw_amount"] }]).size, 0);
});

// ── readingHint ───────────────────────────────────────────────────────────────

test("[QUIET] one correction says nothing", () => {
  // Every supplier produces one eventually. A hint on every card is a hint on no card.
  const memory = buildReadingMemory([{ vendor: "Enka", fields: ["btw_amount"] }]);
  assert.equal(readingHint(memory.get("enka")), null);
  assert.equal(MEMORY_THRESHOLD, 2, "the threshold is a decision, not an accident");
});

test("two corrections on the same field become a sentence that names that field", () => {
  const memory = buildReadingMemory([
    { vendor: "Elegance Brands", fields: ["btw_amount", "total_inc_btw"] },
    { vendor: "Elegance Brands", fields: ["btw_amount"] },
  ]);
  const hint = readingHint(memory.get("elegance brands"))!;
  assert.match(hint, /2 eerdere facturen/);
  assert.match(hint, /het btw-bedrag/);
  // The total changed only once — it rode along with the btw and is not the pattern.
  assert.doesNotMatch(hint, /totaalbedrag/);
});

test("[NO-NUMBERS] the hint never carries an amount", () => {
  // A remembered number belongs to a different invoice. Naming the FIELD sends the reviewer to the
  // right line; naming an amount would send them to the wrong one.
  const memory = buildReadingMemory([
    { vendor: "Enka", fields: ["btw_amount"] },
    { vendor: "Enka", fields: ["btw_amount"] },
  ]);
  const hint = readingHint(memory.get("enka"))!;
  assert.doesNotMatch(hint, /\d+[.,]\d\d/, "no money in the sentence");
  assert.doesNotMatch(hint, /€/);
});

test("at most two fields are named", () => {
  // A sentence listing seven fields is a sentence nobody reads.
  const memory = buildReadingMemory([
    { vendor: "X", fields: ["total_ex_btw", "btw_amount", "total_inc_btw", "invoice_date"] },
    { vendor: "X", fields: ["total_ex_btw", "btw_amount", "total_inc_btw", "invoice_date"] },
  ]);
  const hint = readingHint(memory.get("x"))!;
  assert.equal(hint.split(" en ").length, 2, "exactly two labels, joined once");
});

test("a supplier with no history gets no hint, and an unknown one does not throw", () => {
  const memory = buildReadingMemory([
    { vendor: "Enka", fields: ["btw_amount"] },
    { vendor: "Enka", fields: ["btw_amount"] },
  ]);
  assert.equal(readingHintFor("Enka", memory) != null, true);
  assert.equal(readingHintFor("Nooit Gezien B.V.", memory), null);
  assert.equal(readingHintFor(null, memory), null);
  assert.equal(readingHint(undefined), null);
});

test("vendorKey matches the key every other screen in this line uses", () => {
  assert.equal(vendorKey("  Elegance Brands "), "elegance brands");
  assert.equal(vendorKey(null), "");
});
