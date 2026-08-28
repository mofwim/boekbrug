// [ZOEK-BEGRIJPT] Pure node test — run: npx tsx --test src/lib/search-query.test.ts

import { test } from "node:test";
import assert from "node:assert/strict";

import { parseSearchQuery, filterDateRange } from "./search-query";

test("[ZOEK-BEGRIJPT] a recognised word is REMOVED from the text, never left in it", () => {
  // THE POINT of consuming. If "2025" narrows to that year and stays a search term, every 2025
  // invoice matches the term anyway — the filter changes nothing and the owner sees no difference.
  const p = parseSearchQuery("doyum 2025");
  assert.equal(p.filters.year, 2025);
  assert.equal(p.text, "doyum", "the year stayed in the text, so the filter does nothing");
  assert.equal(p.recognised.length, 1);
  assert.equal(p.recognised[0].label, "Jaar 2025");
});

test("[ZOEK-BEGRIJPT] a bare year stays a search term", () => {
  // Alone, "2025" is far more likely to be part of an invoice number than a period, and guessing
  // wrong hides the exact document being looked for.
  const p = parseSearchQuery("2025");
  assert.equal(p.filters.year, undefined);
  assert.equal(p.text, "2025");
  assert.deepEqual(p.recognised, []);
});

test("[ZOEK-BEGRIJPT] a period needs a year, in both spellings of a quarter", () => {
  for (const q of ["kiwi 2026 q2", "kiwi 2026 Q2", "kiwi 2026 kwartaal 2"]) {
    const p = parseSearchQuery(q);
    assert.equal(p.filters.year, 2026, q);
    assert.equal(p.filters.quarter, 2, q);
    assert.equal(p.text, "kiwi", `${q} left something behind: ${p.text}`);
  }
  // Without a year a quarter is not a period. Assuming the current year would silently answer a
  // different question in January, so the token goes back to being ordinary text.
  const loose = parseSearchQuery("kiwi q2");
  assert.equal(loose.filters.quarter, undefined);
  assert.equal(loose.text, "kiwi q2");
});

test("[ZOEK-BEGRIJPT] direction and paid state, and only the unambiguous words", () => {
  const p = parseSearchQuery("inkoop onbetaald groothandel");
  assert.equal(p.filters.direction, "incoming");
  assert.equal(p.filters.paid, "open");
  assert.equal(p.text, "groothandel");

  // Deliberately NOT recognised: "klant" and "open" are ordinary words that appear in real company
  // names. Consuming them would silently drop half the query on an innocent search.
  const innocent = parseSearchQuery("open klant bakkerij");
  assert.equal(innocent.filters.paid, undefined);
  assert.equal(innocent.filters.direction, undefined);
  assert.equal(innocent.text, "open klant bakkerij");
});

test("[ZOEK-BEGRIJPT] a month wins over a quarter, and the loser goes back to being text", () => {
  // Two periods in one query. The month is the narrower and the more deliberately typed.
  const p = parseSearchQuery("2026 q2 april nettorama");
  assert.equal(p.filters.month, 4);
  assert.equal(p.filters.quarter, undefined);
  assert.match(p.text, /q2/, "the quarter was swallowed instead of handed back as text");
  assert.match(p.text, /nettorama/);
});

test("[ZOEK-BEGRIJPT] every filter comes back with a chip the owner can read", () => {
  const p = parseSearchQuery("verkoop betaald 2026 maart");
  const labels = p.recognised.map((r) => r.label).sort();
  assert.deepEqual(labels, ["Betaald", "Jaar 2026", "Maart 2026", "Verkoop"]);
  // Each chip knows which filter to remove, and what the owner actually typed.
  assert.ok(p.recognised.every((r) => r.key && r.token), "a chip without a key or a token cannot be undone");
});

test("[ZOEK-BEGRIJPT] the date range is exact, including a leap February", () => {
  assert.deepEqual(filterDateRange({ year: 2026 }), { start: "2026-01-01", end: "2026-12-31" });
  assert.deepEqual(filterDateRange({ year: 2026, quarter: 2 }), { start: "2026-04-01", end: "2026-06-30" });
  assert.deepEqual(filterDateRange({ year: 2026, quarter: 4 }), { start: "2026-10-01", end: "2026-12-31" });
  assert.deepEqual(filterDateRange({ year: 2026, month: 4 }), { start: "2026-04-01", end: "2026-04-30" });
  // 2028 is a leap year. A hard-coded 28 would drop every invoice dated the 29th.
  assert.deepEqual(filterDateRange({ year: 2028, month: 2 }), { start: "2028-02-01", end: "2028-02-29" });
  assert.deepEqual(filterDateRange({ year: 2026, month: 2 }), { start: "2026-02-01", end: "2026-02-28" });
  // No year, no period — never a guessed range.
  assert.equal(filterDateRange({}), null);
  assert.equal(filterDateRange({ quarter: 3 }), null);
});

test("[ZOEK-BEGRIJPT] an empty or all-filter query is handled without inventing text", () => {
  assert.deepEqual(parseSearchQuery("").recognised, []);
  assert.equal(parseSearchQuery("   ").text, "");
  // Only filters, no words left: the caller must be able to see that and search on the filters.
  const p = parseSearchQuery("inkoop 2026");
  assert.equal(p.text, "");
  assert.equal(p.filters.direction, "incoming");
  assert.equal(p.filters.year, 2026);
});
