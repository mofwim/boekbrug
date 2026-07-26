// src/lib/bank-statement-balance.ts
// [BANK-BALANCE] Statement-completeness check (audit §2.6). A bank statement carries its own
// opening + closing balance (MT940 :60F:/:62F:, CAMT.053 OPBD/CLBD). The ledger identity is:
//
//     opening + Σ(all transaction amounts) === closing
//
// If it doesn't hold, a transaction is MISSING (a truncated upload, a page not exported, a line
// the parser could not read) or DUPLICATED — and every downstream figure (omzet, kosten,
// voorbelasting, the kas/bank saldo) is then silently wrong with no other signal. This proves
// the file is internally complete, or names the exact euro gap so the owner can re-upload.
//
// Deliberately about the FILE, not the database: it runs on the full parse (every line the
// statement contained), independent of dedup — so it also catches a line the parser dropped,
// not just a user-truncated file. Pure; run: npx tsx src/lib/bank-statement-balance.test.ts

export interface BalanceReconciliation {
  // Whether the identity holds within tolerance. When not checkable (a balance is missing) this
  // is true — an unknowable statement is never reported as "incomplete" (no false alarm), only
  // as not-checkable via `checkable`.
  ok: boolean;
  checkable: boolean;          // both opening AND closing were present
  opening: number | null;
  closing: number | null;
  transactionsSum: number;     // Σ signed tx amounts
  expectedClosing: number | null; // opening + Σtx (null when opening missing)
  gap: number;                 // closing − expectedClosing (signed; 0 when not checkable)
  txCount: number;
  tolerance: number;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Reconcile a statement's declared balances against the sum of its transactions. `opening`/
 * `closing` are signed euros (a debit/overdrawn balance is negative); either may be null.
 * `txAmounts` are the signed amounts of EVERY transaction the statement contained (credits +,
 * debits −). A |gap| within `toleranceEur` (default 1 cent, for rounding) counts as reconciled.
 */
export function reconcileStatementBalance(
  opening: number | null,
  closing: number | null,
  txAmounts: number[],
  toleranceEur = 0.01,
): BalanceReconciliation {
  const transactionsSum = round2(txAmounts.reduce((s, a) => s + (Number.isFinite(a) ? a : 0), 0));
  const checkable = opening !== null && closing !== null;
  const expectedClosing = opening !== null ? round2(opening + transactionsSum) : null;
  const gap = checkable ? round2((closing as number) - (expectedClosing as number)) : 0;
  const ok = !checkable || Math.abs(gap) <= toleranceEur;
  return {
    ok,
    checkable,
    opening,
    closing,
    transactionsSum,
    expectedClosing,
    gap,
    txCount: txAmounts.length,
    tolerance: toleranceEur,
  };
}

const eur = (n: number) => `€${Math.abs(n).toFixed(2).replace(".", ",")}`;

/**
 * A Dutch owner-facing warning when a statement does NOT reconcile, or null when it does (or
 * can't be checked). Names the exact gap and its direction so the owner knows what to look for.
 * A positive gap (closing higher than opening+Σtx) means credits are MISSING (money that
 * arrived isn't in the file); a negative gap means debits are missing or a line is duplicated.
 */
export function balanceWarning(r: BalanceReconciliation): string | null {
  if (!r.checkable || r.ok) return null;
  const missingCredits = r.gap > 0;
  const direction = missingCredits
    ? `er lijkt ${eur(r.gap)} aan BIJgeschreven bedragen te ontbreken`
    : `er lijkt ${eur(r.gap)} aan AFgeschreven bedragen te ontbreken (of een regel staat dubbel)`;
  return (
    `Let op: dit bankafschrift sluit niet aan. Beginsaldo ${eur(r.opening as number)} + ` +
    `${r.txCount} transacties zou moeten uitkomen op ${eur(r.expectedClosing as number)}, ` +
    `maar het opgegeven eindsaldo is ${eur(r.closing as number)} — ${direction}. ` +
    `Controleer of je het volledige afschrift hebt geüpload; anders kloppen omzet, kosten en BTW niet.`
  );
}
