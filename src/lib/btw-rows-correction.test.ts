// src/lib/btw-rows-correction.test.ts
// [SPLIT-CORRECTIE] The owner may correct the per-rate split; the split may not contradict the
// invoice it claims to specify. Run: npx tsx --test src/lib/btw-rows-correction.test.ts

import { test } from "node:test";
import assert from "node:assert/strict";

import { validateBtwRows } from "./btw-rows-correction";

const totals = { totalExBtw: 1000, btwAmount: 138 };

test("[SPLIT-CORRECTIE] a coherent mixed-rate split passes, sorted highest rate first", () => {
  const v = validateBtwRows(
    [
      { rate: 9, base: 400, btw: 36 },
      { rate: 21, base: 500, btw: 105 },
      { rate: 0, base: 100, btw: 0 },
    ],
    { totalExBtw: 1000, btwAmount: 141 },
  );
  assert.ok(v.ok);
  assert.deepEqual(v.rows.map((r) => r.rate), [21, 9, 0], "the paper's order: 21 before 9 before 0");
});

test("[SPLIT-CORRECTIE] an empty list is a valid 'clear the specification'", () => {
  const v = validateBtwRows([], totals);
  assert.ok(v.ok && v.rows.length === 0);
});

test("[SPLIT-CORRECTIE] a rate that does not exist is refused by name", () => {
  const v = validateBtwRows([{ rate: 19, base: 1000, btw: 190 }], totals);
  assert.ok(!v.ok && /19%/.test(v.reason), "19% is Germany, not the Netherlands");
});

test("[SPLIT-CORRECTIE] a row whose btw is not base × rate is refused with both numbers", () => {
  const v = validateBtwRows([{ rate: 21, base: 1000, btw: 138 }], totals);
  assert.ok(!v.ok && /210\.00/.test(v.reason) && /138\.00/.test(v.reason),
    "the refusal names what belongs there and what was typed");
});

test("[SPLIT-CORRECTIE] a 0%-row carrying BTW is a contradiction, not a rounding", () => {
  const v = validateBtwRows([{ rate: 0, base: 1000, btw: 5 }], { totalExBtw: 1000, btwAmount: 5 });
  assert.ok(!v.ok);
});

test("[SPLIT-CORRECTIE] the split must BE the totals — a base sum that disagrees is refused", () => {
  const v = validateBtwRows([{ rate: 21, base: 900, btw: 189 }], { totalExBtw: 1000, btwAmount: 189 });
  assert.ok(!v.ok && /900\.00/.test(v.reason) && /1000\.00/.test(v.reason));
});

test("[SPLIT-CORRECTIE] duplicate rates are refused — one row per tariff", () => {
  const v = validateBtwRows(
    [{ rate: 21, base: 500, btw: 105 }, { rate: 21, base: 500, btw: 105 }],
    { totalExBtw: 1000, btwAmount: 210 },
  );
  assert.ok(!v.ok && /twee keer/.test(v.reason));
});

test("[SPLIT-CORRECTIE] [CREDIT-SIGN] a creditnota's split is negative like its totals — signed, never sign-flipped", () => {
  const goed = validateBtwRows(
    [{ rate: 21, base: -100, btw: -21 }],
    { totalExBtw: -100, btwAmount: -21 },
  );
  assert.ok(goed.ok, "a negative split against negative totals is the stored truth");
  const fout = validateBtwRows(
    [{ rate: 21, base: 100, btw: 21 }],
    { totalExBtw: -100, btwAmount: -21 },
  );
  assert.ok(!fout.ok, "a positive split on a credit contradicts the stored sign convention");
});

test("[SPLIT-CORRECTIE] one rounding step of slack, never more", () => {
  assert.ok(validateBtwRows([{ rate: 21, base: 123.45, btw: 25.92 }], { totalExBtw: 123.45, btwAmount: 25.92 }).ok,
    "25.9245 rounds to 25.92 — real invoices round");
  assert.ok(!validateBtwRows([{ rate: 21, base: 123.45, btw: 26.05 }], { totalExBtw: 123.45, btwAmount: 26.05 }).ok,
    "…but 13 cents is a wrong number, not a rounding");
});

test("[SPLIT-CORRECTIE] garbage shapes are refused, never coerced", () => {
  assert.ok(!validateBtwRows("21%", totals).ok);
  assert.ok(!validateBtwRows([{ rate: 21, base: "veel", btw: 1 }], totals).ok);
  assert.ok(!validateBtwRows([1, 2, 3, 4].map((i) => ({ rate: 21, base: i, btw: 0 })), totals).ok, "four rows exceed three tariffs");
});
