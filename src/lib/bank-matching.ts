// lib/bank-matching.ts
// [BOEK-016] Bank Matching Engine — rules-based, pure functions, no I/O.
//
// Input : BankTransaction[] (from bank-parser.ts, any format) + invoices (from DB).
// Output: per-transaction match outcome ('auto' | 'choice' | 'none') with scored candidates.
//
// Philosophy (BoekBrug): "AI prepares + presents, Human confirms, System executes."
// This engine ONLY suggests. It never writes to the DB and never changes invoice status.
//
// Design notes:
//   - Pure & deterministic → testable with `npx tsx` (no Supabase, no fetch).
//   - Signed amount respects direction (M-confirmed):
//       outgoing invoice  ↔ positive credit (ontvangen)
//       incoming invoice  ↔ negative debit  (betaald)
//   - B.4 Conflict Guard: invoices with accountant_status='verwerkt' are NEVER suggested
//     (the DB trigger blocks the status change anyway — don't suggest the impossible).
//   - AI arbiter (ai.ts → matchTransaction) is a SEPARATE later phase; not called here.

import type { BankTransaction } from "./bank-parser";

// ─── Public types ─────────────────────────────────────────────────────────────

/** Minimal invoice shape the matcher needs. Caller maps DB rows → this. */
export interface InvoiceForMatching {
  id: string;
  invoice_number: string | null;
  total_inc_btw: number | null;
  invoice_date: string | null; // ISO "YYYY-MM-DD"
  due_date: string | null; // ISO
  client_name: string | null; // counterpart (customer for outgoing, vendor for incoming)
  direction: "outgoing" | "incoming" | null;
  status: string | null; // 'sent' | 'overdue' | 'paid' | 'received' | ...
  accountant_status: string | null; // 'verwerkt' → excluded (B.4)
}

/** Which signal(s) fired for a candidate. */
export type MatchSignal = "reference" | "amount" | "date" | "counterpart";

/** A scored invoice candidate for one transaction. */
export interface MatchCandidate {
  invoiceId: string;
  invoiceNumber: string | null;
  confidence: number; // 0..1
  signals: MatchSignal[];
  reason: string; // short Dutch explanation
}

/** Outcome class for one transaction. */
export type MatchOutcome =
  | "auto" // one clear candidate → pre-select "betaald" (human still confirms)
  | "choice" // several plausible candidates → user picks
  | "none"; // no usable candidate → status 'not_found'

/** Match result for one transaction. */
export interface TransactionMatch {
  transaction: BankTransaction;
  outcome: MatchOutcome;
  best: MatchCandidate | null; // top candidate when outcome === 'auto'
  candidates: MatchCandidate[]; // sorted desc by confidence (trimmed)
}

/** Aggregate result for a whole statement. */
export interface MatchResult {
  matches: TransactionMatch[];
  autoCount: number;
  choiceCount: number;
  noneCount: number;
}

/** Tunable knobs — exported so tests/UI can reason about them. */
export interface MatchOptions {
  amountEpsilon: number; // EUR tolerance for "exact" amount
  dateWindowDays: number; // beyond this, date adds nothing
  nameSimThreshold: number; // min similarity to count as a counterpart signal
  choiceThreshold: number; // min confidence to be listed as a candidate
  autoConfidence: number; // min top confidence to consider 'auto'
  autoMargin: number; // top must beat 2nd by this to be 'auto'
  maxCandidates: number; // cap the candidate list shown to the user
}

export const DEFAULT_OPTIONS: MatchOptions = {
  amountEpsilon: 0.01,
  dateWindowDays: 45,
  nameSimThreshold: 0.5,
  choiceThreshold: 0.5,
  autoConfidence: 0.7,
  autoMargin: 0.15,
  maxCandidates: 5,
};

const EXCLUDED_STATUSES = new Set(["paid", "draft", "archived"]);

// ─── Text / number helpers (pure) ───────────────────────────────────────────

/** Lowercase + strip everything except [a-z0-9] for robust reference matching. */
export function normalizeRef(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * Does the invoice number appear in the transaction's reference/description?
 * Guards against trivially short numbers (e.g. "1") matching everything.
 */
export function referenceMatches(
  tx: Pick<BankTransaction, "reference" | "description">,
  invoiceNumber: string | null
): boolean {
  if (!invoiceNumber) return false;
  const needle = normalizeRef(invoiceNumber);
  if (needle.length < 4) return false; // too short → unsafe
  const haystack = normalizeRef(`${tx.reference ?? ""} ${tx.description ?? ""}`);
  return haystack.includes(needle);
}

/** Exact amount match within tolerance (compares absolute values). */
export function amountMatches(
  txAmount: number,
  invoiceTotal: number | null,
  epsilon: number
): boolean {
  if (invoiceTotal == null) return false;
  return Math.abs(Math.abs(txAmount) - invoiceTotal) <= epsilon;
}

/** Days between two ISO dates (absolute, NaN-safe → Infinity). */
function dayDiff(isoA: string | null, isoB: string | null): number {
  if (!isoA || !isoB) return Infinity;
  const a = Date.parse(isoA);
  const b = Date.parse(isoB);
  if (Number.isNaN(a) || Number.isNaN(b)) return Infinity;
  return Math.abs(a - b) / 86_400_000;
}

/**
 * Date proximity bonus 0..0.25. Closeness to the NEARER of invoice_date / due_date.
 * Pure booster — never disqualifies a pair (late payments are legitimate).
 */
export function dateProximityScore(
  txDate: string,
  invoiceDate: string | null,
  dueDate: string | null,
  windowDays: number
): number {
  const dist = Math.min(dayDiff(txDate, invoiceDate), dayDiff(txDate, dueDate));
  if (!Number.isFinite(dist) || dist > windowDays) return 0;
  return 0.25 * (1 - dist / windowDays);
}

const LEGAL_SUFFIXES = new Set([
  "bv",
  "nv",
  "vof",
  "cv",
  "ltd",
  "gmbh",
  "maatschap",
  "holding",
  "inzake",
]);

function nameTokens(s: string): Set<string> {
  const tokens = s
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 2 && !LEGAL_SUFFIXES.has(t));
  return new Set(tokens);
}

/**
 * Counterpart name similarity 0..1.
 * Jaccard over tokens, boosted by containment (one name's tokens ⊆ the other's),
 * so "JANSEN BV INZAKE FACTUUR" still matches invoice client "Jansen BV".
 */
export function nameSimilarity(a: string | null, b: string | null): number {
  if (!a || !b) return 0;
  const setA = nameTokens(a);
  const setB = nameTokens(b);
  if (setA.size === 0 || setB.size === 0) return 0;

  let inter = 0;
  for (const t of setA) if (setB.has(t)) inter++;
  const union = setA.size + setB.size - inter;
  const jaccard = union === 0 ? 0 : inter / union;
  const containment = inter / Math.min(setA.size, setB.size);
  return Math.max(jaccard, containment * 0.9);
}

// ─── Eligibility + scoring (pure) ─────────────────────────────────────────────

/** Hard filters: direction/sign, excluded statuses, B.4 verwerkt guard, date sanity. */
export function isEligible(
  tx: BankTransaction,
  inv: InvoiceForMatching
): boolean {
  if (tx.amount === 0) return false;
  if (inv.accountant_status === "verwerkt") return false; // B.4
  if (inv.status && EXCLUDED_STATUSES.has(inv.status)) return false;

  // Direction / sign guard (M-confirmed)
  const requiredDirection: "outgoing" | "incoming" =
    tx.amount > 0 ? "outgoing" : "incoming";
  if (inv.direction !== requiredDirection) return false;

  // [BANK-MATCH-STRICT] Date sanity: a payment cannot happen meaningfully BEFORE
  // the invoice was issued. A €323,68 monthly fee invoice dated 15-06 must NOT
  // match a transaction from 30-05 or 17-04 (those paid EARLIER invoices, likely
  // not in the system). Small grace window (3 days) for clock/booking skew.
  // tx.date and invoice_date are ISO "YYYY-MM-DD"; skip the check if either missing.
  if (tx.date && inv.invoice_date) {
    const txT = Date.parse(tx.date);
    const invT = Date.parse(inv.invoice_date);
    if (!Number.isNaN(txT) && !Number.isNaN(invT)) {
      const GRACE_MS = 3 * 86_400_000; // 3 days
      if (txT < invT - GRACE_MS) return false; // payment predates the invoice
    }
  }

  return true;
}

/** Score one (transaction, invoice) pair. Assumes the pair is already eligible. */
export function scorePair(
  tx: BankTransaction,
  inv: InvoiceForMatching,
  opts: MatchOptions
): { confidence: number; signals: MatchSignal[]; reason: string } {
  const signals: MatchSignal[] = [];
  const reasons: string[] = [];

  const refOk = referenceMatches(tx, inv.invoice_number);
  const amtOk = amountMatches(tx.amount, inv.total_inc_btw, opts.amountEpsilon);
  const dateBonus = dateProximityScore(
    tx.date,
    inv.invoice_date,
    inv.due_date,
    opts.dateWindowDays
  );
  const sim = nameSimilarity(tx.counterpartName, inv.client_name);
  const cpBonus = sim >= opts.nameSimThreshold ? 0.3 * sim : 0;

  let confidence: number;

  if (refOk) {
    // Reference is near-identity: invoice number printed in the payment.
    confidence = amtOk ? 0.97 : 0.9;
    signals.push("reference");
    reasons.push(`factuurnummer ${inv.invoice_number} gevonden in omschrijving`);
    if (amtOk) {
      signals.push("amount");
      reasons.push("bedrag komt exact overeen");
    }
  } else {
    // No reference → amount is the backbone; date + counterpart refine.
    // A strong combination (exact amount + matching counterpart + close date)
    // can still reach 'auto'; a weak one (amount only) stays 'choice'. The
    // date-sanity and one-to-one guards below prevent the dangerous cases
    // (paying before issue, one invoice on many transactions) without making
    // every clean match a manual pick — that keeps confirmation low-effort.
    confidence = 0;
    if (amtOk) {
      confidence += 0.5;
      signals.push("amount");
      reasons.push(`bedrag €${inv.total_inc_btw} komt exact overeen`);
    }
    confidence += dateBonus;
    if (dateBonus > 0) {
      signals.push("date");
      reasons.push("datum dicht bij factuurdatum");
    }
    if (cpBonus > 0) {
      confidence += cpBonus;
      signals.push("counterpart");
      reasons.push(`tegenpartij lijkt op ${inv.client_name}`);
    }
    // Without an exact amount and without a reference, a pair stays weak.
    if (!amtOk) confidence = Math.min(confidence, 0.35);
  }

  confidence = Math.min(1, Math.max(0, confidence));
  const reason = reasons.length ? reasons.join(" · ") : "geen duidelijke match";
  return { confidence, signals, reason };
}

// ─── Main entry ────────────────────────────────────────────────────────────────

/**
 * Match every transaction against the candidate invoices.
 * Returns suggestions only — the human confirms, the existing payment path executes.
 */
export function matchTransactions(
  transactions: BankTransaction[],
  invoices: InvoiceForMatching[],
  options?: Partial<MatchOptions>
): MatchResult {
  const opts: MatchOptions = { ...DEFAULT_OPTIONS, ...options };
  const matches: TransactionMatch[] = [];

  for (const tx of transactions) {
    const candidates: MatchCandidate[] = [];

    for (const inv of invoices) {
      if (!isEligible(tx, inv)) continue;
      const { confidence, signals, reason } = scorePair(tx, inv, opts);
      if (confidence < opts.choiceThreshold) continue;
      candidates.push({
        invoiceId: inv.id,
        invoiceNumber: inv.invoice_number,
        confidence,
        signals,
        reason,
      });
    }

    candidates.sort((a, b) => b.confidence - a.confidence);
    const trimmed = candidates.slice(0, opts.maxCandidates);

    let outcome: MatchOutcome = "none";
    let best: MatchCandidate | null = null;

    if (trimmed.length > 0) {
      const top = trimmed[0];
      const second = trimmed[1];
      const strongLead =
        !second || top.confidence - second.confidence >= opts.autoMargin;

      if (top.confidence >= opts.autoConfidence && strongLead) {
        outcome = "auto";
        best = top;
      } else {
        outcome = "choice";
      }
    }

    matches.push({ transaction: tx, outcome, best, candidates: trimmed });
  }

  // [BANK-MATCH-STRICT] One-to-one guard: a single invoice must not be suggested
  // as the match for several transactions (one invoice is paid once). Greedy
  // assignment — process the strongest 'auto'/'choice' pairings first; once an
  // invoice is claimed, remove it from every other transaction's candidates and
  // re-evaluate that transaction's outcome. Prevents the "same invoice on three
  // transactions" bug while keeping the most confident pairing intact.
  const claimed = new Set<string>();
  // Order transactions by their best candidate confidence, strongest first.
  const order = matches
    .map((m, i) => ({ i, c: m.best?.confidence ?? m.candidates[0]?.confidence ?? 0 }))
    .sort((a, b) => b.c - a.c)
    .map((o) => o.i);

  for (const i of order) {
    const m = matches[i];
    // Drop any candidate whose invoice is already claimed by a stronger tx.
    const free = m.candidates.filter((c) => !claimed.has(c.invoiceId));

    if (free.length === 0) {
      m.outcome = "none";
      m.best = null;
      m.candidates = [];
      continue;
    }

    // Re-derive outcome from the remaining free candidates.
    const top = free[0];
    const second = free[1];
    const strongLead = !second || top.confidence - second.confidence >= opts.autoMargin;

    if (top.confidence >= opts.autoConfidence && strongLead) {
      m.outcome = "auto";
      m.best = top;
      claimed.add(top.invoiceId); // auto → this invoice is taken
    } else {
      m.outcome = "choice";
      m.best = null;
      // For 'choice' we claim the TOP candidate so it can't auto-match elsewhere,
      // but still show the full free list so the owner can pick.
      claimed.add(top.invoiceId);
    }
    m.candidates = free;
  }

  const autoCount = matches.filter((m) => m.outcome === "auto").length;
  const choiceCount = matches.filter((m) => m.outcome === "choice").length;
  const noneCount = matches.filter((m) => m.outcome === "none").length;

  return { matches, autoCount, choiceCount, noneCount };
}
// ─── [BANK-MULTI-LINK-PERSIST] Shared multi-invoice coverage (pure, no I/O) ──────
//
// A single bank transaction can settle SEVERAL invoices at once; the bank then
// lists every invoice number in the reference, e.g. "26302050, 26302362". Paying
// ONE of them must NOT make the transaction disappear while the others are still
// open. Two endpoints need the SAME rule:
//   - confirm/route.ts : after a payment, decide whether to flip the tx 'matched'
//   - match/route.ts   : on (re)load, decide whether a partially-linked tx is done
// Defining it ONCE here (the home of pure matching logic, already imported by both
// routes) keeps the two answers identical — no duplicated coverage logic to drift.

/**
 * Split a bank reference ("26302050, 26302362") into the distinct invoice numbers
 * it lists. Comma-separated, trimmed, NORMALIZED (lowercase, [a-z0-9] only), and
 * short tokens (< 4 chars) dropped — a bare "263" or a year is not an invoice
 * number (same >= 4 guard referenceMatches uses). The parser stores multi numbers
 * exactly as "num1, num2" (see bank-parser.extractInvoiceReference), so a comma
 * split recovers them. De-duplicated. Pure.
 */
export function parseReferenceNumbers(reference: string | null): string[] {
  if (!reference) return [];
  const seen = new Set<string>();
  for (const part of reference.split(",")) {
    const norm = normalizeRef(part.trim());
    if (norm.length >= 4) seen.add(norm);
  }
  return [...seen];
}

/**
 * Is every invoice number listed in this transaction's reference now backed by a
 * PAID invoice? Presence check only — no amount arithmetic (decision: amount is
 * for display confidence, never a subset-sum reconciliation).
 *
 *   - 0 or 1 reference number → single-invoice case: a confirmation completes it.
 *     Returns true (the existing single-invoice flow is unchanged). A tx with one
 *     reference number is fully covered the moment its one invoice is paid.
 *   - > 1 reference number → multi case: require EVERY reference number to map
 *     (by EQUALITY, not substring — so "263" can't satisfy "26302050") to a number
 *     in paidNumbers. Any open number → false → the tx stays visible/actionable.
 *
 * @param reference     the transaction reference (raw, as stored).
 * @param paidNumbers   normalized invoice numbers of THIS user's PAID invoices in
 *                      the correct direction. The caller fetches them (this stays
 *                      I/O-free); pass already-normalized values (normalizeRef).
 */
export function isFullyCovered(
  reference: string | null,
  paidNumbers: Iterable<string>
): boolean {
  const refNumbers = parseReferenceNumbers(reference);
  if (refNumbers.length <= 1) return true; // single-invoice case — one link completes it
  const paidSet = paidNumbers instanceof Set ? paidNumbers : new Set(paidNumbers);
  return refNumbers.every((n) => paidSet.has(n));
}