// src/lib/bank-match-confidence.ts
// [MATCH-CONFIDENCE] Naming the matching decision, in the shape Dynamics 365 Business Central
// publishes it. Pure, no I/O.
//
// ── Why this exists next to a matcher that already works ──────────────────────────────────────
//
// bank-matching.ts decides correctly. It decides IMPLICITLY: the outcome falls out of a score, a
// pair of confidence caps, a margin against the runner-up, and a chain of tier guards. Each of
// those is well reasoned and individually tested, and together they are not enumerable — you
// cannot ask the codebase "what does it do when the party matches fully, no invoice number is
// printed, and three open invoices carry this exact amount?" without running it and reading the
// number that comes out. That is how I checked it: one probe at a time.
//
// Business Central answers that question from a TABLE. Three dimensions, published values, one
// confidence per combination. The table is the contribution — not better logic, but logic you can
// enumerate, assert exhaustively, and show to an owner in words.
//
//     Related Party Matched            Fully | Partially | No
//     Document No. Matched             Yes-Multiple | Yes | No
//     Entries Within Amount Tolerance  One | Multiple | None
//                                      → Match Confidence: High | Medium | Low
//                                      → Review Required (a SEPARATE axis)
//
// The two axes are separate on purpose, and that is the second thing worth taking. "How sure am
// I" and "must a human look" are different questions, and collapsing them — as an auto/choice/none
// enum does — makes "confident, but this one is large, look at it" inexpressible.
//
// ── The Dutch mapping ─────────────────────────────────────────────────────────────────────────
//
// Business Central matches a related party on "bank account, name, or address". A Dutch bank feed
// carries no address, and it always carries an IBAN, so the ladder is:
//
//     fully      the counterpart IBAN equals the invoice's vendor_iban — the same ACCOUNT, which
//                no same-amount coincidence can fake
//     partially  the names identify the same party (isStrongNameIdentity), or are similar enough
//                to list — a name is evidence, not identity: "Jansen B.V." and "Jansen Holding"
//                reduce to one token and score a perfect 1.0
//     no         neither
//
// Document No. is the betalingskenmerk / factuurnummer printed in the payment. `yes-multiple` is
// the verzamelbetaling — one transfer quoting several invoice numbers, which is ordinary here.
//
// ── This layer may DEMOTE. It may never PROMOTE. ──────────────────────────────────────────────
//
// bank-matching.ts carries guards Business Central has no equivalent for — a printed number that
// contradicts the winner vetoes the booking; elimination may not manufacture a lone winner
// (phantomSecond); a bare calendar year is not an identity; a name whose token set is merely a
// SUBSET of another is not the same company. Those were each earned from a real wrong booking.
// A table imported from another product must not quietly overrule them, so the contract is
// one-directional: a Low classification can stop an automatic booking, and a High classification
// can never start one. Everything this module can do is refuse.

import type { BankTransaction } from "./bank-parser";
import {
  DEFAULT_OPTIONS,
  amountMatches,
  ibanMatches,
  isStrongNameIdentity,
  nameSimilarity,
  parseReferenceNumbers,
  referenceMatches,
  type AutoConfirmTier,
  type InvoiceForMatching,
  type MatchOptions,
  type TransactionMatch,
} from "./bank-matching";

/** How much of the counterparty is established. See the Dutch ladder in the header. */
export type RelatedPartyMatch = "fully" | "partially" | "no";
/** Whether the payment text names this invoice — and whether it names others too. */
export type DocumentNoMatch = "yes-multiple" | "yes" | "no";
/** How many OPEN invoices this one payment could settle on amount alone. */
export type AmountToleranceMatch = "one" | "multiple" | "none";
/** Business Central's own three levels. */
export type MatchConfidence = "high" | "medium" | "low";

export interface MatchClassification {
  relatedParty: RelatedPartyMatch;
  documentNo: DocumentNoMatch;
  amountTolerance: AmountToleranceMatch;
  confidence: MatchConfidence;
  /**
   * Whether a human must look before this is booked. A SEPARATE axis from confidence, exactly as
   * in Business Central: the two answer different questions, and a product that ties them cannot
   * say "sure, but large — look at it".
   */
  reviewRequired: boolean;
  /** Dutch, owner-facing: the same three facts, in words the owner can check against his bank. */
  reason: string;
}

/**
 * The published Business Central table, completed.
 *
 * Business Central lists 24 rules across the three dimensions, several of them under an amount
 * value of "Not Considered" — a rule that fires without consulting the amount at all. Here the
 * amount count is always known (we hold the whole candidate set), so those rows collapse onto the
 * concrete counts and the space closes at 3 × 3 × 3 = 27. Every combination is present: a lookup
 * that can miss is a lookup that needs a default, and a default is where an unexamined case hides.
 *
 * Keyed `${relatedParty}|${documentNo}|${amountTolerance}`.
 */
const CONFIDENCE_TABLE: Readonly<Record<string, MatchConfidence>> = Object.freeze({
  // ── Related party FULLY established (the IBAN) ──────────────────────────────────────────────
  "fully|yes-multiple|one": "high", // BC High 1
  "fully|yes-multiple|multiple": "high", // BC High 2
  "fully|yes-multiple|none": "medium", // BC Medium 1 (amount not considered)
  "fully|yes|one": "high", // BC High 3
  "fully|yes|multiple": "high", // BC High 4
  "fully|yes|none": "medium", // BC Medium 2
  "fully|no|one": "high", // BC High 8 — the account and the sum agree, and only one bill fits
  "fully|no|multiple": "medium", // BC Medium 3 — right account, but which of the bills?
  "fully|no|none": "low", // BC Low 1 — the account is all we have

  // ── Related party PARTIALLY established (the name) ──────────────────────────────────────────
  "partially|yes-multiple|one": "high", // BC High 5
  "partially|yes-multiple|multiple": "high", // BC High 6
  "partially|yes-multiple|none": "medium", // BC Medium 4
  "partially|yes|one": "high", // BC High 7
  "partially|yes|multiple": "medium", // BC Medium 5
  "partially|yes|none": "medium", // BC Medium 5
  "partially|no|one": "medium", // BC Medium 8 — a name and a sum, nothing printed
  "partially|no|multiple": "low", // BC Low 2
  "partially|no|none": "low", // BC Low 3

  // ── No related party at all ────────────────────────────────────────────────────────────────
  "no|yes-multiple|one": "high", // BC High 9 — the numbers themselves carry the identity
  "no|yes-multiple|multiple": "high", // BC High 10
  "no|yes-multiple|none": "medium", // BC Medium 7
  "no|yes|one": "medium", // BC Medium 6
  "no|yes|multiple": "medium", // BC Medium 9
  "no|yes|none": "medium", // BC Medium 9
  "no|no|one": "low", // BC Low 4
  "no|no|multiple": "low", // BC Low 5
  "no|no|none": "low", // not in BC's table — nothing matched at all, the weakest there is
});

/** Every key the table must answer for. Exported so the test can prove the space is closed. */
export const RELATED_PARTY_VALUES: readonly RelatedPartyMatch[] = ["fully", "partially", "no"];
export const DOCUMENT_NO_VALUES: readonly DocumentNoMatch[] = ["yes-multiple", "yes", "no"];
export const AMOUNT_TOLERANCE_VALUES: readonly AmountToleranceMatch[] = ["one", "multiple", "none"];

/** The table lookup. Total by construction — see the note on CONFIDENCE_TABLE. */
export function confidenceFor(
  relatedParty: RelatedPartyMatch,
  documentNo: DocumentNoMatch,
  amountTolerance: AmountToleranceMatch,
): MatchConfidence {
  return CONFIDENCE_TABLE[`${relatedParty}|${documentNo}|${amountTolerance}`];
}

/**
 * How much of the counterparty this pairing establishes.
 *
 * The IBAN outranks the name and is not a matter of degree: two IBANs are equal or they are not,
 * and equal means the same account. A name is a resemblance, and the app has been burned by
 * treating a resemblance as an identity — hence `partially` covers both the strong token-set
 * identity and the merely-similar name, because Business Central's own ladder makes the same cut:
 * "partially" is the value for "some of the party information agrees".
 */
export function classifyRelatedParty(
  tx: Pick<BankTransaction, "counterpartIban" | "counterpartName">,
  inv: Pick<InvoiceForMatching, "vendor_iban" | "client_name">,
  opts: MatchOptions = DEFAULT_OPTIONS,
): RelatedPartyMatch {
  if (ibanMatches(tx.counterpartIban, inv.vendor_iban)) return "fully";
  if (isStrongNameIdentity(tx.counterpartName, inv.client_name)) return "partially";
  return nameSimilarity(tx.counterpartName, inv.client_name) >= opts.nameSimThreshold
    ? "partially"
    : "no";
}

/**
 * Whether the payment text names THIS invoice, and whether it names others as well.
 *
 * `yes-multiple` is the verzamelbetaling: one transfer quoting several invoice numbers, of which
 * this invoice is one. Business Central rates that its HIGHEST confidence — several numbers that
 * all resolve is stronger evidence than one, not weaker. Note what this module does NOT do with
 * that: bank-matching refuses to auto-book a multi-reference payment outright, because allocating
 * a sum across several bills is the owner's decision, and this layer cannot overrule a refusal.
 */
export function classifyDocumentNo(
  tx: Pick<BankTransaction, "reference" | "description">,
  inv: Pick<InvoiceForMatching, "invoice_number">,
): DocumentNoMatch {
  if (!referenceMatches(tx, inv.invoice_number)) return "no";
  return parseReferenceNumbers(tx.reference).length > 1 ? "yes-multiple" : "yes";
}

/**
 * How many of the open invoices this payment could settle on AMOUNT alone.
 *
 * This is the dimension a score cannot express. bank-matching already protects the ambiguous case
 * — two same-amount rivals land on the same confidence cap, so the margin rule refuses to pick one
 * — but it protects it as a CONSEQUENCE of the arithmetic, invisibly. Counting it makes the fact
 * itself reportable: "drie openstaande facturen van dit bedrag" is a sentence an owner can act on,
 * where "no clear winner" is not.
 *
 * The count is over the candidate set the caller already assembled for this transaction, so it
 * inherits every eligibility rule (direction, date sanity, accountant-verwerkt) for free.
 */
export function classifyAmountTolerance(
  tx: Pick<BankTransaction, "amount">,
  eligible: readonly Pick<InvoiceForMatching, "total_inc_btw" | "amount_paid">[],
  opts: MatchOptions = DEFAULT_OPTIONS,
): AmountToleranceMatch {
  let hits = 0;
  for (const inv of eligible) {
    // [PARTIAL-PAY] Aim at the REMAINING balance, exactly as scorePair does — the second
    // instalment of a part-paid invoice matches its restant, not its gross total.
    const paidSoFar = Math.max(0, inv.amount_paid ?? 0);
    const target =
      inv.total_inc_btw == null || paidSoFar <= 0.005
        ? inv.total_inc_btw
        : (inv.total_inc_btw < 0 ? -1 : 1) * Math.max(0, Math.abs(inv.total_inc_btw) - paidSoFar);
    if (amountMatches(tx.amount, target, opts.amountEpsilon)) hits++;
    if (hits > 1) return "multiple"; // no reason to keep counting
  }
  return hits === 1 ? "one" : "none";
}

/** Dutch sentence for the three facts, so the owner can check the claim against his own bank. */
function dutchReason(c: Omit<MatchClassification, "reason">): string {
  const party =
    c.relatedParty === "fully"
      ? "zelfde rekeningnummer (IBAN)"
      : c.relatedParty === "partially"
        ? "naam komt overeen"
        : "tegenpartij onbekend";
  const doc =
    c.documentNo === "yes-multiple"
      ? "meerdere factuurnummers genoemd"
      : c.documentNo === "yes"
        ? "factuurnummer genoemd"
        : "geen factuurnummer genoemd";
  const amount =
    c.amountTolerance === "one"
      ? "één openstaande factuur met dit bedrag"
      : c.amountTolerance === "multiple"
        ? "méérdere openstaande facturen met dit bedrag"
        : "geen openstaande factuur met dit bedrag";
  return `${party} · ${doc} · ${amount}`;
}

/**
 * Classify one (transaction, invoice) pairing.
 *
 * `eligible` is every invoice that survived isEligible for THIS transaction — the caller has it
 * already. It is what makes the amount dimension answerable; without it the third column would be
 * a guess, and a guessed column is worse than an absent one.
 */
export function classifyMatch(args: {
  tx: BankTransaction;
  invoice: InvoiceForMatching;
  eligible: readonly InvoiceForMatching[];
  opts?: MatchOptions;
}): MatchClassification {
  const opts = args.opts ?? DEFAULT_OPTIONS;
  const relatedParty = classifyRelatedParty(args.tx, args.invoice, opts);
  const documentNo = classifyDocumentNo(args.tx, args.invoice);
  const amountTolerance = classifyAmountTolerance(args.tx, args.eligible, opts);
  const confidence = confidenceFor(relatedParty, documentNo, amountTolerance);
  const partial: Omit<MatchClassification, "reason"> = {
    relatedParty,
    documentNo,
    amountTolerance,
    confidence,
    // Business Central marks review on its weakest rules. Here anything short of High asks for a
    // human, which is the conservative reading and the one this product already lives by: a
    // pre-selected one-tap costs the owner a second, and a wrong booking costs him a quarter.
    reviewRequired: confidence !== "high",
  };
  return { ...partial, reason: dutchReason(partial) };
}

/**
 * The one-directional contract, as a function.
 *
 * True when this classification is too weak to book without a human. bank-matching's own tier
 * decision stays authoritative for everything else: this can turn an automatic booking into a
 * human one, and nothing can turn a human one into an automatic one.
 */
export function vetoesAutoBooking(c: MatchClassification): boolean {
  return c.confidence === "low";
}

/** One pairing the tiers are willing to book, before this layer has had its say. */
export interface TieredMatch {
  m: TransactionMatch;
  tier: AutoConfirmTier | null;
}

/**
 * Apply the veto across a whole auto-confirm run.
 *
 * Extracted from bank-auto-confirm so the composed decision is testable WITHOUT a database. That
 * matters more than it looks: the classification below is unit-tested to the last combination, but
 * until this function existed the code that JOINS it to the booking path ran only inside a
 * Supabase-shaped call, so nothing could assert that the join was wired at all. A guard nobody can
 * exercise is indistinguishable from a guard nobody wired.
 *
 * Returns the same list with `tier` cleared on every pairing this layer refuses. It never sets a
 * tier, never reorders, and never drops an entry — the caller's own filter owns that.
 */
export function applyConfidenceVeto(args: {
  matches: readonly TieredMatch[];
  /** The invoice behind each candidate id. */
  invoiceById: ReadonlyMap<string, InvoiceForMatching>;
  /** Which invoices this transaction could legitimately settle — the amount column needs the set. */
  eligibleFor: (tx: BankTransaction) => readonly InvoiceForMatching[];
  opts?: MatchOptions;
  /** Called for each refusal, so a production run can say what it stopped and why. */
  onVeto?: (info: { match: TransactionMatch; tier: AutoConfirmTier; classification: MatchClassification }) => void;
}): TieredMatch[] {
  return args.matches.map((entry) => {
    const { m, tier } = entry;
    if (!tier || !m.best) return entry;
    const invoice = args.invoiceById.get(m.best.invoiceId);
    if (!invoice) return entry; // not ours to judge; the caller's own guards handle it
    const classification = classifyMatch({
      tx: m.transaction,
      invoice,
      eligible: args.eligibleFor(m.transaction),
      opts: args.opts,
    });
    if (!vetoesAutoBooking(classification)) return entry;
    args.onVeto?.({ match: m, tier, classification });
    return { m, tier: null };
  });
}
