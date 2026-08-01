// [GOCARDLESS] Pure node test — run: npx tsx --test src/lib/gocardless-sync.test.ts
//
// The sync itself talks to a database and is covered by the client and mapper tests either side
// of it. What is pinned HERE is the arithmetic that decides when we may call the bank and which
// window we ask for — two small pure functions that, when wrong, fail in ways nobody notices:
// a guard that is slightly too eager burns the daily budget and the feed goes silent until
// tomorrow, and a window that starts one day too late loses a transaction permanently.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_FIRST_SYNC_DAYS,
  isAccountDue,
  isoDaysBefore,
  SYNC_MIN_INTERVAL_HOURS,
  SYNC_OVERLAP_DAYS,
  syncWindow,
} from "./gocardless-sync";
import { MAX_HISTORICAL_DAYS_CAP } from "./gocardless-client";

const NOW = new Date("2026-08-01T12:00:00.000Z");
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000).toISOString();

// ─── the rate-limit guard ─────────────────────────────────────────────────────────────────────

test("an account that has never synced is always due", () => {
  assert.equal(isAccountDue(null, NOW), true);
});

test("the guard sits just under a day, so a daily cron never skips by drifting a few minutes", () => {
  // The failure this pins: at exactly 24 hours, a cron that fires a minute early would find the
  // account "not due" and defer it a whole day — every day, forever.
  assert.ok(SYNC_MIN_INTERVAL_HOURS < 24);
  assert.equal(isAccountDue(hoursAgo(23), NOW), true);
  assert.equal(isAccountDue(hoursAgo(SYNC_MIN_INTERVAL_HOURS), NOW), true);
  assert.equal(isAccountDue(hoursAgo(SYNC_MIN_INTERVAL_HOURS - 0.5), NOW), false);
  assert.equal(isAccountDue(hoursAgo(1), NOW), false);
});

test("an unreadable timestamp counts as due, never as blocked forever", () => {
  // Refusing to sync on a corrupt column would stop the feed silently and permanently — far
  // worse than one extra read.
  assert.equal(isAccountDue("not-a-date", NOW), true);
  assert.equal(isAccountDue("", NOW), true);
});

// ─── the window ───────────────────────────────────────────────────────────────────────────────

test("isoDaysBefore steps back over a month boundary", () => {
  assert.equal(isoDaysBefore(new Date("2026-03-05T00:00:00Z"), 7), "2026-02-26");
  assert.equal(isoDaysBefore(new Date("2026-01-01T00:00:00Z"), 1), "2025-12-31");
  // A leap day must survive the arithmetic.
  assert.equal(isoDaysBefore(new Date("2028-03-01T00:00:00Z"), 1), "2028-02-29");
});

test("a first sync asks for the history this bank granted", () => {
  const w = syncWindow({ lastSyncedThrough: null }, { maxHistoricalDays: 180 }, NOW);
  assert.equal(w.dateTo, "2026-08-01");
  assert.equal(w.dateFrom, isoDaysBefore(NOW, 180));
});

test("a first sync without a known window falls back to a year, and never exceeds the cap", () => {
  assert.equal(
    syncWindow({ lastSyncedThrough: null }, { maxHistoricalDays: null }, NOW).dateFrom,
    isoDaysBefore(NOW, DEFAULT_FIRST_SYNC_DAYS),
  );
  // A bank reporting something absurd must not make us request years we would only throw away.
  assert.equal(
    syncWindow({ lastSyncedThrough: null }, { maxHistoricalDays: 99_999 }, NOW).dateFrom,
    isoDaysBefore(NOW, MAX_HISTORICAL_DAYS_CAP),
  );
});

test("a later sync overlaps the previous window instead of resuming exactly where it stopped", () => {
  // A transaction can book days after it happened. Starting exactly at last_synced_through would
  // step over it and it would never arrive — the dedup absorbs the overlap, so overlapping costs
  // nothing and not overlapping costs a transaction.
  const w = syncWindow({ lastSyncedThrough: "2026-07-30" }, { maxHistoricalDays: 730 }, NOW);
  assert.equal(w.dateFrom, "2026-07-23");
  assert.equal(w.dateTo, "2026-08-01");
  assert.ok(SYNC_OVERLAP_DAYS >= 1);
});

test("the window always ends today — never in the future", () => {
  // date_to in the future is rejected by the API, which would fail the whole account.
  for (const through of [null, "2026-07-31", "2020-01-01"]) {
    const w = syncWindow({ lastSyncedThrough: through }, { maxHistoricalDays: 90 }, NOW);
    assert.equal(w.dateTo, "2026-08-01");
    assert.ok(w.dateFrom <= w.dateTo, `${w.dateFrom} must not be after ${w.dateTo}`);
  }
});
