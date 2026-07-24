// src/lib/card-reconcile.ts
// [CARD-RECON] Pure engine — closes the reconciliation triangle for card takings. No I/O,
// fully testable (run: npx tsx src/lib/card-reconcile.test.ts).
//
// The problem it fixes: the till records PIN GROSS; the bank receives the acquirer's
// payout NET of commission, a day later, weekend shifts merged. The old reconcileDay
// compared gross-till directly to net-bank and, to avoid a daily false break, swallowed
// the difference in a tolerance — silently discarding the acquirer commission (profit
// overstated, its BTW lost). The EFT terminal settlement (gross, per shift) is the missing
// middle that lets us split that one fuzzy comparison into TWO exact legs:
//
//   Leg A  (gross == gross):  till PIN  ==  EFT gross   → a break here is a REAL
//          till/terminal discrepancy (missing bon, skim, terminal fault). Tight tolerance.
//   Leg B  (gross − net):     EFT gross −  bank net     → the acquirer COMMISSION, a real
//          cost. Surfaced and booked, never hidden.
//
// The bookkeeper's PIN ledger (ledger-import, kind="pin") is an optional third gross
// witness for Leg A. The bank NET payout is optional too — when it is absent we honestly
// report the card gross as verified but the payout/commission as "not yet matched", rather
// than inventing a number.

export interface CardDayInput {
  date: string;                 // ISO 'YYYY-MM-DD'
  tillPin: number | null;       // till pin_amount for the day (GROSS)
  eftGross: number | null;      // Σ EFT settlement grossTotal keyed to this day (GROSS)
  bankNet?: number | null;      // Σ bank pos_income settled for this day (NET) — optional
  ledgerPin?: number | null;    // bookkeeper PIN-ledger gross for this day — optional
  tolerance?: number;           // absolute euro floor (default €0.02)
  tolerancePct?: number;        // relative floor for Leg A (default 0.1% — both are gross)
  maxCommissionPct?: number;    // commission above this fraction of gross is implausible (default 5%)
}

export interface CardBreak {
  kind: "card_gross" | "ledger_pin" | "commission_negative" | "commission_implausible";
  expected: number;
  actual: number;
  diff: number;
  note: string;                 // Dutch
}

export interface CardDayResult {
  date: string;
  tillPin: number | null;       // echo of the inputs, so the CSV/UI can show the row
  eftGross: number | null;
  bankNet: number | null;
  ledgerPin?: number | null;    // echo — the bookkeeper's PIN grootboek witness (cross-check only)
  grossMatch: boolean | null;   // till == EFT (null when either side is missing)
  grossDiff: number | null;     // eftGross − tillPin
  commission: number | null;    // eftGross − bankNet (null when bankNet absent)
  status: "ok" | "gross_mismatch" | "commission_issue" | "incomplete";
  breaks: CardBreak[];
  notes: string[];              // Dutch, honest — what is and isn't verified
}

const r2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Reconcile one day's card takings across the triangle. Pure; the caller aggregates
 * per-day figures (summing EFT shifts by settlementDate and bank settlements by DAT.).
 */
export function reconcileCardDay(input: CardDayInput): CardDayResult {
  const absTol = input.tolerance ?? 0.02;
  const pctTol = input.tolerancePct ?? 0.001; // 0.1% — Leg A is gross vs gross, should be tight
  const maxCommPct = input.maxCommissionPct ?? 0.05;
  const breaks: CardBreak[] = [];
  const notes: string[] = [];

  const within = (diff: number, expected: number): boolean => {
    const diffCents = Math.round(diff * 100);
    const tolCents = Math.round(Math.max(absTol, pctTol * Math.abs(expected)) * 100);
    return Math.abs(diffCents) <= tolCents;
  };

  // ── Leg A: till PIN (gross) == EFT gross ──
  let grossMatch: boolean | null = null;
  let grossDiff: number | null = null;
  if (input.tillPin != null && input.eftGross != null) {
    grossDiff = r2(input.eftGross - input.tillPin);
    grossMatch = within(grossDiff, input.tillPin);
    if (!grossMatch) {
      breaks.push({ kind: "card_gross", expected: input.tillPin, actual: input.eftGross, diff: grossDiff,
        note: `Kassa PIN (${input.tillPin.toFixed(2)}) ≠ terminal-afrekening (${input.eftGross.toFixed(2)}). Beide zijn bruto — dit is een echt verschil (ontbrekende bon, terminalstoring of afroming), geen commissie.` });
    }
  } else {
    notes.push("Kaart-bruto niet volledig te controleren: kassa-PIN of terminal-afrekening ontbreekt voor deze dag.");
  }

  // ── Optional gross witness: the bookkeeper's PIN ledger ──
  if (input.ledgerPin != null && input.tillPin != null) {
    const d = r2(input.ledgerPin - input.tillPin);
    if (!within(d, input.tillPin)) {
      breaks.push({ kind: "ledger_pin", expected: input.tillPin, actual: input.ledgerPin, diff: d,
        note: `PIN-grootboek (${input.ledgerPin.toFixed(2)}) ≠ kassa-PIN (${input.tillPin.toFixed(2)}).` });
    }
  }

  // ── Leg B: commission = EFT gross − bank net ──
  let commission: number | null = null;
  if (input.eftGross != null && input.bankNet != null) {
    commission = r2(input.eftGross - input.bankNet);
    if (commission < -Math.max(absTol, 0.001 * input.eftGross)) {
      // Bank paid out MORE than the gross card sales → this payout isn't (only) this day's
      // card takings; do not book a negative "commission".
      breaks.push({ kind: "commission_negative", expected: input.eftGross, actual: input.bankNet, diff: commission,
        note: `Bank-uitbetaling (${input.bankNet.toFixed(2)}) is hoger dan de bruto kaartomzet (${input.eftGross.toFixed(2)}). De uitbetaling hoort waarschijnlijk (deels) bij een andere dag/shift.` });
      commission = null;
    } else if (commission > maxCommPct * input.eftGross) {
      breaks.push({ kind: "commission_implausible", expected: 0, actual: commission, diff: commission,
        note: `Commissie (${commission.toFixed(2)}) is meer dan ${(maxCommPct * 100).toFixed(0)}% van de kaartomzet — controleer of de bank-uitbetaling bij deze dag hoort.` });
    } else if (commission > 0) {
      notes.push(`Acquirer-commissie deze dag: €${commission.toFixed(2)} (bruto ${input.eftGross.toFixed(2)} − netto ${input.bankNet.toFixed(2)}). Geboekt als betaalkosten; binnenlandse PIN-transactiekosten zijn BTW-VRIJGESTELD (vrijstelling betalingsverkeer), dus er wordt geen voorbelasting geclaimd.`);
    }
  } else if (input.eftGross != null) {
    notes.push("Bank-uitbetaling nog niet gekoppeld: commissie voor deze dag is nog niet bekend (upload het bankafschrift met de acquirer-uitbetaling).");
  }

  const status: CardDayResult["status"] =
    breaks.some((b) => b.kind === "card_gross" || b.kind === "ledger_pin") ? "gross_mismatch"
    : breaks.length > 0 ? "commission_issue"
    : (grossMatch === null || (input.bankNet == null && input.eftGross != null)) ? "incomplete"
    : "ok";

  return {
    date: input.date,
    tillPin: input.tillPin, eftGross: input.eftGross, bankNet: input.bankNet ?? null,
    ledgerPin: input.ledgerPin ?? null,
    grossMatch, grossDiff, commission, status, breaks, notes,
  };
}

export interface CardPeriodResult {
  days: CardDayResult[];
  totalCommission: number;      // Σ booked commissions (real cost for the period)
  grossMismatchDays: number;    // days where Leg A failed (real discrepancies)
  incompleteDays: number;       // days where the payout/commission isn't matched yet
}

// [TRIANGLE] Known card-acquirer / PSP vendor names. An incoming invoice from one of
// these IS the commission already booked as kosten — so its amount is subtracted from the
// triangle commission before booking, or the fee is counted twice. This turns Finding 1's
// prose "guard" into real code.
export const ACQUIRER_VENDOR_RE =
  /\b(ccv|worldline|paysquare|adyen|equens|mollie|buckaroo|sum\s?up|zettle|izettle|nets|stripe|klarna|rabo\s?omnikassa|omnikassa)\b/i;

/**
 * The commission to actually book as a cost: the raw triangle commission (Σ EFT gross −
 * bank net) MINUS any acquirer-fee invoices already sitting in kosten, floored at 0. If the
 * store uploaded the acquirer's fee invoice, that invoice already carried the cost (and its
 * BTW as voorbelasting) through the normal invoice path, so only the residual is booked.
 */
export function netCommissionToBook(rawCommission: number, acquirerFeesAlreadyBooked: number): number {
  return Math.max(0, r2(rawCommission - Math.max(0, acquirerFeesAlreadyBooked)));
}

/**
 * Reconcile a period of card days and aggregate the commission + exception counts.
 *
 * [CROSS-QUARTER] `isInWindow`, when given, marks which days belong to the REPORTING period. Days
 * outside it are still reconciled and returned in `days[]` (so a buffer day can ANCHOR the
 * re-attribution of a cross-boundary payout — see reconcileTriangle), but they contribute NOTHING to
 * `totalCommission` / `grossMismatchDays` / `incompleteDays`. This is what lets a payout that posts a
 * few days into the next quarter book its commission in the quarter that OWNS the takings day, exactly
 * once, without the neighbouring quarter also counting it. With no predicate → byte-identical to
 * before (every day contributes).
 */
export function reconcileCardPeriod(
  inputs: CardDayInput[],
  isInWindow?: (date: string) => boolean,
): CardPeriodResult {
  const days = inputs.map(reconcileCardDay);
  let totalCommission = 0;
  let grossMismatchDays = 0;
  let incompleteDays = 0;
  for (const d of days) {
    if (isInWindow && !isInWindow(d.date)) continue; // buffer anchor — reconciled, but not this period's figure

    // Book commission (Leg B = eftGross − bankNet) unless a MONEY-relevant break makes the day
    // suspect: a card_gross break (till ≠ terminal → the gross itself is uncertain) or an
    // implausible commission. A ledger_pin break must NOT withhold it — the bookkeeper's PIN
    // grootboek is an independent cross-check of the TILL, not of Leg B, so a ledger disagreement
    // cannot make the eftGross−bankNet commission wrong. (It still surfaces as a break/exception.)
    // This keeps the commission — a real, booked cost — decoupled from the ledger witness.
    const moneyBreak = d.breaks.some((b) => b.kind === "card_gross" || b.kind === "commission_implausible");
    if (!moneyBreak && d.commission != null && d.commission > 0) totalCommission = r2(totalCommission + d.commission);
    if (d.status === "gross_mismatch") grossMismatchDays += 1;
    if (d.status === "incomplete") incompleteDays += 1;
  }
  return { days, totalCommission, grossMismatchDays, incompleteDays };
}
