// [BTW-RECONCILE] Pure node test — run: npx tsx --test src/lib/btw-reconcile.test.ts
//
// The tests ARE the real invoices that caused this file, with their own amounts. That is deliberate:
// an invented example proves the formula is right; these prove it gives the right ANSWER on the
// papers that actually stalled in the queue.
import { test } from "node:test";
import assert from "node:assert/strict";

import { reconcileBtw, reconcileHint, SUM_TOLERANCE, impliedBasesForBtw, rateHint } from "./btw-reconcile";

// D: potato wholesaler. Stored 26.00 / 13.42 / 39.42 — those three DO reconcile, so the sum check
// stays quiet and only the rate (52%) stands out. Paper: goods 149.00 @9% plus a returned container
// −408.00 @0% → Totaal excl. −123.00 and Totaal te voldoen −109.58.
const POTATO = { excl: 26.0, btw: 13.42, incl: 39.42, paperBase: 149.0 };

test("[D · returned container] the sum holds, so only the rate can point anywhere", () => {
  // First the proof that the identity does NOT help here: the three add up.
  const r = reconcileBtw(POTATO.excl, POTATO.btw, POTATO.incl);
  assert.equal(r.ok, true, "26.00 + 13.42 = 39.42 — the arithmetic gate has nothing to report");
  assert.equal(reconcileHint(r), null);

  // But 13.42 over 26.00 is 52%, and that rate does not exist. The btw itself points the way:
  const bases = impliedBasesForBtw(POTATO.btw);
  assert.deepEqual(bases.map((b) => b.rate), [9, 21]);
  // 13.42 / 0.09 = 149.11 — the paper prints base 149.00.
  assert.equal(bases[0].base, 149.11);
  assert.ok(Math.abs(bases[0].base - POTATO.paperBase) < 0.2, "points at the right column");
  assert.equal(bases[1].base, 63.9);

  const hint = rateHint(POTATO.btw, POTATO.excl)!;
  assert.ok(hint.includes("149,11") && hint.includes("26,00"), hint);
  assert.ok(/retour container|statiegeld|emballage/i.test(hint), "names the item that makes the difference");
});

test("the rate hint stays silent when there is nothing to say", () => {
  assert.deepEqual(impliedBasesForBtw(0), [], "without a btw amount no base belongs to it");
  assert.deepEqual(impliedBasesForBtw(null), []);
  assert.deepEqual(impliedBasesForBtw(Number.NaN), []);
  assert.equal(rateHint(0, 100), null);
  assert.equal(rateHint(null, 100), null);
  // A negative btw (credit note) yields a negative base — sign preserved.
  assert.equal(impliedBasesForBtw(-13.42)[0].base, -149.11);
});

// ── The practical cases, with what was STORED ──
// A: btw table with 9% over 985.87 and 0% over 3.86 (E2 crates). Paper: ex. BTW 989.73.
const MEAT = { excl: 985.87, btw: 88.73, incl: 1078.46, paperExcl: 989.73 };
// B: Subtotaal 1610.34 + BTW 144.95 + Totaal Statiegeld 88.20. Paper ex = 1610.34 + 88.20.
const SWEETS = { excl: 1722.54, btw: 144.95, incl: 1843.49, paperExcl: 1698.54 };
// C: BTW 9% 233.20 + BTW 21% 172.70 = 405.90. Here the btw was wrong, not the ex amount.
const HORECA = { excl: 3413.92, btw: 995.9, incl: 3819.82, paperBtw: 405.9 };

test("a correct invoice produces no message at all", () => {
  const r = reconcileBtw(1698.54, 144.95, 1843.49);
  assert.equal(r.ok, true);
  assert.equal(reconcileHint(r), null);
  // Right on the tolerance it still passes — rounding noise is not an error.
  assert.equal(reconcileBtw(100, 21, 121.02).ok, true);
  assert.equal(reconcileBtw(100, 21, 121 + SUM_TOLERANCE + 0.005).ok, false);
});

test("[A · crates] the difference is exactly the 0% item that dropped out", () => {
  const r = reconcileBtw(MEAT.excl, MEAT.btw, MEAT.incl);
  assert.equal(r.ok, false);
  // 1078.46 − (985.87 + 88.73) = 3.86 — exactly the E2 row (6 crates in, 5 out).
  assert.equal(r.difference, 3.86);
  // And the reading "the total is right" points at exactly the amount printed on the paper.
  assert.equal(r.impliedExcl, MEAT.paperExcl);
  // Both readings are arithmetically possible here, so no choice may be made.
  assert.equal(r.exclRepairPossible, true);
  assert.equal(r.btwRepairPossible, true);
  const hint = reconcileHint(r)!;
  assert.ok(hint.includes("989,73"), hint);
  assert.ok(/statiegeld|emballage|kratten/i.test(hint), "points at where it sits");
});

test("[B · deposit] the same pattern, other side of the difference", () => {
  const r = reconcileBtw(SWEETS.excl, SWEETS.btw, SWEETS.incl);
  assert.equal(r.ok, false);
  // Here the ex amount held too MUCH: −24.00.
  assert.equal(r.difference, -24);
  assert.equal(r.impliedExcl, SWEETS.paperExcl, "subtotaal 1610.34 + deposit 88.20");
  assert.ok(reconcileHint(r)!.includes("1.698,54"));
});

test("[C · two rates] here one reading drops out and the screen may NAME the other", () => {
  const r = reconcileBtw(HORECA.excl, HORECA.btw, HORECA.incl);
  assert.equal(r.ok, false);
  // The reading "ex is wrong" would imply a 35% btw rate — which does not exist.
  assert.equal(r.exclRepairRate, 35);
  assert.equal(r.exclRepairPossible, false);
  // The other gives 12% (a blend of 9% and 21%) and lands exactly on the sum of the two btw rows
  // on the paper: 233.20 + 172.70.
  assert.equal(r.impliedBtw, HORECA.paperBtw);
  assert.equal(r.btwRepairPossible, true);
  const hint = reconcileHint(r)!;
  assert.ok(hint.includes("405,90"), hint);
  // Exactly one answer, so NO "óf".
  assert.ok(!hint.includes("óf"), hint);
});

test("the rate argument is what carries the choice — 21% may, 22% may not", () => {
  // On the boundary: 21% is the highest Dutch rate and must stay possible.
  const onBoundary = reconcileBtw(0, 21, 121);
  assert.equal(onBoundary.exclRepairRate, 21);
  assert.equal(onBoundary.exclRepairPossible, true);
  // One tick above is impossible.
  const above = reconcileBtw(0, 22, 122);
  assert.equal(above.exclRepairRate, 22);
  assert.equal(above.exclRepairPossible, false);
});

test("when neither is possible, the message promises no repair", () => {
  // Two numbers wrong at once: nothing can be pointed at, and we say so.
  const r = reconcileBtw(100, 900, 300);
  assert.equal(r.exclRepairPossible, false);
  assert.equal(r.btwRepairPossible, false);
  const hint = reconcileHint(r)!;
  assert.ok(/controleer de hele uitsplitsing/i.test(hint), hint);
  assert.ok(!hint.includes("hoort"), "promise no repair we cannot support");
});

test("nonsense does not get through", () => {
  assert.equal(reconcileBtw(null, null, null).ok, true, "0 + 0 = 0 adds up");
  const r = reconcileBtw(undefined, 21, 121);
  assert.equal(r.impliedExcl, 100);
  // A zero base yields no rate — that reading cannot be supported.
  assert.equal(reconcileBtw(0, 0, 50).btwRepairRate, null);
  assert.equal(reconcileBtw(0, 0, 50).btwRepairPossible, false);
});

test("[GATE] the two hints do not contradict each other", async () => {
  const { evaluateArithmetic } = await import("./safecore");

  // C: the sum does NOT hold. The sum hint names the btw (€ 405.90). The rate hint would, from that
  // same just-declared-wrong € 995.90, propose a base of € 11,065.56 — it may no longer do that.
  const c = evaluateArithmetic({ totalExBtw: HORECA.excl, btwAmount: HORECA.btw, totalIncBtw: HORECA.incl });
  assert.equal(c.ok, false);
  assert.ok(c.reason!.includes("405,90"), c.reason);
  assert.ok(!c.reason!.includes("11.065,56"), "no base derived from a btw we just called wrong");

  // D: the sum DOES hold, so there the rate hint is the only thing that can point anywhere.
  const d = evaluateArithmetic({ totalExBtw: POTATO.excl, btwAmount: POTATO.btw, totalIncBtw: POTATO.incl });
  assert.equal(d.ok, false);
  assert.ok(d.reason!.includes("149,11"), d.reason);

  // And an exempt invoice (pension premium: 266.62 / 0 / 266.62) stays entirely silent — no false
  // alarm on a document that simply carries no btw.
  const vrij = evaluateArithmetic({ totalExBtw: 266.62, btwAmount: 0, totalIncBtw: 266.62 });
  assert.equal(vrij.ok, true, vrij.reason ?? "");
});

test("[MONEY] nothing is repaired — the function only answers", () => {
  // A readability check on the promise in the header: reconcileBtw is pure and leaves the INPUT
  // untouched. Anyone who ever hangs a write on this comes past this test.
  const before = { excl: MEAT.excl, btw: MEAT.btw, incl: MEAT.incl };
  reconcileBtw(before.excl, before.btw, before.incl);
  assert.deepEqual(before, { excl: 985.87, btw: 88.73, incl: 1078.46 });
});

test("[TARIEF-GEHEUGEN] a split that was never read offers no 'repair' at all", () => {
  // The shape of 44 held production invoices: the reader saw the printed total and no breakdown.
  // The arithmetic then hands back the total itself as "excl. BTW", at an implied rate of 0 % —
  // which IS a legal Dutch rate, so this used to be offered as a repair. Accepting it books a
  // wholesale food invoice with zero voorbelasting, next to two buttons that are real derivations.
  for (const incl of [1560.42, 8980.05, 117.17, 3819.82]) {
    const r = reconcileBtw(0, 0, incl);
    assert.equal(r.ok, false, "it still does not add up — that part was never in doubt");
    assert.equal(r.exclRepairPossible, false,
      `€ ${incl}: "excl. BTW is the whole total" is the missing number restated, not a repair`);
    assert.equal(r.btwRepairPossible, false);
    assert.equal(reconcileHint(r), null,
      "and no sentence may claim a reading either — there is nothing here to reconcile between");
  }
});

test("[TARIEF-GEHEUGEN] a real 0%-invoice with a READ split is untouched", () => {
  // The guard is on "nothing was read", not on "the rate is 0". An invoice that genuinely states
  // excl € 100 and BTW € 0 has a split; it simply adds up, and nothing here should fire.
  const r = reconcileBtw(100, 0, 100);
  assert.equal(r.ok, true);
});

test("[TARIEF-GEHEUGEN] one half read is still reconcilable", () => {
  // Only BOTH being absent means nothing was read. With excl present and BTW missing there is a
  // genuine second reading to offer, and taking that away would lose a working repair.
  const r = reconcileBtw(1000, 0, 1090);
  assert.equal(r.btwRepairPossible, true, "BTW € 90 on a base of € 1.000 is 9% — a real reading");
});
