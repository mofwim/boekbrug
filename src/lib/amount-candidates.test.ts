import test from "node:test";
import assert from "node:assert/strict";
import { totalsCandidates, alternativeTotals, alternativeTotalsText } from "./amount-candidates";

// ─── [ANDER-TOTAAL] The invoice this was built from ──────────────────────────────────────────────
//
// NemaFood B.V. 262697, 28-07-2026 — three scanned pages with no text layer. The app read
// € 1.149,56 with € 94,92 BTW, and flagged that the total was not literally in the document. The
// document's own totals block, on page 3:
//
//     Btw 9%     95,54   1.061,54 ex.btw
//     Btw 0%      0,00       3,60 ex.btw
//     Totaal Btw 95,54   1.065,14 T.ex.btw
//     Totaal Incl. Btw   1.160,68
//
// € 11,12 of cost and € 0,62 of voorbelasting, on a document the app had already told the owner it
// could not verify. These are the amounts a blind transcription of that page produces.
const NEMAFOOD = [
  18.40, 27.60, 3.60, 11.76, 135.00,      // line totals from page 3
  95.54, 1061.54,                          // the 9% block
  0.00, 3.60,                              // the 0% block
  95.54, 1065.14,                          // Totaal Btw / T.ex.btw
  1160.68,                                 // Totaal Incl. Btw
  262697,                                  // the invoice number — an amount-shaped token
  22, 23, 24, 25, 26,                      // line numbers
  1, 2, 15, 16, 12, 24, 40, 75, 400, 800,  // quantities and pack sizes
  1.15, 0.15, 0.49, 9.00,                  // unit prices
];

test("[ANDER-TOTAAL] the document's real total is found among the transcribed amounts", () => {
  const alt = alternativeTotals(1149.56, NEMAFOOD);
  assert.ok(alt, "the totals block is in the transcription — not finding it is the whole failure");
  assert.equal(alt.inc, 1160.68, "the grand total, not a per-rate block");
  assert.equal(alt.ex, 1065.14);
  assert.equal(alt.btw, 95.54);
  // And the arithmetic really closes, to the cent.
  assert.equal(Math.round((alt.ex + alt.btw) * 100), Math.round(alt.inc * 100));
});

test("[ANDER-TOTAAL] the GRAND total wins over the per-rate blocks that also add up", () => {
  // 3,60 + 1.061,54 = 1.065,14 is a real relationship on this invoice, and it is not the total.
  // Ordering by the sum is what puts the number that becomes money first.
  const all = totalsCandidates(NEMAFOOD);
  assert.ok(all.length >= 2, `expected several consistent blocks, found ${all.length}`);
  assert.equal(all[0].inc, 1160.68);
  assert.ok(all.some((c) => c.inc === 1065.14), "the ex-BTW split is a real block too, just not the total");
  // Sorted, so a caller taking [0] always gets the largest.
  for (let i = 1; i < all.length; i++) assert.ok(all[i - 1].inc >= all[i].inc);
});

test("[ANDER-TOTAAL] it says nothing when the reader and the document agree", () => {
  // Agreement is not a finding. Raising it would interrupt the owner on every correct invoice,
  // which is how a warning stops being read.
  assert.equal(alternativeTotals(1160.68, NEMAFOOD), null);
  assert.equal(alternativeTotalsText(1160.68, NEMAFOOD), null);
  // …including when the stored total is negative, as a creditnota's is.
  assert.equal(alternativeTotals(-1160.68, NEMAFOOD), null);
});

test("[ANDER-TOTAAL] it says nothing when there is nothing consistent to say", () => {
  assert.equal(alternativeTotals(100, []), null);
  assert.equal(alternativeTotals(100, [12.5]), null);
  // Three amounts that do not add up in any order.
  assert.equal(alternativeTotals(100, [12.5, 33.25, 91.4]), null);
  assert.equal(alternativeTotalsText(100, [12.5, 33.25, 91.4]), null);
});

test("[ANDER-TOTAAL] a triple must be exact to the cent", () => {
  // 100,00 + 21,00 = 121,00 holds; a cent out is not a totals block, it is two numbers.
  assert.deepEqual(alternativeTotals(999, [100, 21, 121]), { ex: 100, btw: 21, inc: 121 });
  assert.equal(alternativeTotals(999, [100, 21, 121.01]), null);
  // Floating point must not decide this: 0.1 + 0.2 !== 0.3 in binary, and money compares in cents.
  assert.deepEqual(alternativeTotals(999, [1000.1, 200.2, 1200.3]), { ex: 1000.1, btw: 200.2, inc: 1200.3 });
});

test("[ANDER-TOTAAL] BTW never exceeds the net it is charged on", () => {
  // 21 + 100 = 121 is the same triple read the wrong way round. Refusing it halves the false pairs
  // and costs nothing: no Dutch invoice charges more tax than turnover.
  const c = totalsCandidates([100, 21, 121]);
  assert.equal(c.length, 1);
  assert.deepEqual(c[0], { ex: 100, btw: 21, inc: 121 });
});

test("[ANDER-TOTAAL] small change does not become a totals block", () => {
  // A receipt's line prices sum coincidentally all the time. Below a euro a "consistent triple" is
  // noise, and noise here means interrupting a correct invoice.
  assert.equal(alternativeTotals(50, [0.1, 0.15, 0.25]), null);
  // …but a real small invoice still works.
  assert.deepEqual(alternativeTotals(50, [10, 2.1, 12.1]), { ex: 10, btw: 2.1, inc: 12.1 });
});

test("[ANDER-TOTAAL] a repeated amount cannot pair with itself", () => {
  // An invoice prints the same figure twice (a BTW amount per rate and again as the sum). Without
  // de-duplication that produces x + x = 2x whenever 2x also happens to be printed.
  const c = totalsCandidates([50, 50, 100]);
  assert.equal(c.length, 0, "50 + 50 = 100 uses one printed amount twice");
});

test("[ANDER-TOTAAL] the sentence names both figures and asks rather than asserts", () => {
  const text = alternativeTotalsText(1149.56, NEMAFOOD);
  assert.ok(text, "the owner must be told");
  // Both numbers, in Dutch money format — the owner is holding the paper and compares in a glance.
  assert.match(text, /1\.149,56/, "what we read");
  assert.match(text, /1\.160,68/, "what the document says");
  assert.match(text, /1\.065,14/);
  assert.match(text, /95,54/);
  // A question, never a correction: both figures come from a model reading a scan, and naming a
  // winner would be the same overconfidence that produced the wrong number.
  assert.match(text, /Kijk even op de factuur/);
  assert.doesNotMatch(text, /wij hebben het gecorrigeerd|aangepast/i);
});

test("[ANDER-TOTAAL] it still speaks when the reader gave no total at all", () => {
  // A read that produced nothing is exactly when the document's own block is most useful, and the
  // sentence must not open with "Wij lazen null".
  const text = alternativeTotalsText(null, NEMAFOOD);
  assert.ok(text);
  assert.doesNotMatch(text, /Wij lazen/);
  assert.match(text, /1\.160,68/);
});

test("[ANDER-TOTAAL] a pathological transcription cannot stall the request", () => {
  // The search is quadratic in the number of amounts. A reply with a thousand tokens — a model that
  // transcribed the whole page including every date and code — must stay bounded.
  const many = Array.from({ length: 2000 }, (_, i) => (i + 1) * 1.01);
  const started = process.hrtime.bigint();
  totalsCandidates(many);
  const ms = Number(process.hrtime.bigint() - started) / 1e6;
  assert.ok(ms < 200, `took ${ms.toFixed(0)}ms — the cap on considered amounts is not holding`);
});
