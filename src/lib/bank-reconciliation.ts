// src/lib/bank-reconciliation.ts
// [BANK-RECON-BADGE] Invoice-centric reconciliation status — the inverse of the
// transaction-centric matcher. Given the owner's bank_transactions that are linked to an
// invoice, plus the pending match suggestions, it answers per invoice:
//
//   - linked:       a bank line already points at this invoice (invoice_id set). The
//                   payment is in the bank statement → "Betaald · in bankafschrift".
//   - pendingMatch: this invoice is the CONFIDENT match (the engine's 'auto' best) of a
//                   still-unconfirmed bank line → "Betaling gevonden → bevestigen"
//                   (one tap on the bank page, never auto-paid).
//
// Deliberately conservative: only an 'auto' suggestion tags an invoice. An ambiguous
// 'choice' (e.g. four same-amount monthly rent invoices) tags NOTHING — surfacing "we
// found your payment" on all four would be a false claim. The two states are disjoint:
// the matcher excludes paid invoices from candidates, so a linked/paid invoice never also
// shows a pendingMatch.
//
// Pure + testable: run `npx tsx src/lib/bank-reconciliation.test.ts`.

/** A bank line that already references an invoice (bank_transactions.invoice_id set). */
export interface ReconLink {
  invoiceId: string;
  txStatus: string | null; // 'matched' (fully) | 'pending' (partial multi) | ...
}

/** One candidate inside a suggestion (mirrors MatchCandidate's UI-relevant fields). */
export interface ReconCandidate {
  invoiceId: string;
  confidence: number;
}

/** A per-transaction suggestion from the matcher (the fields we need). */
export interface ReconSuggestion {
  transactionId: string | null;
  outcome: "auto" | "choice" | "none";
  best: ReconCandidate | null;
  candidates: ReconCandidate[];
}

export interface InvoiceRecon {
  /** A bank line points at this invoice → the payment is in the statement. */
  linked: boolean;
  /** The invoice is the confident 'auto' match of an unconfirmed bank line. */
  pendingMatch: { transactionId: string; confidence: number } | null;
}

/**
 * Compute per-invoice reconciliation status.
 *
 * `links` come from bank_transactions rows whose invoice_id is set (any status).
 * `suggestions` come from the same matcher the bank page uses (paid invoices already
 * excluded from candidates upstream).
 *
 * Returns a plain map keyed by invoiceId. An invoice absent from the map has no bank
 * relationship at all (state 'none' — the caller shows no reconciliation badge).
 */
export function computeInvoiceReconciliation(
  links: ReconLink[],
  suggestions: ReconSuggestion[],
): Record<string, InvoiceRecon> {
  const out: Record<string, InvoiceRecon> = {};

  const ensure = (id: string): InvoiceRecon => {
    let r = out[id];
    if (!r) {
      r = { linked: false, pendingMatch: null };
      out[id] = r;
    }
    return r;
  };

  // 1) Linked bank lines → the payment is already in the statement.
  for (const l of links) {
    if (!l.invoiceId) continue;
    ensure(l.invoiceId).linked = true;
  }

  // 2) Confident pending matches. Only 'auto' with a best candidate; keep the strongest
  //    per invoice. Never overwrites a linked invoice (disjoint, but guard anyway).
  for (const s of suggestions) {
    if (s.outcome !== "auto" || !s.best || !s.transactionId) continue;
    const { invoiceId, confidence } = s.best;
    if (!invoiceId) continue;
    const r = ensure(invoiceId);
    if (r.linked) continue; // already reconciled — no "found" hint needed
    if (!r.pendingMatch || confidence > r.pendingMatch.confidence) {
      r.pendingMatch = { transactionId: s.transactionId, confidence };
    }
  }

  return out;
}
