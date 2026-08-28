// src/lib/campaign-attribution.test.ts
// Run: npx tsx --test src/lib/campaign-attribution.test.ts

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseAttribution,
  rememberAttribution,
  readAttribution,
  clearAttribution,
  ATTRIBUTION_KEY,
  ATTRIBUTION_TTL_DAYS,
  type AttributionStorage,
} from "./campaign-attribution";

const NOW = new Date("2026-08-27T12:00:00.000Z");
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000);

function mem(seed: Record<string, string> = {}, opts: { failWrites?: boolean; failReads?: boolean } = {}): AttributionStorage {
  const store = { ...seed };
  return {
    getItem: (k) => { if (opts.failReads) throw new Error("blocked"); return store[k] ?? null; },
    setItem: (k, v) => { if (opts.failWrites) throw new Error("full"); store[k] = v; },
    removeItem: (k) => { delete store[k]; },
  };
}

test("[HERKOMST] a tagged link is parsed, an untagged one is not a campaign", () => {
  const tagged = parseAttribution("?utm_source=nieuwsbrief&utm_medium=email&utm_campaign=zzp-2026");
  assert.equal(tagged?.source, "nieuwsbrief");
  assert.equal(tagged?.medium, "email");
  assert.equal(tagged?.campaign, "zzp-2026");

  assert.equal(parseAttribution(""), null, "no parameters at all is no campaign");
  assert.equal(parseAttribution("?redirect=/dashboard"), null, "unrelated parameters are not a campaign");
  assert.equal(
    parseAttribution("?utm_content=knop-b"),
    null,
    "utm_content on its own is noise: it says which variant but not which campaign",
  );
});

test("[HERKOMST] first touch wins — a later untagged visit does not erase the source", () => {
  const s = mem();
  rememberAttribution(s, "?utm_source=google&utm_medium=cpc", NOW);
  rememberAttribution(s, "", NOW);
  assert.equal(readAttribution(s, NOW)?.source, "google");

  // Nor does a DIFFERENT campaign overwrite it: the first click is the one that earned the visit.
  rememberAttribution(s, "?utm_source=facebook&utm_medium=social", NOW);
  assert.equal(readAttribution(s, NOW)?.source, "google");
});

test("[HERKOMST] the record expires, and so does one from the future", () => {
  const fresh = mem();
  rememberAttribution(fresh, "?utm_source=nieuwsbrief", daysAgo(1));
  assert.ok(readAttribution(fresh, NOW), "a day old is well within the window");

  const edge = mem();
  rememberAttribution(edge, "?utm_source=nieuwsbrief", daysAgo(ATTRIBUTION_TTL_DAYS - 0.1));
  assert.ok(readAttribution(edge, NOW), "just inside the window still counts");

  const stale = mem();
  rememberAttribution(stale, "?utm_source=nieuwsbrief", daysAgo(ATTRIBUTION_TTL_DAYS + 1));
  assert.equal(readAttribution(stale, NOW), null, "past the window it must not credit an old click");

  const future = mem();
  rememberAttribution(future, "?utm_source=nieuwsbrief", new Date(NOW.getTime() + 5 * 86_400_000));
  assert.equal(readAttribution(future, NOW), null, "a moved system clock is as suspect as an expired record");
});

test("[HERKOMST] blocked or corrupt storage degrades to 'no campaign', never to a throw", () => {
  assert.doesNotThrow(() => rememberAttribution(mem({}, { failWrites: true }), "?utm_source=x", NOW));
  assert.equal(readAttribution(mem({}, { failReads: true }), NOW), null);
  assert.equal(readAttribution(mem({ [ATTRIBUTION_KEY]: "{not json" }), NOW), null);
  assert.equal(readAttribution(mem({ [ATTRIBUTION_KEY]: "[]" }), NOW), null, "an array is not a record");
  assert.equal(readAttribution(mem({ [ATTRIBUTION_KEY]: '{"source":"x"}' }), NOW), null, "no savedAt → unusable");
});

test("[HERKOMST] a pathological querystring cannot become a pathological property", () => {
  const s = mem();
  rememberAttribution(s, `?utm_source=${"a".repeat(500)}`, NOW);
  const stored = readAttribution(s, NOW);
  assert.ok(stored && stored.source.length <= 64, "the value is capped before it ever reaches analytics");
});

test("[HERKOMST] clearing works", () => {
  const s = mem();
  rememberAttribution(s, "?utm_source=nieuwsbrief", NOW);
  clearAttribution(s);
  assert.equal(readAttribution(s, NOW), null);
});
