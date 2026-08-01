// src/lib/creditnota-signal.ts
// [CREDITNOTA-SIGNAL] Spots a purchase credit note that was stored as an ordinary invoice. Pure.
//
// ── WHAT GOES WRONG ──
// A supplier's creditnota is MONEY OWED TO YOU: it belongs in the books with a minus sign, so it
// comes off the outstanding balance and corrects the deductible input tax. Every Dutch source says
// the same ("Het bedrag en de BTW gaan er met een minteken in, zodat uw omzet en af te dragen BTW
// automatisch worden gecorrigeerd").
//
// The reader already catches many of them, but one case slips through structurally: a supplier who
// prints the credit note with a POSITIVE final amount. That is common — the paper says "Creditnota"
// and puts € 51.80 under it, not € -51.80. And ai.ts deliberately refuses to go by that paper
// (HUNT-F2: "A POSITIVE printed total is never a creditnota"), because otherwise every discount on
// a normal invoice would become a credit note. Correct — but the consequence is that such a
// document lands in the books as an ordinary purchase invoice, and then:
//
//   · it counts toward "still to pay" while you owe nothing;
//   · it collects a dunning badge ("135 days late") for money you do not owe;
//   · and — the heaviest — its input tax is ADDED instead of SUBTRACTED, so the return claims back
//     more btw than it should.
//
// ── WHY THIS SIGNALS AND DOES NOT DECIDE ──
// The tempting move is to flip the sign automatically as soon as a number starts with "CR". That
// is not allowed. At another supplier "CR" can mean something entirely different, and a wrong flip
// turns a REAL debt into a credit: you underpay, and you find out at the dunning letter. This is
// the money core; the house rule applies — the screen SHOWS, the human DECIDES.
//
// So two requirements sit side by side, and only together do they say anything:
//
//   1. the number carries a known credit marker as its prefix (CR, CN, …), and
//   2. the SAME supplier demonstrably uses a DIFFERENT prefix for its ordinary invoices.
//
// Requirement 2 carries the evidence: it is not our assumption about what "CR" means, it is the
// supplier keeping two kinds of document apart with its own numbering. In the case that prompted
// this file that was literally visible in the list — CR0300343 and CR0300510 next to RE0801378,
// all three from the same wholesaler. A prefix without a counterpart says nothing, and then we
// stay quiet too.

/** The alphabetic prefix of a document number: "CR0300343" → "CR", "2033161" → "". */
export function numberPrefix(raw: string | null | undefined): string {
  const s = (raw ?? "").trim().toUpperCase();
  const m = /^([A-Z]+)/.exec(s);
  return m ? m[1] : "";
}

/**
 * Prefixes that mark a credit note in Dutch practice.
 *
 * Deliberately SHORT. Every prefix added here increases the chance of mistaking an ordinary
 * invoice for a credit — and that mistake costs the owner a dunning letter. A bare "C" is
 * therefore absent (too often "Customer", "Contract"), and so is "KR" (may mean "krediet", but
 * just as easily an article range).
 */
const CREDIT_PREFIXES = new Set(["CR", "CN", "CRN", "CRED", "CREDIT", "CRE"]);

export type CreditnotaSignal = {
  /** Certain enough to have the owner look; never certain enough to book it ourselves. */
  suspected: boolean;
  /** The prefix that stood out, for the explanation on screen. Empty when nothing did. */
  prefix: string;
  /** A differing prefix from the same supplier — the evidence behind requirement 2. */
  contrastPrefix: string | null;
};

const NO_SIGNAL: CreditnotaSignal = { suspected: false, prefix: "", contrastPrefix: null };

/**
 * Does this stored document look like a credit note booked as an ordinary invoice?
 *
 * @param invoiceNumber the number as the supplier prints it
 * @param totalIncBtw   the STORED total (positive = booked as a debt)
 * @param invoiceType   the stored kind ('factuur' | 'creditnota' | …)
 * @param vendorNumbers every document number from the SAME supplier; this one may be among them
 */
export function looksLikeCreditnota(input: {
  invoiceNumber: string | null | undefined;
  totalIncBtw: number | null | undefined;
  invoiceType: string | null | undefined;
  vendorNumbers: readonly (string | null | undefined)[];
}): CreditnotaSignal {
  // Already booked correctly — nothing to report. This is the desired end state, not a case we
  // want to keep pointing at.
  if (input.invoiceType === "creditnota") return NO_SIGNAL;

  // Already stored negative: the row already behaves as a credit (it comes off the balance). The
  // KIND may still be wrong, but the MONEY is not — and this signal is about money pointing the
  // wrong way. `0` also counts as nothing to report: there is nothing to subtract.
  const total = Number(input.totalIncBtw ?? 0);
  if (!Number.isFinite(total) || total <= 0) return NO_SIGNAL;

  // Requirement 1 — a known credit marker.
  const prefix = numberPrefix(input.invoiceNumber);
  if (!prefix || !CREDIT_PREFIXES.has(prefix)) return NO_SIGNAL;

  // Requirement 2 — the same supplier keeps two kinds apart in its numbering. Without that
  // counterpart this is our assumption about two letters, which is too little to send someone
  // after. A second CR number does not count: it only confirms itself.
  const contrastPrefix =
    input.vendorNumbers
      .map((n) => numberPrefix(n))
      .find((p) => p !== "" && p !== prefix) ?? null;
  if (!contrastPrefix) return NO_SIGNAL;

  return { suspected: true, prefix, contrastPrefix };
}

/**
 * The app says this IS a credit note, yet the amount sits in the books as a DEBT.
 *
 * Not a suspicion but a CONTRADICTION, and therefore its own case: there is nothing to guess — the
 * reader already established the kind and the amount points the other way. Such a row counts
 * toward "still to pay" while it should come off, and its input tax is added instead of
 * subtracted. Heavier than the suspicion above, and it gets its own message.
 */
export function creditnotaSignConflict(input: {
  invoiceType: string | null | undefined;
  totalIncBtw: number | null | undefined;
}): boolean {
  if (input.invoiceType !== "creditnota") return false;
  const total = Number(input.totalIncBtw ?? 0);
  return Number.isFinite(total) && total > 0;
}

/**
 * The sentence on screen. Says WHAT stood out and WHY it matters, and leaves the decision to the
 * owner — it contains no amount that we have already flipped.
 *
 * Dutch string: this is UI text shown to the owner, per the language rule in AGENTS.md.
 */
export function creditnotaSignalText(signal: CreditnotaSignal): string | null {
  if (!signal.suspected) return null;
  return (
    `Dit nummer begint met ${signal.prefix} terwijl dezelfde leverancier ${signal.contrastPrefix} gebruikt ` +
    `voor gewone facturen — dit lijkt een creditnota. Die hoort met een minteken in de boeken: hij gaat ` +
    `van je openstaande saldo af en verlaagt de btw die je terugvraagt. Nu telt hij als schuld mee.`
  );
}
