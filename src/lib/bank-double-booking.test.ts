// [DUBBEL-GEDEKT] Pure node test — run: npx tsx --test src/lib/bank-double-booking.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  paidInvoiceExplainsLine,
  buildDoubleBookingGuard,
  isMollieCredit,
  type PaidExplainerRow,
  type GuardLine,
} from "./bank-double-booking";

const paid = (over: Partial<PaidExplainerRow> = {}): PaidExplainerRow => ({
  direction: "incoming", total_inc_btw: 250, amount_paid: 250,
  payment_date: "2026-07-10", marked_paid_at: null, invoice_date: "2026-07-01",
  ...over,
});

test("[DUBBEL-GEDEKT] a hand-paid bill explains its own bank debit", () => {
  // The Sligro case from the audit: invoice marked paid by hand (or incasso-settled with no bank
  // line), the debit arrives days later, the matcher excludes paid invoices, and a confident
  // memory hit used to code it 'kosten' — the same cost twice. The guard sees it.
  assert.equal(paidInvoiceExplainsLine([paid()], -250, "2026-07-12"), true);
  // Direction is load-bearing: a CREDIT of the same magnitude is different money.
  assert.equal(paidInvoiceExplainsLine([paid()], 250, "2026-07-12"), false);
  // An outgoing sale explains a credit, not a debit.
  assert.equal(paidInvoiceExplainsLine([paid({ direction: "outgoing" })], 250, "2026-07-12"), true);
});

test("[DUBBEL-GEDEKT] the two-week window bounds the claim", () => {
  assert.equal(paidInvoiceExplainsLine([paid()], -250, "2026-07-24"), true, "day 14 still inside");
  assert.equal(paidInvoiceExplainsLine([paid()], -250, "2026-08-20"), false, "six weeks later is a different €250");
  // Settled date falls back through marked_paid_at → invoice_date.
  assert.equal(paidInvoiceExplainsLine([paid({ payment_date: null, marked_paid_at: "2026-07-10" })], -250, "2026-07-12"), true);
});

test("[DUBBEL-GEDEKT] a cent of difference is a different amount", () => {
  assert.equal(paidInvoiceExplainsLine([paid()], -250.01, "2026-07-12"), true, "one cent inside tolerance");
  assert.equal(paidInvoiceExplainsLine([paid()], -250.5, "2026-07-12"), false);
});

test("[DUBBEL-GEDEKT] undatable errs toward holding the line, never toward double-booking", () => {
  assert.equal(paidInvoiceExplainsLine([paid({ payment_date: null, marked_paid_at: null, invoice_date: null })], -250, "2026-07-12"), true);
  assert.equal(paidInvoiceExplainsLine([paid()], -250, null), true);
  assert.equal(paidInvoiceExplainsLine([], -250, "2026-07-12"), false, "no paid invoices, nothing to explain");
});

// ── The composed guard: what the three writers actually call ────────────────────────────────────

const line = (over: Partial<GuardLine> = {}): GuardLine => ({
  amount: -250, counterpart_name: "SLIGRO", description: "factuur", date: "2026-07-12", ...over,
});

test("[DUBBEL-GEDEKT] the guard withholds only the categories that carry money", () => {
  const g = buildDoubleBookingGuard({ paidRows: [paid()], hasRecentMolliePayout: false });
  assert.equal(g.hold("kosten", line()), "paid-invoice");
  assert.equal(g.hold("omzet", line({ amount: 250, date: "2026-07-12" })), null,
    "a credit is not explained by an incoming invoice — direction still decides");
  // transfer/prive/tax carry no P&L amount, so they cannot double-book one. Withholding them
  // would leave a private withdrawal uncoded for no gain.
  assert.equal(g.hold("transfer", line()), null);
  assert.equal(g.hold("prive", line()), null);
  assert.equal(g.hold("tax", line()), null);
});

test("[DUBBEL-GEDEKT] with nothing paid, nothing is withheld", () => {
  const g = buildDoubleBookingGuard({ paidRows: [], hasRecentMolliePayout: false });
  assert.equal(g.hold("kosten", line()), null, "the guard must not become a brake on ordinary coding");
});

test("[MOLLIE-UITBETALING] a payout credit is held whatever category was suggested", () => {
  const mollie = line({ amount: 412.55, counterpart_name: "Mollie B.V.", description: "payout" });
  const on = buildDoubleBookingGuard({ paidRows: [], hasRecentMolliePayout: true });
  const off = buildDoubleBookingGuard({ paidRows: [], hasRecentMolliePayout: false });
  // The fee shifts every amount, so the cent-exact rule above can never catch this one.
  assert.equal(on.hold("omzet", mollie), "mollie-payout");
  assert.equal(on.hold("transfer", mollie), "mollie-payout", "not limited to P&L: the owner names this money");
  assert.equal(off.hold("omzet", mollie), null, "an owner without recent Mollie links keeps today's behaviour");
  // A DEBIT to Mollie (the fee invoice) is an ordinary cost, not a payout.
  assert.equal(on.hold("kosten", line({ amount: -12.10, counterpart_name: "Mollie B.V." })), null);
});

test("[MOLLIE-UITBETALING] the name test is Mollie-specific, not every PSP", () => {
  assert.equal(isMollieCredit({ amount: 100, counterpart_name: "MOLLIE B.V.", description: "" }), true);
  assert.equal(isMollieCredit({ amount: 100, counterpart_name: "CCV Group", description: "afrekening" }), false,
    "a retail owner's daily terminal settlement must not be frozen forever by one iDEAL payment");
  assert.equal(isMollieCredit({ amount: 100, counterpart_name: null, description: "mollie payout" }), true);
});

test("[DUBBEL-GEDEKT] a guard that could not look does not claim to know", () => {
  // molliePayoutKnown separates "this owner has no Mollie" from "the probe never ran". The
  // difference decides whether a future reader may treat the absence of a hold as an answer.
  const known = buildDoubleBookingGuard({ paidRows: [], hasRecentMolliePayout: false });
  const blind = buildDoubleBookingGuard({ paidRows: [], hasRecentMolliePayout: false, molliePayoutKnown: false });
  assert.equal(known.molliePayoutKnown, true);
  assert.equal(blind.molliePayoutKnown, false);
});
