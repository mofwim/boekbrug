// [VRIJGESTELD] Pure node test — run: npx tsx --test src/lib/vat-exemption.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  getVatTreatment,
  getVatDeduction,
  isVatTreatment,
  isVatDeduction,
  resolveExemptionForQuarter,
  computeProRata,
  deductibleVoorbelasting,
  resolveSaleTreatment,
  type ProRata,
} from "./vat-exemption";

// ── Normalizing raw DB values ────────────────────────────────────────────────

test("an unclassified sale is taxed, never exempt", () => {
  assert.equal(getVatTreatment(null), "taxed");
  assert.equal(getVatTreatment(undefined), "taxed");
  assert.equal(getVatTreatment("taxed"), "taxed");
  assert.equal(getVatTreatment("garbage"), "taxed");
  // The only value that removes a row from the rubrieken has to be spelled exactly.
  assert.equal(getVatTreatment("exempt"), "exempt");
  assert.equal(getVatTreatment("EXEMPT"), "taxed", "case is not guessed at");
});

test("an unclassified cost is mixed, so it gets the ratio and not a full deduction", () => {
  assert.equal(getVatDeduction(null), "mixed");
  assert.equal(getVatDeduction(undefined), "mixed");
  assert.equal(getVatDeduction("nonsense"), "mixed");
  assert.equal(getVatDeduction("direct_taxed"), "direct_taxed");
  assert.equal(getVatDeduction("direct_exempt"), "direct_exempt");
});

test("the type guards accept only the closed sets", () => {
  assert.ok(isVatTreatment("taxed") && isVatTreatment("exempt"));
  assert.ok(!isVatTreatment("vrijgesteld"), "the Dutch word is not a stored value");
  assert.ok(isVatDeduction("mixed") && !isVatDeduction("partial"));
});

// ── The declaration, resolved per quarter ────────────────────────────────────

test("an owner who never declared exempt activity is never exempt", () => {
  assert.equal(resolveExemptionForQuarter(false, null, "2026-01-01"), false);
  assert.equal(resolveExemptionForQuarter(false, "2020-01-01", "2026-10-01"), false,
    "a since date grants nothing on its own");
});

test("a declaration without a start date applies to every quarter", () => {
  assert.equal(resolveExemptionForQuarter(true, null, "2026-01-01"), true);
  assert.equal(resolveExemptionForQuarter(true, undefined, "2019-04-01"), true);
});

test("a filed quarter is not rewritten when the regime starts later", () => {
  // Declared from Q3. Q1 and Q2 were filed under the ordinary regime and must stay there.
  const since = "2026-07-01";
  assert.equal(resolveExemptionForQuarter(true, since, "2026-01-01"), false, "Q1 untouched");
  assert.equal(resolveExemptionForQuarter(true, since, "2026-04-01"), false, "Q2 untouched");
  assert.equal(resolveExemptionForQuarter(true, since, "2026-07-01"), true, "Q3 is the first");
  assert.equal(resolveExemptionForQuarter(true, since, "2026-10-01"), true, "Q4 follows");
});

test("a since value carrying a time component still gates on the date", () => {
  assert.equal(resolveExemptionForQuarter(true, "2026-07-01T00:00:00Z", "2026-04-01"), false);
  assert.equal(resolveExemptionForQuarter(true, "2026-07-01T23:59:59Z", "2026-07-01"), true);
});

// ── The ratio ────────────────────────────────────────────────────────────────

test("a fully taxed owner deducts everything", () => {
  const p = computeProRata({ taxedOmzet: 50_000, exemptOmzet: 0 });
  assert.equal(p.percent, 100);
  assert.equal(p.ratio, 1);
  assert.equal(p.undecidable, false);
  assert.equal(p.note, "", "nothing unusual to say");
});

test("a fully exempt owner deducts nothing on mixed costs", () => {
  const p = computeProRata({ taxedOmzet: 0, exemptOmzet: 132_000 });
  assert.equal(p.percent, 0);
  assert.equal(p.ratio, 0);
  assert.equal(p.undecidable, false);
});

test("the mixed practice from the dental example lands on 9%", () => {
  // €132.000 exempt care beside €12.396,69 taxable whitening → 8,58% raw, rounded UP.
  const p = computeProRata({ taxedOmzet: 12_396.69, exemptOmzet: 132_000 });
  assert.equal(p.percent, 9, "8,58% rounds up to a whole 9%");
  assert.equal(p.totalOmzet, 144_396.69);
  assert.equal(p.undecidable, false);
});

test("the percentage rounds UP, never to nearest", () => {
  // 50,1% must not become 50%.
  const p = computeProRata({ taxedOmzet: 501, exemptOmzet: 499 });
  assert.equal(p.percent, 51);
  // And an exact whole percent stays put rather than climbing one.
  const exact = computeProRata({ taxedOmzet: 25, exemptOmzet: 75 });
  assert.equal(exact.percent, 25, "an exact 25% is not inflated to 26%");
});

test("the canonical example from the rule: 21,1% becomes 22%", () => {
  // art. 11 Uitvoeringsbeschikking OB 1968 rounds the pro rata UP to whole percents. 211 against
  // a total of 1000 is exactly 21,1%, the example the rule is usually stated with.
  assert.equal(computeProRata({ taxedOmzet: 211, exemptOmzet: 789 }).percent, 22);
});

test("a third/third floating-point split does not climb a percent on dust", () => {
  // 1/3 = 33,333…% → 34. The epsilon only absorbs representation dust, never a real fraction.
  const p = computeProRata({ taxedOmzet: 1, exemptOmzet: 2 });
  assert.equal(p.percent, 34);
});

test("no turnover at all is undecidable — not 0%, and not 100%", () => {
  const p = computeProRata({ taxedOmzet: 0, exemptOmzet: 0 });
  assert.equal(p.percent, null);
  assert.equal(p.ratio, null);
  assert.equal(p.undecidable, true);
  assert.match(p.note, /niet te bepalen/, "the note says why, in Dutch");
});

test("a net-negative quarter yields no ratio instead of a meaningless one", () => {
  const p = computeProRata({ taxedOmzet: -5_000, exemptOmzet: 1_000 });
  assert.equal(p.percent, null);
  assert.equal(p.undecidable, true);
  assert.match(p.note, /negatief/);
});

test("one negative side against a positive total is clamped into 0-100 and named", () => {
  // Net credits on the taxable activity: raw share is negative, which is not a deduction right.
  const low = computeProRata({ taxedOmzet: -1_000, exemptOmzet: 10_000 });
  assert.equal(low.percent, 0);
  assert.match(low.note, /begrensd op 0%/);

  // Net credits on the exempt side push the raw share above 100.
  const high = computeProRata({ taxedOmzet: 10_000, exemptOmzet: -1_000 });
  assert.equal(high.percent, 100);
  assert.match(high.note, /begrensd op 100%/);
});

test("non-finite input is treated as zero rather than producing NaN", () => {
  const p = computeProRata({ taxedOmzet: NaN, exemptOmzet: 100 });
  assert.equal(p.percent, 0);
  assert.equal(p.undecidable, false);
});

// ── Applying the ratio ───────────────────────────────────────────────────────

const ratioOf = (percent: number): ProRata => ({
  percent,
  ratio: percent / 100,
  taxedOmzet: 0,
  exemptOmzet: 0,
  totalOmzet: 0,
  undecidable: false,
  note: "",
});

const UNDECIDABLE: ProRata = {
  percent: null, ratio: null, taxedOmzet: 0, exemptOmzet: 0, totalOmzet: 0,
  undecidable: true, note: "geen omzet",
};

test("an owner with no exempt activity gets their input BTW back untouched", () => {
  // THE regression guard: every existing owner puts everything in `direct`. Whatever the
  // ratio says, the answer is the old arithmetic, to the cent.
  const r = deductibleVoorbelasting({ direct: 6_069, mixed: 0, blocked: 0 }, ratioOf(9));
  assert.equal(r.amount, 6_069);
  assert.equal(r.unresolved, 0);
});

test("the dental quarter deducts 333,14 where the app used to claim 6.069", () => {
  // Direct exempt (composiet, verdoving) €4.200 → nothing. Direct taxed (bleekgel) €189 → all.
  // Mixed (energie, software, schoonmaak) €1.680 → 9%.
  const r = deductibleVoorbelasting(
    { direct: 189, mixed: 1_680, blocked: 4_200 },
    computeProRata({ taxedOmzet: 12_396.69, exemptOmzet: 132_000 }),
  );
  assert.equal(Number(r.amount.toFixed(2)), 340.20);
  assert.equal(r.percent, 9);
  assert.equal(r.unresolved, 0);
  // The old behaviour reclaimed every cent of input BTW in the book.
  const oldBehaviour = 189 + 1_680 + 4_200;
  assert.ok(oldBehaviour - r.amount > 5_000, "the correction is thousands, not rounding");
});

test("blocked BTW never reaches the deduction, only the transparency figure", () => {
  const r = deductibleVoorbelasting({ direct: 0, mixed: 0, blocked: 9_999 }, ratioOf(100));
  assert.equal(r.amount, 0, "a 100% ratio does not unblock a direct_exempt cost");
});

test("an undecidable ratio leaves the mixed bucket out and says how much", () => {
  const r = deductibleVoorbelasting({ direct: 500, mixed: 1_200, blocked: 0 }, UNDECIDABLE);
  assert.equal(r.amount, 500, "only the directly attributable BTW is claimed");
  assert.equal(r.unresolved, 1_200, "the rest is reported, never silently dropped or claimed");
  assert.equal(r.percent, null);
});

test("the result is unrounded so the caller keeps the cent", () => {
  const r = deductibleVoorbelasting({ direct: 0, mixed: 100, blocked: 0 }, ratioOf(33));
  assert.equal(r.amount, 33);
  const odd = deductibleVoorbelasting({ direct: 0, mixed: 1_680, blocked: 0 }, ratioOf(9));
  assert.equal(Number(odd.amount.toFixed(2)), 151.20);
});

// ── The contradiction guard ──────────────────────────────────────────────────

test("a sale labelled exempt that carries BTW is treated as taxed", () => {
  // Art. 37 Wet OB: BTW stated on an invoice is owed, whether or not it should have been
  // charged. Trusting the label here would drop money that is genuinely due.
  const r = resolveSaleTreatment("exempt", 21);
  assert.equal(r.treatment, "taxed");
  assert.equal(r.contradicted, true);
});

test("a clean exempt sale stays exempt", () => {
  const r = resolveSaleTreatment("exempt", 0);
  assert.equal(r.treatment, "exempt");
  assert.equal(r.contradicted, false);
});

test("rounding dust on an exempt line is not a contradiction", () => {
  const r = resolveSaleTreatment("exempt", 0.004);
  assert.equal(r.treatment, "exempt");
  assert.equal(r.contradicted, false);
});

test("a negative BTW on an exempt creditnota is still a contradiction", () => {
  const r = resolveSaleTreatment("exempt", -21);
  assert.equal(r.treatment, "taxed");
  assert.equal(r.contradicted, true);
});

test("a taxed sale is never re-labelled", () => {
  assert.equal(resolveSaleTreatment("taxed", 0).treatment, "taxed");
  assert.equal(resolveSaleTreatment("taxed", 21).contradicted, false);
});
