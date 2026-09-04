// src/lib/vendor-vat-rate.ts
// [TARIEF-GEHEUGEN] The BTW rate a supplier actually uses, taken from their own invoices.
// Pure, no I/O. Run: npx tsx --test src/lib/vendor-vat-rate.test.ts
//
// ── THE PROBLEM THIS ANSWERS ──
//
// 44 incoming invoices in production sit held with total_ex_btw = 0 and btw_amount = 0 against a
// real gross total — EUR 49.963 of purchases with no voorbelasting claimed against any of them.
// The app is not wrong to hold them: safecore saw excl + BTW != incl, flagged sum_mismatch, wrote
// an audit row per invoice, and refused to book a split it had not read. That is the app working.
//
// But "held" is not an answer, it is a queue. And for most of these the answer is already in the
// administration. Counted on the owner's own rows:
//
//   ATAPACK Cash & Carry      12 invoices, every one 21,00 %
//   Sumer Food                12 invoices, every one  9,00 %
//   W.KETELS & ZN             25 invoices, 23 at 9,00 % and two at 8,99 / 9,01 (cent rounding)
//   Supervers                  6 invoices, every one  9,00 %
//   Dutch Sweets               4 invoices, every one  9,00 %
//   Enka Horeca               14 invoices: 9,00 ten times — and 9,45, 10,07, 11,10, 11,89
//
// The last row is the important one. Those four are BLENDS: an invoice carrying both 9 % and 21 %
// lines averages to something between them. A supplier like that has no single rate, and proposing
// one would put a wrong number in a btw-aangifte. So Enka Horeca — the largest block by value, 13
// invoices and EUR 18.698 — is exactly the case this module must REFUSE, and the refusal falls out
// of the data rather than being special-cased.
//
// ── WHAT IT MAY AND MAY NOT DO ──
//
// It PROPOSES. It never books, never writes, and never runs unattended: [ZELF-EERST] says nothing
// books itself, and a btw-aangifte is the last place to start. The proposal carries the count it
// rests on so the sentence can name its evidence — "deze leverancier rekende 12 keer 21 %" is a
// fact the owner can check, where "wij denken 21 %" is a machine asking to be trusted.
//
// It is also not a reader. The document still says what it says; this is the administration's own
// history offering an answer for a field the reader could not see. If the supplier's next invoice
// is different, the owner types the real number — and after this proposal the supplier's history
// contains a mixed rate, so the module stops proposing for them. It corrects itself by being wrong
// once, in a place where being wrong costs one tap.

/** The only rates a Dutch invoice can legally carry. A blend is not a rate. */
import { round2 } from "./invoice-totals";

export const LEGAL_NL_RATES = [0, 9, 21] as const;

/**
 * How far a computed percentage may sit from a legal rate and still count as that rate.
 *
 * Cent rounding on a real invoice moves the computed rate a little: W.KETELS shows 8,99 and 9,01
 * across 25 invoices that are all plainly 9 %. It must be small enough to reject a blend —
 * Enka Horeca's lowest blend is 9,45, which this refuses with room to spare.
 */
export const RATE_SNAP_TOLERANCE = 0.2;

/**
 * How many agreeing invoices before a rate is worth proposing.
 *
 * A judgement, not a measurement, and worth saying so: three identical readings can all come from
 * one batch of one template misread the same way. Four is where a pattern stops looking like an
 * accident. The proposal reports the count either way, so an owner who wants a higher bar can
 * apply it themselves — which is the whole reason the count travels with the answer.
 */
export const MIN_INVOICES_FOR_RATE = 4;

/** One invoice, reduced to the three numbers this question needs. */
export interface RatedInvoice {
  totalExBtw: number | null;
  btwAmount: number | null;
  totalIncBtw: number | null;
}

/** A rate this supplier demonstrably uses, and the evidence for it. */
export interface VendorRate {
  /** 0, 9 or 21. */
  rate: number;
  /** How many of the supplier's invoices agree. Travels with the answer so the screen can cite it. */
  basedOn: number;
}

/** The nearest legal rate, or null when the percentage is not one — which is what a blend is. */
export function snapToLegalRate(percentage: number): number | null {
  if (!Number.isFinite(percentage)) return null;
  for (const legal of LEGAL_NL_RATES) {
    if (Math.abs(percentage - legal) <= RATE_SNAP_TOLERANCE) return legal;
  }
  return null;
}

/**
 * Does this supplier use exactly one rate, across enough invoices to say so?
 *
 * Only invoices whose own arithmetic holds are counted: an invoice that does not add up cannot
 * testify about a rate, and letting one in would let the very defect this module exists to answer
 * become its own evidence.
 *
 * Answers null the moment two different rates appear, or any invoice blends. Not "the most common
 * rate" — a supplier who charges 9 % ten times and 21 % twice has no single rate, and picking the
 * majority would put a wrong number in a btw-aangifte one invoice in six.
 */
export function deriveVendorRate(invoices: readonly RatedInvoice[]): VendorRate | null {
  let found: number | null = null;
  let count = 0;

  for (const inv of invoices) {
    const ex = inv.totalExBtw;
    const btw = inv.btwAmount;
    const incl = inv.totalIncBtw;
    if (typeof ex !== "number" || typeof btw !== "number" || !Number.isFinite(ex) || !Number.isFinite(btw)) continue;
    if (ex <= 0) continue; // no base, no rate — and a zero base is the held case itself
    if (typeof incl === "number" && Number.isFinite(incl) && Math.abs(ex + btw - incl) > 0.02) continue;

    const snapped = snapToLegalRate((btw / ex) * 100);
    if (snapped === null) return null; // a blend: this supplier has no single rate, full stop
    if (found === null) found = snapped;
    else if (found !== snapped) return null; // two rates: likewise
    count++;
  }

  if (found === null || count < MIN_INVOICES_FOR_RATE) return null;
  return { rate: found, basedOn: count };
}

/** A split the owner can accept in one tap. */
export interface ProposedSplit {
  totalExBtw: number;
  btwAmount: number;
}

/**
 * Split a gross total at a known rate.
 *
 * The BTW is derived by SUBTRACTION so that ex + btw is exactly the printed total BY CONSTRUCTION,
 * for every input, at every rate. That matters because a proposal one cent out is a proposal
 * safecore flags as sum_mismatch — this module would be handing the owner a suggestion that fails
 * the very check it exists to clear.
 *
 * Measured, so the reason is not overstated: rounding both halves independently agrees with
 * subtraction on every cent from € 0,01 to € 20.000 at 9 % and 21 %, so it is not a bug waiting to
 * happen at today's amounts. Subtraction is chosen because it cannot drift at ANY amount or rate,
 * not because the alternative was observed to fail. The test below asserts the invariant itself
 * rather than the difference between two ways of getting there.
 */
export function proposeSplit(totalIncBtw: number, rate: number): ProposedSplit | null {
  if (!Number.isFinite(totalIncBtw) || totalIncBtw === 0) return null;
  if (!LEGAL_NL_RATES.includes(rate as (typeof LEGAL_NL_RATES)[number])) return null;
  // [CENT] round2 comes from invoice-totals — one cent-rounding for the whole app. A second one
  // written here would be a second answer to "what is € 0,005", and the gate that enforces this
  // exists because two of them once disagreed.
  const ex = round2(totalIncBtw / (1 + rate / 100));
  const btw = round2(totalIncBtw - ex);
  return { totalExBtw: ex, btwAmount: btw };
}
