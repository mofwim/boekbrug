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

// ── The client and the server must sweep by the SAME rule ────────────────────────────────────
//
// They did not, briefly, and the screenshot of the live screen is what exposed it: the route
// spread by counterpartKey (which strips B.V., punctuation and spacing) while the list filtered by
// a lowercase string equality written beside it. The server would then categorise rows the list
// left on screen — the note claiming four, two disappearing, and the two that stayed already
// answered. A source gate, because the drift is invisible at runtime until a supplier is printed
// twice with a different suffix.

test("both the categorise route and its screen sweep through linesForCounterpart", async () => {
  const { readFileSync } = await import("node:fs");
  const route = readFileSync("src/app/api/bank/categorize/route.ts", "utf8");
  const screen = readFileSync("src/app/dashboard/bank/categoriseren/CategoriseClient.tsx", "utf8");
  for (const [name, src] of [["route", route], ["screen", screen]] as const) {
    assert.match(src, /linesForCounterpart\(/, `${name} must sweep through the shared rule`);
    assert.match(src, /counterpart-spread/, `${name} must import it rather than restate it`);
  }
  // The specific shape that was wrong: a hand-rolled name comparison beside the shared one.
  assert.doesNotMatch(
    screen, /trim\(\)\.toLowerCase\(\)\s*===\s*\w+\.trim\(\)\.toLowerCase\(\)/,
    "a second 'same party' rule in the screen is how the two drift apart",
  );
});

test("the live spellings that must collapse, and the one that must not", () => {
  // Verbatim from the pending list: three ways one egg wholesaler is printed, and a pension fund
  // the bank stored twice — once truncated mid-word. The first three are one party. The last two
  // are NOT provably one, and guessing a truncated prefix is how "Jan Bakker" becomes "Jan
  // Bakkerij B.V." — so they stay two answers, which is still two instead of thirteen.
  const rows: SpreadCandidate[] = [
    row("k1", "W.KETELS & ZN EIERHANDEL"), row("k2", "W. Ketels & Zn Eierhandel"), row("k3", "W ketels & zn eierhandel"),
    row("p1", "Stichting Bedrijfstakpensioenfonds voor het Levens"),
    row("p2", "Stichting Bedrijfstakpensioenfonds voor het Levensmiddelenbedrijf"),
  ];
  assert.deepEqual(linesForCounterpart(rows, "W.KETELS & ZN EIERHANDEL", "k1").sort(), ["k2", "k3"]);
  assert.deepEqual(linesForCounterpart(rows, rows[3].counterpart_name, "p1"), [],
    "a name the bank cut off mid-word is not provably the same company");
});
