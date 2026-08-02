// [MONEY-INVARIANTS] The properties that make the headline figures true — run:
//   npx tsx --test src/lib/money-invariants.test.ts
//
// WHY THIS FILE EXISTS, AND WHY IT GENERATES ITS DATA
//
// "In / uit / openstaand / betaald" are not features, they are CLAIMS. Every screen that prints
// one is asserting something about money that a tax office and an accountant will read. The rules
// behind them live in partial-payment.ts and are correct — but nothing enforced that they STAY
// correct, and nothing tied the several functions that express them to each other. Three surfaces
// computed openstaand three ways; all three happened to agree; nothing would have said so if one
// had stopped.
//
// So these are PROPERTY tests over a GENERATED corpus, not hand-picked fixtures. That distinction
// is not stylistic. The MT940/CAMT divergence that doubled 28 transactions of a real quarter
// survived a full suite because every fixture had been written by the same hand as the parser, so
// both sides agreed on the same misreading. A generated corpus does not share our assumptions: it
// walks the whole space — creditnota's, over-payments, corrupt negatives, the legacy row marked
// paid before amount_paid existed — and asks whether the RELATIONSHIPS hold, never whether one
// blessed input produces one blessed output.
//
// The generator is seeded, so a failure is reproducible: the same seed replays the same corpus.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  CENT_EPSILON,
  PAYMENT_DUST,
  isPartiallyPaid,
  openAmount,
  openAmountSigned,
  openBalanceFromAmounts,
  paidAmount,
  paymentExceedsOpenBalance,
  settledAmountSigned,
  toCents,
  totalAmount,
  type PartialPayInvoice,
} from "./partial-payment";
import { openstaandOf } from "./invoice-reminders";

// ── the corpus ────────────────────────────────────────────────────────────────────────────────

/** Deterministic PRNG. A seeded generator makes a failure replayable; Math.random does not. */
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 0x1_0000_0000;
  };
}

/** Every status the invoices table actually carries, plus the null a legacy row can have. */
const STATUSES = ["draft", "sent", "overdue", "received", "processing", "paid", "archived", null];

/**
 * A corpus that deliberately includes the shapes that break naive arithmetic:
 *   · creditnota's — a NEGATIVE total whose openstaand must stay negative when summed
 *   · exact-zero totals, and sub-cent totals
 *   · amount_paid of 0 / part / exactly the total / MORE than the total (an over-linked payment)
 *   · amount_paid negative — corrupt, and must never produce a balance larger than the invoice
 *   · status 'paid' with amount_paid 0 — the legacy row, and the reason status outranks the money
 */
function corpus(): PartialPayInvoice[] {
  const rand = lcg(20260802);
  const out: PartialPayInvoice[] = [];

  // The hand-placed edges first: these are the ones a random walk hits rarely and costs most.
  const edges: PartialPayInvoice[] = [
    { status: "paid", total_inc_btw: 100, amount_paid: 0 },      // legacy: paid before amount_paid existed
    { status: "paid", total_inc_btw: 100, amount_paid: 100 },
    { status: "sent", total_inc_btw: 0, amount_paid: 0 },
    { status: "sent", total_inc_btw: 100, amount_paid: 100 },    // money says settled, status does not
    { status: "sent", total_inc_btw: 100, amount_paid: 150 },    // over-linked
    { status: "sent", total_inc_btw: 100, amount_paid: -20 },    // corrupt
    { status: "sent", total_inc_btw: -250, amount_paid: 0 },      // creditnota, untouched
    { status: "sent", total_inc_btw: -250, amount_paid: 100 },    // creditnota, part refunded
    { status: "paid", total_inc_btw: -250, amount_paid: 250 },
    { status: "sent", total_inc_btw: 0.004, amount_paid: 0 },     // below a cent
    { status: null, total_inc_btw: 99.995, amount_paid: 0 },      // half-cent, rounding boundary
  ];
  out.push(...edges);

  for (let i = 0; i < 400; i++) {
    const magnitude = toCents(rand() * 5000);
    const total = rand() < 0.2 ? -magnitude : magnitude; // one in five is a creditnota
    const roll = rand();
    const paid =
      roll < 0.35 ? 0
      : roll < 0.7 ? toCents(magnitude * rand())        // a genuine instalment
      : roll < 0.85 ? magnitude                          // settled to the cent
      : toCents(magnitude * (1 + rand()));               // over-linked
    out.push({
      status: STATUSES[Math.floor(rand() * STATUSES.length)],
      total_inc_btw: total,
      amount_paid: paid,
    });
  }
  return out;
}

const CORPUS = corpus();
const label = (inv: PartialPayInvoice) =>
  `status=${inv.status} total=${inv.total_inc_btw} paid=${inv.amount_paid}`;

// ── the invariants ────────────────────────────────────────────────────────────────────────────

test("[MONEY-INVARIANTS] openstaand is never negative and never exceeds the invoice", () => {
  // A negative openstaand would mean the debtor owes less than nothing — it silently REDUCES a
  // portfolio total, so one corrupt row quietly shrinks what the owner believes he is owed. And a
  // balance larger than the invoice would chase money that was never billed.
  for (const inv of CORPUS) {
    const open = openAmount(inv);
    assert.ok(open >= 0, `openstaand went negative — ${label(inv)}`);
    assert.ok(
      open <= totalAmount(inv) + CENT_EPSILON,
      `openstaand exceeds the invoice itself — ${label(inv)}`,
    );
  }
});

test("[MONEY-INVARIANTS] status 'paid' settles the invoice whatever the money column says", () => {
  // The status is the authority on completion; amount_paid only describes the road there. A row
  // marked paid before amount_paid existed carries 0 — deriving openstaand from the money alone
  // would report the FULL total as still owed, and the owner would chase a client who has paid.
  for (const inv of CORPUS) {
    if (inv.status !== "paid") continue;
    assert.equal(openAmount(inv), 0, `a paid invoice still reported a balance — ${label(inv)}`);
    assert.equal(openAmountSigned(inv), 0, `…and it survived into the signed total — ${label(inv)}`);
  }
});

test("[MONEY-INVARIANTS] every figure that reaches a screen is cent-exact", () => {
  // 0.1 + 0.2 is 0.30000000000000004. Printed once it is cosmetic; summed over a debtor list it is
  // a total that does not equal the column above it, which is the one thing a figure called
  // "je financiële waarheid" may not be.
  const isCentExact = (v: number) => Math.abs(v * 100 - Math.round(v * 100)) < 1e-6;
  for (const inv of CORPUS) {
    assert.ok(isCentExact(openAmount(inv)), `openAmount carried float dust — ${label(inv)}`);
    assert.ok(isCentExact(openAmountSigned(inv)), `openAmountSigned carried float dust — ${label(inv)}`);
    assert.ok(isCentExact(settledAmountSigned(inv)), `settledAmountSigned carried float dust — ${label(inv)}`);
  }
});

test("[MONEY-INVARIANTS] the sign never changes the magnitude", () => {
  // openAmountSigned exists so a creditnota SUBTRACTS in a column instead of adding. It must be the
  // same number wearing a sign — if the two ever disagreed, a row would print one figure and the
  // total beneath it would be built from another.
  for (const inv of CORPUS) {
    assert.equal(
      Math.abs(openAmountSigned(inv)),
      openAmount(inv),
      `signed and unsigned openstaand disagree — ${label(inv)}`,
    );
    const total = inv.total_inc_btw ?? 0;
    if (total < 0 && openAmount(inv) > 0) {
      assert.ok(openAmountSigned(inv) < 0, `a creditnota's balance added instead of subtracting — ${label(inv)}`);
    }
  }
});

test("[MONEY-INVARIANTS] open + settled = the invoice, exactly, for every open invoice", () => {
  // The identity the three columns on screen invite the reader to check by eye: "nog te betalen",
  // "betaald" and "totaal". If they do not add up, the reader trusts none of them — and on a
  // partly-paid invoice the money already transferred would otherwise fall out of BOTH columns
  // while sitting inside the total.
  for (const inv of CORPUS) {
    if (inv.status === "paid") continue; // a settled invoice reports 0 open by status, by design
    const sum = toCents(openAmountSigned(inv) + settledAmountSigned(inv));
    const total = toCents(inv.total_inc_btw ?? 0);
    // Over-linked rows clamp open at 0, so settled alone may exceed the total — that is the clamp
    // working, not a broken identity. Everything that is NOT over-linked must add up to the cent.
    if (paidAmount(inv) <= totalAmount(inv) + CENT_EPSILON) {
      assert.equal(sum, total, `open + betaald ≠ totaal — ${label(inv)}`);
    }
  }
});

test("[MONEY-INVARIANTS] an invoice is in exactly one of the three states", () => {
  // Fully open, part-paid, settled. Overlapping states mean one invoice counted on two screens;
  // a gap between them means an invoice that appears on none and is simply forgotten.
  for (const inv of CORPUS) {
    const settled = inv.status === "paid" || openAmount(inv) <= CENT_EPSILON;
    const partly = isPartiallyPaid(inv);
    const fullyOpen = !settled && !partly;
    const states = [settled, partly, fullyOpen].filter(Boolean).length;
    assert.equal(states, 1, `invoice is in ${states} states at once — ${label(inv)}`);
  }
});

test("[MONEY-INVARIANTS] the reminder e-mail asks for the same figure the app shows", () => {
  // openstaandOf (invoice-reminders) is a SECOND expression of the same rule, and it is the one a
  // third party reads: it goes out in a dunning e-mail. Its contract is narrower — callers hand it
  // only unpaid invoices (the cron filters status in ('sent','overdue')) — so it takes no status.
  // Wherever the two contracts overlap they must produce the identical number, or the app and the
  // e-mail disagree about what a customer owes, in writing.
  for (const inv of CORPUS) {
    if (inv.status === "paid") continue;
    assert.equal(
      openstaandOf(inv.total_inc_btw, inv.amount_paid),
      openAmount(inv),
      `the reminder would ask for a different amount than the screen shows — ${label(inv)}`,
    );
  }
});

test("[MONEY-INVARIANTS] a portfolio total equals what the eye can add up", () => {
  // The reason openAmountSigned exists. A supplier's creditnota must REDUCE what that supplier is
  // owed; summing magnitudes would make a credit note increase a debt — the opposite of what it is,
  // and the opposite of what the same screen prints on that row.
  const open = CORPUS.filter((i) => i.status !== "paid" && openAmount(i) > CENT_EPSILON);
  const byEye = open.reduce((s, i) => s + openAmountSigned(i), 0);
  const invoices = open.filter((i) => (i.total_inc_btw ?? 0) >= 0).reduce((s, i) => s + openAmount(i), 0);
  const credits = open.filter((i) => (i.total_inc_btw ?? 0) < 0).reduce((s, i) => s + openAmount(i), 0);
  assert.equal(
    toCents(byEye),
    toCents(invoices - credits),
    "the signed total is not invoices minus credit notes",
  );
});

test("[MONEY-INVARIANTS] no payment is ever declared to cover more than is open", () => {
  // The guard that decides whether one invoice absorbs a payment or the bank line stays open for
  // the rest of the money. A false negative swallows the second invoice's money inside the first —
  // which leaves a real bill open with its payment already spent.
  for (const inv of CORPUS) {
    const open = openBalanceFromAmounts(inv);
    if (open <= 0) {
      assert.equal(
        paymentExceedsOpenBalance(9_999_999, inv),
        false,
        `an invoice with nothing open claimed to absorb a payment — ${label(inv)}`,
      );
      continue;
    }
    assert.equal(paymentExceedsOpenBalance(open, inv), false, `exact settlement read as an overflow — ${label(inv)}`);
    assert.equal(
      paymentExceedsOpenBalance(open + PAYMENT_DUST + 0.01, inv),
      true,
      `money beyond the open balance was not recognised as belonging elsewhere — ${label(inv)}`,
    );
    // Dust below the threshold is a rounding tick, not a second invoice's money.
    assert.equal(
      paymentExceedsOpenBalance(open + CENT_EPSILON, inv),
      false,
      `a rounding tick was treated as another invoice's money — ${label(inv)}`,
    );
  }
});

test("[MONEY-INVARIANTS] the corpus actually exercises the branches it claims to", () => {
  // A property suite that silently stops covering a shape is worse than no suite: it still reports
  // green. [].every(cb) never calls cb — the same class of blind spot that let a render bug through
  // the whole gate set. So the corpus asserts its own coverage.
  const has = (p: (i: PartialPayInvoice) => boolean) => CORPUS.some(p);
  assert.ok(has((i) => (i.total_inc_btw ?? 0) < 0), "no creditnota in the corpus");
  assert.ok(has((i) => i.status === "paid" && paidAmount(i) === 0), "no legacy paid-without-amount row");
  assert.ok(has((i) => paidAmount(i) > totalAmount(i)), "no over-linked payment");
  assert.ok(has((i) => isPartiallyPaid(i)), "no partly-paid invoice");
  assert.ok(has((i) => (i.amount_paid ?? 0) < 0), "no corrupt negative amount_paid");
  assert.ok(CORPUS.length > 300, "the corpus shrank");
});
