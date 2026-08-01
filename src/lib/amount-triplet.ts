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
