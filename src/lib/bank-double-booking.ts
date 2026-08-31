// src/lib/bank-double-booking.ts
// [DUBBEL-GEDEKT] Is this bank line's money ALREADY in the books? One rule, one place.
// Run: npx tsx --test src/lib/bank-double-booking.test.ts
//
// ── WHY THIS MODULE EXISTS ──
//
// Three code paths write a category onto a bank line the owner did not answer for personally:
//
//   applyLearnedBankCategories()  the import / cron / /bank-load pass
//   bulkApply()                   the "N zekere invullen" button on the categorisatie screen
//   the [ZELFDE-TEGENPARTIJ] spread, which applies one answer to the party's other lines
//
// All three run the SAME classifier (suggestIdentity) over the SAME rows and write the same
// three columns. Only the first one consulted the paid invoices first. The other two were the
// identical decision written a second and a third time, minus the guard — and the button is the
// one the owner presses, so the unguarded path was also the fast one.
//
// Measured in production the day this module was written: 53 uncategorised lines, together
// € 31.188,87, sit against a paid invoice that already explains them; 45 of those (€ 22.821,96)
// would be confidently coded 'kosten' by one press of that button. That is the same cost twice
// in the resultaat and in the closing package, and nothing downstream flags it — readiness only
// counts EXCLUDED categories, and a doubled 'kosten' is not excluded, it is deductible.
//
// So the decision lives here and the writers ask it. A fourth writer that forgets to ask is what
// [BANK-RESTANTEN] in lifecycle-gates now refuses: it derives the writer list from the source
// (every update that sets `category_confirmed: false`) rather than from a list someone maintains.
//
// ── WHY IT IS A HOLD AND NOT A CORRECTION ──
//
// The line is not wrong; it is unexplained. Either it is the payment of that invoice (the owner
// links it, and nothing is booked twice) or it is a second, real cost that happens to carry the
// same amount within a fortnight (the owner codes it, one tap). Both answers are the owner's, and
// leaving the line uncoded is what asks them. Writing a category is what stops asking.

import { round2 } from "./invoice-totals";
import { fetchAllRowsForIds } from "./supabase-paginate";

/** A paid-invoice row as the double-booking guard needs it. */
export interface PaidExplainerRow {
  direction: string | null;
  total_inc_btw: number | null;
  amount_paid: number | null;
  payment_date: string | null;
  marked_paid_at: string | null;
  invoice_date: string | null;
}

/** The bank line, as little of it as the decision needs. */
export interface GuardLine {
  amount: number | null;
  counterpart_name: string | null;
  description: string | null;
  date: string | null;
}

/** Why a category was withheld. English identifiers — these are log/counter values, not screen text. */
export type DoubleBookingHold = "paid-invoice" | "mollie-payout";

export interface DoubleBookingGuard {
  /**
   * The reason this category must NOT be written on this line, or null when it may be.
   * One method rather than a predicate plus a reason: two of those can disagree.
   */
  hold(category: string, line: GuardLine): DoubleBookingHold | null;
  /** True when the Mollie probe actually ran. False = no hold was possible, not "no Mollie". */
  molliePayoutKnown: boolean;
}

/** How far apart a bank line and an invoice's settlement may sit and still be the same money. */
export const SETTLEMENT_WINDOW_MS = 14 * 86_400_000;
/** How far back a paid Mollie link still says "this owner receives iDEAL money". */
export const MOLLIE_RECENCY_MS = 45 * 24 * 60 * 60 * 1000;

/**
 * Does a PAID invoice already explain this bank line's money? Pure — the caller reads, this
 * decides. Same direction, same magnitude to the cent, settled within two weeks of the line. An
 * UNDATABLE pair errs toward true: the guard prevents a double booking, and holding a line for a
 * human is recoverable where a doubled cost in the aangifte is not.
 */
export function paidInvoiceExplainsLine(
  paidRows: readonly PaidExplainerRow[],
  txAmount: number,
  txDate: string | null,
): boolean {
  const mag = round2(Math.abs(txAmount));
  const wantDir = txAmount < 0 ? "incoming" : "outgoing";
  const txMs = txDate ? Date.parse(txDate) : NaN;
  return paidRows.some((inv) => {
    if ((inv.direction ?? "") !== wantDir) return false;
    const invMag = round2(Math.abs(Number(inv.total_inc_btw) || 0));
    if (Math.abs(invMag - mag) > 0.01) return false;
    const settled = inv.payment_date ?? inv.marked_paid_at ?? inv.invoice_date;
    if (!settled || Number.isNaN(txMs)) return true; // undatable → err toward NOT double-booking
    const d = Math.abs(txMs - Date.parse(settled));
    return d <= SETTLEMENT_WINDOW_MS;
  });
}

/**
 * [MOLLIE-UITBETALING] A Mollie payout credit is the BATCHED, FEE-REDUCED sum of payments whose
 * invoices the webhook already marked paid — so the cent-exact amount match above can never catch
 * it (the fee shifts every amount). Pure, and MOLLIE-specific on purpose: the broad PSP regex
 * would leave a retail owner's every daily CCV settlement uncoded forever over one iDEAL payment.
 */
const MOLLIE_RE = /\bmollie\b/i;
export function isMollieCredit(line: Pick<GuardLine, "amount" | "counterpart_name" | "description">): boolean {
  return (line.amount ?? 0) > 0 && MOLLIE_RE.test(`${line.counterpart_name ?? ""} ${line.description ?? ""}`);
}

/** Only these categories carry a P&L amount; 'transfer'/'prive'/'tax' cannot double-book one. */
function isProfitAndLossCategory(category: string): boolean {
  return category === "kosten" || category === "omzet";
}

/** The composed decision, over data the caller has already read. Pure and directly testable. */
export function buildDoubleBookingGuard(input: {
  paidRows: readonly PaidExplainerRow[];
  hasRecentMolliePayout: boolean;
  molliePayoutKnown?: boolean;
}): DoubleBookingGuard {
  const { paidRows, hasRecentMolliePayout } = input;
  return {
    molliePayoutKnown: input.molliePayoutKnown ?? true,
    hold(category, line) {
      if (isProfitAndLossCategory(category) && paidInvoiceExplainsLine(paidRows, line.amount ?? 0, line.date)) {
        return "paid-invoice";
      }
      // Not restricted to P&L categories, deliberately: a Mollie payout at an owner whose invoices
      // Mollie already settled is money the app should not pre-label AT ALL — the owner is the one
      // who knows which settlement it is.
      if (hasRecentMolliePayout && isMollieCredit(line)) return "mollie-payout";
      return null;
    },
  };
}

/**
 * The minimum of a Supabase client this module uses. Structural on purpose: the cron holds a
 * service-role client and the categorisatie route holds the RLS one, and the QUERIES must not
 * differ between them — only the handle does.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type GuardReadClient = { from: (table: string) => any };

/**
 * Read what the guard needs and build it.
 *
 * `invoiceClient` reads the owner's paid invoices — RLS serves those to the owner themselves, so
 * either client works. `molliePipeline` reads `mollie_payment_links`, which carries RLS with ZERO
 * policies by design (every other access in the app goes through the service role), so an RLS
 * client would read an empty set and the hold would silently never fire. A caller that cannot
 * offer a privileged client passes null and gets `molliePayoutKnown: false` — an admission, not a
 * verdict.
 *
 * Both reads fail OPEN, deliberately and unchanged from where this rule came from: the guard
 * prevents a double booking, and its own hiccup must not switch auto-coding off wholesale.
 */
export async function readDoubleBookingGuard(args: {
  invoiceClient: GuardReadClient;
  molliePipeline: GuardReadClient | null;
  userId: string;
  lines: readonly { amount: number | null }[];
  now?: number;
}): Promise<DoubleBookingGuard> {
  const { invoiceClient, molliePipeline, userId, lines } = args;

  // Keyed on the magnitudes actually present, so the read is bounded by the work at hand.
  const candidateAmounts = [...new Set(
    lines
      .map((t) => Math.abs(Number(t.amount) || 0))
      .filter((a) => a > 0.005)
      .map((a) => round2(a)),
  )];

  let paidRows: PaidExplainerRow[] = [];
  try {
    paidRows = await fetchAllRowsForIds<PaidExplainerRow, number>(candidateAmounts, (chunk, from, to) => invoiceClient
      .from("invoices")
      .select("direction, total_inc_btw, amount_paid, payment_date, marked_paid_at, invoice_date")
      .or(`sender_id.eq.${userId},receiver_id.eq.${userId}`)
      .eq("status", "paid")
      .in("total_inc_btw", chunk)
      .order("id", { ascending: true })
      .range(from, to));
  } catch (e) {
    console.error("[DUBBEL-GEDEKT] paid-invoice read failed — this pass runs without the double-booking guard", e);
  }

  // "Recent" is enforced, not asserted: one paid link from August must not suppress coding for the
  // rest of this account's life. 45 days covers the longest Mollie payout cadence comfortably.
  let hasRecentMolliePayout = false;
  let molliePayoutKnown = false;
  if (molliePipeline) {
    try {
      const cutoff = new Date((args.now ?? Date.now()) - MOLLIE_RECENCY_MS).toISOString();
      const { data, error } = await molliePipeline
        .from("mollie_payment_links")
        .select("id")
        .eq("user_id", userId)
        .eq("status", "paid")
        .gte("paid_at", cutoff)
        .limit(1);
      // 42P01 = mollie.sql was never applied, which means no links, which means no hold — a known
      // answer, not a failed probe. Any other error is a failed probe.
      if (!error || (error as { code?: string }).code === "42P01") {
        hasRecentMolliePayout = Array.isArray(data) && data.length > 0;
        molliePayoutKnown = true;
      }
    } catch { /* a probe that threw knows nothing */ }
  }

  return buildDoubleBookingGuard({ paidRows, hasRecentMolliePayout, molliePayoutKnown });
}
