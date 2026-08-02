// [MATCH-CONFIDENCE] Run: npx tsx --test src/lib/bank-match-confidence.test.ts
//
// The point of a table is that it can be checked whole. bank-matching.ts decides correctly but
// implicitly — I verified its ambiguity handling by probing it one constructed case at a time, and
// one case at a time is exactly how a matrix gets a hole in it. So this file asserts the closed
// space: all 3 × 3 × 3 combinations, every one of them named, none of them defaulted.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  AMOUNT_TOLERANCE_VALUES,
  DOCUMENT_NO_VALUES,
  RELATED_PARTY_VALUES,
  classifyAmountTolerance,
  classifyDocumentNo,
  classifyMatch,
  classifyRelatedParty,
  confidenceFor,
  applyConfidenceVeto,
  vetoesAutoBooking,
  type MatchConfidence,
} from "./bank-match-confidence";
import { autoConfirmTier, matchTransactions, DEFAULT_OPTIONS } from "./bank-matching";
import type { InvoiceForMatching } from "./bank-matching";
import type { BankTransaction } from "./bank-parser";

const tx = (over: Partial<BankTransaction> = {}): BankTransaction => ({
  date: "2026-06-10",
  amount: -500,
  currency: "EUR",
  description: "Betaling",
  counterpartName: "Jansen Bouw B.V.",
  counterpartIban: null,
  reference: null,
  transactionId: null,
  rawLine: "",
  ...over,
});

const inv = (over: Partial<InvoiceForMatching> = {}): InvoiceForMatching => ({
  id: "i1",
  invoice_number: "26100",
  total_inc_btw: 500,
  amount_paid: 0,
  invoice_date: "2026-06-08",
  due_date: "2026-07-08",
  client_name: "Jansen Bouw B.V.",
  direction: "incoming",
  status: "received",
  accountant_status: null,
  vendor_iban: null,
  ...over,
});

const IBAN = "NL91ABNA0417164300";

// ── the table itself ──────────────────────────────────────────────────────────────────────────

test("[MATCH-CONFIDENCE] every one of the 27 combinations has an answer", () => {
  // A lookup that can miss needs a default, and a default is where an unexamined case hides —
  // silently, at whatever confidence the default happens to be.
  let checked = 0;
  for (const party of RELATED_PARTY_VALUES) {
    for (const doc of DOCUMENT_NO_VALUES) {
      for (const amount of AMOUNT_TOLERANCE_VALUES) {
        const c = confidenceFor(party, doc, amount);
        assert.ok(
          c === "high" || c === "medium" || c === "low",
          `no confidence defined for ${party}|${doc}|${amount}`,
        );
        checked++;
      }
    }
  }
  assert.equal(checked, 27, "the combination space is not 3 × 3 × 3");
});

test("[MATCH-CONFIDENCE] the table matches the one Business Central publishes", () => {
  // Spot-checked against the rows in receivables-how-set-up-payment-application-rules: if someone
  // edits the table, this says which row they moved and away from what.
  const expected: Array<[string, MatchConfidence]> = [
    ["fully|yes-multiple|one", "high"], //  BC High 1
    ["fully|yes|one", "high"], //            BC High 3
    ["partially|yes-multiple|one", "high"], //BC High 5
    ["partially|yes|one", "high"], //        BC High 7
    ["fully|no|one", "high"], //             BC High 8  — account + sum, and only one bill fits
    ["no|yes-multiple|one", "high"], //      BC High 9  — the numbers carry the identity
    ["fully|no|multiple", "medium"], //      BC Medium 3
    ["no|yes|one", "medium"], //             BC Medium 6
    ["partially|no|one", "medium"], //       BC Medium 8
    ["fully|no|none", "low"], //             BC Low 1
    ["partially|no|multiple", "low"], //     BC Low 2
    ["no|no|one", "low"], //                 BC Low 4
    ["no|no|multiple", "low"], //            BC Low 5
  ];
  for (const [key, want] of expected) {
    const [p, d, a] = key.split("|");
    assert.equal(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      confidenceFor(p as any, d as any, a as any),
      want,
      `${key} should be ${want}`,
    );
  }
});

test("[MATCH-CONFIDENCE] confidence never rises when the evidence weakens", () => {
  // Monotonicity is the property a hand-typed table breaks first: a stray edit that rates a WEAKER
  // combination higher than a stronger one is invisible by inspection and obvious here.
  const rank: Record<MatchConfidence, number> = { low: 0, medium: 1, high: 2 };
  const partyRank = { no: 0, partially: 1, fully: 2 } as const;
  const docRank = { no: 0, yes: 1, "yes-multiple": 2 } as const;

  for (const doc of DOCUMENT_NO_VALUES) {
    for (const amount of AMOUNT_TOLERANCE_VALUES) {
      for (const a of RELATED_PARTY_VALUES) {
        for (const b of RELATED_PARTY_VALUES) {
          if (partyRank[a] >= partyRank[b]) continue;
          assert.ok(
            rank[confidenceFor(a, doc, amount)] <= rank[confidenceFor(b, doc, amount)],
            `weaker party ${a} outranks ${b} at ${doc}|${amount}`,
          );
        }
      }
    }
  }
  for (const party of RELATED_PARTY_VALUES) {
    for (const amount of AMOUNT_TOLERANCE_VALUES) {
      for (const a of DOCUMENT_NO_VALUES) {
        for (const b of DOCUMENT_NO_VALUES) {
          if (docRank[a] >= docRank[b]) continue;
          assert.ok(
            rank[confidenceFor(party, a, amount)] <= rank[confidenceFor(party, b, amount)],
            `weaker document evidence ${a} outranks ${b} at ${party}|${amount}`,
          );
        }
      }
    }
  }
});

// ── the Dutch mapping ─────────────────────────────────────────────────────────────────────────

test("[MATCH-CONFIDENCE] the IBAN outranks the name, because an account is not a resemblance", () => {
  assert.equal(
    classifyRelatedParty(tx({ counterpartIban: IBAN }), inv({ vendor_iban: IBAN, client_name: "Iets Anders" })),
    "fully",
    "a matching account is full identity even when the names differ",
  );
  assert.equal(classifyRelatedParty(tx(), inv()), "partially", "equal names identify the party partially");
  assert.equal(
    classifyRelatedParty(tx({ counterpartName: "Volstrekt Anders" }), inv()),
    "no",
  );
  // The trap the app was burned by: one name's token set being a SUBSET of a longer one. Both
  // reduce to {jansen} and score a perfect similarity — evidence, never identity.
  assert.equal(
    classifyRelatedParty(tx({ counterpartName: "Jansen B.V." }), inv({ client_name: "Jansen Holding B.V." })),
    "partially",
    "a shared surname is at most partial — it must never reach 'fully'",
  );
});

test("[MATCH-CONFIDENCE] a verzamelbetaling is its own document category", () => {
  const single = tx({ reference: "26100" });
  assert.equal(classifyDocumentNo(single, inv()), "yes");
  // The parser stores several numbers exactly as "num1, num2" — comma-separated.
  const bundle = tx({ reference: "26100, 26101, 26102" });
  assert.equal(classifyDocumentNo(bundle, inv()), "yes-multiple", "several numbers, one transfer");
  assert.equal(classifyDocumentNo(tx({ reference: "99999" }), inv()), "no");
  // Too short to be identity — the >4-character rule both products share.
  assert.equal(classifyDocumentNo(tx({ reference: "26" }), inv({ invoice_number: "26" })), "no");
});

test("[MATCH-CONFIDENCE] the amount column counts rivals, which no score can express", () => {
  const payment = tx({ amount: -500 });
  assert.equal(classifyAmountTolerance(payment, [inv()]), "one");
  assert.equal(
    classifyAmountTolerance(payment, [inv({ id: "a" }), inv({ id: "b" })]),
    "multiple",
    "two open invoices of this exact amount — the fact worth reporting",
  );
  assert.equal(classifyAmountTolerance(payment, [inv({ total_inc_btw: 999 })]), "none");
  // [PARTIAL-PAY] the restant, not the gross total — the second instalment matches what is left.
  assert.equal(
    classifyAmountTolerance(tx({ amount: -600 }), [inv({ total_inc_btw: 1000, amount_paid: 400 })]),
    "one",
    "an instalment matches the remaining balance",
  );
});

// ── the contract with the existing matcher ────────────────────────────────────────────────────

test("[MATCH-CONFIDENCE] the ambiguous rent case is named, not merely survived", () => {
  // Two open invoices, same supplier, both exactly €500, nothing printed. bank-matching already
  // refuses to book it: both land on the same confidence cap so the margin rule cannot pick one.
  // That refusal is correct and invisible. Here it acquires a name — and a sentence the owner can
  // act on, which "no clear winner" is not.
  const payment = tx();
  const rivals = [inv({ id: "a", invoice_number: "26100" }), inv({ id: "b", invoice_number: "26050" })];

  const c = classifyMatch({ tx: payment, invoice: rivals[0], eligible: rivals });
  assert.equal(c.amountTolerance, "multiple");
  assert.equal(c.relatedParty, "partially");
  assert.equal(c.documentNo, "no");
  assert.equal(c.confidence, "low", "Business Central Low 2 — and so is this");
  assert.equal(c.reviewRequired, true);
  assert.match(c.reason, /méérdere openstaande facturen/);

  // …and the existing matcher independently refuses it. Both must hold: the classification is a
  // second opinion, not a replacement.
  const m = matchTransactions([payment], rivals, DEFAULT_OPTIONS).matches[0];
  assert.equal(autoConfirmTier(m), null, "the matcher's own guards still refuse this pairing");
});

test("[MATCH-CONFIDENCE] the layer can only ever refuse — it never books anything", () => {
  // The one-directional contract. Business Central rates a printed-numbers bundle its HIGHEST
  // confidence; bank-matching refuses to auto-book any multi-reference payment, because allocating
  // a sum across several bills is the owner's decision. High must not overturn that.
  const bundle = tx({ reference: "26100, 26101", amount: -1000 });
  const invoices = [
    inv({ id: "a", invoice_number: "26100" }),
    inv({ id: "b", invoice_number: "26101" }),
  ];
  const c = classifyMatch({ tx: bundle, invoice: invoices[0], eligible: invoices });
  assert.equal(c.documentNo, "yes-multiple");
  // Worth pinning, because it is not the obvious answer: the amount column counts INDIVIDUAL
  // entries within tolerance, and a €1000 transfer settling two €500 bills matches NEITHER of them
  // on its own. So the verzamelbetaling lands on 'none', and Business Central rates that Medium
  // (Medium 4) rather than High — the printed numbers carry the identity, the sum does not.
  assert.equal(c.amountTolerance, "none", "a bundle matches no single invoice's amount");
  assert.equal(c.confidence, "medium");
  assert.equal(vetoesAutoBooking(c), false, "and nothing short of Low vetoes anything");

  const m = matchTransactions([bundle], invoices, DEFAULT_OPTIONS).matches[0];
  assert.equal(
    autoConfirmTier(m),
    null,
    "…and the matcher still refuses to book it, which is what one-directional means",
  );
});

test("[MATCH-CONFIDENCE] only Low refuses, and Low is exactly the weakest evidence", () => {
  for (const party of RELATED_PARTY_VALUES) {
    for (const doc of DOCUMENT_NO_VALUES) {
      for (const amount of AMOUNT_TOLERANCE_VALUES) {
        const c = confidenceFor(party, doc, amount);
        const veto = vetoesAutoBooking({
          relatedParty: party, documentNo: doc, amountTolerance: amount,
          confidence: c, reviewRequired: c !== "high", reason: "",
        });
        assert.equal(veto, c === "low", `veto disagrees with confidence at ${party}|${doc}|${amount}`);
        // Nothing that names this invoice AND matches exactly one amount may ever be refused.
        if (doc !== "no" && amount === "one") {
          assert.equal(veto, false, `${party}|${doc}|one was refused despite naming the invoice`);
        }
      }
    }
  }
});

test("[MATCH-CONFIDENCE] the veto is actually joined to the booking path", () => {
  // Until applyConfidenceVeto was extracted, the code joining this classification to the booking
  // decision lived inside a Supabase-shaped call, so no test could reach it: mutating the veto to
  // refuse EVERYTHING broke only this file's own unit tests and left the whole rest of the suite
  // green. A guard nobody can exercise is indistinguishable from a guard nobody wired.
  const payment = tx();
  const invoice = inv();
  const m = matchTransactions([payment], [invoice], DEFAULT_OPTIONS).matches[0];
  const byId = new Map([[invoice.id, invoice]]);

  // A pairing the classification is happy with survives untouched, tier and all.
  const kept = applyConfidenceVeto({
    matches: [{ m, tier: "certain" }],
    invoiceById: byId,
    eligibleFor: () => [invoice],
  });
  assert.equal(kept[0].tier, "certain", "a Medium/High pairing must not be refused");

  // The Low case has to be built by hand, and the reason is itself the finding: `best` is only
  // populated on an 'auto' outcome, and this matcher never reaches 'auto' on a Low pairing — its
  // identity caps and margin rule refuse first. So the veto is unreachable through the front door
  // TODAY, which is precisely the agreement claimed in the module header. It is wired anyway, and
  // exercised here directly, because "unreachable today" is a statement about today's guards: the
  // day one of them is relaxed, this is what stands between a Low pairing and someone's quarter.
  const stranger = tx({ counterpartName: "Volstrekt Onbekend", amount: -12345.67 });
  const lowPairing = {
    transaction: stranger,
    outcome: "auto" as const,
    best: {
      invoiceId: invoice.id,
      invoiceNumber: invoice.invoice_number,
      amount: invoice.total_inc_btw,
      invoiceDate: invoice.invoice_date,
      confidence: 0.9,
      signals: ["amount" as const],
      reason: "synthetic",
    },
    candidates: [],
  };
  const reasons: string[] = [];
  const vetoed = applyConfidenceVeto({
    matches: [{ m: lowPairing, tier: "amount_only" }],
    invoiceById: byId,
    eligibleFor: () => [invoice],
    onVeto: ({ classification }) => reasons.push(classification.reason),
  });
  assert.equal(vetoed[0].tier, null, "a Low pairing must lose its tier");
  assert.equal(reasons.length, 1, "and the refusal must be reportable, not silent");
  assert.match(reasons[0], /tegenpartij onbekend/);

  // It never invents a tier, and never drops an entry: the caller's own filter owns removal.
  const untiered = applyConfidenceVeto({
    matches: [{ m, tier: null }],
    invoiceById: byId,
    eligibleFor: () => [invoice],
  });
  assert.equal(untiered.length, 1, "entries are never dropped");
  assert.equal(untiered[0].tier, null, "a null tier is never promoted");
});

test("[MATCH-CONFIDENCE] the strongest pairing this app can see is High and needs no review", () => {
  // Same account, invoice number printed, one bill of that amount. If this is not High, nothing is.
  const payment = tx({ counterpartIban: IBAN, reference: "26100" });
  const invoice = inv({ vendor_iban: IBAN });
  const c = classifyMatch({ tx: payment, invoice, eligible: [invoice] });
  assert.equal(c.relatedParty, "fully");
  assert.equal(c.documentNo, "yes");
  assert.equal(c.amountTolerance, "one");
  assert.equal(c.confidence, "high");
  assert.equal(c.reviewRequired, false);
});
