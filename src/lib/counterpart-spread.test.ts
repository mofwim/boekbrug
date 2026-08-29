// [ZELFDE-TEGENPARTIJ] Run: npx tsx --test src/lib/counterpart-spread.test.ts
//
// The dangerous direction here is spreading too WIDE: this writes a category onto rows the owner
// never looked at, so every test below is about something it must refuse to touch.

import { test } from "node:test";
import assert from "node:assert/strict";
import { linesForCounterpart, type SpreadCandidate } from "./counterpart-spread";

const row = (id: string, name: string | null, category: string | null = null): SpreadCandidate =>
  ({ id, counterpart_name: name, category });

test("the same counterpart, however it is spelled, is one party", () => {
  // Real names from the live database: the same wholesaler arrives with and without its suffix.
  const rows = [
    row("a", "Trimex"), row("b", "TRIMEX B.V."), row("c", "trimex bv"), row("d", "Nettorama"),
  ];
  const ids = linesForCounterpart(rows, "Trimex International", "a");
  assert.ok(!ids.includes("d"), "a different party is never swept in");
  assert.ok(!ids.includes("a"), "the answered line itself is excluded");
});

test("the answered line is never rewritten — its confirmation is the owner's, not an inference", () => {
  const rows = [row("a", "WonenBreburg"), row("b", "WonenBreburg")];
  assert.deepEqual(linesForCounterpart(rows, "WonenBreburg", "a"), ["b"]);
});

test("a line that already carries a category is left alone", () => {
  const rows = [row("a", "ONS IT"), row("b", "ONS IT", "kosten"), row("c", "ONS IT")];
  assert.deepEqual(linesForCounterpart(rows, "ONS IT", "a"), ["c"], "never clobber an existing answer");
});

test("a blank counterpart spreads to nothing — two unknowns are not the same party", () => {
  const rows = [row("a", null), row("b", null), row("c", ""), row("d", "Trimex")];
  assert.deepEqual(linesForCounterpart(rows, null, "a"), []);
  assert.deepEqual(linesForCounterpart(rows, "", "a"), []);
});

test("no siblings is an empty list, not an error", () => {
  assert.deepEqual(linesForCounterpart([row("a", "Trimex")], "Trimex", "a"), []);
  assert.deepEqual(linesForCounterpart([], "Trimex", "a"), []);
});

test("the real shape: one answer reaches the other 27 lines of that party", () => {
  const rows: SpreadCandidate[] = [
    ...Array.from({ length: 28 }, (_, i) => row(`t${i}`, "Trimex International")),
    ...Array.from({ length: 20 }, (_, i) => row(`m${i}`, "Mohammad Ibrahim")),
    row("done", "Trimex International", "kosten"),
  ];
  const ids = linesForCounterpart(rows, "Trimex International", "t0");
  assert.equal(ids.length, 27, "28 lines, minus the one just answered");
  assert.ok(!ids.includes("done"), "and minus the one already categorised");
  assert.ok(ids.every((id) => id.startsWith("t")), "no other party is touched");
});
