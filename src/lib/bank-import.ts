// lib/bank-import.ts
// [BOEK-016] Pure import helpers: content fingerprint + cross-upload dedup + DB-row mapping.
// No I/O — testable with `npx tsx`. The route (api/bank/upload) is a thin shell over these.
//
// Dedup design (Tech Lead point, phase 2):
//   - bank_transactions has NO transaction_id / hash column (decision #4: no migration now),
//     so dedup is CONTENT-based.
//   - We must NOT collapse legitimate identical transactions inside a single statement
//     (e.g. two €4 coffees, same day, same description = two real transactions).
//   - Therefore: multiset diff. Insert only the COUNT of each fingerprint that exceeds
//     what is already stored for this user in the same date range.
//       first upload          → existing 0, file 2 coffees → insert 2
//       re-upload same file    → existing 2, file 2 coffees → insert 0
//       new period (new date)  → different key             → insert as new

import type { BankTransaction } from "./bank-parser";
import { classifyBankTransaction } from "./bank-identity";

/** Row shape inserted into bank_transactions. status starts 'pending' (human confirms later). */
export interface BankTransactionRow {
  user_id: string;
  date: string | null;
  amount: number | null;
  description: string | null;
  counterpart_name: string | null;
  // [BANK-IBAN] The counterpart's IBAN parsed from the statement — kept so the matcher can pair a
  // payment to the invoice bearing the SAME supplier account (a strong, collision-free signal).
  counterpart_iban: string | null;
  reference: string | null;
  status: "pending";
  // [BANK-AUTOCAT] Structural identity assigned at import (pos_income / fee / tax /
  // transfer / prive). Only the UNAMBIGUOUS, structurally-detectable ones are set; a
  // genuine business line the classifier can't explain stays null for the owner to code
  // as kosten/omzet. Without this every line imported as null, so a retail store's card
  // settlements (AFREK. BETAALAUTOMAAT) never reached the result until manually tagged.
  category: string | null;
}

/** Subset of an existing DB row needed for dedup (from a scoped SELECT).
 *  [BANK-DEDUP-DOUBLE] `description` is no longer part of the fingerprint (see
 *  contentKey) but is kept here so the upload route's existing SELECT shape stays
 *  unchanged; it is simply ignored by keyOfRow. */
export interface ExistingTxKey {
  date: string | null;
  amount: number | null;
  description: string | null;
  counterpart_name: string | null;
  reference: string | null;
}

function norm(s: string | null): string {
  return (s ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * [BANK-DEDUP-NAME] Format-stable normalization of a counterpart NAME for the
 * dedup fingerprint only (never for storage/display). Lowercases, strips
 * diacritics, and removes every non-alphanumeric character — so punctuation,
 * spacing and legal-form differences that vary between export formats collapse:
 *   MT940-derived "Jansen Bouw B.V."  ==  CSV-column "Jansen Bouw BV"  → "jansenbouwbv"
 *
 * Crucially it KEEPS digits. That is deliberate and load-bearing: two genuinely
 * different same-day, same-amount, reference-less transactions — e.g. two fuel
 * stops "Shell 123" and "Shell 456" — must stay DISTINCT ("shell123" ≠ "shell456"),
 * otherwise the dedup would silently DROP a real transaction and under-state the
 * owner's money. Under-counting is worse than the rare, visible cross-format
 * double-count, so we never strip the distinguishing digits.
 */
function dedupName(s: string | null): string {
  return (s ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]/g, "")
    .slice(0, DEDUP_NAME_LENGTH);
}

/**
 * [BANK-DEDUP-TRUNCATED-NAME] How much of a counterpart name the fingerprint looks at.
 *
 * A bank does not send the same name to every door. ING writes
 * "Stichting Bedrijfstakpensioenfonds voor het Levensmiddelenbedrijf" in CAMT and cuts it to
 * "Stichting Bedrijfstakpensioenfonds voor het Levens" in the MT940 :86: /CNTP/ field \u2014 the same
 * payment, the same download page, two names. Comparing them whole made five lines of one real
 * quarter fingerprint as ten, and it does so for every long name: pension funds, foundations,
 * bedrijfstak schemes \u2014 exactly the counterparties whose names run long.
 *
 * 40 characters AFTER normalization, which is comfortably inside ING's cut (46 normalized) and
 * still 40 distinguishing characters. It cannot silently merge two suppliers: contentKey also
 * carries the date, the amount to the cent and the reference, so a collision needs two
 * counterparties sharing 40 alphanumerics who were paid the identical amount on the identical day
 * under the identical reference.
 *
 * This is safe to change without a migration, unlike the stored columns: both sides of the
 * comparison are hashed at compare time, incoming and stored alike. A bank found truncating
 * SHORTER than this would need the number lowered, and the parity test would be what tells us.
 */
const DEDUP_NAME_LENGTH = 40;

/**
 * Stable content fingerprint for cross-upload dedup.
 *
 * [BANK-DEDUP-DOUBLE] The fingerprint deliberately EXCLUDES `description`. Proven
 * by testing the SAME statement exported as both MT940 and CAMT for one period:
 * the stored description (the raw REMI) differs between the two formats for every
 * transaction — MT940 keeps ING's "USTD//29528/" wrapper, CAMT gives a clean
 * "29528" — so a description-based key never matched across formats and every
 * transaction was re-inserted on the second upload (an exact ×2 doubling of
 * in/uit). date + amount + reference are IDENTICAL across formats; the counterpart
 * NAME is the one field whose representation can differ per format (MT940/CAMT
 * DERIVE it from the REMI, a CSV reads it from a dedicated column), so it is
 * normalized via dedupName — collapsing "B.V." vs "BV" while keeping the digits
 * that distinguish separate transactions. Verified 30/30 match on MT940↔CAMT with
 * zero collisions (incl. 20 reference-less POS settlements distinguished by amount).
 *
 * [BANK-DEDUP-CSV] CSV↔MT940/CAMT re-upload of the SAME period: invoice transfers
 * (a real counterparty name) now dedup across formats thanks to dedupName. Card/POS
 * lines whose CSV column name carries a terminal/store number the derived MT940 name
 * lacks (e.g. "Albert Heijn 1234" vs "Albert Heijn") can still both import — the
 * accepted residual edge, chosen over merging distinct transactions. Same-FORMAT
 * re-upload (the common case) always dedups exactly. Two genuinely identical
 * transactions in one statement would still collapse — the documented, accepted edge.
 */
export function contentKey(
  date: string | null,
  amount: number | null,
  counterpart: string | null,
  reference: string | null
): string {
  return [
    date ?? "",
    (amount ?? 0).toFixed(2),
    dedupName(counterpart),
    norm(reference),
  ].join("|");
}

function keyOfTx(t: BankTransaction): string {
  return contentKey(t.date, t.amount, t.counterpartName, t.reference);
}

function keyOfRow(r: ExistingTxKey): string {
  return contentKey(r.date, r.amount, r.counterpart_name, r.reference);
}

/** Min/max ISO date in a transaction list — used to scope the existing-rows query. */
export function dateRange(transactions: BankTransaction[]): {
  min: string | null;
  max: string | null;
} {
  const dates = transactions.map((t) => t.date).filter(Boolean).sort();
  return { min: dates[0] ?? null, max: dates[dates.length - 1] ?? null };
}

/**
 * Multiset diff: return the transactions to insert (those not already covered by existing
 * rows of the same fingerprint) plus how many were skipped as duplicates.
 */
export function dedupTransactions(
  incoming: BankTransaction[],
  existing: ExistingTxKey[]
): { toInsert: BankTransaction[]; skipped: number } {
  const existingCount = new Map<string, number>();
  for (const r of existing) {
    const k = keyOfRow(r);
    existingCount.set(k, (existingCount.get(k) ?? 0) + 1);
  }

  const toInsert: BankTransaction[] = [];
  let skipped = 0;

  for (const t of incoming) {
    const k = keyOfTx(t);
    const left = existingCount.get(k) ?? 0;
    if (left > 0) {
      existingCount.set(k, left - 1); // consume one existing → this one is a duplicate
      skipped++;
    } else {
      toInsert.push(t);
    }
  }

  return { toInsert, skipped };
}

/** Map parsed transactions → insertable rows (status 'pending', user_id pinned by caller). */
export function mapToRows(
  transactions: BankTransaction[],
  userId: string
): BankTransactionRow[] {
  return transactions.map((t) => {
    // Auto-classify the structural identities (card takings, fees, tax, transfers, privé).
    // 'unknown' → null so the genuine business lines still go through human coding.
    const id = classifyBankTransaction(t.counterpartName, t.description, t.amount);
    return {
      user_id: userId,
      date: t.date || null,
      amount: t.amount,
      description: t.description || null,
      counterpart_name: t.counterpartName,
      counterpart_iban: t.counterpartIban ?? null, // [BANK-IBAN] store for supplier-account matching
      reference: t.reference,
      status: "pending" as const,
      category: id === "unknown" ? null : id,
    };
  });
}

/** A stored bank_transactions row, as selected for the matching run (phase 3). */
export interface BankTransactionDbRow {
  id: string;
  date: string | null;
  amount: number | null;
  description: string | null;
  counterpart_name: string | null;
  counterpart_iban?: string | null; // [BANK-IBAN] supplier account, for IBAN matching (optional)
  reference: string | null;
  // [BANK-MULTI-LINK-PERSIST] A partially-linked multi-invoice tx keeps
  // status='pending' but already carries an invoice_id (the last invoice paid
  // against it). The match route needs both to tell the UI "this one is partially
  // done — keep it in Te bevestigen until allCovered", surviving a page reload.
  invoice_id?: string | null;
  status?: string | null;
}

/**
 * Map a stored row back into the canonical BankTransaction shape the matcher consumes.
 * The DB row id is carried in `transactionId` so suggestions tie back to the exact row.
 */
export function rowToTransaction(r: BankTransactionDbRow): BankTransaction {
  return {
    date: r.date ?? "",
    amount: r.amount ?? 0,
    currency: "EUR",
    description: r.description ?? "",
    counterpartName: r.counterpart_name,
    counterpartIban: r.counterpart_iban ?? null, // [BANK-IBAN] now stored → used by the matcher
    reference: r.reference,
    transactionId: r.id, // carry DB id → ties a suggestion to its transaction
    rawLine: "",
  };
}