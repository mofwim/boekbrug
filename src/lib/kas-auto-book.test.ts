// [KAS-AUTO-BOOK] Pure node test — run: npx tsx --test src/lib/kas-auto-book.test.ts
//
// The rule being replaced was "under kasstelsel, an amount-only match never books". Its premise is
// right and is kept; its conclusion was wider than the premise, and the width was costing a
// kasstelsel owner every amount-only booking they will ever have.
//
// So what is held here is the narrower line and both of its edges: automation up to the point where
// a mistake would leave the app, and a hard stop at that point — including when we cannot TELL
// where that point is.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  decideKasAutoBook,
  filingStateOf,
  filingKey,
  quarterStartOf,
  type KasAutoBookInput,
} from "./kas-auto-book";

const kas = (o: Partial<KasAutoBookInput> = {}): KasAutoBookInput => ({
  tier: "amount_only",
  profileScheme: "kas",
  schemeSince: null,
  paymentDate: "2026-05-20", // Q2
  filingState: "open",
  ...o,
});

test("[KAS-AUTO-BOOK] an open quarter books; the cost of being wrong is one tap", () => {
  assert.deepEqual(decideKasAutoBook(kas()), { book: true });
});

test("[KAS-AUTO-BOOK] a filed quarter never does — that mistake leaves the app", () => {
  // Once declared, the correction is a suppletie to the Belastingdienst. No automation may put the
  // owner there; the match stays a one-tap on /bank exactly as before.
  assert.deepEqual(
    decideKasAutoBook(kas({ filingState: "filed" })),
    { book: false, refusal: "filed_quarter" },
  );
});

test("[KAS-AUTO-BOOK] and neither does a quarter we could not read", () => {
  // [NO-SILENT-EMPTY] A failed btw_filings read is not "nothing is filed". Treating it as open is
  // exactly the shape where acting destroys something: the one state in which the guard is blind is
  // the one state in which it must refuse.
  assert.deepEqual(
    decideKasAutoBook(kas({ filingState: "unknown" })),
    { book: false, refusal: "unknown_filing" },
  );
});

test("[KAS-AUTO-BOOK] a payment with no date has no quarter to reason about", () => {
  assert.deepEqual(
    decideKasAutoBook(kas({ paymentDate: null })),
    { book: false, refusal: "no_payment_date" },
  );
  // Under factuur the invoice date carries the timing, so a dateless line is not this function's
  // problem and it does not invent one.
  assert.deepEqual(decideKasAutoBook(kas({ profileScheme: "factuur", paymentDate: null })), { book: true });
});

test("[KAS-AUTO-BOOK] 'certain' was never gated on the scheme and still is not", () => {
  // A printed invoice number or the supplier's own IBAN is document identity. Blocking it would be
  // a REGRESSION against what shipped, on the tier that carries the most evidence.
  for (const filingState of ["open", "filed", "unknown"] as const) {
    assert.deepEqual(
      decideKasAutoBook(kas({ tier: "certain", filingState })),
      { book: true },
      `certain must book regardless of filing state (${filingState})`,
    );
  }
});

test("[KAS-AUTO-BOOK] factuurstelsel is untouched in every direction", () => {
  for (const filingState of ["open", "filed", "unknown"] as const) {
    assert.deepEqual(
      decideKasAutoBook(kas({ profileScheme: "factuur", filingState })),
      { book: true },
      "under factuur the pay date is not VAT timing — this gate has nothing to say",
    );
  }
});

test("[KAS-AUTO-BOOK] the scheme is resolved FOR THE QUARTER, not globally", () => {
  // An owner who elected kas from 1 July 2026 is on factuurstelsel for Q1 and Q2. Under factuur the
  // payment date is not VAT timing, so those quarters were never the concern the blanket rule was
  // built for — blocking them was pure loss, filed or not.
  const since = "2026-07-01";
  assert.deepEqual(
    decideKasAutoBook(kas({ schemeSince: since, paymentDate: "2026-05-20", filingState: "filed" })),
    { book: true },
    "a filed Q2 predates the kas election — it is a factuur quarter and books",
  );
  // From the election onward the kas rule applies in full.
  assert.deepEqual(
    decideKasAutoBook(kas({ schemeSince: since, paymentDate: "2026-08-20", filingState: "filed" })),
    { book: false, refusal: "filed_quarter" },
  );
  assert.deepEqual(
    decideKasAutoBook(kas({ schemeSince: since, paymentDate: "2026-08-20", filingState: "open" })),
    { book: true },
  );
});

test("[KAS-AUTO-BOOK] filingStateOf never collapses 'nothing filed' into 'could not read'", () => {
  const filed = new Set([filingKey(2026, 1)]);

  assert.equal(filingStateOf("2026-Q1", filed, true), "filed");
  assert.equal(filingStateOf("2026-Q2", filed, true), "open");
  // The same empty answer, from a read that failed, must NOT read as open.
  assert.equal(filingStateOf("2026-Q2", new Set(), false), "unknown");
  assert.equal(filingStateOf("2026-Q2", new Set(), true), "open");
  // No quarter key at all (undated line) is not knowledge either.
  assert.equal(filingStateOf(null, filed, true), "unknown");
});

test("[KAS-AUTO-BOOK] quarterStartOf produces what resolveSchemeForQuarter compares against", () => {
  assert.equal(quarterStartOf("2026-Q1"), "2026-01-01");
  assert.equal(quarterStartOf("2026-Q2"), "2026-04-01");
  assert.equal(quarterStartOf("2026-Q3"), "2026-07-01");
  assert.equal(quarterStartOf("2026-Q4"), "2026-10-01");
});

test("[KAS-AUTO-BOOK] the boundary date lands in the quarter the aangifte uses", () => {
  // 1 July is Q3's first day, and under an election of the same date it is already kas. An
  // off-by-one here would book into the first quarter of the new scheme as if it were the old one.
  assert.deepEqual(
    decideKasAutoBook(kas({ schemeSince: "2026-07-01", paymentDate: "2026-07-01", filingState: "filed" })),
    { book: false, refusal: "filed_quarter" },
  );
  assert.deepEqual(
    decideKasAutoBook(kas({ schemeSince: "2026-07-01", paymentDate: "2026-06-30", filingState: "filed" })),
    { book: true },
  );
});
