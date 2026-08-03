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
 * Where a row stands on the credit question — ONE answer, read by every widget that would treat it
 * as a debt.
 *
 * ── WHY THIS EXISTS ──
 * All three facts above were already computed on the payment screen, and the screen still offered a
 * payment QR of € 33,87 on a document it had badged "⚠ Lijkt een creditnota" one line earlier. The
 * paper was the supplier's own CREDITFACTUUR CR0301267, printed "Totaal bedrag (EUR) : € -33,87";
 * it is stored positive because the reader took its figures from the btw-berekening table, which
 * prints them positive. The row also carried "2 dagen te laat", and the QR was filled in and ready
 * to scan.
 *
 * Every widget asked a different question. The dunning badge asked `invoice_type === 'creditnota'
 * || total < 0`. The "Betalen" button and the one-tap "Heb je betaald?" asked only
 * `status === 'received'` — so they never saw the warning standing right next to them. A warning
 * that does not disarm the action it warns about is decoration beside a button that sends money.
 *
 * So the states live here, and the screen reads one of them.
 *
 * ── WHY 'suspected' HOLDS THE PAYMENT, THOUGH IT IS ONLY A SUSPICION ──
 * Nothing here books anything: looksLikeCreditnota still refuses to flip a sign, for the reason its
 * own header gives. Holding the PAYMENT is a different decision, and its two ways of being wrong
 * are not each other's mirror image:
 *
 *   · suspicion right, payment offered → the owner transfers money to a supplier who owes it to
 *     THEM. Real money, gone, and getting it back means asking for it.
 *   · suspicion wrong, payment held behind one question → one tap ("Nee, gewone factuur") and the
 *     payment continues. The vervaldatum stays on the row; nothing is hidden.
 *
 * One costs a tap, the other costs the invoice twice. So the question comes first.
 */
export type CreditStance =
  /** Nothing points at a credit note. The only state in which a row may be treated as a debt. */
  | "none"
  /** A credit note carrying the sign of one — correct, and not something you pay. */
  | "credit"
  /** Typed 'creditnota' while the money sits positive: the app contradicting itself. */
  | "conflict"
  /** The supplier's own numbering says credit, and nobody has confirmed it yet. */
  | "suspected";

export function creditStance(input: {
  invoiceNumber: string | null | undefined;
  totalIncBtw: number | null | undefined;
  invoiceType: string | null | undefined;
  vendorNumbers: readonly (string | null | undefined)[];
}): CreditStance {
  // The contradiction first: it is the only state where the kind and the money disagree, and
  // reporting it as either half alone would lose exactly what makes it worth reporting.
  if (creditnotaSignConflict({ invoiceType: input.invoiceType, totalIncBtw: input.totalIncBtw })) {
    return "conflict";
  }
  // Either half is enough. A row stored negative behaves as a credit on every screen that reads a
  // sign, whatever its type says — and a row typed 'creditnota' is one by the owner's own hand.
  // A total that is not a finite number falls through: unread is not the same as negative.
  const total = Number(input.totalIncBtw ?? 0);
  if (input.invoiceType === "creditnota" || (Number.isFinite(total) && total < 0)) return "credit";
  return looksLikeCreditnota(input).suspected ? "suspected" : "none";
}

/**
 * May this row be offered as a debt — the payment QR, the one-tap "Heb je betaald?", the dunning
 * badge? Only when nothing at all points at a credit note.
 */
export function payableAsDebt(stance: CreditStance): boolean {
  return stance === "none";
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

/**
 * The amounts of a credit note, with the sign a credit note must carry.
 *
 * ── WHY THIS EXISTS ──
 * "Dit is een creditnota" was a tick that set `invoice_type` and nothing else. The label under it
 * promised the consequences — "gaat hij van je openstaande saldo af en wordt zijn btw afgetrokken
 * in plaats van opgeteld" — and none of them followed, because in this codebase NOTHING reads the
 * type when money is counted:
 *
 *   · openAmountSigned (partial-payment.ts) takes its sign from `total_inc_btw < 0`, so a credit
 *     note stored at +51.80 keeps counting as a debt on every screen that shows what you owe;
 *   · /api/aangifte selects direction, status, total_ex_btw and btw_amount — never invoice_type —
 *     and sums them raw, so that +4.28 is ADDED to the input tax you reclaim instead of subtracted.
 *
 * So ticking the box produced exactly the sign conflict the app warns about one screen later. The
 * type is a label; the SIGN is the money.
 *
 * ── WHY THE WHOLE TRIPLET FLIPS AS ONE ──
 * Not `-Math.abs()` per field. Negating each field independently silently rewrites a triplet whose
 * parts do not share a sign (a credit note carrying positive goods-btw over a negative net base),
 * turning a reading we do not understand into a different one we invented. One multiplication by
 * −1 preserves `ex + btw = incl` exactly and preserves the relationship between the three, whatever
 * it was.
 *
 * Already-negative amounts are returned untouched: the owner typed a minus, or the reader read one,
 * and re-flipping would turn their credit note back into a debt.
 */
export function asCreditAmounts(input: {
  totalExBtw: number;
  btwAmount: number;
  totalIncBtw: number;
}): { totalExBtw: number; btwAmount: number; totalIncBtw: number; flipped: boolean } {
  const { totalExBtw, btwAmount, totalIncBtw } = input;
  // The total decides, because it is the number the paper prints as "Te voldoen" and the only one
  // every screen agrees to read the sign from. Zero is left alone — there is no sign to give it.
  if (!(totalIncBtw > 0)) return { totalExBtw, btwAmount, totalIncBtw, flipped: false };
  return {
    totalExBtw: -totalExBtw,
    btwAmount: -btwAmount,
    totalIncBtw: -totalIncBtw,
    flipped: true,
  };
}
