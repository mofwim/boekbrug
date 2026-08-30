// src/lib/client-payment-behaviour.ts
// [BETAALGEDRAG] How this customer actually pays — computed, not typed in by hand.
// Pure, no I/O, no clock of its own. Run: npx tsx --test src/lib/client-payment-behaviour.test.ts
//
// ── WHY THIS EXISTS ──────────────────────────────────────────────────────────────────────
//
// The customer detail screen already reads EVERY invoice for one customer — invoice date, due
// date, status, amount, fully paginated because the screen promises the complete history
// ([VOL-GELEZEN] in klanten/[id]/page.tsx). It computes "Gefactureerd" and "Openstaand" from
// them. And then, directly underneath, it offers a free-text box whose placeholder invites the
// owner to write down, in their own words:
//
//     "Context over deze klant — afspraken, voorkeuren, betaalgedrag…"   (kld.notitiesHint)
//
// The app holds every invoice date, every due date and every bank-matched payment_date for that
// same customer. It knows the answer exactly. It was asking the owner to type it from memory.
//
// That is the defect this module closes, and it is a money defect rather than a convenience one:
// "when will this money actually arrive" is the question a one-person business runs out of cash
// by guessing at. A number the app can derive is worth more than a note somebody wrote once in
// 2024 and never revised.
//
// ── WHAT MAKES THE NUMBER SAFE TO LEAN ON ────────────────────────────────────────────────
//
// A verdict about how somebody pays is a claim about a third party the owner has to keep doing
// business with. So every rule below leans the careful way, and says so when it does:
//
//   · THE MEDIAN, NEVER THE AVERAGE. One invoice that sat for 300 days because of a dispute
//     drags an average across the whole relationship and brands a customer who pays in a week.
//     The median is what "how they normally pay" means.
//   · ABSENT, NEVER ZERO. Under MIN_MEASURED_INVOICES observations there is no verdict at all —
//     not "0 dagen". A reassuring zero where a real figure belongs is the lie this codebase
//     refuses everywhere else ([NO-SILENT-EMPTY]), and it would be worst here, where zero reads
//     as "pays instantly".
//   · WHAT COULD NOT BE MEASURED IS REPORTED, NOT DROPPED. A paid invoice missing a payment_date
//     (marked paid by hand, or from before the bank match existed) is counted in `unmeasured` and
//     shown. A verdict resting on 4 of 30 invoices must not look like one resting on 30.
//   · AN IMPOSSIBLE PAIR IS REFUSED, NOT REPAIRED. A payment dated before its own invoice is a
//     data error; it is excluded and counted, never clamped to zero days.
//   · THE ROUNDING LEANS SLOW. An even sample medians between two days; Math.round takes .5
//     upward, which reports the customer as marginally SLOWER than the midpoint. Flattering a
//     debtor is the one direction with a cost.
//
// ── TWO NUMBERS, BECAUSE THEY ANSWER DIFFERENT QUESTIONS ─────────────────────────────────
//
// `medianDaysAfterInvoice` answers "when do I see the money" — the cash-flow question, asked
// while writing the next invoice. `medianDaysBeyondTerm` answers "is this customer a problem" —
// the same relationship measured against what was agreed. A customer paying in 40 days on a
// 60-day term is fast; one paying in 20 days on a 7-day term is late. Only the second number
// knows the difference, and only the first one buys groceries.

import { dayNumberFromIso } from "./invoice-reminders";
import { round2 } from "./invoice-totals";
import { openAmount } from "./partial-payment";

/** The invoice fields this module reads. A subset of the invoices row. */
export interface BehaviourInvoice {
  invoice_date: string | null;
  due_date: string | null;
  status: string | null;
  payment_date: string | null;
  total_inc_btw: number | null;
  /**
   * [CREDITNOTA-NO-CHASE] Which kind of document this is. Optional so a caller that never had it
   * keeps its old behaviour for ordinary invoices — but it is what makes the promise below true.
   */
  invoice_type?: string | null;
  /** [PARTIAL-PAY] What has already been received. Absent reads as nothing received. */
  amount_paid?: number | null;
}

/**
 * How many measurable invoices before a pace is stated at all.
 *
 * Three is the smallest number at which a median means anything: with two, the "median" is the
 * midpoint of the only two facts there are, and one unusual invoice moves it half its own width.
 */
export const MIN_MEASURED_INVOICES = 3;

/**
 * Why there is no verdict — as codes, never sentences. The wording lives with the screen
 * (messages.ts), the way btw-reservation.ts keeps its copy out of the engine.
 */
export type BehaviourAbsence =
  | "no_invoices" // nothing has ever been billed to this customer
  | "none_paid" // invoices exist, none is paid yet
  | "no_payment_dates" // paid invoices exist, not one carries the dates needed to measure
  | "too_few"; // measurable, but under MIN_MEASURED_INVOICES

export interface PaymentPace {
  /** How many invoices the two medians below actually rest on. */
  sample: number;
  /** Median days from invoice date to payment date. */
  medianDaysAfterInvoice: number;
  /** Median days past the due date. Negative means they pay BEFORE the term is up. */
  medianDaysBeyondTerm: number;
  /** Paid on or before the due date. */
  onTime: number;
  /** Paid after it. onTime + late === sample. */
  late: number;
  /** The worst single case in the sample, in days past the term. */
  slowestDaysBeyondTerm: number;
}

/** Invoices standing open past their due date right now. */
export interface OverdueNow {
  count: number;
  /** Total incl. btw still outstanding on those invoices. */
  amount: number;
  /** Days late of the oldest one. */
  oldestDaysLate: number;
}

export interface PaymentBehaviour {
  /** The verdict, or null when there is not enough to state one honestly. */
  pace: PaymentPace | null;
  /** Why not, when pace is null. Exactly one of pace/absence is set. */
  absence: BehaviourAbsence | null;
  /** Paid invoices that could NOT be measured — always shown, never quietly dropped. */
  unmeasured: {
    /** Paid, but missing an invoice, due or payment date. */
    missingDate: number;
    /** Paid before its own invoice date — a data error, refused rather than repaired. */
    impossible: number;
  };
  /** Open and past due today, or null when nothing is. */
  overdue: OverdueNow | null;
}

/**
 * An invoice that is out with the customer and awaiting payment.
 *
 * Deliberately narrower than the screen's own "not paid": a draft is not owed by anybody yet, and
 * a creditnota is money going the other way. Counting either as overdue would put a debt on the
 * screen that does not exist.
 */
const AWAITING = new Set(["sent", "overdue"]);

/**
 * …and the type check that actually delivers the second half of that promise.
 *
 * AWAITING is a set of STATUSES, and a creditnota has the same statuses an invoice has — there is
 * a live `status='sent', invoice_type='creditnota'` row in this database today. So the sentence
 * above was true about drafts and false about credit notes: a sent creditnota past its due date
 * was counted as an overdue debt, and because its total is stored negative it SUBTRACTED from the
 * overdue euros while ADDING to the overdue count. The screen then read "2 facturen te laat" over
 * an amount smaller than one of them.
 *
 * A pro_forma is excluded by the same line, for the same reason: it is not owed either.
 */
function isReceivable(iv: BehaviourInvoice): boolean {
  return (iv.invoice_type ?? "factuur") === "factuur";
}

/** Median of a non-empty list of whole days, leaning slow on an even split (see the header). */
function medianDays(sorted: readonly number[]): number {
  const mid = sorted.length >> 1;
  if (sorted.length % 2 === 1) return sorted[mid];
  return Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

/**
 * What this customer's own invoice history says about how they pay.
 *
 * `todayDayNumber` is INJECTED — the same whole-day number `dayNumberFromIso` produces, so the
 * caller judges against the Amsterdam day it already computed and this stays testable.
 */
export function clientPaymentBehaviour(
  invoices: readonly BehaviourInvoice[],
  todayDayNumber: number,
): PaymentBehaviour {
  const afterInvoice: number[] = [];
  const beyondTerm: number[] = [];
  let paidCount = 0;
  let missingDate = 0;
  let impossible = 0;

  let overdueCount = 0;
  let overdueAmount = 0;
  let oldestDaysLate = 0;

  // [CREDITNOTA-NO-CHASE] Filtered ONCE, at the top, so the type check reaches both halves of
  // this engine. The overdue euros are the obvious half; the pace median is the quieter one — a
  // creditnota's payment_date is the day the OWNER paid the customer back, and feeding that into
  // "how fast does this customer pay me" moves the verdict on the strength of a refund.
  const receivables = invoices.filter(isReceivable);

  for (const iv of receivables) {
    const status = iv.status ?? "";
    const due = dayNumberFromIso(iv.due_date);

    if (status === "paid") {
      paidCount++;
      const inv = dayNumberFromIso(iv.invoice_date);
      const pay = dayNumberFromIso(iv.payment_date);
      if (inv === null || due === null || pay === null) {
        missingDate++;
        continue;
      }
      if (pay < inv) {
        impossible++;
        continue;
      }
      afterInvoice.push(pay - inv);
      beyondTerm.push(pay - due);
      continue;
    }

    if (AWAITING.has(status) && due !== null && due < todayDayNumber) {
      overdueCount++;
      // [PARTIAL-PAY] What is still OWED, not what was once billed. This added the full
      // total_inc_btw, so a € 1.000 invoice with € 900 already in the bank was chased for
      // € 1.000 — on the panel the owner reads before picking up the telephone, and against the
      // reminder mail, which has always asked only for the remainder.
      overdueAmount += openAmount(iv);
      oldestDaysLate = Math.max(oldestDaysLate, todayDayNumber - due);
    }
  }

  const overdue: OverdueNow | null =
    overdueCount === 0
      ? null
      : { count: overdueCount, amount: round2(overdueAmount), oldestDaysLate };
  const unmeasured = { missingDate, impossible };

  const sample = afterInvoice.length;
  if (sample < MIN_MEASURED_INVOICES) {
    const absence: BehaviourAbsence =
      receivables.length === 0
        ? "no_invoices"
        : paidCount === 0
          ? "none_paid"
          : sample === 0
            ? "no_payment_dates"
            : "too_few";
    return { pace: null, absence, unmeasured, overdue };
  }

  const sortedAfter = [...afterInvoice].sort((a, b) => a - b);
  const sortedBeyond = [...beyondTerm].sort((a, b) => a - b);
  const late = beyondTerm.filter((d) => d > 0).length;

  return {
    pace: {
      sample,
      medianDaysAfterInvoice: medianDays(sortedAfter),
      medianDaysBeyondTerm: medianDays(sortedBeyond),
      onTime: sample - late,
      late,
      slowestDaysBeyondTerm: sortedBeyond[sortedBeyond.length - 1],
    },
    absence: null,
    unmeasured,
    overdue,
  };
}
