// [KOR-FACTUUR] Pure node test — run: npx tsx --test src/lib/kor-invoice.test.ts
//
// The load-bearing test is the first one in the second block: an owner who is NOT in the KOR must
// be untouched by every line of this. Most owners are not, and a false refusal on the one
// irreversible button in the app is worse than the defect this module fixes.

import { test } from "node:test";
import assert from "node:assert/strict";

import { checkKorInvoice, korLineViolations, KOR_ALLOWED_RATE } from "./kor-invoice";

const line = (btw_rate: number | null) => ({ btw_rate });

// ── the refusal ───────────────────────────────────────────────────────────────────────────────

test("[KOR-FACTUUR] a KOR invoice that charges btw is refused", () => {
  // Art. 37 Wet OB: stating the btw is what makes it owed. Under the KOR nothing offsets it.
  const r = checkKorInvoice({ korActive: true, lines: [line(21)] });
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.equal(r.code, "kor_btw_charged");
  assert.deepEqual(r.lines, [1]);
});

test("[KOR-FACTUUR] the refusal names the lines, in the numbering the owner sees", () => {
  // "Er zit BTW op" sends someone hunting through twelve rows. The positions are 1-based, because
  // that is what the screen shows.
  const r = checkKorInvoice({ korActive: true, lines: [line(0), line(9), line(0), line(21)] });
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.deepEqual(r.lines, [2, 4]);
  assert.match(r.error, /Regels 2, 4/);
});

test("[KOR-FACTUUR] the sentence says the consequence and the way out, not just 'no'", () => {
  // An owner who reads only "mag niet" tries again. The three things that must be in it: what to
  // change, what it costs to ignore, and where to go if the KOR itself is wrong.
  const r = checkKorInvoice({ korActive: true, lines: [line(21)] });
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.match(r.error, /0%/, "what to change");
  assert.match(r.error, /art\. 37 Wet OB/, "why it is not merely tidy");
  assert.match(r.error, /creditnota/, "…and that it cannot simply be undone");
  assert.match(r.error, /Instellingen/, "where to go if the KOR flag itself is out of date");
});

test("[KOR-FACTUUR] one line reads as one line", () => {
  const r = checkKorInvoice({ korActive: true, lines: [line(21), line(0)] });
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.match(r.error, /^Regel 1 rekent BTW/, "singular, and no stray comma");
});

// ── everything that must stay untouched ───────────────────────────────────────────────────────

test("[KOR-FACTUUR] an owner who is NOT in the KOR is never refused", () => {
  // The one that matters most. This runs on the send route, in front of the irreversible action.
  for (const kor of [false, null, undefined]) {
    for (const rate of [0, 9, 21]) {
      assert.equal(
        checkKorInvoice({ korActive: kor, lines: [line(rate)] }).ok, true,
        `korActive=${kor} rate=${rate} must pass untouched`,
      );
    }
  }
});

test("[KOR-FACTUUR] a KOR invoice at 0% is exactly what the scheme expects", () => {
  assert.equal(checkKorInvoice({ korActive: true, lines: [line(0), line(0)] }).ok, true);
  assert.equal(KOR_ALLOWED_RATE, 0);
});

test("[KOR-FACTUUR] no lines, no objection", () => {
  // An empty or unreadable set is somebody else's refusal (validateDraftLines). This module must
  // not add a second, differently-worded one for the same thing.
  assert.equal(checkKorInvoice({ korActive: true, lines: [] }).ok, true);
  assert.equal(checkKorInvoice({ korActive: true, lines: null }).ok, true);
  assert.equal(checkKorInvoice({ korActive: true, lines: undefined }).ok, true);
});

test("[KOR-FACTUUR] a rate that is not a number is not this module's complaint", () => {
  // validateDraftLines refuses "13%" and null with its own sentence. Objecting here too would give
  // the owner two different explanations of one mistake.
  assert.deepEqual(korLineViolations([line(null), { btw_rate: NaN }, {}]), []);
  assert.equal(checkKorInvoice({ korActive: true, lines: [line(null)] }).ok, true);
});

test("[KOR-FACTUUR] a creditnota under the KOR is held to the same rule", () => {
  // It carries negative amounts but the same regime. A credit note "refunding" btw that was never
  // owed compounds the art. 37 problem rather than fixing it.
  assert.deepEqual(korLineViolations([{ btw_rate: 21 }]), [1]);
  assert.equal(checkKorInvoice({ korActive: true, lines: [{ btw_rate: 21 }] }).ok, false);
});
