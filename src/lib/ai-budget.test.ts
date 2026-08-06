// [COST-GUARD] Pure node test — run: npx tsx --test src/lib/ai-budget.test.ts
//
// The arithmetic of the fuse, without a database.
//
// WHY THESE TESTS AND NOT OTHERS
//
// The fuse is global: one number, shared by every user of the app. That makes its arithmetic
// unusually consequential in ONE direction — an estimate that is 3× too high does not cost money,
// it costs everyone else their automatic reading for the rest of the day. That is exactly what
// happened: €5 blew at ~260 documents while real spend was under €2, because the reservation
// charged max_tokens and the cache-write rate on every call.
//
// So the properties worth pinning are about the CORRECTION, and about the directions in which it
// must refuse to correct:
//
//   1. The refund is real and large. A settled batch call costs a fraction of its reservation.
//   2. A dearer-than-estimated call is CHARGED. A settlement that only ever refunds is a discount.
//   3. An unreadable usage block settles NOTHING. Never talk a fuse down from a response you could
//      not read — that is the one direction where being wrong ends in a bill.
//   4. A reservation that was never recorded is never settled. Fail-open on the guard must not
//      turn into subtracting money nobody charged.
//   5. The floor: no settlement can be constructed that drives a day negative on its own. (The
//      database clamps too — GREATEST(...,0) in ai_budget_settle.sql — but a fuse deserves both.)

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  estimateCostMicros,
  actualCostMicros,
  settlementMicros,
  MICROS_PER_KTOK,
  TOKEN_ESTIMATE,
  type ClaudeUsage,
} from "./ai-budget";

/** A reservation as reserveAiBudget() returns it for a document read. */
const RESERVED_DOCUMENT = {
  reservedMicros: estimateCostMicros(TOKEN_ESTIMATE.imageDocument, 2000),
  recorded: true,
};

/** What a COLD invoice read really reports: system prompt written to cache, short answer. */
const COLD: ClaudeUsage = {
  input_tokens: 1_700,
  cache_creation_input_tokens: 4_300,
  cache_read_input_tokens: 0,
  output_tokens: 420,
};

/** The same read inside a batch: the system prompt is a cache HIT. */
const WARM: ClaudeUsage = {
  input_tokens: 1_700,
  cache_creation_input_tokens: 0,
  cache_read_input_tokens: 4_300,
  output_tokens: 420,
};

// ── The rates themselves ─────────────────────────────────────────────

test("[COST-GUARD] a cache read is a tenth of ordinary input, and output is five times it", () => {
  assert.equal(MICROS_PER_KTOK.cacheRead * 10, MICROS_PER_KTOK.input);
  assert.equal(MICROS_PER_KTOK.cacheWrite, Math.round(MICROS_PER_KTOK.input * 1.25));
  assert.equal(MICROS_PER_KTOK.output, MICROS_PER_KTOK.input * 5);
});

// ── 1. The refund is real, and big enough to matter ──────────────────

test("[COST-GUARD] the reservation for one document is what it always was", () => {
  // 6,000 in at the cache-write rate + 2,000 out. Pinned because the whole point of the
  // settlement is that this number stays conservative — it must not quietly get cheaper.
  assert.equal(RESERVED_DOCUMENT.reservedMicros, 19_250);
});

test("[COST-GUARD] a cold read settles to roughly a third of its reservation", () => {
  const actual = actualCostMicros(COLD);
  assert.ok(actual !== null);
  // 1700×1.100 + 4300×1.375 + 420×5.500 = 1870 + 5912.5 + 2310 = 10092.5 → 10093
  assert.equal(actual, 10_093);

  const delta = settlementMicros(RESERVED_DOCUMENT, COLD);
  assert.ok(delta < 0, "a cold read still costs less than the reservation");
  assert.equal(RESERVED_DOCUMENT.reservedMicros + delta, actual);
});

test("[COST-GUARD] a warm read — the normal case in a batch — settles to about a fifth", () => {
  const actual = actualCostMicros(WARM);
  assert.ok(actual !== null);
  // 1700×1.100 + 4300×0.110 + 420×5.500 = 1870 + 473 + 2310 = 4653
  assert.equal(actual, 4_653);

  // This is the number the whole change exists for: a €5 day is ~1,000 warm reads, not ~260.
  const perDay = Math.floor(5_000_000 / actual);
  assert.ok(perDay > 900, `a €5 day should be well past 900 warm reads, got ${perDay}`);
});

// ── 2. A dearer call is charged, not forgiven ────────────────────────

test("[COST-GUARD] a call that cost MORE than estimated is charged the difference", () => {
  // A long multi-page PDF that answers at the full 2,000 tokens with no cache hit.
  const expensive: ClaudeUsage = {
    input_tokens: 20_000,
    cache_creation_input_tokens: 4_300,
    cache_read_input_tokens: 0,
    output_tokens: 2_000,
  };
  const delta = settlementMicros(RESERVED_DOCUMENT, expensive);
  assert.ok(delta > 0, "settlement must add when the estimate was too low");
  assert.equal(
    RESERVED_DOCUMENT.reservedMicros + delta,
    actualCostMicros(expensive),
    "after settling, the day carries the real cost — not the estimate, in either direction",
  );
});

// ── 3. An unreadable usage block settles nothing ─────────────────────

test("[COST-GUARD] a missing or empty usage block leaves the conservative estimate standing", () => {
  for (const bad of [undefined, null, {}, { input_tokens: 0, output_tokens: 0 }]) {
    assert.equal(actualCostMicros(bad as ClaudeUsage | null | undefined), null);
    assert.equal(
      settlementMicros(RESERVED_DOCUMENT, bad as ClaudeUsage | null | undefined),
      0,
      "no usage → no settlement → the fuse keeps the high guess",
    );
  }
});

test("[COST-GUARD] nonsense token counts never make a call look cheaper than it was", () => {
  // NaN, negatives and strings all read as zero — but a block that is ONLY nonsense reads as
  // unreadable, not as a free call.
  const nonsense = {
    input_tokens: Number.NaN,
    output_tokens: -5,
    cache_read_input_tokens: null,
  } as unknown as ClaudeUsage;
  assert.equal(actualCostMicros(nonsense), null);

  // One good field among the nonsense is still a real reading of that field.
  const partly = { input_tokens: Number.NaN, output_tokens: 400 } as unknown as ClaudeUsage;
  assert.equal(actualCostMicros(partly), 400 * (MICROS_PER_KTOK.output / 1000));
});

// ── 4. Nothing recorded, nothing settled ─────────────────────────────

test("[COST-GUARD] a reservation the guard never recorded is never refunded", () => {
  // This is the fail-open path: reserveAiBudget allowed the call because the database was
  // unreachable, so NOTHING went on the tab. Refunding it here would drive the day's total down
  // by money that was never charged — and a fuse you can talk downwards is not a fuse.
  const unrecorded = { reservedMicros: 19_250, recorded: false };
  assert.equal(settlementMicros(unrecorded, WARM), 0);

  // Same for a refused call: ai_budget_consume() reserves nothing when it says no.
  const refused = { reservedMicros: 0, recorded: false };
  assert.equal(settlementMicros(refused, WARM), 0);
});

// ── 5. A settlement can never exceed its own reservation downwards ───

test("[COST-GUARD] a refund never exceeds what was reserved", () => {
  // The cheapest imaginable call against the biggest reservation: the refund is bounded by the
  // reservation itself, so one settlement can never push a day below zero on its own.
  const tiny: ClaudeUsage = { input_tokens: 1, output_tokens: 1 };
  const delta = settlementMicros(RESERVED_DOCUMENT, tiny);
  assert.ok(delta < 0);
  assert.ok(
    Math.abs(delta) < RESERVED_DOCUMENT.reservedMicros,
    "the refund is smaller than the reservation, always — the call cost SOMETHING",
  );
});

// ── The estimate itself, unchanged ───────────────────────────────────

test("[COST-GUARD] the estimate still refuses to be talked down by bad input", () => {
  assert.equal(estimateCostMicros(-1, -1), 0);
  assert.equal(estimateCostMicros(0, 2000), 11_000);
  // Rounded UP, never down: the reservation errs toward tripping early.
  assert.equal(estimateCostMicros(1, 0), Math.ceil(MICROS_PER_KTOK.cacheWrite / 1000));
});
