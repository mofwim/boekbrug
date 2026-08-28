// src/lib/amount-triplet.ts
// [AMOUNT-TRIPLET] An invoice's three amounts, where ex + btw = incl ALWAYS holds. Pure, no I/O.
//
// ── WHY THIS EXISTS ──
// The confirm screen let the reviewer fill in two amounts — ex-btw and btw — and derived the
// total. That guarantees the identity, which is worth something. But it is backwards from how an
// invoice reads.
//
// On paper the TOTAL is the most reliable number there is: it is what you transfer, it is printed
// in bold at the bottom ("Totaal te voldoen"), and it is the one figure your bank statement has to
// match. The ex-btw amount is the hard one: a single invoice can print four candidates —
// "Subtotaal", "basis", "Ex. BTW", "Totaal exclusief BTW" — and on all four invoices that stalled
// in the queue, that was exactly the figure the reader got wrong.
//
// So anyone coming to correct such an invoice had to NOT enter the most reliable number on the
// page, and instead work out 1078.46 − 88.73 = 989.73 in their head to land on the same total.
// That is the app making the human do arithmetic, which is the wrong way round.
//
// ── THE RULE ──
// All three fields are editable, and the identity holds exactly after every keystroke. What moves
// depends on what you touch:
//
//   · type EX    → the total follows (btw stays)
//   · type BTW   → the total follows (ex stays)
//   · type TOTAL → the EX amount follows (btw stays)
//
// In all three cases the btw stays put unless you type it yourself. That is not arbitrary: btw is
// printed in its own labelled column on almost every invoice, is therefore read most reliably, and
// is the figure that goes straight into the return as deductible input tax. Of the three, it is
// the one you least want to see jump around.
//
// For the potato-wholesaler invoice this means: type total −109.58 and btw 13.42, and the ex
// amount becomes −123.00 by itself — exactly what the paper says.

// [CENT] Cent rounding has one home. Writing `Math.round(n * 100) / 100` here would be the fifth
// copy of a fact this repo already had four spellings of — see the gate of the same name.
import { round2 } from "./invoice-totals";

export type AmountTriplet = {
  /** Amount excluding btw. May be negative (credit note / net return). */
  ex: number;
  /** The btw amount. */
  btw: number;
  /** The final total — what actually gets paid. */
  incl: number;
};

/** Unreadable input counts as 0, so a half-typed field never pushes NaN into the arithmetic. */
function num(v: number | null | undefined): number {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
}

/**
 * The ex amount changed. The total follows; btw stays.
 *
 * Not rounded: `ex + btw` is the total by definition, and rounding here could create or destroy
 * cents nobody typed.
 */
export function setExcl(t: AmountTriplet, ex: number | null | undefined): AmountTriplet {
  const nx = num(ex);
  return { ex: nx, btw: t.btw, incl: nx + t.btw };
}

/** The btw changed. The total follows; the ex amount stays. */
export function setBtw(t: AmountTriplet, btw: number | null | undefined): AmountTriplet {
  const nb = num(btw);
  return { ex: t.ex, btw: nb, incl: t.ex + nb };
}

/**
 * The TOTAL changed — the new case. The ex amount follows; btw stays.
 *
 * This is the direction that unblocks all four stalled invoices in one move: the total and the btw
 * are both printed literally on the paper, and the figure the reader tripped over follows by itself.
 */
export function setIncl(t: AmountTriplet, incl: number | null | undefined): AmountTriplet {
  const ni = num(incl);
  return { ex: ni - t.btw, btw: t.btw, incl: ni };
}

/**
 * Does the identity hold? Same tolerance as the arithmetic gate in safecore.
 *
 * Meant as a safety net in a test, not something the screen needs to check: the three functions
 * above cannot break it by construction.
 */
export function tripletHolds(t: AmountTriplet): boolean {
  return Math.abs(t.ex + t.btw - t.incl) <= 0.02;
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// [BTW-TARIEF] Splitting a total by a rate, and the one thing the screen may not guess
// ─────────────────────────────────────────────────────────────────────────────────────────────
//
// REPORTED: "when I type the amount excluding VAT, the VAT should be calculated automatically."
//
// It cannot be, and the reason matters: btw = ex × RATE, and the ex amount alone does not carry a
// rate. € 679,33 is a 9% invoice and a 21% invoice at the same time until somebody says which.
// Deriving it anyway would put a guessed figure into the aangifte as deductible input tax — money,
// in the direction that gets corrected with the Belastingdienst rather than the supplier.
//
// So the rate is ASKED, never inferred, and the split runs from the TOTAL — for the same reason
// setIncl exists: the total is the most reliable number on the paper, printed in bold at the
// bottom, and it is what the bank statement has to match.
//
// This does move the btw, which the three functions above deliberately never do. That is the whole
// point of a button: the owner asked for this rate, on this invoice, once. It is not something the
// screen does on its own while they are typing.

/** The rates a Dutch invoice can carry. 0% exists too, but it needs no button — btw is already 0. */
export const NL_BTW_RATES = [9, 21] as const;

export type NlBtwRate = (typeof NL_BTW_RATES)[number];

/**
 * Split a gross total by a rate.
 *
 * The identity is preserved EXACTLY, and that is why btw is the subtraction rather than its own
 * rounding: rounding both halves independently makes 740,47 at 9% come out as 679,33 + 61,14 on a
 * good day and one cent short on a bad one, and a cent that exists in no field is precisely what
 * [CENT] was written about.
 *
 * A negative total (a creditnota) splits with both parts negative, which is what a credit note is.
 */
export function splitByRate(incl: number | null | undefined, ratePercent: number): AmountTriplet {
  const total = num(incl);
  const rate = num(ratePercent);
  // A rate of 0 (or nonsense) leaves everything in the base — never invents btw.
  if (!(rate > 0)) return { ex: total, btw: 0, incl: total };
  const ex = round2(total / (1 + rate / 100));
  return { ex, btw: total - ex, incl: total };
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// [NUL-IS-GEEN-INVOER] What an amount field SHOWS
// ─────────────────────────────────────────────────────────────────────────────────────────────
//
// REPORTED: "the zero is written as a value where it should be a placeholder — when I want to
// type, the zero stays and sometimes it goes wrong."
//
// Exactly right, and it was the same line copied into two components. A held 0 was rendered as the
// character "0", so the caret landed after it and the first keystrokes appended to it: typing
// 740,47 into an untouched field produced "0740,47". Clearing the box did not help either — on
// blur it snapped straight back to "0", and touching a NEIGHBOURING field did the same, because
// the draft moved away with the focus.
//
// A held 0 and an empty box are the same value to this app: parseAmountNL("") is 0. So showing
// nothing is not information lost, it is the honest rendering — and the placeholder beside it says
// what the field wants without occupying it.
export const AMOUNT_PLACEHOLDER = "0,00";

/**
 * The text an amount input shows: the draft while it is being typed in, otherwise the held value —
 * and nothing at all when that value is zero.
 */
export function amountFieldText(
  held: number,
  draft: { field: string; text: string } | null,
  field: string,
): string {
  if (draft && draft.field === field) return draft.text;
  const rounded = round2(held);
  if (rounded === 0) return "";
  return String(rounded).replace(".", ",");
}
