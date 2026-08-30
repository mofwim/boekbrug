// src/lib/payment-corroboration.ts
// [BETAALD-MAAR-WAAR] A hand-marked "Betaald" is a claim. This is where the bank answers it.
//
// ── THE CASE THIS WAS WRITTEN FROM ──
//
// A supplier's own accounting package, on a photo: two invoices for Kiwi Food Market, 2034488 of
// 15 August for € 1.165,73 and 2034534 of 22 August for € 1.217,92, both OPEN, the first overdue.
// BoekBrug held 2034534 as open too — and 2034488 as PAID, on 29 August.
//
// Nothing in the app was broken. The owner had tapped "betaald", which writes a bank_tx_invoices
// row with transaction_id NULL — the deliberate representation of a payment the owner recorded
// himself (payment-evidence.ts already says so, and already renders it in a different tone from a
// bank-proven one). The tap was on 29 August. The last bank line the app holds is 21 August.
//
// So the app asserted a payment eight days beyond the edge of everything it can see, and then
// never looked again. That is the whole defect: not the claim, but that no later statement is ever
// held against it. On this one administration 94 purchase payments stand on a hand tick with no
// bank line behind them, and every one of them has been unexamined since the day it was made.
//
// ── WHAT THIS MODULE WILL AND WILL NOT SAY ──
//
// It will not accuse. A hand tick is usually true, and an app that cries wolf about money gets its
// warnings switched off, after which it is worse than silent. So there are exactly two things it
// says, and both are facts rather than suspicions:
//
//   1. "This claim is not yet checkable" — the payment date lies outside the period your bank
//      statement covers. That is a statement about OUR data, not about the owner's honesty, and it
//      is the one that would have caught 2034488 on the day it was made.
//
//   2. "Your books say you paid this supplier more than your bank shows leaving for them" — over
//      the period the statement DOES cover, compared per supplier and never per invoice.
//
// Per SUPPLIER and not per invoice is not a simplification, it is the only correct comparison. A
// shopkeeper pays five invoices of one wholesaler with a single transfer; matching amounts one to
// one would report five gaps where there are none. Summing both sides over the covered period is
// what an accountant does, and it cannot be fooled by how the payments were bundled.
//
// The comparison also counts BANK-PROVEN payments on the claimed side. The question is not "is
// this tick backed" but "does everything we say we paid this supplier fit inside what actually
// left the account" — and a bank-linked payment spends the same euros.
//
// Pure: no I/O, no clock, no database.

import { round2 } from "./invoice-totals";

/**
 * Whole cents, as an integer.
 *
 * Deliberately local, and a warning with it: `toCents` in partial-payment.ts does NOT return cents
 * — it is `round2`, i.e. euros with the float dust removed. Importing it here and dividing by a
 * hundred is exactly the mistake that made this module's first draft report an € 800 discrepancy
 * as € 8, which is a wrong number about money presented with confidence: the precise failure this
 * whole file exists to prevent. Comparing in integers is the [CENT] rule; comparing in the right
 * unit is the reader's job, and the name did not help.
 */
function cents(euro: number): number {
  return Math.round(round2(euro) * 100);
}

/** The window a bank statement actually covers. Nulls mean: no statement, or unreadable. */
export interface StatementCoverage {
  /** ISO date of the first day covered, inclusive. */
  from: string | null;
  /** ISO date of the last day covered, inclusive. */
  to: string | null;
}

/** One settlement recorded against a purchase invoice, as bank_tx_invoices holds it. */
export interface PaymentClaim {
  invoiceId: string;
  invoiceNumber: string | null;
  /** The supplier as the invoice names them — for the sentence, never for the grouping. */
  supplierName: string | null;
  /**
   * The grouping identity. Callers pass counterpartKey(name) or the supplier_id, but ONE of the
   * two consistently: two spellings of one wholesaler must land on the same key or its payments
   * are compared against half its bank lines. Null = this claim cannot be grouped, and it is
   * REPORTED as such rather than dropped.
   */
  supplierKey: string | null;
  /** Magnitude this settlement applied. */
  amountApplied: number;
  /** ISO date the owner says it was paid, or null when nothing recorded one. */
  paidOn: string | null;
  /** 'bank' | 'kas' — how it was said to be settled. */
  method: string | null;
  /** Present when a real bank line carries this settlement. Its presence IS the proof. */
  transactionId: string | null;
}

/** One outflow from the owner's account, already attributed to a supplier by the caller. */
export interface SupplierDebit {
  supplierKey: string | null;
  /** ISO date of the bank line. */
  date: string;
  /** Magnitude of the money that left. Callers pass Math.abs of a negative amount. */
  amount: number;
}

/**
 * Why a claim cannot be held against the bank.
 *
 * These are three different sentences to an owner and collapsing them would make all three
 * useless: "you have no statement" is a thing to fix once, "your statement stops before this date"
 * is a thing to fix by uploading the next one, and "this payment has no date" is a thing only the
 * owner can answer.
 */
export type UncheckableReason =
  /** No statement period at all. One thing to fix, once. */
  | "geen_afschrift"
  /** Paid AFTER the newest statement reaches. The urgent one — see below. */
  | "na_dekking"
  /** Paid BEFORE the oldest statement starts. Old history; informational. */
  | "voor_dekking"
  /** No payment date recorded at all. Only the owner can answer this one. */
  | "geen_datum";

export type ClaimVerdict =
  /** A bank line carries it. The strongest thing the app can say, and nothing to add. */
  | { kind: "bank" }
  /** Settled from the drawer. A bank statement cannot corroborate cash, and that is not a gap. */
  | { kind: "kas" }
  /** Recorded by hand, and not yet holdable against a statement. */
  | { kind: "niet_te_controleren"; reason: UncheckableReason; coverageTo: string | null }
  /** Recorded by hand, inside the covered period — it counts in the supplier comparison below. */
  | { kind: "telt_mee" };

/**
 * What kind of claim one settlement is, and whether the bank can be asked about it at all.
 *
 * Order matters and is argued: a bank line settles the question before anything else, cash is
 * outside the bank's reach by nature, and only then does coverage come into it.
 */
export function claimVerdict(claim: PaymentClaim, coverage: StatementCoverage): ClaimVerdict {
  if (claim.transactionId) return { kind: "bank" };
  if (claim.method === "kas") return { kind: "kas" };
  if (!claim.paidOn) {
    return { kind: "niet_te_controleren", reason: "geen_datum", coverageTo: coverage.to };
  }
  if (!coverage.from || !coverage.to) {
    return { kind: "niet_te_controleren", reason: "geen_afschrift", coverageTo: null };
  }
  // [NA-DEKKING] Two directions out of the window, and they are not the same news.
  //
  // AFTER the newest statement is the live one: the owner ticked "betaald" today, the statement
  // that would prove it has not been downloaded yet, and until it is the app is asserting a
  // payment past the edge of everything it can see. That is the exact shape of invoice 2034488 —
  // marked paid on 29 August against bank data ending 21 August, while the wholesaler's own
  // ledger had it open and overdue.
  //
  // BEFORE the oldest statement is history. It may never become checkable, nothing about it is
  // urgent, and putting it on the same list as the one above would bury the one that matters
  // under sixty that do not.
  if (claim.paidOn > coverage.to) {
    return { kind: "niet_te_controleren", reason: "na_dekking", coverageTo: coverage.to };
  }
  if (claim.paidOn < coverage.from) {
    return { kind: "niet_te_controleren", reason: "voor_dekking", coverageTo: coverage.from };
  }
  return { kind: "telt_mee" };
}

/** One supplier's books held against one supplier's bank lines, over the covered period. */
export interface SupplierReconciliation {
  supplierKey: string;
  /** The most recent name seen for this key — for the sentence only. */
  supplierName: string | null;
  /** What the books say was paid to this supplier inside the covered period. */
  claimed: number;
  /** What actually left the account for this supplier inside the covered period. */
  paidByBank: number;
  /**
   * claimed − paidByBank, when positive. Zero when the bank covers the books.
   *
   * Never negative: paying a supplier MORE than the books account for is an ordinary thing (a
   * payment on account, an invoice not yet imported) and reporting it as a discrepancy would fire
   * on almost every supplier of a shop that pays weekly.
   */
  gap: number;
  /** How many settlements were counted, and how many of those stand on a hand tick alone. */
  claimCount: number;
  handClaimCount: number;
  /** The invoice numbers behind the claims, so the owner can go and look. Bounded. */
  invoiceNumbers: string[];
}

export interface CorroborationResult {
  /** The window everything above was judged inside. Echoed so a caller cannot restate it wrong. */
  coverage: StatementCoverage;
  /** Suppliers whose books claim more than their bank lines show, worst first. */
  short: SupplierReconciliation[];
  /** Suppliers the statement corroborates. Present, not implied by absence. */
  covered: SupplierReconciliation[];
  /** Claims the bank cannot be asked about, with the reason each one carries. */
  uncheckable: Array<{ claim: PaymentClaim; verdict: ClaimVerdict }>;
  /**
   * [NO-SILENT-EMPTY] Claims inside the covered period that carry no supplier key. They are in
   * NEITHER list above, so without this they would vanish — and an owner reading "all suppliers
   * check out" would be reading a sentence about a smaller set than they think.
   */
  unkeyed: PaymentClaim[];
}

/** At most this many invoice numbers travel per supplier — a wall of numbers is not a finding. */
export const MAX_INVOICE_LABELS = 8;

/**
 * A gap under this many cents is not reported.
 *
 * A shop's suppliers hand out credit notes, round off statiegeld and settle a few cents with the
 * next delivery. One euro of difference over a quarter is noise, and a warning about noise is how
 * an owner learns to skip warnings.
 */
export const GAP_DUST_CENTS = 100;

function inCoverage(iso: string | null, coverage: StatementCoverage): boolean {
  if (!iso || !coverage.from || !coverage.to) return false;
  return iso >= coverage.from && iso <= coverage.to;
}

/**
 * Hold the books against the bank, per supplier, over the period the statement covers.
 *
 * What is deliberately NOT here: any attempt to say WHICH invoice a debit paid. That is the
 * matcher's job and it already exists; guessing it a second time here would produce a second
 * opinion about the same euro. This function answers one question — does the total we claim to
 * have paid a supplier fit inside the total that actually left for them — and refuses to answer
 * anything it has no evidence for.
 */
export function corroboratePayments(args: {
  claims: PaymentClaim[];
  debits: SupplierDebit[];
  coverage: StatementCoverage;
}): CorroborationResult {
  const { claims, debits, coverage } = args;

  const uncheckable: Array<{ claim: PaymentClaim; verdict: ClaimVerdict }> = [];
  const unkeyed: PaymentClaim[] = [];
  const perSupplier = new Map<string, SupplierReconciliation>();

  const bucket = (key: string, name: string | null): SupplierReconciliation => {
    const found = perSupplier.get(key);
    if (found) {
      if (!found.supplierName && name) found.supplierName = name;
      return found;
    }
    const made: SupplierReconciliation = {
      supplierKey: key, supplierName: name, claimed: 0, paidByBank: 0, gap: 0,
      claimCount: 0, handClaimCount: 0, invoiceNumbers: [],
    };
    perSupplier.set(key, made);
    return made;
  };

  for (const claim of claims) {
    const verdict = claimVerdict(claim, coverage);
    if (verdict.kind === "niet_te_controleren") { uncheckable.push({ claim, verdict }); continue; }
    // 'kas' is settled outside the bank by nature — it belongs in neither comparison. It is not
    // uncheckable either: nothing is missing, the drawer is simply not the bank.
    if (verdict.kind === "kas") continue;
    if (!claim.supplierKey) { unkeyed.push(claim); continue; }

    const b = bucket(claim.supplierKey, claim.supplierName);
    b.claimed = round2(b.claimed + Math.abs(claim.amountApplied));
    b.claimCount += 1;
    if (!claim.transactionId) b.handClaimCount += 1;
    if (claim.invoiceNumber && b.invoiceNumbers.length < MAX_INVOICE_LABELS) {
      b.invoiceNumbers.push(claim.invoiceNumber);
    }
  }

  for (const debit of debits) {
    if (!debit.supplierKey) continue;
    if (!inCoverage(debit.date, coverage)) continue;
    // A supplier with outflow but no claims still gets a bucket: "we paid them and booked nothing"
    // is a real state, and it is the reverse of a gap rather than the absence of one.
    const b = bucket(debit.supplierKey, null);
    b.paidByBank = round2(b.paidByBank + Math.abs(debit.amount));
  }

  const short: SupplierReconciliation[] = [];
  const covered: SupplierReconciliation[] = [];
  for (const b of perSupplier.values()) {
    if (b.claimCount === 0) continue; // nothing claimed → nothing to corroborate
    const gapCents = cents(b.claimed) - cents(b.paidByBank);
    b.gap = gapCents > 0 ? round2(gapCents / 100) : 0;
    if (gapCents > GAP_DUST_CENTS) short.push(b);
    else covered.push(b);
  }
  short.sort((a, z) => z.gap - a.gap);
  covered.sort((a, z) => z.claimed - a.claimed);

  return { coverage, short, covered, uncheckable, unkeyed };
}
