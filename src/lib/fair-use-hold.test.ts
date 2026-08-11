// [GRENS-ZICHTBAAR] Pure node test — run: npx tsx --test src/lib/fair-use-hold.test.ts
//
// The property that matters: an owner whose invoices arrived and were not read finds that out.
// Everything else here protects the sentence that tells them — that it is accurate, that it does
// not frighten, and above all that it arrives ONCE, because a notification that repeats every hour
// is one the owner switches off, and then they are not told at all.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  fairUseHold, fairUseHoldMonth, fairUseHoldNotice, drainStopReason,
} from "./fair-use-hold";

test("[GRENS-ZICHTBAAR] the measured case: ten arrived, none read", () => {
  // wanted: 10, granted: 0, plan: 'free' — straight from the log.
  assert.deepEqual(fairUseHold(10, 0, "free"), { held: 10, plan: "free" });
});

test("[GRENS-ZICHTBAAR] a PARTIAL grant is still a hold, for the remainder", () => {
  // The easy thing to get wrong. Seven read and three not is not "fine": three invoices are
  // missing from the owner's books and nothing else would say so.
  assert.deepEqual(fairUseHold(10, 7, "free"), { held: 3, plan: "free" });
});

test("[GRENS-ZICHTBAAR] a batch that fits is not a hold", () => {
  // The ordinary run, which must stay silent — this notice may never appear on a normal month.
  assert.equal(fairUseHold(10, 10, "free"), null);
  assert.equal(fairUseHold(0, 0, "free"), null);
  // Granted more than wanted is not a NEGATIVE hold either.
  assert.equal(fairUseHold(3, 9, "plus"), null);
});

test("[GRENS-ZICHTBAAR] junk numbers cannot invent a hold that is not there", () => {
  // These come from a counter and an API response, so neither is guaranteed to be a number.
  for (const [w, g] of [[NaN, 0], [10, NaN], [undefined, undefined], [null, 5]] as const) {
    const h = fairUseHold(w as number, g as number);
    if (h) assert.ok(h.held > 0 && Number.isFinite(h.held), `${String(w)}/${String(g)}`);
  }
  assert.equal(fairUseHold(NaN as number, NaN as number), null);
  assert.equal(fairUseHold(-5, 0), null, "a negative want is not ten invoices");
});

test("[GRENS-ZICHTBAAR] the month key is read from the STRING, so it cannot drift with a timezone", () => {
  // A Date object would move this over a month boundary for anyone east or west of the server, and
  // the whole point of the key is that it is the same for every call in one month.
  assert.equal(fairUseHoldMonth("2026-08-11T08:00:33.776Z"), "2026-08");
  assert.equal(fairUseHoldMonth("2026-01-01"), "2026-01");
  assert.equal(fairUseHoldMonth("2026-12-31T23:59:59+01:00"), "2026-12");
  assert.equal(fairUseHoldMonth("nonsense"), "", "an unusable date must not become a fake month");
  assert.equal(fairUseHoldMonth(""), "");
});

test("[GRENS-ZICHTBAAR] the notice says what happened, that nothing is lost, and what can be done", () => {
  // All three carry weight. Without the second, a limit reads as "your bookkeeping has holes in
  // it"; without the third it is an announcement the owner can do nothing with.
  const n = fairUseHoldNotice({ held: 10, plan: "free" }, "2026-08");
  assert.match(n.body, /10 facturen/, "the count belongs in the body");
  assert.match(n.body, /via je e-mail/, "WHAT happened");
  assert.match(n.body, /maandgrens/, "…and why");
  assert.match(n.body, /er gaat niets verloren/i, "that nothing is lost");
  assert.match(n.body, /nieuwe maand/, "…and when they arrive by themselves");
  assert.equal(n.link, "/prijzen");
});

test("[GRENS-ZICHTBAAR] one invoice is not written as '1 facturen'", () => {
  // It reaches a screen. A template that cannot count reads as an app that cannot count.
  const one = fairUseHoldNotice({ held: 1, plan: "free" }, "2026-08");
  assert.match(one.body, /kwam 1 factuur binnen/);
  assert.match(one.body, /Hij staat klaar en wordt/);
  assert.doesNotMatch(one.body, /1 facturen|Ze staan/);
});

test("[GRENS-ZICHTBAAR] it names the plan, and never turns a service message into a sales pitch", () => {
  assert.match(fairUseHoldNotice({ held: 2, plan: "free" }, "2026-08").body, /gratis-pakket/);
  assert.match(fairUseHoldNotice({ held: 2, plan: "plus" }, "2026-08").body, /Plus-pakket/);
  // Waiting for the new month is a valid answer and the sentence has to leave it standing. A
  // bookkeeping app that pushes an upgrade inside a service message has stopped being one you can
  // trust about your own numbers.
  for (const plan of ["free", "plus"] as const) {
    assert.doesNotMatch(fairUseHoldNotice({ held: 2, plan }, "2026-08").body, /upgrade|nu overstappen|koop/i);
  }
});

test("[GRENS-ZICHTBAAR] the drain reports the cause it actually has", () => {
  // The log said "likely a stuck attachment" about a batch no attachment was ever tried on, which
  // sends whoever reads it looking for a broken PDF that does not exist.
  assert.match(drainStopReason(10), /monthly allowance spent/);
  assert.doesNotMatch(drainStopReason(10), /stuck attachment/);
  // …and a genuine poison pill must keep its own words.
  assert.match(drainStopReason(0), /stuck attachment/);
});

test("[GRENS-ZICHTBAAR] the title is the dedup key: stable within a month, different across months", () => {
  // The once-a-month promise rests entirely on this. The caller posts only when no notification
  // with this exact title exists, so a title that moved with the COUNT would let the same message
  // through every time the number changed — ten held this hour, three the next, and the owner is
  // notified twice for one situation.
  const a = fairUseHoldNotice({ held: 10, plan: "free" }, "2026-08").title;
  const b = fairUseHoldNotice({ held: 3, plan: "free" }, "2026-08").title;
  const c = fairUseHoldNotice({ held: 10, plan: "plus" }, "2026-08").title;
  assert.equal(a, b, "a different count must not create a second notification");
  assert.equal(a, c, "…nor a different plan");
  assert.doesNotMatch(a, /\d+ factu/, "no count in the key");
  // …but a new month is a new situation and must be told.
  assert.notEqual(a, fairUseHoldNotice({ held: 10, plan: "free" }, "2026-09").title);
  assert.match(a, /2026-08/);
});
