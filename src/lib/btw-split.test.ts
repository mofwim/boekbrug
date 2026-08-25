// [BTW-SPLIT] Pure node test — run: npx tsx --test src/lib/btw-split.test.ts
//
// The invoice under test is real: Enka Horeca B.V. 26701681, which passed all seven checks in
// invoice-checks.ts while carrying a btw that was € 0,46 wrong. Every number below is off that
// paper, so a regression here is not hypothetical — it is that invoice going green again.
//
// The property being held is narrow and it is the one that failed: a blended rate is not evidence.
// Whatever else changes, `blend-unverified` must never become a pass.

import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  classifyBtwSplit,
  btwSplitCorroborated,
  btwSplitDetail,
  type BtwSplitRow,
} from './btw-split'

// ── The paper ────────────────────────────────────────────────────────────────
// Totaal exclusief BTW € 1.213,50 · € 1.101,38 @ 9% → € 99,06 · € 112,12 @ 21% → € 23,58
// Totaal te voldoen € 1.336,14
const ENKA_ROWS: BtwSplitRow[] = [
  { rate: 9, base: 1101.38, btw: 99.06 },
  { rate: 21, base: 112.12, btw: 23.58 },
]
const ENKA_EX = 1213.5
const ENKA_BTW_PRINTED = 122.64   // 99,06 + 23,58
const ENKA_BTW_STORED = 122.18    // what the app read

test('[BTW-SPLIT] the Enka invoice: stored btw is a blend, so nothing corroborates it', () => {
  const v = classifyBtwSplit({ totalExBtw: ENKA_EX, btwAmount: ENKA_BTW_STORED })
  assert.equal(v.kind, 'blend-unverified', 'a blended rate is not a checked rate')
  assert.equal(btwSplitCorroborated(v), false, 'and it must never count as a pass')

  // The reason this was invisible: the two candidate figures blend to rates one apart, and BOTH
  // are legal. No rate test can separate them — which is exactly why the answer is "not checked"
  // and not "checked, fine".
  assert.equal((v as { rate: number }).rate, 10, 'stored blends to 10%')
  const truth = classifyBtwSplit({ totalExBtw: ENKA_EX, btwAmount: ENKA_BTW_PRINTED })
  assert.equal(truth.kind, 'blend-unverified', 'the CORRECT btw is equally unverifiable on its own')
})

test('[BTW-SPLIT] with the printed block read, the € 0,46 is caught', () => {
  const v = classifyBtwSplit({
    totalExBtw: ENKA_EX,
    btwAmount: ENKA_BTW_STORED,
    rows: ENKA_ROWS,
  })
  assert.equal(v.kind, 'blend-mismatch')
  assert.equal(btwSplitCorroborated(v), false)
  if (v.kind !== 'blend-mismatch') return
  assert.equal(v.rowsBtw, 122.64, 'the btw column of the printed block')
  assert.equal(v.rowsBase, 1213.5, 'and its grondslag column')
  assert.equal(v.baseAgrees, true, 'which reproduces our excl exactly — so the block is trustworthy')

  // The half that makes it actionable: naming the figure the paper supports.
  const detail = btwSplitDetail(v, ENKA_BTW_STORED)
  assert.ok(detail?.includes('122,64'), 'says what the invoice adds up to')
  assert.ok(detail?.includes('122,18'), 'and what we stored, so the owner can see the gap')
})

test('[BTW-SPLIT] the same block over the CORRECT btw verifies instead of flagging', () => {
  const v = classifyBtwSplit({
    totalExBtw: ENKA_EX,
    btwAmount: ENKA_BTW_PRINTED,
    rows: ENKA_ROWS,
  })
  assert.equal(v.kind, 'blend-verified', 'both columns reproduce what we stored')
  assert.equal(btwSplitCorroborated(v), true, 'THIS is how a mixed-rate invoice earns a tick')
})

test('[BTW-SPLIT] an ordinary single-rate invoice is corroborated without any block', () => {
  // 21% — the everyday case. Two constraints hold (the sum identity elsewhere, the exact rate
  // here), so the amounts check each other and the row is a genuine pass.
  const v21 = classifyBtwSplit({ totalExBtw: 100, btwAmount: 21 })
  assert.deepEqual(v21, { kind: 'single-rate', rate: 21 })
  assert.equal(btwSplitCorroborated(v21), true)

  // 9%, with the cent-rounding a real invoice carries (257,85 × 9% = 23,2065 → printed 23,21).
  const v9 = classifyBtwSplit({ totalExBtw: 257.85, btwAmount: 23.21 })
  assert.deepEqual(v9, { kind: 'single-rate', rate: 9 }, 'rounding to the cent is not a blend')

  // 0% — verlegd / intracommunautair / a pure statiegeld credit.
  assert.deepEqual(classifyBtwSplit({ totalExBtw: 480, btwAmount: 0 }), { kind: 'single-rate', rate: 0 })
})

test('[BTW-SPLIT] a rate NEAR a legal one but not on it is a blend, not a pass', () => {
  // The failure a percentage-point tolerance would produce: 9,4% rounds to 9 and would have been
  // waved through as "9% over het hele bedrag". It is a mix of 9% and 21% goods, and the btw is
  // not verified by anything.
  const v = classifyBtwSplit({ totalExBtw: 1000, btwAmount: 94 })
  assert.equal(v.kind, 'blend-unverified')
  assert.equal(btwSplitCorroborated(v), false)
})

test('[BTW-SPLIT] an impossible rate stays flagged, and a missing split says nothing', () => {
  // Above 21% no NL rate and no blend of them can reach — the horeca case [BTW-SUM-FIX] repairs.
  assert.equal(classifyBtwSplit({ totalExBtw: 3413.92, btwAmount: 995.9 }).kind, 'impossible')
  // btw over an empty base: an infinite rate.
  assert.equal(classifyBtwSplit({ totalExBtw: 0, btwAmount: 13.42 }).kind, 'impossible')

  // No split read at all → the arithmetic row already reports that. Two rows saying the same
  // thing is noise; the checklist drops this one.
  assert.equal(classifyBtwSplit({ totalExBtw: null, btwAmount: null }).kind, 'no-basis')
  assert.equal(classifyBtwSplit({ totalExBtw: 100, btwAmount: null }).kind, 'no-basis')
  assert.equal(classifyBtwSplit({ totalExBtw: 0, btwAmount: 0 }).kind, 'no-basis')
})

test('[BTW-SPLIT] a creditnota is judged on magnitude, not on sign', () => {
  // All three negative, 21% — a normal creditnota. It must read exactly like its positive twin,
  // or every credit would land in the queue with a btw warning.
  const v = classifyBtwSplit({ totalExBtw: -100, btwAmount: -21 })
  assert.deepEqual(v, { kind: 'single-rate', rate: 21 })

  // A block whose rows carry the SAME sign as the totals verifies normally. This is the UBL path,
  // where the file states magnitudes and the intake applies one sign to rows and totals alike.
  const credit = classifyBtwSplit({
    totalExBtw: -1213.5,
    btwAmount: -122.64,
    rows: [{ rate: 9, base: -1101.38, btw: -99.06 }, { rate: 21, base: -112.12, btw: -23.58 }],
  })
  assert.equal(credit.kind, 'blend-verified')

  // And the failure this guards: rows left POSITIVE against negative totals read as a mismatch.
  // Which is why the PDF reader does not store a block for a creditnota at all — the sign of a
  // printed specification row is genuinely ambiguous there, and a false flag on every credit note
  // costs more than the check is worth. See the exclusion in ai.ts.
  const mixedSign = classifyBtwSplit({
    totalExBtw: -1213.5,
    btwAmount: -122.64,
    rows: [{ rate: 9, base: 1101.38, btw: 99.06 }, { rate: 21, base: 112.12, btw: 23.58 }],
  })
  assert.equal(mixedSign.kind, 'blend-mismatch', 'unsigned rows over signed totals do NOT agree')
})

test('[BTW-SPLIT] a block that contradicts BOTH columns says so instead of naming a winner', () => {
  // When the grondslag column does not reproduce our excl either, the block is not corroborated
  // on its own terms — then pointing at its btw total would be guessing, and the detail must not.
  const v = classifyBtwSplit({
    totalExBtw: 900,
    btwAmount: 100,
    rows: [{ rate: 9, base: 500, btw: 45 }, { rate: 21, base: 300, btw: 63 }],
  })
  assert.equal(v.kind, 'blend-mismatch')
  if (v.kind !== 'blend-mismatch') return
  assert.equal(v.baseAgrees, false)
  const detail = btwSplitDetail(v, 100)
  assert.ok(detail?.includes('controleer de hele uitsplitsing'), 'no winner is named')
  assert.ok(!detail?.includes('waarschijnlijk de juiste btw'), 'and no figure is proposed')
})

test('[BTW-SPLIT] junk rows are ignored rather than treated as a read block', () => {
  // A row with a NaN or a missing column carries no evidence. Dropping it back to "no block"
  // is the honest fallback — inventing a sum out of half a block is not.
  const v = classifyBtwSplit({
    totalExBtw: 100,
    btwAmount: 21,
    rows: [{ rate: 21, base: Number.NaN, btw: 21 }],
  })
  assert.deepEqual(v, { kind: 'single-rate', rate: 21 }, 'falls back to the rate test')
})

// ── [RIJ-KLOPT-NIET] A row that contradicts its own rate is not corroboration ─
//
// BALKIP B.V. 264091. Its per-rate block prints two rows — 21% over 0,00 giving 0,00, and 9% over
// 1.123,62 giving 101,13. The reader returned ONE row: the rate from the first, the amounts from the
// second. Its columns then reproduced our excl and our btw exactly, so the block was accepted as a
// verified blend and the checklist put a GREEN TICK beside "Btw-bedrag nagerekend — 21%".
//
// 21% of 1.123,62 is 235,96. The row disagreed with its own rate by € 134,83, and the one constraint
// that would have caught it — base × rate = btw, free, printed right there — was never asked.

test("[RIJ-VERKEERD-ETIKET] a rate taken from the wrong row is settled by the arithmetic, out loud", () => {
  // The BALKIP shape, upgraded from flag to verdict: 101,13 is 9% of 1.123,62 to the cent, and no
  // other legal rate fits. The amounts pass the same two constraints 'single-rate' earns its tick
  // on — only the reader's label was wrong. Sending the owner to "kijk welk tarief er op de
  // factuur staat" made them search for a problem the arithmetic had already solved (GROOTHANDEL
  // M.H. BAL 264242 is the reported case: "21% over 697,09 = 62,74", which is exactly 9%).
  const v = classifyBtwSplit({
    totalExBtw: 1123.62,
    btwAmount: 101.13,
    rows: [{ rate: 21, base: 1123.62, btw: 101.13 }],
  });
  assert.equal(v.kind, "row-mislabeled");
  assert.equal(btwSplitCorroborated(v), true, "the amounts corroborate at exactly one legal rate");
  if (v.kind === "row-mislabeled") {
    assert.equal(v.rate, 9, "the rate the amounts actually fit");
    assert.equal(v.claimed, 21, "the rate the row claimed");
  }
  const detail = btwSplitDetail(v, 101.13);
  assert.match(detail!, /9%/, "names the fitting rate");
  assert.match(detail!, /21%/, "and the misread label — the tick is never silent about the relabel");
  assert.match(detail!, /misgelezen/, "says what probably happened");
});

test("[RIJ-VERKEERD-ETIKET] the reported BAL invoice, number for number", () => {
  const v = classifyBtwSplit({
    totalExBtw: 697.09,
    btwAmount: 62.74,
    rows: [{ rate: 21, base: 697.09, btw: 62.74 }],
  });
  assert.equal(v.kind, "row-mislabeled");
  assert.equal(btwSplitCorroborated(v), true);
});

test("[RIJ-KLOPT-NIET] a row whose btw fits NO legal rate is still flagged with both numbers", () => {
  // The relabel is strict: it only speaks when exactly one legal rate fits. 50,00 over 697,09 is
  // 7,2% — no Dutch rate — so this stays the real question it always was.
  const v = classifyBtwSplit({
    totalExBtw: 697.09,
    btwAmount: 50.0,
    rows: [{ rate: 21, base: 697.09, btw: 50.0 }],
  });
  assert.equal(v.kind, "row-inconsistent");
  assert.equal(btwSplitCorroborated(v), false);
  const detail = btwSplitDetail(v, 50.0);
  assert.match(detail!, /21%/, "the rate the row claims");
  assert.match(detail!, /€\s?697,09/, "over what");
  assert.match(detail!, /€\s?146,39/, "what that rate would actually produce");
  assert.match(detail!, /€\s?50,00/, "and what is printed instead");
});

test("[RIJ-VERKEERD-ETIKET] a row that is not our stored pair may not be relabeled", () => {
  // The relabel is a statement about the SAME two numbers the booking carries. A row whose amounts
  // differ from what we stored is a different disagreement — the owner gets the full question.
  const v = classifyBtwSplit({
    totalExBtw: 1000,
    btwAmount: 90,
    rows: [{ rate: 21, base: 697.09, btw: 62.74 }],
  });
  assert.equal(v.kind, "row-inconsistent");
});

test("[RIJ-KLOPT-NIET] the block as the invoice actually prints it is still verified", () => {
  // Both rows, the 21% one empty. 0 × 21% = 0 is consistent by definition, so an empty rate line —
  // which every Dutch block has — can never trip this.
  const v = classifyBtwSplit({
    totalExBtw: 1123.62,
    btwAmount: 101.13,
    rows: [{ rate: 21, base: 0, btw: 0 }, { rate: 9, base: 1123.62, btw: 101.13 }],
  });
  assert.equal(v.kind, "blend-verified");
  assert.equal(btwSplitCorroborated(v), true);
});

test("[RIJ-KLOPT-NIET] per-line rounding does not make an honest block inconsistent", () => {
  // A supplier who rounds every line and then sums drifts a few cents from base × rate. The
  // tolerance is the same one the single-rate test uses — half a per mille of the base — so this
  // check refuses a € 134 contradiction without refusing a € 0,02 one.
  // 9% of 1.000 is 90,00 and 21% of 1.000 is 210,00; each row is printed a cent over.
  const v = classifyBtwSplit({
    totalExBtw: 2000, btwAmount: 300.02,
    rows: [{ rate: 9, base: 1000, btw: 90.01 }, { rate: 21, base: 1000, btw: 210.01 }],
  });
  assert.equal(v.kind, "blend-verified");
});

test("[RIJ-KLOPT-NIET] a real mixed-rate block still passes, and a swapped one does not", () => {
  const honest = classifyBtwSplit({
    totalExBtw: 1500, btwAmount: 300,
    rows: [{ rate: 9, base: 1000, btw: 90 }, { rate: 21, base: 500, btw: 105 }],
  });
  assert.equal(honest.kind, "blend-mismatch", "these rows are honest but do not sum to the stored btw");
  // The same two bases with the rates swapped: each row now contradicts itself, which is the
  // stronger finding and the one that names what to look at.
  const swapped = classifyBtwSplit({
    totalExBtw: 1500, btwAmount: 195,
    rows: [{ rate: 21, base: 1000, btw: 90 }, { rate: 9, base: 500, btw: 105 }],
  });
  assert.equal(swapped.kind, "row-inconsistent");
  assert.equal((swapped as { offenders: readonly unknown[] }).offenders.length, 2, "both rows are named");
});
