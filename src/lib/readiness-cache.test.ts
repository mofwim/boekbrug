// src/lib/readiness-cache.test.ts — run: npx tsx src/lib/readiness-cache.test.ts
// [SNEL-BORD] The rule that decides whether a recorded verdict may stand in for a fresh one.
import { cacheFreshness, ageMessageKey, AGE_MESSAGE_KEYS, MAX_CACHE_AGE_MS, needsRefresh, REFRESH_AFTER_MS } from "./readiness-cache";

let failed = 0;
function check(name: string, ok: boolean) {
  if (!ok) { console.error(`FAIL ${name}`); failed++; } else { console.log(`ok   ${name}`); }
}
function eq(name: string, got: unknown, want: unknown) {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  check(`${name}${g === w ? "" : `  (got ${g}, want ${w})`}`, g === w);
}

const NOW = Date.parse("2026-09-06T10:00:00Z");
const geleden = (ms: number) => new Date(NOW - ms).toISOString();
const MIN = 60_000, HOUR = 60 * MIN, DAY = 24 * HOUR;

// ── The bands ─────────────────────────────────────────────────────────────────
{
  eq("seconds old is 'zojuist', not '0 minuten'", cacheFreshness(geleden(20_000), NOW).band, "zojuist");
  eq("…and it is usable", cacheFreshness(geleden(20_000), NOW).usable, true);

  const m = cacheFreshness(geleden(7 * MIN), NOW);
  eq("seven minutes", [m.band, m.amount], ["minuten", 7]);

  const u = cacheFreshness(geleden(3 * HOUR + 40 * MIN), NOW);
  eq("three hours and a bit rounds DOWN", [u.band, u.amount], ["uren", 3]);

  const d = cacheFreshness(geleden(2 * DAY + 5 * HOUR), NOW);
  eq("two days", [d.band, d.amount], ["dagen", 2]);

  // The boundaries themselves, because off-by-one here shows an owner "60 minuten geleden".
  eq("exactly one minute crosses into minutes", cacheFreshness(geleden(MIN), NOW).band, "minuten");
  eq("exactly one hour crosses into hours", cacheFreshness(geleden(HOUR), NOW).band, "uren");
  eq("exactly one day crosses into days", cacheFreshness(geleden(DAY), NOW).band, "dagen");
  eq("59 minutes is still minutes", cacheFreshness(geleden(59 * MIN), NOW).amount, 59);
}

// ── The age cap ───────────────────────────────────────────────────────────────
//
// A report is only meaningful under the buildReadiness that produced it. Past the cap it is not
// labelled old, it is not shown: "berekend op 12 augustus" reads as trustworthy-but-old, when the
// honest answer is that we do not know what that score meant.
{
  eq("one hour inside the cap is still shown", cacheFreshness(geleden(MAX_CACHE_AGE_MS - HOUR), NOW).usable, true);
  eq("one second past it is not", cacheFreshness(geleden(MAX_CACHE_AGE_MS + 1000), NOW).usable, false);
  eq("a month old is certainly not", cacheFreshness(geleden(30 * DAY), NOW).usable, false);
  // …and the age still comes back, so a caller that wants to say WHY can.
  check("the dropped recording still reports its age", (cacheFreshness(geleden(30 * DAY), NOW).ageMs ?? 0) > 0);
}

// ── What cannot be read is never shown ────────────────────────────────────────
{
  eq("null", cacheFreshness(null, NOW).usable, false);
  eq("undefined", cacheFreshness(undefined, NOW).usable, false);
  eq("empty string", cacheFreshness("", NOW).usable, false);
  eq("nonsense", cacheFreshness("gisteren", NOW).usable, false);
  eq("…and its age is null, not zero", cacheFreshness("gisteren", NOW).ageMs, null);
}

// ── A future timestamp ────────────────────────────────────────────────────────
//
// Clock skew between the database and a browser would render "over 3 minuten berekend". A screen
// that says something impossible about a money figure has spent the trust the figure needs.
{
  eq("a wildly future stamp is refused", cacheFreshness(geleden(-2 * HOUR), NOW).usable, false);
  // A few seconds of skew is ordinary; that must not blank the board.
  eq("a few seconds of skew is 'zojuist'", cacheFreshness(geleden(-3000), NOW).band, "zojuist");
  eq("…and it is still usable", cacheFreshness(geleden(-3000), NOW).usable, true);
  eq("…and never reports a negative amount", cacheFreshness(geleden(-3000), NOW).amount, 0);
}

// ── The keys ──────────────────────────────────────────────────────────────────
{
  const banden = ["zojuist", "minuten", "uren", "dagen"] as const;
  // Every band, at n = 1 and at n = many: "1 minuut" and "5 minuten" are two sentences in Dutch and
  // in every language this app is translated into.
  const alle = banden.flatMap((b) => [ageMessageKey(b, 1), ageMessageKey(b, 5)]);
  eq("no two of them collide", new Set(alle).size, 7);
  eq("the declared list is exactly what the function can return",
    [...AGE_MESSAGE_KEYS].sort(), [...new Set(alle)].sort());
  eq("one minute is not the plural key", ageMessageKey("minuten", 1), "bh.stand.minuut1");
  eq("…and five is", ageMessageKey("minuten", 5), "bh.stand.minuten");
  eq("zojuist has no number at all", ageMessageKey("zojuist", 1), ageMessageKey("zojuist", 9));
}

// ── Recompute, or work from the recording? ────────────────────────────────────
//
// A different question from "may this be shown", with a different cost. Every branch that has no
// usable recording must ask for a fresh one: "we have no verdict" and "we have a recent verdict"
// taking the same path is how a board would silently stop refreshing.
{
  eq("a recording from a minute ago is worth working from", needsRefresh(geleden(MIN), NOW), false);
  eq("…and one from fourteen minutes ago too", needsRefresh(geleden(14 * MIN), NOW), false);
  eq("exactly the window is already too old", needsRefresh(geleden(REFRESH_AFTER_MS), NOW), true);
  eq("an hour certainly is", needsRefresh(geleden(HOUR), NOW), true);

  // The three ways there is nothing to work from. All must recompute.
  eq("no recording at all", needsRefresh(null, NOW), true);
  eq("an unreadable moment", needsRefresh("gisteren", NOW), true);
  eq("past the age cap", needsRefresh(geleden(MAX_CACHE_AGE_MS + MIN), NOW), true);
  eq("a future moment", needsRefresh(geleden(-2 * HOUR), NOW), true);

  // The two windows are not the same number, and confusing them is the whole risk here: showing a
  // week-old figure is allowed, working from a week-old figure without re-reading it is not.
  check("the refresh window is far shorter than the age cap", REFRESH_AFTER_MS < MAX_CACHE_AGE_MS);
  eq("a two-hour recording is shown but re-read",
    [cacheFreshness(geleden(2 * HOUR), NOW).usable, needsRefresh(geleden(2 * HOUR), NOW)], [true, true]);
}

// [NEGATIEVE CONTROLE] Every "not usable" above also passes if cacheFreshness always refuses.
{
  check("a fresh recording really is usable", cacheFreshness(geleden(5 * MIN), NOW).usable === true);
  check("and a stale one really is not", cacheFreshness(geleden(8 * DAY), NOW).usable === false);
  // …and needsRefresh really can say no, or the board would recompute everything as before.
  check("needsRefresh really does skip a recent recording", needsRefresh(geleden(30_000), NOW) === false);
}

console.log(failed === 0 ? "\nreadiness-cache: all green" : `\nreadiness-cache: ${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);
