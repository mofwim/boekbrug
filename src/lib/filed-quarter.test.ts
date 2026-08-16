// [SUPPLETIE] Pure node test — run: npx tsx --test src/lib/filed-quarter.test.ts
//
// The parts of the filed-quarter door that can be tested without a database: which quarter a date
// falls in, where a quarter starts and ends, and what the owner is told. The database half
// (filedQuarterImpacts) is exercised against a fake client at the bottom — the point there is the
// FAIL-CLOSED behaviour, which is the half that decides whether an obligation is announced or lost.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  quarterOf,
  quarterBounds,
  quarterLabel,
  describeFiledQuarterImpact,
  filedQuarterImpacts,
  type FiledQuarterImpact,
} from "./filed-quarter";
import { computeFilingDivergence } from "./btw-filing";

test("[SUPPLETIE] a date lands in the quarter the Belastingdienst puts it in", () => {
  assert.deepEqual(quarterOf("2026-01-01"), { year: 2026, quarter: 1 });
  assert.deepEqual(quarterOf("2026-03-31"), { year: 2026, quarter: 1 });
  assert.deepEqual(quarterOf("2026-04-01"), { year: 2026, quarter: 2 });
  assert.deepEqual(quarterOf("2026-06-30"), { year: 2026, quarter: 2 });
  assert.deepEqual(quarterOf("2026-07-01"), { year: 2026, quarter: 3 });
  assert.deepEqual(quarterOf("2026-10-01"), { year: 2026, quarter: 4 });
  assert.deepEqual(quarterOf("2026-12-31"), { year: 2026, quarter: 4 });
});

test("[SUPPLETIE] the quarter is read from the STRING, never through a Date", () => {
  // `new Date("2026-01-01")` is midnight UTC. Read back in any zone west of UTC that is
  // 31 December — a different quarter, a different year, and a different aangifte. The boundary
  // days are the only ones where this shows, which is exactly why it survives casual testing.
  assert.deepEqual(quarterOf("2026-01-01"), { year: 2026, quarter: 1 }, "not 2025-Q4");
  assert.deepEqual(quarterOf("2027-01-01"), { year: 2027, quarter: 1 }, "not 2026-Q4");
  // And nothing that is not a plain ISO day is a quarter.
  for (const bad of ["", "2026-1-1", "01-01-2026", "2026-13-01", "not a date", "2026-01-01T10:00:00Z"]) {
    assert.equal(quarterOf(bad), null, JSON.stringify(bad));
  }
  assert.equal(quarterOf(null), null);
  assert.equal(quarterOf(undefined), null);
});

test("[SUPPLETIE] a quarter's bounds cover it exactly, leap year included", () => {
  assert.deepEqual(quarterBounds(2026, 1), { start: "2026-01-01", end: "2026-03-31" });
  assert.deepEqual(quarterBounds(2026, 2), { start: "2026-04-01", end: "2026-06-30" });
  assert.deepEqual(quarterBounds(2026, 3), { start: "2026-07-01", end: "2026-09-30" });
  assert.deepEqual(quarterBounds(2026, 4), { start: "2026-10-01", end: "2026-12-31" });
  // 2028 is a leap year: Q1 must end on the 31st of March either way, but the February inside it
  // is what a naive day-count gets wrong.
  assert.deepEqual(quarterBounds(2028, 1), { start: "2028-01-01", end: "2028-03-31" });
  // Every day of a year belongs to exactly one quarter — bounds meet with no gap and no overlap.
  for (const year of [2025, 2026, 2028]) {
    for (let q = 1; q < 4; q++) {
      const endMs = Date.parse(`${quarterBounds(year, q).end}T00:00:00Z`);
      const nextMs = Date.parse(`${quarterBounds(year, q + 1).start}T00:00:00Z`);
      assert.equal(nextMs - endMs, 86_400_000, `${year} Q${q} → Q${q + 1} meet exactly`);
    }
  }
  assert.equal(quarterLabel(2026, 3), "2026-Q3");
});

// ── What the owner is told ───────────────────────────────────────────────────

const impactWith = (filed: { saldo: number; omzet?: number; kosten?: number }, current: { saldo: number; omzet?: number; kosten?: number }): FiledQuarterImpact => ({
  year: 2026,
  quarter: 1,
  label: "2026-Q1",
  filedAt: "2026-04-10T09:00:00Z",
  divergence: computeFilingDivergence(
    { omzet: filed.omzet ?? 10000, kosten: filed.kosten ?? 4000, btwVerschuldigd: 2100, btwVoorbelasting: 840, btwSaldo: filed.saldo },
    { omzet: current.omzet ?? 10000, kosten: current.kosten ?? 4000, btwVerschuldigd: 2100, btwVoorbelasting: 840, btwSaldo: current.saldo },
  ),
});

test("[SUPPLETIE] over €1.000 the sentence demands a suppletie, and names the amount", () => {
  const text = describeFiledQuarterImpact(impactWith({ saldo: 1260 }, { saldo: 2760 }));
  assert.match(text, /2026-Q1/, "the owner is told WHICH quarter");
  assert.match(text, /€\s?1\.500,00/, "and by how much");
  assert.match(text, /meer/, "and in which direction");
  assert.match(text, /suppletie/);
  assert.doesNotMatch(text, /volgende aangifte/, "one path, not two");
});

test("[SUPPLETIE] under €1.000 it points at the next aangifte instead", () => {
  const text = describeFiledQuarterImpact(impactWith({ saldo: 1260 }, { saldo: 1100 }));
  assert.match(text, /€\s?160,00/);
  assert.match(text, /minder/, "the direction is the owner's, not the tax office's");
  assert.match(text, /volgende aangifte/);
  assert.doesNotMatch(text, /dien hiervoor een suppletie in/);
});

test("[SUPPLETIE] exactly €1.000 is not a suppletie — the rule is 'more than'", () => {
  const text = describeFiledQuarterImpact(impactWith({ saldo: 0 }, { saldo: 1000 }));
  assert.match(text, /volgende aangifte/);
  const over = describeFiledQuarterImpact(impactWith({ saldo: 0 }, { saldo: 1000.01 }));
  assert.match(over, /suppletie/);
});

test("[SUPPLETIE] a change that moves the result but not the btw says exactly that", () => {
  // [DIVERGENCE-SPLIT] A 0%-BTW cost arriving late. "Je btw verandert met € 0,00" would be nonsense
  // on the one screen that exists to be trusted — and it is the screen where the owner decides
  // whether to file a correction with the Belastingdienst.
  const text = describeFiledQuarterImpact(impactWith({ saldo: 1260, kosten: 4000 }, { saldo: 1260, kosten: 4500 }));
  assert.doesNotMatch(text, /€\s?0,00/);
  assert.match(text, /verandert hierdoor niet/);
  assert.match(text, /inkomstenbelasting/, "it says where the change DOES land");
  assert.doesNotMatch(text, /suppletie/, "no btw correction is due, so none is demanded");
});

// ── The database half: fail-closed, always ───────────────────────────────────

/** A Supabase-shaped stub: one .from("btw_filings") chain ending in maybeSingle(). */
const filingClient = (answer: { data?: unknown; error?: { message: string } }) => ({
  from: () => ({
    select: () => ({
      eq: () => ({
        eq: () => ({
          eq: () => ({ maybeSingle: async () => ({ data: answer.data ?? null, error: answer.error ?? null }) }),
        }),
      }),
    }),
  }),
});

test("[SUPPLETIE] no date means no question — and no quarter is recomputed", () => {
  return filedQuarterImpacts({ pipeline: filingClient({}), ownerId: "u1", dates: [null, undefined, ""] })
    .then((r) => {
      assert.deepEqual(r.impacts, []);
      assert.equal(r.unknown, false, "a missing date is a fact, not an unknown");
    });
});

test("[SUPPLETIE] an unfiled quarter raises nothing", async () => {
  const r = await filedQuarterImpacts({ pipeline: filingClient({ data: null }), ownerId: "u1", dates: ["2026-02-10"] });
  assert.deepEqual(r.impacts, []);
  assert.equal(r.unknown, false);
});

test("[SUPPLETIE] a filing read that FAILED is unknown, never 'nothing moved'", async () => {
  // The direction that matters. This helper exists to raise an obligation the owner does not know
  // about yet; if a failed read came back as an empty list, the caller would say nothing at all and
  // the silence would be indistinguishable from a clean correction.
  const r = await filedQuarterImpacts({
    pipeline: filingClient({ error: { message: "canceling statement due to statement timeout" } }),
    ownerId: "u1",
    dates: ["2026-02-10"],
  });
  assert.deepEqual(r.impacts, []);
  assert.equal(r.unknown, true);
});

test("[SUPPLETIE] a btw_filings table that does not exist yet is 'not filed', not 'unknown'", async () => {
  // [DEPLOY-SAFE] The migrations here are applied by hand. Before btw_filings exists there are no
  // filings, which is an answer — treating it as unknown would put a warning on every correction in
  // an environment where nothing has ever been filed.
  const r = await filedQuarterImpacts({
    pipeline: filingClient({ error: { message: 'relation "public.btw_filings" does not exist' } }),
    ownerId: "u1",
    dates: ["2026-02-10"],
  });
  assert.deepEqual(r.impacts, []);
  assert.equal(r.unknown, false);
});

test("[SUPPLETIE] a date change asks about BOTH quarters, and asks each one once", async () => {
  // Moving an invoice from February to April takes the amount OUT of Q1 and puts it INTO Q2. A
  // caller told about only one of them has been told half of what happened.
  const asked: string[] = [];
  const spy = {
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: (_c: string, year: number) => ({
            eq: (_c2: string, quarter: number) => ({
              maybeSingle: async () => { asked.push(`${year}-Q${quarter}`); return { data: null, error: null }; },
            }),
          }),
        }),
      }),
    }),
  };
  await filedQuarterImpacts({ pipeline: spy, ownerId: "u1", dates: ["2026-02-10", "2026-04-02", "2026-02-28"] });
  assert.deepEqual(asked.sort(), ["2026-Q1", "2026-Q2"], "both quarters, and Q1 only once");
});
