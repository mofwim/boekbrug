// [AUTO-INCASSO] Pure node test — run: npx tsx --test src/lib/auto-incasso-gates.test.ts
//
// WHY THESE ARE SOURCE-LEVEL GATES
//
// This feature books payments nobody watched happen. What makes that acceptable is not the
// decision function — that one has its own tests and its own negative controls — but four pieces
// of wiring around it, every one of which fails SILENTLY when it breaks:
//
//   · the booking goes through apply_manual_payment. A direct `.update({ status: 'paid' })` is one
//     line shorter, reads perfectly, and breaks the invariant this whole app is built on
//     (invoices.amount_paid = SUM(bank_tx_invoices.amount_applied)). Nothing on any screen turns
//     red; the number simply stops adding up, months later, in an accountant's export;
//   · it books on the VERVALDATUM. `amsterdamToday()` is the obvious thing to reach for and is
//     wrong in one specific way: under the kasstelsel the payment date picks the BTW-kwartaal, so
//     a collection that ran on 30 June booked "today" lands in Q3 instead of Q2;
//   · the QR pay sheet is closed on an incasso row. That button pre-fills the supplier's IBAN and
//     amount in the owner's banking app — on an already-collected invoice it is a second payment,
//     one tap away, with no warning anywhere. It sits in the EXPANDED card, which a static render
//     never opens, so the render gate cannot see it;
//   · the incasso pass runs from the hourly cron. Without that, the switch works exactly once (in
//     the request that flips it) and every invoice after that stays open forever — a feature that
//     appears to work on the day you turn it on and quietly does nothing from then on.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/** Source with comments stripped — these files explain the very mistakes the gates look for. */
function code(path: string): string {
  return readFileSync(path, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1 ");
}

const SETTLE = "src/lib/incasso-settle.ts";
const MANAGE = "src/app/dashboard/incoming/manage/IncomingManageClient.tsx";
const CRON = "src/app/api/cron/reconcile/route.ts";

test("[AUTO-INCASSO] the booking goes through the same door as every other payment", () => {
  const src = code(SETTLE);
  assert.match(
    src, /rpc\('apply_manual_payment'/,
    "the settle pass no longer calls apply_manual_payment — a direct status write leaves " +
      "amount_paid and bank_tx_invoices disagreeing, which is the one invariant this app has",
  );
  assert.doesNotMatch(
    src, /\.update\(\{[^}]*status:\s*['"]paid['"]/,
    "an invoice is being flipped to 'paid' directly, bypassing the RPC's row lock, its 'verwerkt' " +
      "re-check and the bank_tx_invoices row that keeps amount_paid true",
  );
});

test("[AUTO-INCASSO] it books on the day the money left, not the day it noticed", () => {
  const src = code(SETTLE);
  assert.match(
    src, /p_pay_date:\s*decision\.paymentDate/,
    "the payment date must come from the decision (the vervaldatum). Under the kasstelsel that " +
      "date decides which aangifte the voorbelasting lands in — 'today' is not a fact about the payment",
  );
  assert.doesNotMatch(
    src, /p_pay_date:\s*(today|amsterdamToday)/,
    "booking on today's date moves a collection that ran in the previous quarter into this one",
  );
  assert.match(
    src, /p_method:\s*['"]bank['"]/,
    "payment_method must stay 'bank' — the money did leave the bank account, and inventing a " +
      "third value would need every reader of that column to learn it",
  );
});

test("[AUTO-INCASSO] an assumed payment is still recorded as an assumption", () => {
  // Because payment_method is honestly 'bank', nothing else in the row separates a payment the app
  // watched arrive from one it inferred. Without the marker a storno — a collection reversed for
  // want of funds — leaves an invoice that says paid, with nothing anywhere saying who decided so.
  const src = code(SETTLE);
  assert.match(src, /withIncassoMark/, "the field_confidence marker write is gone");
  assert.match(
    src, /reportHandledFailure/,
    "a marker that failed to save must reach someone: the payment stands, and it now looks observed",
  );
});

test("[AUTO-INCASSO] neither pay button survives on an invoice the bank collects", () => {
  const src = code(MANAGE);
  // Both CTAs, and the second one is the expensive one: the QR sheet pre-fills the supplier's
  // IBAN and amount in the owner's banking app. The render gate can only see the first, because
  // the other lives in the expanded card and a static render never opens one.
  const guarded = [...src.matchAll(/inv\.status === 'received' && !incasso &&/g)];
  assert.equal(
    guarded.length, 2,
    `expected BOTH pay actions ("Heb je betaald?" and the QR "Betalen") to be closed on an incasso ` +
      `row, found ${guarded.length}. An unguarded one is a second payment of money that already left.`,
  );
});

test("[AUTO-INCASSO] the hourly reconcile keeps booking after the day you switch it on", () => {
  const src = code(CRON);
  // The CALL, not the import. An import that nothing calls is exactly how this breaks — the line
  // stays at the top of the file, tsc is happy, and the pass simply never runs.
  assert.match(
    src, /settleIncassoForUser\([^)]*\buid\b/,
    "the cron no longer runs the incasso pass for its users — the switch would then work once, in " +
      "the request that flips it, and every invoice after that would stay open forever",
  );
  // An owner whose bills are all collected automatically has no pending bank lines, no cash-paid
  // invoices and no drawer entries — none of the three sets the cron discovers users from. Without
  // its own discovery query they are never visited at all.
  assert.match(
    src, /auto_incasso/,
    "the cron does not discover incasso owners; an owner with nothing but incasso invoices is " +
      "reached by none of its other three user queries",
  );
  assert.match(
    src, /createNotification\(\{[\s\S]{0,400}?automatisch afgeschreven/,
    "the owner is not told. This is the one pass in the reconcile that books a payment nobody " +
      "observed, so it may never be the quiet one",
  );
});
