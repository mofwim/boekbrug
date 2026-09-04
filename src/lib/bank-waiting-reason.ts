// src/lib/bank-waiting-reason.ts
// [WAAROM-WACHT-BANK] Why THIS bank line did not book itself. Pure, no I/O.
//
// ── WHY THIS EXISTS ──
//
// The same hole as the verify queue, one screen further. A bank line that found no invoice lands
// under "Geen factuur", and the whole tab shares ONE paragraph: "Leveranciers zonder gevonden
// factuur. Koppel het bestand, of negeer de transactie." That sentence is true of every line in
// the tab and therefore tells the owner nothing about any of them.
//
// The reasons underneath are not the same at all, and they ask for opposite actions:
//
//   · the payment quotes an invoice number that is nowhere in the administration — the paper
//     invoice was never entered. Nothing to match; something to ADD. This is the single most
//     valuable line on the screen, because the owner is holding the answer in a shoebox.
//   · this supplier has open invoices, but none for this amount — probably a partial payment, or
//     an invoice that has not arrived yet.
//   · several open invoices carry exactly this amount — the app is not allowed to guess which,
//     and the owner can answer it in one tap.
//   · the counterparty appears nowhere — rent, a loan, a private transfer: lines that will never
//     have an invoice and should be categorised or ignored once.
//
// Four different afternoons. One paragraph covered all four.
//
// ── WHAT IT MAY NOT DO ──
//
// It never claims more than the rows support, and it answers `null` rather than guessing. The
// screen then shows what it always showed. "We could not say why" and "there is nothing to say"
// must not look alike — the same rule the reader-quality panel lives by.
//
// It also does not decide anything. bank-matching.ts owns the matching; this only names what
// already happened, in the order that puts the most actionable sentence first.

import {
  amountMatches,
  ibanMatches,
  isStrongNameIdentity,
  nameSimilarity,
  parseReferenceNumbers,
  referenceMatches,
  DEFAULT_OPTIONS,
  type InvoiceForMatching,
} from "./bank-matching";

/**
 * Why a line is still waiting. Machine tags — never shown to anyone; why-waiting.ts turns them
 * into sentences, exactly as the intake refusals are handled.
 */
export type BankWaitReason =
  | "reference_not_in_administration"
  | "reference_already_settled"
  | "several_invoices_this_amount"
  | "counterparty_has_no_open_invoice_this_amount"
  | "counterparty_unknown_here"
  | "nothing_open_at_all";

/** The bank line, as much of it as this judgement needs. */
export interface WaitingBankLine {
  amount: number | null;
  counterpartName: string | null;
  counterpartIban?: string | null;
  reference: string | null;
  description?: string | null;
}

/** What is left to pay on an invoice — the figure the matcher targets, not the printed total. */
function remaining(inv: InvoiceForMatching): number | null {
  const total = inv.total_inc_btw;
  if (total === null || total === undefined || !Number.isFinite(total)) return null;
  const paid = Math.max(0, inv.amount_paid ?? 0);
  return Math.max(0, Math.abs(total) - paid);
}

/** Is this open invoice from the party on the other side of this bank line? */
function sameParty(line: WaitingBankLine, inv: InvoiceForMatching): boolean {
  if (ibanMatches(line.counterpartIban, inv.vendor_iban)) return true;
  if (isStrongNameIdentity(line.counterpartName, inv.client_name)) return true;
  return nameSimilarity(line.counterpartName, inv.client_name) >= DEFAULT_OPTIONS.nameSimThreshold;
}

/**
 * Name the reason, or answer null when the rows do not support one.
 *
 * `openInvoices` is the pool the matcher was allowed to consider for this line — the same set, so
 * the sentence can never contradict the matching that produced it. Hand it a different pool and
 * the screen starts explaining a decision that was made on other grounds.
 */
export function judgeBankWait(
  line: WaitingBankLine,
  openInvoices: readonly InvoiceForMatching[],
  /**
   * [SOM-KLOPT] The SETTLED invoices this payment names, if any — the answer from
   * quotedSettledSet. Optional so every existing caller keeps its meaning, and load-bearing when
   * present, because without it this function's first rule tells the owner a falsehood.
   *
   * Reported from /bank: a payment of € 1.955,90 naming invoice 2600999, which exists, is paid, and
   * agrees to the cent — under the sentence "De betaling noemt een factuurnummer dat niet in je
   * administratie staat", printed directly above a card showing that very invoice. The two panels
   * of one card contradicted each other on a money screen.
   *
   * The cause is structural rather than a slip. This function is handed the OPEN invoices, so from
   * inside it "already settled" and "never entered" are the same observation. Its own header calls
   * that a blind spot and picks silence as the safe error — but silence was never what happened:
   * rule 1 fires, because the quoted number is genuinely absent from the OPEN pool. An accusation
   * about the owner's own bookkeeping is the worst possible sentence to be wrong about, and this is
   * the one fact that decides it.
   */
  settledQuoted?: readonly { invoiceNumber: string }[] | null,
): BankWaitReason | null {
  if (line.amount === null || !Number.isFinite(line.amount)) return null;
  const eps = DEFAULT_OPTIONS.amountEpsilon;

  const sameAmount = openInvoices.filter((inv) => amountMatches(line.amount as number, remaining(inv), eps));
  const vanDezePartij = openInvoices.filter((inv) => sameParty(line, inv));

  // 1. A quoted number that is nowhere in the administration, FROM A PARTY WE ALREADY HOLD
  //    INVOICES FROM. First, because it is the only reason here whose answer is "the invoice is
  //    missing" rather than "pick one", and the owner is the only person who can fix that.
  //
  //    ── WHY THE PARTY CONDITION IS NOT OPTIONAL ──
  //
  //    The first version of this rule asked only "did the payment quote a number, and is that
  //    number unknown". Checked against production, that fires on almost everything: a
  //    betalingskenmerk from the Belastingdienst, a pension fund's scheme reference, a water
  //    company's customer number, a marketplace order id, a landlord whose payment reference is
  //    the tenant's own name. isReferenceNumberToken accepts any token of four characters
  //    containing a digit — deliberately, because for MATCHING a wide net costs nothing.
  //
  //    For an ACCUSATION it costs everything. "This payment names an invoice you have not entered"
  //    is a sentence about the owner's own diligence, and saying it about a tax payment is not
  //    vague, it is false. A worklist that is wrong most of the time gets dismissed once and then
  //    protects nothing — the same reasoning as the gate that must bite.
  //
  //    So the claim is only made where it can be defended: this counterparty ALREADY has open
  //    invoices in this administration, and this payment quotes a number that is not among them.
  //    Everything else falls through to reason 5, whose sentence — rent, a loan, private, give it
  //    a category once — is the true answer for the Belastingdienst and the pension fund.
  //
  //    Conservative on purpose: a supplier whose every invoice happens to be settled is not in the
  //    open pool, so a genuinely missing invoice from them stays unnamed. Silence is the right
  //    error to make here; a false accusation is not.
  //
  //    [SOM-KLOPT] And it is only made where it is TRUE. A number that names an invoice which is in
  //    the administration and already settled is not a missing invoice; it is a settled one, and
  //    the two ask for opposite things from the owner ("go find the paper" versus "nothing to do
  //    here"). This is asked FIRST, before the open pool is consulted at all, because the open pool
  //    is exactly where a settled invoice is not.
  if (settledQuoted && settledQuoted.length > 0) return "reference_already_settled";

  if (vanDezePartij.length > 0) {
    const quoted = parseReferenceNumbers(line.reference);
    if (quoted.length > 0) {
      const anyKnown = openInvoices.some((inv) =>
        referenceMatches({ reference: line.reference, description: line.description ?? "" }, inv.invoice_number),
      );
      if (!anyKnown) return "reference_not_in_administration";
    }
  }

  // 2. More than one open invoice for exactly this amount. The app may not guess between them —
  //    that is a rule, not a limitation — and the owner settles it in one tap.
  if (sameAmount.length > 1) return "several_invoices_this_amount";

  // 3. Known party, open invoices, none for this amount. Usually a part payment or an invoice
  //    that has not arrived — either way the owner knows which, and nothing else does.
  if (vanDezePartij.length > 0 && sameAmount.length === 0) {
    return "counterparty_has_no_open_invoice_this_amount";
  }

  // 4. Nothing open anywhere. Said apart from "this party is unknown", because the answer differs:
  //    an empty administration is not a statement about this counterparty.
  if (openInvoices.length === 0) return "nothing_open_at_all";

  // 5. The party appears nowhere in what is open. Rent, a loan, a private transfer — lines that
  //    will never have an invoice, and that are answered once by categorising or ignoring them.
  if (vanDezePartij.length === 0) return "counterparty_unknown_here";

  // Anything else: the pool has this party AND an invoice at this amount, so the matcher refused
  // for a reason this module cannot see. Saying nothing is then the honest answer — a made-up
  // explanation on a money screen is worse than the blank the owner already had.
  return null;
}
