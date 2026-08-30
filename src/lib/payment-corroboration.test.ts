// src/lib/payment-corroboration.test.ts
// [BETAALD-MAAR-WAAR] Pure node test — run: npx tsx --test src/lib/payment-corroboration.test.ts

import test from "node:test";
import assert from "node:assert/strict";

import {
  claimVerdict,
  corroboratePayments,
  GAP_DUST_CENTS,
  MAX_INVOICE_LABELS,
  type PaymentClaim,
  type StatementCoverage,
} from "./payment-corroboration";

const COVER: StatementCoverage = { from: "2026-01-01", to: "2026-08-21" };

function claim(over: Partial<PaymentClaim>): PaymentClaim {
  return {
    invoiceId: over.invoiceId ?? "inv-1",
    invoiceNumber: over.invoiceNumber ?? "2034488",
    supplierName: over.supplierName ?? "CAN Vleesgroothandel B.V.",
    supplierKey: over.supplierKey === undefined ? "can vleesgroothandel" : over.supplierKey,
    amountApplied: over.amountApplied ?? 1165.73,
    paidOn: over.paidOn === undefined ? "2026-08-17" : over.paidOn,
    method: over.method === undefined ? "bank" : over.method,
    transactionId: over.transactionId === undefined ? null : over.transactionId,
  };
}

// ─── The case this module was written from ────────────────────────────────────────────────────

test("[BETAALD-MAAR-WAAR] a payment dated past the statement's edge is NOT CHECKABLE, not wrong", () => {
  // Invoice 2034488, marked paid 29 August. The last bank line the app holds is 21 August. The
  // supplier's own ledger says the invoice is open and overdue.
  //
  // The app cannot know who is right — and that is exactly the answer it must give. Calling this
  // a discrepancy would accuse an owner who may well have paid it yesterday; calling it settled is
  // what the app did for eight days while a wholesaler was dunning him.
  const v = claimVerdict(claim({ paidOn: "2026-08-29" }), COVER);
  assert.equal(v.kind, "niet_te_controleren");
  assert.equal(v.kind === "niet_te_controleren" && v.reason, "na_dekking");
  assert.equal(v.kind === "niet_te_controleren" && v.coverageTo, "2026-08-21",
    "the sentence needs the edge itself — 'your statement stops on 21 August' is actionable, " +
    "'we cannot check this' is not");
});

test("[BETAALD-MAAR-WAAR] the three reasons stay three reasons", () => {
  // Each is a different thing for the owner to do, so collapsing them makes all three useless.
  assert.equal(
    (claimVerdict(claim({ paidOn: null }), COVER) as { reason: string }).reason, "geen_datum");
  assert.equal(
    (claimVerdict(claim({}), { from: null, to: null }) as { reason: string }).reason, "geen_afschrift");
  // Both directions are uncheckable and only one is news. "Paid after your newest statement" is
  // the live case; "paid before your oldest" is history that may never become checkable, and
  // putting the two on one list buries the one that matters.
  assert.equal(
    (claimVerdict(claim({ paidOn: "2025-11-30" }), COVER) as { reason: string }).reason, "voor_dekking");
  assert.equal(
    (claimVerdict(claim({ paidOn: "2026-08-29" }), COVER) as { coverageTo: string }).coverageTo, "2026-08-21",
    "after → the edge it passed is the newest statement's end");
  assert.equal(
    (claimVerdict(claim({ paidOn: "2025-11-30" }), COVER) as { coverageTo: string }).coverageTo, "2026-01-01",
    "before → the edge it passed is the oldest statement's start");
});

test("[BETAALD-MAAR-WAAR] a bank line settles the question, and cash is not a gap", () => {
  assert.equal(claimVerdict(claim({ transactionId: "tx-1" }), COVER).kind, "bank");
  // Even one dated outside coverage: the proof is the link, not the date.
  assert.equal(claimVerdict(claim({ transactionId: "tx-1", paidOn: "2026-12-31" }), COVER).kind, "bank");
  // The drawer is outside the bank's reach BY NATURE. Reporting it as unverifiable would put a
  // permanent warning on every cash purchase a shop makes.
  assert.equal(claimVerdict(claim({ method: "kas" }), COVER).kind, "kas");
  assert.equal(claimVerdict(claim({ method: "kas", paidOn: "2026-12-31" }), COVER).kind, "kas");
});

// ─── Why the comparison is per supplier ───────────────────────────────────────────────────────

test("[BETAALD-MAAR-WAAR] one transfer paying five invoices is not five discrepancies", () => {
  // This is the whole reason the comparison is not per invoice. A shopkeeper pays a wholesaler
  // once a week for everything delivered that week. Matching amounts one to one would report a
  // gap on every single invoice, on an administration where nothing is wrong.
  const r = corroboratePayments({
    claims: [
      claim({ invoiceId: "a", invoiceNumber: "263463", amountApplied: 753.93, supplierKey: "bal", paidOn: "2026-08-05" }),
      claim({ invoiceId: "b", invoiceNumber: "263414", amountApplied: 928.87, supplierKey: "bal", paidOn: "2026-08-05" }),
      claim({ invoiceId: "c", invoiceNumber: "263431", amountApplied: 1147.06, supplierKey: "bal", paidOn: "2026-08-05" }),
    ],
    debits: [{ supplierKey: "bal", date: "2026-08-05", amount: 2829.86 }],
    coverage: COVER,
  });
  assert.equal(r.short.length, 0, "one transfer covers all three");
  assert.equal(r.covered.length, 1);
  assert.equal(r.covered[0].claimed, 2829.86);
  assert.equal(r.covered[0].paidByBank, 2829.86);
  assert.equal(r.covered[0].claimCount, 3);
});

test("[BETAALD-MAAR-WAAR] books claiming more than left the account is reported, worst first", () => {
  const r = corroboratePayments({
    claims: [
      claim({ invoiceId: "a", supplierKey: "bal", amountApplied: 2000, paidOn: "2026-08-05" }),
      claim({ invoiceId: "b", supplierKey: "enka", amountApplied: 1500, paidOn: "2026-08-05" }),
    ],
    debits: [
      { supplierKey: "bal", date: "2026-08-05", amount: 1200 },
      { supplierKey: "enka", date: "2026-08-05", amount: 900 },
    ],
    coverage: COVER,
  });
  assert.equal(r.short.length, 2);
  assert.equal(r.short[0].supplierKey, "bal", "the biggest gap leads");
  assert.equal(r.short[0].gap, 800);
  assert.equal(r.short[1].gap, 600);
});

test("[BETAALD-MAAR-WAAR] paying a supplier MORE than the books account for is never a discrepancy", () => {
  // A payment on account, an invoice not yet imported, a deposit. Reporting this direction would
  // fire on nearly every supplier of a shop that pays weekly, and an owner who is warned about
  // everything is warned about nothing.
  const r = corroboratePayments({
    claims: [claim({ supplierKey: "bal", amountApplied: 500, paidOn: "2026-08-05" })],
    debits: [{ supplierKey: "bal", date: "2026-08-05", amount: 5000 }],
    coverage: COVER,
  });
  assert.equal(r.short.length, 0);
  assert.equal(r.covered[0].gap, 0, "gap is never negative");
});

test("[BETAALD-MAAR-WAAR] a bank-proven payment spends the same euros, so it counts on the claimed side", () => {
  // The question is not "is this tick backed" — it is "does everything we say we paid this
  // supplier fit inside what actually left". A bank-linked settlement consumes the debit that
  // would otherwise appear to corroborate the hand tick beside it.
  const r = corroboratePayments({
    claims: [
      claim({ invoiceId: "a", supplierKey: "can", amountApplied: 1000, transactionId: "tx-1", paidOn: "2026-08-05" }),
      claim({ invoiceId: "b", supplierKey: "can", amountApplied: 1000, paidOn: "2026-08-06" }),
    ],
    debits: [{ supplierKey: "can", date: "2026-08-05", amount: 1000 }],
    coverage: COVER,
  });
  assert.equal(r.short.length, 1, "€2.000 booked against €1.000 that left");
  assert.equal(r.short[0].gap, 1000);
  assert.equal(r.short[0].claimCount, 2);
  assert.equal(r.short[0].handClaimCount, 1, "…of which one stands on a tick alone");
});

// ─── Boundaries and refusals ──────────────────────────────────────────────────────────────────

test("[BETAALD-MAAR-WAAR] cents of noise are not a finding", () => {
  const dust = corroboratePayments({
    claims: [claim({ supplierKey: "bal", amountApplied: 1000.99, paidOn: "2026-08-05" })],
    debits: [{ supplierKey: "bal", date: "2026-08-05", amount: 1000 }],
    coverage: COVER,
  });
  assert.equal(dust.short.length, 0, `${GAP_DUST_CENTS} cents or less is statiegeld and rounding`);

  const real = corroboratePayments({
    claims: [claim({ supplierKey: "bal", amountApplied: 1001.01, paidOn: "2026-08-05" })],
    debits: [{ supplierKey: "bal", date: "2026-08-05", amount: 1000 }],
    coverage: COVER,
  });
  assert.equal(real.short.length, 1, "one cent past the dust boundary IS a finding");
});

test("[BETAALD-MAAR-WAAR] a debit outside the covered period may not corroborate anything", () => {
  // The whole comparison rests on both sides describing the same period. A debit the statement
  // does not actually cover cannot be counted, or the app would corroborate a claim with money it
  // only believes it saw.
  const r = corroboratePayments({
    claims: [claim({ supplierKey: "bal", amountApplied: 1000, paidOn: "2026-08-05" })],
    debits: [{ supplierKey: "bal", date: "2026-09-05", amount: 1000 }],
    coverage: COVER,
  });
  assert.equal(r.short.length, 1);
  assert.equal(r.short[0].paidByBank, 0);
});

test("[BETAALD-MAAR-WAAR] a claim without a supplier key is REPORTED, never dropped", () => {
  // [NO-SILENT-EMPTY]: it is in neither list, so without this an owner reading "all your suppliers
  // check out" would be reading a sentence about a smaller set than they think.
  const r = corroboratePayments({
    claims: [
      claim({ invoiceId: "a", supplierKey: null, amountApplied: 900, paidOn: "2026-08-05" }),
      claim({ invoiceId: "b", supplierKey: "bal", amountApplied: 100, paidOn: "2026-08-05" }),
    ],
    debits: [{ supplierKey: "bal", date: "2026-08-05", amount: 100 }],
    coverage: COVER,
  });
  assert.equal(r.unkeyed.length, 1);
  assert.equal(r.unkeyed[0].invoiceId, "a");
  assert.equal(r.short.length, 0);
  assert.equal(r.covered.length, 1, "the keyed one is still judged");
});

test("[BETAALD-MAAR-WAAR] with no statement at all, nothing is judged and everything is named", () => {
  // Not "everything checks out". An empty `short` list on an account with no bank data would be
  // the most dangerous sentence this module could produce.
  const r = corroboratePayments({
    claims: [claim({ supplierKey: "bal", amountApplied: 1000 })],
    debits: [],
    coverage: { from: null, to: null },
  });
  assert.equal(r.short.length, 0);
  assert.equal(r.covered.length, 0);
  assert.equal(r.uncheckable.length, 1);
  assert.equal((r.uncheckable[0].verdict as { reason: string }).reason, "geen_afschrift");
});

test("[BETAALD-MAAR-WAAR] a supplier paid but never booked is not a gap either", () => {
  // Money left for someone with no invoice behind it. That is the REVERSE of an overstated book,
  // and it belongs to the categorisation screen, not here.
  const r = corroboratePayments({
    claims: [],
    debits: [{ supplierKey: "onbekend", date: "2026-08-05", amount: 4000 }],
    coverage: COVER,
  });
  assert.equal(r.short.length, 0);
  assert.equal(r.covered.length, 0, "no claim means nothing to corroborate");
});

test("[BETAALD-MAAR-WAAR] the invoice labels are bounded and the count is not", () => {
  const many = Array.from({ length: 20 }, (_, i) =>
    claim({ invoiceId: `i${i}`, invoiceNumber: `F-${i}`, supplierKey: "bal", amountApplied: 100, paidOn: "2026-08-05" }));
  const r = corroboratePayments({ claims: many, debits: [], coverage: COVER });
  assert.equal(r.short[0].claimCount, 20, "the count stays exact");
  assert.equal(r.short[0].invoiceNumbers.length, MAX_INVOICE_LABELS, "the list stays readable");
  assert.equal(r.short[0].claimed, 2000);
});

test("[BETAALD-MAAR-WAAR] the coverage travels with the answer", () => {
  // A caller that restated the window in its own words would eventually restate it wrong, and the
  // whole finding is only meaningful against the period it was measured over.
  const r = corroboratePayments({ claims: [], debits: [], coverage: COVER });
  assert.deepEqual(r.coverage, COVER);
});
