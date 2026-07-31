// src/lib/bank-rematch.ts
// [BANK-REMATCH] Which set-aside bank lines deserve a second look? Pure, no I/O.
// Run: npx tsx src/lib/bank-rematch.test.ts
//
// WHY THIS EXISTS — what the normal flow can and cannot heal by itself:
//
//   status 'pending'   → /api/bank/match re-scores it against every open invoice on EVERY page
//                        load, and runBankAutoConfirm books it the moment it becomes certain.
//                        Nothing is stuck here: an invoice imported today is matched against
//                        last month's payment the next time the page opens.
//   status 'not_found' → the owner set it aside ("Genegeerd"). /api/bank/match reads ONLY
//                        'pending', so this line is invisible to the matcher FOREVER. It is
//                        never re-examined, no matter what arrives later.
//
// That asymmetry is the whole problem. An owner ignores a payment in June precisely BECAUSE the
// invoice wasn't there — the supplier hadn't sent it, the scan failed, the e-mail bounced. When
// the invoice finally lands in August, every other line in the app finds it; this one cannot,
// because the reason it was ignored is the reason it can no longer be seen. The decision outlives
// the situation that justified it.
//
// WHAT THIS DOES NOT DO — it never mass-un-ignores. "Genegeerd" is a real decision (a standing
// order, a lease instalment, a private transfer) and the owner made it to stop being asked. A
// force pass that dumped every ignored line back into the active list would hand back exactly the
// work they deliberately cleared, and they would never trust the button twice. So a line comes
// back ONLY when the premise of the decision is provably gone: the matcher now gives it a single
// clear winner ('auto'). Anything weaker is REPORTED, never acted on — see planRematch.

import { matchTransactions, type InvoiceForMatching } from "./bank-matching";
import type { BankTransaction } from "./bank-parser";

/** One set-aside line that now has a clear invoice waiting for it. */
export interface RematchRestore {
  transactionId: string;
  invoiceId: string;
  invoiceNumber: string | null;
  confidence: number;
}

export interface RematchPlan {
  /** Ignored lines with a single clear winner → put back in the active list. */
  restore: RematchRestore[];
  /** Ignored lines the pass found something for but deliberately did NOT act on, for either
   *  reason below. Named so the owner can look; never touched, because an unrequested ambiguous
   *  suggestion is the nagging they used "Genegeerd" to escape.
   *    · the matcher could not pick a single winner, or
   *    · the invoice it would point at is already a candidate of a LIVE line (see planRematch). */
  ambiguous: string[];
  /** Ignored lines that still match nothing — the owner's decision stands untouched. */
  unchanged: number;
}

/**
 * Decide which ignored lines to reactivate.
 *
 * Two passes, because reviving a set-aside line must never cost the ACTIVE list anything.
 *
 *   1. The pending lines are scored ALONE first, and every invoice any of them lists as a
 *      candidate is recorded as "in play".
 *   2. The pending and ignored lines are then scored TOGETHER, so matchTransactions' closing
 *      one-to-one guard (an invoice is paid once) judges them in one field rather than letting a
 *      resurrected line and a live line each believe they own the same bill.
 *
 * An ignored line is restored only when pass 2 gives it a single clear winner AND pass 1 shows no
 * live line was considering that invoice. The second condition is the one that matters, and it is
 * deliberately not left to the guard: the guard resolves ties by CONFIDENCE, and confidence does
 * not rank identity the way a human would. A payment whose counterpart name, amount and date all
 * line up scores a full 1.0, while a payment that literally prints the invoice number caps at 0.97
 * — so the guard can hand the invoice to the look-alike and leave the line that quoted the number
 * with nothing. Inside the active list that trade is at least visible; making it silently, to a
 * line the owner had already set aside, would be a regression they never asked for. When an
 * invoice is already in play we therefore report the ignored line and leave it alone.
 *
 * Nothing is ever decided ABOUT a pending line here — they are context in both passes.
 */
export function planRematch(args: {
  /** Lines the owner set aside (status 'not_found'). transactionId carries the DB row id. */
  ignored: BankTransaction[];
  /** Lines still in the active list — context for the one-to-one guard, never acted on. */
  pending: BankTransaction[];
  /** The user's unpaid invoices, exactly as /api/bank/match feeds them. */
  invoices: InvoiceForMatching[];
}): RematchPlan {
  const { ignored, pending, invoices } = args;
  const ignoredIds = new Set(ignored.map((t) => t.transactionId).filter((id): id is string => !!id));
  if (ignoredIds.size === 0 || invoices.length === 0) {
    return { restore: [], ambiguous: [], unchanged: ignoredIds.size };
  }

  // Pass 1 — which invoices is the ACTIVE list already working on? Every candidate counts, not
  // just each line's best: a candidate the owner can still pick is an invoice in play.
  const inPlay = new Set<string>();
  if (pending.length > 0) {
    for (const m of matchTransactions(pending, invoices).matches) {
      for (const c of m.candidates) inPlay.add(c.invoiceId);
    }
  }

  // Pass 2 — judge the set-aside lines in the same field as the live ones.
  const result = matchTransactions([...pending, ...ignored], invoices);

  const restore: RematchRestore[] = [];
  const ambiguous: string[] = [];
  let unchanged = 0;

  for (const m of result.matches) {
    const id = m.transaction.transactionId;
    if (!id || !ignoredIds.has(id)) continue; // pending lines are context only
    if (m.outcome === "auto" && m.best) {
      if (inPlay.has(m.best.invoiceId)) {
        ambiguous.push(id); // a live line is already considering this invoice — hands off
      } else {
        restore.push({
          transactionId: id,
          invoiceId: m.best.invoiceId,
          invoiceNumber: m.best.invoiceNumber,
          confidence: m.best.confidence,
        });
      }
    } else if (m.outcome === "choice") {
      ambiguous.push(id);
    } else {
      unchanged++;
    }
  }

  return { restore, ambiguous, unchanged };
}
