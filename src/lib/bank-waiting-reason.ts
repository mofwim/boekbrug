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
): BankWaitReason | null {
  if (line.amount === null || !Number.isFinite(line.amount)) return null;
  const eps = DEFAULT_OPTIONS.amountEpsilon;

  // 1. A quoted number that is nowhere in the administration. First, because it is the only
  //    reason here whose answer is "the invoice is missing" rather than "pick one" — and the
  //    owner is the only person who can fix that. Only claimed when the payment actually printed
  //    a number: silence is not a missing invoice.
  const quoted = parseReferenceNumbers(line.reference);
  if (quoted.length > 0) {
    const anyKnown = openInvoices.some((inv) =>
      referenceMatches({ reference: line.reference, description: line.description ?? "" }, inv.invoice_number),
    );
    if (!anyKnown) return "reference_not_in_administration";
  }

  const sameAmount = openInvoices.filter((inv) => amountMatches(line.amount as number, remaining(inv), eps));

  // 2. More than one open invoice for exactly this amount. The app may not guess between them —
  //    that is a rule, not a limitation — and the owner settles it in one tap.
  if (sameAmount.length > 1) return "several_invoices_this_amount";

  const vanDezePartij = openInvoices.filter((inv) => sameParty(line, inv));

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
