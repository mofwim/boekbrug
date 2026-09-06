// src/lib/bank-quoted-invoice.ts
// [AL-GEBOEKT] The invoice a payment NAMES, whatever its status. Pure, no I/O.
// Run: npx tsx --test src/lib/bank-quoted-invoice.test.ts
//
// ── THE BUG THIS EXISTS FOR ──
//
// Reported from /bank with a screenshot. A payment of € 797,86 to HVO Meat, whose description
// reads `USTD//2919045/`, was offered three invoices of € 2.449,64, € 2.822,27 and € 3.008,71 —
// under the sentence "Meerdere facturen passen bij deze betaling". A payment of € 803,26 to
// GROOTHANDEL M.H. BAL was offered seven, four of them from BALKIP B.V.
//
// Checked against production, every one of those payments names an invoice that EXISTS, at the
// exact cent, from the exact supplier:
//
//   2919045     € 797,86    HVO Meat                  ← the € 797,86 payment
//   2034382     € 1.056,87  CAN Vleesgroothandel      ← the € 1.056,87 payment
//   263591      € 803,26    GROOTHANDEL M.H. BAL      ← the € 803,26 payment
//   FAC-2601629 € 811,40    NAR FOOD                  ← the € 811,40 payment
//
// All four already `paid`. isEligible refuses a settled invoice — correctly, or a bill would be
// paid twice — so the true match is dropped and the scorer goes on to the supplier's OTHER
// invoices, which clear the listing floor on "same counterparty, nearby date". The card then
// presents them as matches.
//
// That is not a cosmetic misfire. Confirming one books this payment against a DIFFERENT, genuinely
// open invoice: a bill marked paid that nobody paid, and the real payment still unexplained.
// 36 of 333 pending debits were in this state, 29 of them exact to the cent.
//
// ── WHY THE EXISTING MACHINERY MISSED IT ──
//
// Two mechanisms already answer "why did this line not book": the paid-explain pass
// ([BANK-PAID-EXPLAINED]) and judgeBankWait ([WAAROM-WACHT-BANK]). Both are gated on
// `outcome === "none"`, on one assumption written into the route: *bij een kandidatenlijst is die
// lijst het antwoord*. That holds right up until the list is wrong, which is exactly this case.
//
// judgeBankWait could not have caught it either way: it is handed the OPEN invoices only, so
// "already settled" and "never entered" look identical from inside it. Its own header admits the
// blind spot — "a supplier whose every invoice happens to be settled is not in the open pool" —
// and chose silence as the safe error. Silence was safe; what filled the silence was not.
//
// ── WHY A LOOKUP AND NOT ANOTHER SCORING PASS ──
//
// The scorer is O(n·m) and [CIRKEL-PERF] measured ~9s on 3000 transactions × 1500 paid invoices.
// It is also not needed: the payment already states the number, and only the SETTLED invoices have
// to be searched — a small slice. A number the supplier printed and the bank carried back unchanged
// is a stronger claim than any similarity score.
//
// ── AND WHY IT REUSES referenceMatches INSTEAD OF PARSING ──
//
// The first version of this module built an index of invoice numbers and looked up whatever
// parseReferenceNumbers returned. Its tests failed on all four real lines, which is the whole
// reason they were written from production rows rather than from invented ones:
// parseReferenceNumbers splits on COMMAS — it exists for "1234,5678", a payment run settling
// several invoices at once — so `USTD//2919045/` came back as the single token `ustd2919045`,
// which matches no invoice. Extracting digit runs instead would have fixed those three and still
// missed `FAC-2601629`, whose number carries a letter prefix.
//
// referenceMatches already knows all of this, including the traps it documents: a structured
// RF-reference, a bare calendar year that must never count as identity, and a short numeric needle
// that may only match as a WHOLE token so invoice 2050 cannot match reference 26302050. Writing a
// second reader of the same field would mean maintaining those three rules in two places, and the
// copy that drifts is always the one nobody is looking at.

import { referenceMatches } from "./bank-matching";
// [CREDIT-TEKEN] One definition of "this is a credit note" for the whole product.
import { creditStance } from "./creditnota-signal";
// [CENT] Rounding to cents lives in one place — see money-rounding.ts.
import { round2 } from "./invoice-totals";

/** One invoice, reduced to what naming it requires. */
export interface QuotedInvoiceRow {
  id: string;
  invoice_number: string | null;
  total_inc_btw: number | null;
  status: string | null;
  client_name: string | null;
  accountant_status?: string | null;
  /** [SOM-KLOPT] 'creditnota' pays the other way, so it SUBTRACTS from a payment's total. */
  invoice_type?: string | null;
}

/**
 * Statuses in which an invoice can no longer be offered as a candidate.
 *
 * Deliberately NOT imported from bank-matching's EXCLUDED_STATUSES, and that is a decision rather
 * than duplication: that set also holds 'draft' and 'processing', which are not settled at all —
 * they are not ready. Telling an owner "this is already booked" about a draft would be false, and
 * a queued one already has its own answer ([CIRKEL] links straight to the verify step). Only these
 * two mean the money question is closed.
 */
const SETTLED_STATUSES = new Set(["paid", "archived"]);

/**
 * The invoices this question is even about: the settled ones.
 *
 * Narrowing here rather than in the caller keeps the rule in one place, and it is what makes the
 * scan cheap — an open invoice needs no rescue, because the matcher can simply offer it.
 */
export function settledOnly(rows: readonly QuotedInvoiceRow[]): QuotedInvoiceRow[] {
  return rows.filter((r) =>
    r.invoice_number && (SETTLED_STATUSES.has(r.status ?? "") || r.accountant_status === "verwerkt"));
}

/** What the payment names, and what became of it. */
export interface QuotedSettled {
  invoiceId: string;
  invoiceNumber: string;
  amount: number | null;
  clientName: string | null;
  /** The payment and the invoice agree to the cent — then this is almost certainly the same bill. */
  amountAgrees: boolean;
  /** 'verwerkt' locks a quarter; the sentence differs because so does the remedy. */
  lockedByAccountant: boolean;
  /**
   * [CREDIT-TEKEN] This document SUBTRACTS from the payment's total.
   *
   * The screen needs it because `amount` is the stored value and the sum is not always allowed to
   * agree with it: a creditnota typed as one but stored positive counts negative anyway (see
   * creditSign). Printing the stored +136,00 above a total that used −136,00 leaves an owner
   * unable to check the addition by eye, which is the one thing this card exists to let them do.
   */
  isCredit: boolean;
}

/**
 * Does this line quote an invoice that exists and is already settled?
 *
 * Returns null in every other case — no quoted number, an unknown number, or a number that names
 * an invoice still open. An open one needs no rescue: the matcher can offer it normally.
 */
export function quotedSettledInvoice(
  line: { amount: number | null; reference: string | null; description?: string | null },
  settled: readonly QuotedInvoiceRow[],
): QuotedSettled | null {
  // Both fields, because banks put the reference in either — the four production lines carry it in
  // `description` (`USTD//2919045/`) while a SEPA batch fills `reference`. referenceMatches reads
  // the pair exactly as the matcher does.
  const tx = { reference: line.reference, description: line.description ?? "" };

  // Prefer an invoice whose amount also agrees: with two settled invoices whose numbers both occur
  // in one description, the one that matches the euro is the one this payment is about.
  let zwak: QuotedSettled | null = null;
  for (const hit of settled) {
    if (!referenceMatches(tx, hit.invoice_number)) continue;

    // [CREDIT-TEKEN] Eén bouwer voor beide paden. Dit was een tweede, woordelijk gelijke kopie van
    // toQuoted; toen QuotedSettled er een veld bij kreeg, bleef die kopie er zonder achter — precies
    // het soort stille verschil waar dit hele hoofdstuk over gaat.
    const gevonden = toQuoted(hit, line.amount);
    if (gevonden.amountAgrees) return gevonden;
    zwak ??= gevonden;
  }
  return zwak;
}

// ── [SOM-KLOPT] ONE PAYMENT, SEVERAL NAMED INVOICES ───────────────────────────────────────────
//
// Reported from /bank with two screenshots, and both were right.
//
//   Al-Malika Bakkerij, € 466,30, description "2601695, 2601826, 2601291".
//     2601695 = 162,19   2601826 = 148,68   2601291 = 155,43   →  466,30, to the cent.
//   Royal Food Center, € 1.955,90, description "2600999", invoice 2600999 = 1.955,90, paid.
//
// The first screen said "Geen factuur gevonden voor deze transactie", offered a chooser of three,
// and underneath showed a card about ONE of the three saying the amount did not agree. The second
// said, in the banner, that the quoted number "staat niet in je administratie" — directly above a
// card naming that very invoice at the exact cent. Two panels of one card contradicting each other
// on a money screen is not a rough edge; it is the moment an accountant stops trusting the app.
//
// The owner's rule, and it is the correct one: the payment states which invoices it pays. If every
// stated number is in the administration and their total is the amount paid, the question is
// ANSWERED. Not scored, not offered, not asked about — answered. The date does not enter into it,
// and neither does anything else.
//
// quotedSettledInvoice above answers for ONE invoice, which is why it read the Al-Malika line as a
// near-miss: it found 2601695 at 162,19 against a payment of 466,30, decided the amount disagreed,
// and reported that as a weak hit. Nothing was wrong with that function; it was asked a question
// one size too small.
//
// ── WHY CREDIT NOTES SUBTRACT ──
//
// A supplier who credits you and then bills you settles the difference in one transfer, naming
// both documents. Adding the creditnota would make the total too high by twice its value and the
// set would read as "does not add up" — on the one arrangement where the owner has done everything
// right. invoice_type is the app's own field, so this is a fact about the row, not a guess.
//
// ── WHAT IT REFUSES TO DO ──
//
// It never books and it never confirms. It reports what the numbers say; the screen turns that
// into either "this is settled, nothing to do" or "two of the three are booked and one is
// missing". Partial is the common real case and it must not be dressed up as complete — the sum
// either matches or it does not, and `coversPayment` says which, always.

/**
 * Every invoice this payment names, sorted by what the owner would have to DO about it.
 *
 * Three buckets, because they ask for three different afternoons and merging any two of them
 * produces a sentence that is wrong for the third:
 *   · settled  — nothing to do; the bill is booked.
 *   · open     — in the administration, still open: this is a real candidate, and the chooser
 *                below the card is exactly the right control for it.
 *   · unknown  — named and nowhere: the paper is in a shoebox and only the owner can fix it.
 *
 * The first version of this had only "settled" and "unresolved", which read a still-OPEN invoice as
 * "staat nog niet in je administratie" — a false accusation about an invoice sitting right there,
 * which is the same class of bug this whole task started from.
 */
export interface QuotedInvoiceSet {
  /** Named and already booked. */
  settled: QuotedSettled[];
  /** Named, present, still open — the honest candidates for this payment. */
  open: QuotedSettled[];
  /** Named and found nowhere. */
  unknownNumbers: string[];
  /** Signed total over settled AND open: a creditnota counts negative. Null when it cannot be read. */
  total: number | null;
  /**
   * [NO-SILENT-EMPTY] Why `total` is null, when it is: 'amount' — one of the named invoices carries
   * no readable amount. Before this existed the card rendered a sentence about something else
   * entirely, so the owner never learned that nothing had been added up.
   */
  totalUnknownReason: "amount" | null;
  /** Does that total equal the payment, to the cent? */
  coversPayment: boolean;
  /** Nothing named is still open or missing — then there is genuinely nothing left to choose. */
  fullySettled: boolean;
}

/**
 * The sign this document brings to a payment's total.
 *
 * [CREDIT-TEKEN] This used to read `invoice_type === "creditnota"` and nothing else, and that one
 * field is not always there. Measured on the live administration: a debit of € 170,27 quoting
 * "26700644 26700603" — a € 306,27 invoice settled with a € 136,00 creditnota, which is exactly
 * 170,27. The card said "Samen € 442,27, en deze betaling is € 170,27" and sent the owner looking
 * for a bill that does not exist, because the creditnota reached this function through the OPEN
 * invoice read — and that select never named invoice_type. Undefined is not "creditnota", so
 * Math.abs turned the stored −136 into +136 and the total was wrong by twice the credit.
 *
 * The route now selects the column, but a sum that is only correct while every caller remembers a
 * field is a sum waiting to be wrong again. creditStance is this codebase's own answer to that and
 * says it plainly: EITHER HALF IS ENOUGH — a row stored negative behaves as a credit whatever its
 * type says, and a row typed 'creditnota' is one by the owner's own hand. Calling it here also
 * means there is one definition of "this is a credit note" in the product instead of a fourth copy.
 *
 * A CONFLICT — typed 'creditnota' while the money sits positive — subtracts too, and that is not a
 * guess: asCreditAmounts in creditnota-signal.ts is this product's standing answer for that exact
 * state, and it flips the amounts. Refusing to add up here would be a THIRD opinion about one
 * question, and it would break the arrangement that already works: invoice 900,00 minus creditnota
 * 100,00 settled in one transfer of 800,00, where the supplier plainly netted them.
 *
 * A "suspected" credit never flips anything. A suspicion is not a fact, and the surfaces that own
 * that suspicion say so in their own words.
 */
function isCreditRow(row: QuotedInvoiceRow, total: number | null): boolean {
  const stance = creditStance({
    invoiceNumber: row.invoice_number,
    totalIncBtw: total,
    invoiceType: row.invoice_type,
    // The supplier's other numbers are not fetched here, so "suspected" can only come from this
    // row's own number — and a suspicion changes no sign, so it never reaches the sum.
    vendorNumbers: [],
  });
  return stance === "credit" || stance === "conflict";
}

/** The amount this document brings to a payment's total, with the sign it belongs with. */
function creditSign(row: QuotedInvoiceRow, total: number): number {
  return isCreditRow(row, total) ? -Math.abs(total) : Math.abs(total);
}

function toQuoted(hit: QuotedInvoiceRow, paymentAmount: number | null): QuotedSettled {
  const raw = typeof hit.total_inc_btw === "number" ? hit.total_inc_btw : null;
  return {
    invoiceId: hit.id,
    invoiceNumber: hit.invoice_number ?? "",
    amount: raw,
    clientName: hit.client_name,
    amountAgrees:
      raw != null && paymentAmount != null && Math.abs(Math.abs(raw) - Math.abs(paymentAmount)) < 0.01,
    lockedByAccountant:
      hit.accountant_status === "verwerkt" && !SETTLED_STATUSES.has(hit.status ?? ""),
    isCredit: isCreditRow(hit, raw),
  };
}

function isSettled(r: QuotedInvoiceRow): boolean {
  return SETTLED_STATUSES.has(r.status ?? "") || r.accountant_status === "verwerkt";
}

/**
 * Read the numbers this payment states and look every one of them up.
 *
 * `rows` is the whole pool the caller can see — settled AND open. Handing it only the settled ones
 * is what produced the false "not in your administration" above.
 *
 * Returns null when the payment names no invoice at all; then there is nothing to say and the
 * ordinary matcher keeps the floor.
 */
export function quotedInvoiceSet(
  line: { amount: number | null; reference: string | null; description?: string | null },
  rows: readonly QuotedInvoiceRow[],
): QuotedInvoiceSet | null {
  const tx = { reference: line.reference, description: line.description ?? "" };

  const gezien = new Set<string>();
  const settled: QuotedSettled[] = [];
  const open: QuotedSettled[] = [];
  const gevondenNummers: string[] = [];
  // Only ONE row per invoice NUMBER contributes to the sum. A corrected invoice keeps the
  // supplier's number and its predecessor is archived; adding both counts the same bill twice and
  // turns a payment that adds up on paper into one the app calls a mismatch.
  const geteld = new Set<string>();
  let total = 0;
  let anyAmountMissing = false;

  for (const hit of rows) {
    if (!hit.invoice_number) continue;
    if (!referenceMatches(tx, hit.invoice_number)) continue;
    if (gezien.has(hit.id)) continue;
    gezien.add(hit.id);

    const q = toQuoted(hit, line.amount);
    (isSettled(hit) ? settled : open).push(q);
    gevondenNummers.push(hit.invoice_number);

    const nummer = normalizedNumber(hit.invoice_number);
    if (nummer && geteld.has(nummer)) continue;
    if (nummer) geteld.add(nummer);
    if (q.amount == null) anyAmountMissing = true;
    else total += creditSign(hit, q.amount);
  }

  if (settled.length === 0 && open.length === 0) return null;

  const unknownNumbers = statedNumbers(line).filter(
    (n) => !gevondenNummers.some((g) => normalizedNumber(g) === normalizedNumber(n)),
  );

  // [NO-SILENT-EMPTY] Why the total is unknown, when it is — so the screen can say what it could
  // not read instead of falling silent on a money question.
  const totalUnknownReason: QuotedInvoiceSet["totalUnknownReason"] = anyAmountMissing ? "amount" : null;

  const coversPayment =
    totalUnknownReason === null &&
    unknownNumbers.length === 0 &&
    line.amount != null &&
    Math.abs(Math.abs(total) - Math.abs(line.amount)) < 0.01;

  return {
    settled,
    open,
    unknownNumbers,
    // [CENT] Rounded once, here: the running sum is float arithmetic and 306,27 − 136,00 came out
    // as 170,26999999999998. coversPayment tolerates a cent, but the number on screen must not.
    total: totalUnknownReason ? null : round2(total),
    totalUnknownReason,
    coversPayment,
    // Fully settled means: everything this payment names is booked, and it names nothing else.
    // Only then is the chooser genuinely empty of anything useful — with an open named invoice in
    // the list, the chooser is the CORRECT control and taking it away would strand the payment.
    fullySettled: open.length === 0 && unknownNumbers.length === 0 && settled.length > 0,
  };
}

/** Comparison form for an invoice number: case and separators are printing, not identity. */
function normalizedNumber(n: string | null | undefined): string {
  return (n ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * The invoice numbers this payment STATES, as tokens.
 *
 * Deliberately a plain scan and not parseReferenceNumbers: that function splits on commas for a
 * payment run and returned the single token `ustd2919045` for `USTD//2919045/`, which is the exact
 * trap the header of this file documents. Here the tokens are only used to notice that a stated
 * number found NO invoice, so a slightly generous reader is the safe direction: it can make the
 * screen say "one of these is missing" where the truth is "that token was never an invoice
 * number", and it can never make a half-explained payment read as fully explained.
 */
function statedNumbers(line: { reference: string | null; description?: string | null }): string[] {
  const haystack = `${line.reference ?? ""} ${line.description ?? ""}`;
  const out = new Set<string>();
  for (const m of haystack.matchAll(/[0-9]{4,}/g)) {
    // A bare calendar year is never identity — the same rule referenceMatches applies, and for the
    // same reason: "Huur juli 2026" would otherwise report 2026 as a missing invoice on every rent
    // payment in the account.
    if (/^20[2-3]\d$/.test(m[0])) continue;
    out.add(m[0]);
  }
  return [...out];
}
