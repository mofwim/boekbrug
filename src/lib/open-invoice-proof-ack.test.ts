// [BEWIJS-BEANTWOORDEN] Pure node test — run: npx tsx --test src/lib/open-invoice-proof-ack.test.ts
//
// The proof panel asked "Klopt het dat deze factuur nog openstaat?" and gave the owner nothing to
// answer with. These are the rules of the answer: what makes two questions the same question, what
// happens to the panel's own sentences when one is put away, and the two ways this could go wrong
// in a way that costs money.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  hitKey, readAcks, writeAcks, acknowledge, forgetAcks, partitionHits,
  ACK_KEY, ACK_VERSION, MAX_ACKS, type AckStorage,
} from "./open-invoice-proof-ack";
import { buildProofPanel } from "./open-invoice-proof-text";
import type { OpenInvoiceHit } from "./open-invoice-proof-types";

/** A localStorage stand-in, so this runs without a browser. */
function memory(initial: Record<string, string> = {}): AckStorage & { data: Record<string, string> } {
  const data = { ...initial };
  return {
    data,
    getItem: (k) => (k in data ? data[k] : null),
    setItem: (k, v) => { data[k] = v; },
    removeItem: (k) => { delete data[k]; },
  };
}

const hit = (over: Partial<OpenInvoiceHit> = {}): OpenInvoiceHit => ({
  invoiceId: "inv-1",
  invoiceNumber: "FAC/2026/00296",
  clientName: "Coroama Stefan Daniel",
  openAmount: 40,
  transaction: {
    transactionId: 'tx-1',
    date: "2026-07-27", amount: -40,
    description: "26/00623", counterpartName: "COROAMA STEFAN DANIEL",
  },
  confidence: 0.7,
  reason: "bedrag en naam",
  ...over,
});

test("[BEWIJS-BEANTWOORDEN] the answer is keyed to the PAIR, not to the invoice", () => {
  const base = hit();
  assert.equal(hitKey(base), hitKey(hit()), "the same question twice is one key");

  // THE rule. Answering "yes this is still open" about THIS payment must not silence the invoice
  // for ever: a different payment next month may genuinely settle it, and the one screen that
  // would have said so would have been told to keep quiet.
  const anderePayment = hit({ transaction: { ...base.transaction, date: "2026-08-14", amount: -40 } });
  assert.notEqual(hitKey(base), hitKey(anderePayment), "a different day is a different question");
  const anderBedrag = hit({ transaction: { ...base.transaction, amount: -41 } });
  assert.notEqual(hitKey(base), hitKey(anderBedrag), "a different amount is a different question");
  const andereFactuur = hit({ invoiceId: "inv-2" });
  assert.notEqual(hitKey(base), hitKey(andereFactuur), "a different invoice is a different question");

  // …and cosmetic differences are NOT a new question. A bank that re-exports the same line with
  // different spacing, or the sign flipped on the way in, is asking the same thing.
  assert.equal(hitKey(hit({ transaction: { ...base.transaction, amount: 40 } })), hitKey(base),
    "the sign is the direction, not the identity");
  assert.equal(hitKey(hit({ transaction: { ...base.transaction, description: "  26/00623  " } })), hitKey(base));
  assert.equal(hitKey(hit({ transaction: { ...base.transaction, description: "26/00623".toUpperCase() } })), hitKey(base));
  assert.equal(hitKey(hit({ transaction: { ...base.transaction, amount: -40.0 } })), hitKey(base));
});

test("[BEWIJS-BEANTWOORDEN] an answered question stops being asked, and says it was", () => {
  const store = memory();
  const proof = {
    direction: "incoming" as const,
    checkedInvoices: 83, checkedTransactions: 1183, bankThrough: "2026-07-28",
    hits: [hit()], capped: { invoices: 0, transactions: 0 }, incoming: null, readFailed: false,
  };

  const before = buildProofPanel(proof, "nl")!;
  assert.equal(before.rows.length, 1);
  assert.equal(before.alarm, true, "an unanswered hit is the amber state");
  assert.match(before.lead, /Bij 1 factuur/, "and the lead counts it");
  assert.equal(before.hidden, null, "nothing is put away yet");

  const answered = acknowledge(store, before.rows[0].ackKey);
  const after = buildProofPanel(proof, "nl", answered)!;

  assert.equal(after.rows.length, 0, "the question is not asked again");
  assert.equal(after.alarm, false, "…and the panel goes back to its calm state");
  // THE consistency this filtering exists for: the lead counts the hits. Filtering in the
  // component instead would have left "Bij 1 factuur vonden we tóch een betaling" standing above
  // an empty list — a claim with no evidence under it, on the one panel whose job is evidence.
  assert.doesNotMatch(after.lead, /Bij 1 factuur vonden we/, "the lead no longer claims a finding");
  assert.match(after.lead, /83/, "…but the SCOPE is still stated — that sentence is the product");
  assert.match(after.lead, /1183/);

  // Nothing vanishes silently. Putting a row away is the owner's decision; hiding that a row was
  // put away would be ours.
  assert.equal(after.hiddenCount, 1);
  assert.match(after.hidden ?? "", /1 eerdere vraag/);
  assert.ok(after.hiddenAction.length > 0, "…and there is a way back to it");

  // The way back really does bring it back.
  const forgotten = forgetAcks(store);
  assert.equal(buildProofPanel(proof, "nl", forgotten)!.rows.length, 1);
});

test("[BEWIJS-BEANTWOORDEN] answering one of two leaves the other one asking", () => {
  const a = hit({ invoiceId: "inv-1" });
  const b = hit({ invoiceId: "inv-2", invoiceNumber: "FAC/2026/00300", openAmount: 120 });
  const proof = {
    direction: "incoming" as const,
    checkedInvoices: 83, checkedTransactions: 1183, bankThrough: "2026-07-28",
    hits: [a, b], capped: { invoices: 0, transactions: 0 }, incoming: null, readFailed: false,
  };

  const answered = acknowledge(memory(), hitKey(a));
  const panel = buildProofPanel(proof, "nl", answered)!;
  assert.equal(panel.rows.length, 1, "the other question is still asked");
  assert.match(panel.rows[0].title, /FAC\/2026\/00300/, "and it is the right one");
  assert.equal(panel.alarm, true, "a remaining hit keeps the panel amber");
  assert.match(panel.lead, /Bij 1 factuur/, "the lead counts what is left, not what was found");
  assert.equal(panel.hiddenCount, 1);
});

test("[BEWIJS-BEANTWOORDEN] unreadable storage means NO answers, never a swallowed warning", () => {
  // The fail-safe direction. The worst case here is a question the owner has already seen being
  // asked once more; the other direction swallows a warning about money because a string in
  // localStorage was malformed.
  assert.equal(readAcks(memory({ [ACK_KEY]: "{not json" })).size, 0);
  assert.equal(readAcks(memory({ [ACK_KEY]: "[]" })).size, 0, "an array is not the payload");
  assert.equal(readAcks(memory({ [ACK_KEY]: JSON.stringify({ version: 999, keys: ["a"] }) })).size, 0,
    "another version is ignored rather than misread");
  assert.equal(readAcks(memory({ [ACK_KEY]: JSON.stringify({ version: ACK_VERSION, keys: "a" }) })).size, 0);
  assert.equal(readAcks(memory()).size, 0);
  assert.equal(readAcks(null).size, 0);

  // A storage that throws on read (private mode, a locked-down browser) is not a crash on a screen
  // about money.
  const hostile: AckStorage = {
    getItem() { throw new Error("blocked"); },
    setItem() { throw new Error("blocked"); },
    removeItem() { throw new Error("blocked"); },
  };
  assert.equal(readAcks(hostile).size, 0);
  assert.equal(writeAcks(hostile, ["a"]), false, "…and the failure is REPORTED, not pretended away");
  assert.doesNotThrow(() => acknowledge(hostile, "a"));
  assert.doesNotThrow(() => forgetAcks(hostile));

  // A good round trip still works.
  const store = memory();
  assert.equal(writeAcks(store, ["a", "b"]), true);
  assert.deepEqual([...readAcks(store)].sort(), ["a", "b"]);
  // Junk inside a well-formed payload is dropped per entry, not wholesale.
  store.data[ACK_KEY] = JSON.stringify({ version: ACK_VERSION, keys: ["a", "", 7, null, "b"] });
  assert.deepEqual([...readAcks(store)].sort(), ["a", "b"]);
});

test("[BEWIJS-BEANTWOORDEN] the store is bounded, and drops the OLDEST first", () => {
  const store = memory();
  const many = Array.from({ length: MAX_ACKS + 10 }, (_, i) => `k${i}`);
  writeAcks(store, many);
  const kept = readAcks(store);
  assert.equal(kept.size, MAX_ACKS, "localStorage is shared with the rest of the app");
  // The direction matters: an old answer coming back asks a question the owner has looked at once,
  // while dropping a NEW one loses the answer they just gave.
  assert.equal(kept.has("k0"), false, "the oldest went");
  assert.equal(kept.has(`k${MAX_ACKS + 9}`), true, "the answer just given survived");
});

test("[BEWIJS-BEANTWOORDEN] a read that failed is never quietly answerable", () => {
  // A panel that could not run says so. It has no rows, so there is nothing to put away — and it
  // must not grow a hidden-count line that would imply a search happened.
  const panel = buildProofPanel({
    direction: "incoming", checkedInvoices: 0, checkedTransactions: 0, bankThrough: null,
    hits: [], capped: { invoices: 0, transactions: 0 }, incoming: null, readFailed: true,
  }, "nl", new Set(["anything"]))!;
  assert.equal(panel.failed, true);
  assert.equal(panel.rows.length, 0);
  assert.equal(panel.hidden, null, "a failure never reads as 'you already answered that'");
  assert.equal(panel.hiddenCount, 0);
});

test("[BEWIJS-BEANTWOORDEN] partitionHits keeps every hit, on exactly one side", () => {
  const a = hit({ invoiceId: "inv-1" });
  const b = hit({ invoiceId: "inv-2" });
  const c = hit({ invoiceId: "inv-3" });
  const { asking, answered } = partitionHits([a, b, c], new Set([hitKey(b)]));
  assert.equal(asking.length + answered.length, 3, "nothing is lost between the two sides");
  assert.deepEqual(asking.map((h) => h.invoiceId), ["inv-1", "inv-3"]);
  assert.deepEqual(answered.map((h) => h.invoiceId), ["inv-2"]);
  const none = partitionHits([a, b, c], new Set());
  assert.equal(none.asking.length, 3);
  assert.equal(none.answered.length, 0);
});
