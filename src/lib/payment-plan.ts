// src/lib/payment-plan.ts
// [BETAALPLAN] One bank line, several invoices, an amount per invoice. Pure, no I/O.
// Run: npx tsx --test src/lib/payment-plan.test.ts
//
// ── WHAT THIS EXISTS FOR ──
// A wholesaler debits one amount for a week of deliveries. A customer transfers one sum against
// four of your invoices and shorts the last one by €12. A supplier deducts a creditnota from the
// batch before paying. None of that is exotic — for a shop it is Tuesday — and the app could
// express none of it: /api/bank/confirm takes ONE invoiceId, so a batch had to be booked as N
// separate calls with nothing checking the total, and a partly-paid line in the middle of a batch
// could not be expressed at all.
//
// The dangerous part is not the missing feature, it is the missing SUM. N independent calls each
// look sensible on their own; together they can book €6.200 out of a €5.000 payment, and every
// screen downstream — the P&L, the BTW return, the accountant's package — then reports money that
// was never received. So this module validates the plan AS A WHOLE before anything is written, and
// the route applies nothing at all when the whole does not hold.
//
// ── THE DETAILS THAT MAKE OR BREAK A REAL BATCH ──
//
// 1. DIRECTION. Money OUT settles purchase invoices; money IN settles sales invoices. Mixing them
//    is silent and catastrophic — a debit booked against a sales invoice reports revenue that never
//    arrived. Refused outright, never guessed.
//
// 2. THE CREDITNOTA IS NEGATIVE, AND THAT IS THE POINT. A supplier bills €1.000, credits €150 for
//    a return, and debits €850. The plan that describes that truthfully is +1.000 and −150, summing
//    to the €850 the bank actually moved. Without negative lines the owner has to lie about one of
//    the three numbers. This is the single detail that decides whether batch booking is usable.
//
// 3. THE REMAINDER IS NAMED, NEVER SWALLOWED. What is left over after the allocation is a fact
//    about the payment — a bank charge, an early-payment discount, an invoice not yet imported —
//    and the plan reports it rather than absorbing it. An allocation that silently eats €40 is how
//    a wrong number enters an administration with nothing to trace it back to.
//
// 4. WHAT THE INVOICE STILL OWES IS THE CEILING, not its total. An invoice already half paid can
//    take only its remainder; the rest of the money has to go somewhere the owner chose.
//
// 5. THE LINE'S OWN REMAINING BALANCE IS THE OTHER CEILING. A transaction already linked to other
//    invoices has less left to give than its face amount.
//
// NOTE ON LANGUAGE: identifiers and comments are English (AGENTS.md); the `message` strings are
// Dutch because the owner reads them on the bank screen.

import { CENT_EPSILON, toCents } from "./partial-payment";

/** An invoice as the plan needs to see it. */
export interface PlanInvoice {
  id: string;
  direction: "incoming" | "outgoing";
  /** 'creditnota' makes this a NEGATIVE line — money coming back, not going out. */
  invoiceType?: string | null;
  totalIncBtw: number | null;
  amountPaid?: number | null;
}

/** One row of the owner's plan: this invoice, this much of this payment. */
export interface PlanLine {
  invoiceId: string;
  /**
   * Magnitude, always positive as the owner types it. The SIGN comes from the invoice being a
   * creditnota — asking a person to type a minus is asking them to get it wrong.
   */
  amount: number;
}

export interface PlanInput {
  /** The bank line, signed: negative is money out. */
  txAmount: number;
  /**
   * What this line already gave to links made earlier. SIGNED, the same way `lines` are: an
   * already-linked creditnota is negative because it GAVE money to the line rather than taking it.
   *
   * This used to be documented as a magnitude and read through Math.abs, which is right for every
   * ordinary link and backwards for a credit — a €150 credit already on the line reduced the
   * budget by €150 instead of raising it, a €300 swing, and the screen then refused plans the
   * database would happily have booked.
   */
  alreadyAllocated?: number;
  lines: PlanLine[];
  invoices: readonly PlanInvoice[];
}

export interface ResolvedLine {
  invoiceId: string;
  /** Signed: negative for a creditnota. This is what gets booked. */
  amount: number;
  /** True when this settles the invoice completely. */
  settlesInFull: boolean;
  /** What the invoice still owes after this line. */
  remainingOnInvoice: number;
}

export type PlanVerdict =
  | {
      ok: true;
      lines: ResolvedLine[];
      /** Σ of the signed line amounts — what this plan takes from the payment. */
      allocated: number;
      /** What the payment still has left afterwards. 0 means fully explained. */
      remainder: number;
      /** A sentence about the remainder, or null when there is none. Owner-facing, Dutch. */
      remainderNote: string | null;
    }
  | { ok: false; reason: PlanRefusal; message: string; invoiceId?: string };

export type PlanRefusal =
  | "empty"
  | "unknown_invoice"
  | "duplicate_invoice"
  | "wrong_direction"
  | "not_positive"
  | "exceeds_invoice"
  | "exceeds_payment";

const eur = (n: number) =>
  `€ ${Math.abs(n).toLocaleString("nl-NL", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** What an invoice still owes, as a positive magnitude. */
function openOf(inv: PlanInvoice): number {
  const total = Math.abs(Number(inv.totalIncBtw) || 0);
  const paid = Math.abs(Number(inv.amountPaid) || 0);
  return toCents(Math.max(0, total - paid));
}

function isCreditnota(inv: PlanInvoice): boolean {
  return (inv.invoiceType ?? "factuur") === "creditnota" || (Number(inv.totalIncBtw) || 0) < 0;
}

/**
 * Which invoice direction a bank line may settle.
 *
 * Money OUT (a debit, negative) pays what YOU owe — purchase invoices. Money IN pays what is owed
 * TO you — sales invoices. There is no honest case for crossing them, so this is a refusal and not
 * a warning: booking a debit against a sales invoice reports revenue that never arrived, and
 * nothing downstream can tell that it did not.
 */
export function settleableDirection(txAmount: number): "incoming" | "outgoing" {
  return txAmount < 0 ? "incoming" : "outgoing";
}

/**
 * Validate the whole plan, then say exactly what it books and what is left over.
 *
 * Refuses rather than clamps, everywhere. A screen that shows €500, books €300 and says nothing
 * has told the owner something untrue — and this is the screen his accountant inherits.
 */
export function resolvePaymentPlan(input: PlanInput): PlanVerdict {
  const lines = Array.isArray(input.lines) ? input.lines : [];
  if (lines.length === 0) {
    return { ok: false, reason: "empty", message: "Kies eerst minstens één factuur." };
  }

  const byId = new Map(input.invoices.map((i) => [i.id, i]));
  const wanted = settleableDirection(input.txAmount);

  // What this line still has to give: its face amount minus what earlier links already took, where
  // "took" is signed — a credit among them gave money back and raises this figure.
  const payAvailable = toCents(
    Math.max(0, Math.abs(Number(input.txAmount) || 0) - (Number(input.alreadyAllocated) || 0)),
  );

  const seen = new Set<string>();
  const resolved: ResolvedLine[] = [];
  let allocated = 0;

  for (const line of lines) {
    const inv = byId.get(line.invoiceId);
    if (!inv) {
      return {
        ok: false,
        reason: "unknown_invoice",
        message: "Een van de gekozen facturen bestaat niet meer. Ververs de pagina.",
        invoiceId: line.invoiceId,
      };
    }
    if (seen.has(inv.id)) {
      return {
        ok: false,
        reason: "duplicate_invoice",
        message: "Dezelfde factuur staat er twee keer in. Vul het hele bedrag op één regel in.",
        invoiceId: inv.id,
      };
    }
    seen.add(inv.id);

    if (inv.direction !== wanted) {
      return {
        ok: false,
        reason: "wrong_direction",
        message:
          wanted === "incoming"
            ? "Dit is geld dat WEGGING. Daar horen inkoopfacturen bij, geen verkoopfacturen."
            : "Dit is geld dat BINNENKWAM. Daar horen verkoopfacturen bij, geen inkoopfacturen.",
        invoiceId: inv.id,
      };
    }

    const want = Number(line.amount);
    if (!Number.isFinite(want) || want <= 0) {
      return {
        ok: false,
        reason: "not_positive",
        message: "Vul een bedrag in dat groter is dan nul.",
        invoiceId: inv.id,
      };
    }

    const amount = toCents(want);
    const open = openOf(inv);
    if (amount > open + CENT_EPSILON) {
      return {
        ok: false,
        reason: "exceeds_invoice",
        message: `Deze factuur staat nog voor ${eur(open)} open — meer kan er niet op.`,
        invoiceId: inv.id,
      };
    }

    // [CREDITNOTA] The sign lives here and nowhere else. The owner types 150; a creditnota makes it
    // −150, which is what lets a €1.000 invoice and a €150 credit add up to the €850 the bank moved.
    const signed = isCreditnota(inv) ? -amount : amount;
    allocated = toCents(allocated + signed);

    resolved.push({
      invoiceId: inv.id,
      amount: signed,
      settlesInFull: Math.abs(amount - open) <= CENT_EPSILON,
      remainingOnInvoice: toCents(Math.max(0, open - amount)),
    });
  }

  // ── The net must be POSITIVE, and this is not a formality ────────────────────────────────────
  //
  // The creditnota's minus sign is what makes a real batch expressible, and it is also the thing
  // that lets a plan describe something that cannot have happened. Two shapes got through every
  // check above:
  //
  //   · a creditnota ALONE against a debit — allocated −1.000 on a payment of 850, which then
  //     reported €1.850 "left to divide" out of money that moved €850, and settled a creditnota
  //     with a payment that had nothing to do with it;
  //   · an invoice and an equal creditnota — allocated 0, booking BOTH as settled out of a
  //     payment that gave neither of them a cent.
  //
  // Both are arithmetic that is internally fine and about a world that does not exist. A bank line
  // MOVED money in one direction; a plan that nets to zero or backwards is not a payment. Offsetting
  // a creditnota against an invoice with no money involved is a real thing an entrepreneur does —
  // it is simply not this screen, because there is no bank line to hang it on.
  if (allocated <= CENT_EPSILON) {
    return {
      ok: false,
      reason: "not_positive",
      message:
        "Zo betaalt deze betaling per saldo niets. Een creditnota gaat eraf, dus er moet ook een " +
        "factuur bij staan die groter is.",
    };
  }

  // The sum guard. Everything above is per-line and each line can be perfectly reasonable while the
  // total books money that does not exist — this is the check that only a whole plan can make.
  if (allocated > payAvailable + CENT_EPSILON) {
    return {
      ok: false,
      reason: "exceeds_payment",
      message: `Je verdeelt ${eur(allocated)} terwijl deze betaling nog ${eur(payAvailable)} te vergeven heeft.`,
    };
  }

  const remainder = toCents(payAvailable - allocated);
  return { ok: true, lines: resolved, allocated, remainder, remainderNote: remainderNote(remainder) };
}

/**
 * What to say about the money this plan does not explain.
 *
 * Deliberately a QUESTION, not a verdict. The app cannot know whether €12 left over is a bank
 * charge, an early-payment discount or an invoice that was never imported — and each of those has
 * a different right answer. Naming the amount and leaving the reason to the owner is the honest
 * shape; guessing it is how a wrong write-off enters the books with our name on it.
 */
export function remainderNote(remainder: number): string | null {
  if (Math.abs(remainder) <= CENT_EPSILON) return null;
  return (
    `Er blijft ${eur(remainder)} van deze betaling over. Dat kan een bankkost zijn, een ` +
    `betaalkorting, of een factuur die er nog niet in staat — die blijft gewoon openstaan.`
  );
}
