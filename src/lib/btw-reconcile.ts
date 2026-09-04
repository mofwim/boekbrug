// src/lib/btw-reconcile.ts
// [BTW-RECONCILE] "excl + BTW ≠ totaal" — which of the three figures is the odd one out? Pure.
//
// ── WHY THIS EXISTS ──
// The arithmetic gate in safecore.ts reliably notices THAT the three amounts do not add up, and
// then says "excl + BTW ≠ totaal". True. The trouble is the owner can do nothing with it: three
// numbers, one of them wrong, and a PDF to go dig through to find out which.
//
// Four real invoices, all four showing that same message, all four a different story:
//
//   A. Meat wholesaler — ex 985.87 · btw 88.73 · total 1078.46 (difference 3.86)
//      On paper: a btw table with two rows, 9% over 985.87 AND 0% over 3.86 (E2 crates, 6 in and
//      5 out). The reader took the 9% BASE as "ex. BTW" and dropped the 0% row — while the paper
//      literally prints "ex. BTW € 989.73".
//   B. Wholesaler — ex 1722.54 · btw 144.95 · total 1843.49 (difference −24.00)
//      On paper: Subtotaal 1610.34 + BTW 144.95 + Totaal Statiegeld 88.20. The deposit (0%)
//      belongs in the base; the ex amount was wrong.
//   C. Horeca — ex 3413.92 · btw 995.90 · total 3819.82 (difference −590.00)
//      On paper: BTW 9% € 233.20 + BTW 21% € 172.70 = € 405.90. Here it was the btw that was wrong.
//
// One pattern: a btw SPECIFICATION BLOCK with MORE THAN ONE row — two rates, or a 0% item such as
// deposit/packaging/crates. The reader grabs one row instead of the sum. Crates and deposits are
// not an oddity there but the norm: in horeca and food wholesale there is almost always such a 0%
// line under the goods.
//
// ── WHAT THIS FILE DOES AND DOES NOT DO ──
// It REPAIRS nothing. No amount is flipped, recomputed or written here — that is the money core,
// and there the human decides. What it does is turn the question around: instead of "something is
// off, go figure it out", it computes what each of the two possible readings would mean, and says
// which of them is even POSSIBLE under Dutch rates.
//
// That last part is the crux. With three numbers and one equation, either can be "repaired" by the
// other two — so arithmetic alone points at nothing. But the btw RATE each repair implies has to
// sit between 0% and 21% (no Dutch rate is higher, so no blend can be either). In case C that
// eliminates one reading outright (35% does not exist) and leaves exactly one — then the screen
// may name it. In A and B both readings are legal, and then we say so honestly and leave the
// choice standing. Deciding where you cannot is guessing.

import { round2 } from "./invoice-totals";

/** Same tolerance as the arithmetic gate in safecore.ts — rounding noise on cents, nothing more. */
export const SUM_TOLERANCE = 0.02;

/** The highest Dutch btw rate. A blend of 0/9/21 never exceeds it. */
const MAX_NL_RATE = 21;

export type BtwReconcile = {
  /** Do the three add up? */
  ok: boolean;
  /** total − (ex + btw). Positive = something is missing from the breakdown. */
  difference: number;
  /** What ex would be if the total and the btw are right. */
  impliedExcl: number;
  /** What the btw would be if the total and ex are right. */
  impliedBtw: number;
  /** The rate that first reading implies, in whole percent. null when undeterminable. */
  exclRepairRate: number | null;
  /** Same for the second reading. */
  btwRepairRate: number | null;
  /** Is the first reading possible under Dutch rates? */
  exclRepairPossible: boolean;
  /** Is the second reading possible? */
  btwRepairPossible: boolean;
  /**
   * [TARIEF-GEHEUGEN] Was there a split to reconcile at all?
   *
   * False when BOTH halves came through as zero — the reader saw the printed total and no
   * breakdown. Carried explicitly rather than left for each caller to infer from the numbers: it
   * IS derivable (impliedExcl, impliedBtw and difference all collapse onto the total), but a
   * caller that has to notice that is a caller that will forget to.
   */
  splitWasRead: boolean;
};

// [CENT] round2 comes from invoice-totals — one function for the whole app. This file had its
// own, and it gave a different answer; see the header of invoice-totals.round2.

/** The rate in whole percent, rounded the way safecore rounds it. null on a zero base. */
function rateOf(btw: number, base: number): number | null {
  if (!(base > 0)) return null;
  return Math.round((btw / base) * 100);
}

function possible(rate: number | null): boolean {
  return rate !== null && rate >= 0 && rate <= MAX_NL_RATE;
}

/**
 * Reconciles the three amounts and reports what each of the two possible readings would mean.
 *
 * The TOTAL is the fixed point here. That is not arbitrary: the total is what actually gets paid,
 * it is printed largest, and it is the only figure the bank statements will have to match. In all
 * three practical cases above the total was right and the breakdown was where the error sat.
 */
export function reconcileBtw(
  excl: number | null | undefined,
  btw: number | null | undefined,
  incl: number | null | undefined,
): BtwReconcile {
  const ex = Number(excl ?? 0);
  const bt = Number(btw ?? 0);
  const inc = Number(incl ?? 0);

  const difference = round2(inc - (ex + bt));
  const impliedExcl = round2(inc - bt);
  const impliedBtw = round2(inc - ex);

  // [TARIEF-GEHEUGEN] Neither reading is a repair when the split was never READ at all.
  //
  // 44 invoices in production carry ex = 0, btw = 0 and a real total: the reader saw the printed
  // total and no breakdown. Fed to the arithmetic above, "excl = total - btw" gives back the total
  // itself, at an implied rate of 0 % — and 0 % is a legal Dutch rate, so `possible()` said yes and
  // the screen offered "het bedrag excl. BTW hoort € 1.560,42 te zijn" as THE repair.
  //
  // Accepting that books a wholesale food invoice with zero voorbelasting. It is not a repair; it
  // is the missing number restated as a fact, wearing the same button as two suggestions that are
  // genuinely derived. EUR 49.963 of purchases sits behind this shape, and the owner's own history
  // says these suppliers charge 9 % and 21 %.
  //
  // So: when there is nothing to reconcile BETWEEN, this function reports no repair. It keeps the
  // difference and the implied figures — a caller may still want to show what the numbers are —
  // and simply stops calling either one possible. What belongs on that screen instead is the
  // supplier's own rate; see vendor-vat-rate.ts.
  const nothingWasRead = ex === 0 && bt === 0;
  const exclRepairRate = nothingWasRead ? null : rateOf(bt, impliedExcl);
  const btwRepairRate = nothingWasRead ? null : rateOf(impliedBtw, ex);

  return {
    ok: Math.abs(inc - (ex + bt)) <= SUM_TOLERANCE,
    difference,
    impliedExcl,
    impliedBtw,
    exclRepairRate,
    btwRepairRate,
    exclRepairPossible: possible(exclRepairRate),
    btwRepairPossible: possible(btwRepairRate),
    splitWasRead: !nothingWasRead,
  };
}

/**
 * The other half of the problem: the SUM adds up, but the RATE cannot be.
 *
 * Fourth practical case, potato wholesaler: stored ex € 26.00 · btw € 13.42 · total € 39.42. Those
 * three reconcile neatly, so the arithmetic gate stays quiet — only the rate screams (52%). On
 * paper it is a net-negative invoice: goods 149.00 at 9%, plus a returned container of −408.00 at
 * 0%, giving "Totaal excl. BTW € -123.00" and "Totaal te voldoen € -109.58". All three stored
 * amounts are therefore wrong, and that is exactly why the identity can point at nothing: it holds.
 *
 * What DOES point somewhere is the btw itself. It is rarely misread (own column, own heading), and
 * at a known rate exactly one base belongs to it. For € 13.42 that is € 149.11 at 9% — and the
 * paper says 149.00. One line that sends the owner straight to the right column.
 *
 * Returns the base per Dutch rate, or an empty list when there is nothing to say.
 */
export function impliedBasesForBtw(btw: number | null | undefined): { rate: number; base: number }[] {
  const b = Number(btw ?? 0);
  if (!Number.isFinite(b) || b === 0) return [];
  // 0% drops out: by definition no btw amount belongs to it, so it yields no base.
  return [9, 21].map((rate) => ({ rate, base: round2(b / (rate / 100)) }));
}

/** € 1.234,56 — the same notation as the screen, so the sentence does not come from two worlds. */
function eur(n: number): string {
  return new Intl.NumberFormat("nl-NL", { style: "currency", currency: "EUR" }).format(n);
}

/**
 * The addition to "ongeldig BTW-tarief (x%)": at which ex amount this btw WOULD be right.
 *
 * Deliberately without the word "must". It is a pointer to where to look, not a verdict on which
 * amount is wrong — that cannot be established here.
 *
 * Dutch string: UI text shown to the owner, per the language rule in AGENTS.md.
 */
export function rateHint(btw: number | null | undefined, storedExcl: number | null | undefined): string | null {
  const bases = impliedBasesForBtw(btw);
  if (bases.length === 0) return null;
  const ex = Number(storedExcl ?? 0);
  const options = bases.map((b) => `${eur(b.base)} bij ${b.rate}%`).join(" of ");
  return (
    `Een BTW van ${eur(Number(btw))} hoort bij een bedrag excl. van ${options} — ` +
    `opgeslagen staat ${eur(ex)}. Staat er een 0%-post op de factuur (statiegeld, emballage, ` +
    `retour container)? Die hoort in het bedrag excl. mee te tellen, mét zijn teken.`
  );
}

/**
 * The addition to "excl + BTW ≠ totaal": the difference, and what should have been there.
 *
 * Returns null when the amounts DO add up or when there is nothing sensible to say — then the old
 * message stands, which beats a sentence implying we know.
 *
 * Dutch strings: UI text shown to the owner, per the language rule in AGENTS.md.
 */
export function reconcileHint(r: BtwReconcile): string | null {
  if (r.ok) return null;

  // [TARIEF-GEHEUGEN] Nothing was read, so there is nothing to reconcile and no sentence here can
  // be about anything. safecore already says the true thing for this case ("de BTW-uitsplitsing
  // ontbreekt — vul deze aan"), and what belongs on the screen next to it is the supplier's own
  // rate, not a remark about amounts that were never on the page.
  if (!r.splitWasRead) return null;

  const diff = `Verschil ${eur(Math.abs(r.difference))}`;

  // Exactly one reading is possible — then it may be named. This is case C: a btw of € 995.90
  // would imply 35%, a rate that does not exist, so one reading remains.
  if (r.btwRepairPossible && !r.exclRepairPossible) {
    return `${diff}. Klopt het totaal, dan hoort de BTW ${eur(r.impliedBtw)} te zijn.`;
  }
  if (r.exclRepairPossible && !r.btwRepairPossible) {
    return `${diff}. Klopt het totaal, dan hoort het bedrag excl. BTW ${eur(r.impliedExcl)} te zijn.`;
  }

  // Both are possible — then we name both and choose neither. This is cases A and B: arithmetically
  // nothing rules either out, and picking one would be guessing. The sentence does point at where
  // it usually sits on invoices like these: a 0% item (deposit, packaging, crates) or a second rate
  // left out of the breakdown.
  if (r.exclRepairPossible && r.btwRepairPossible) {
    return (
      `${diff}. Klopt het totaal, dan hoort excl. BTW ${eur(r.impliedExcl)} te zijn, ` +
      `óf de BTW ${eur(r.impliedBtw)}. Staat er een 0%-post op de factuur (statiegeld, emballage, ` +
      `kratten) of een tweede btw-tarief? Die hoort in de uitsplitsing mee te tellen.`
    );
  }

  // Neither is possible: then more than one number is wrong, and we stay silent about repairs.
  return `${diff}. Geen van beide bedragen levert een geldig btw-tarief op — controleer de hele uitsplitsing.`;
}
