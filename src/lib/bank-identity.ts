// src/lib/bank-identity.ts
// [BANK-IDENTITY] Pure classification of a bank line's financial identity — the
// "what is this?" for transactions that are NOT an invoice payment. No I/O, fully
// testable (run: npx tsx src/lib/bank-identity.test.ts).
//
// Why this exists: most bank lines are not invoice settlements — they are transfers
// between your own ledgers, tax payments, private withdrawals, ATM cash, card
// takings, or bank fees. Giving each an identity keeps the honest picture correct:
//   - a transfer / tax / private debit is NOT a missing receipt → it must not
//     inflate "nog te documenteren";
//   - it is NOT a cost or revenue → it must never reach the P&L / BTW.
//
// Conservative by design: when unsure → 'unknown'. For a DEBIT, 'unknown' means
// "probably a real expense that still needs a receipt" — we would rather ask for a
// bon than silently drop a cost. This mirrors the app's locked principle: a wrong
// task (asking for a receipt you already have) is just ignored; a wrong number is
// what breaks trust.

export type TxIdentity =
  | 'transfer'   // between your own ledgers (savings / cash-drawer / own account / ATM)
  | 'tax'        // Belastingdienst (BTW / IB) — a settlement, not a deductible cost
  | 'prive'      // private withdrawal / deposit — no business P&L impact
  | 'pos_income' // card-terminal / PSP takings (income, no supplier invoice)
  | 'fee'        // bank costs / interest
  | 'unknown'    // not otherwise explained

// ─── Patterns (Dutch bank statements) ─────────────────────────────────────────
// Kept deliberately specific to avoid mislabelling a real purchase as "not a cost".

const TAX_RE = /\bbelastingdienst\b|belasting dienst/;
const PRIVE_RE = /\bpriv[eé]\b|priv[eé][- ]?opname|priv[eé][- ]?storting/;
const TRANSFER_RE =
  /\bspaar-?rekening\b|oranje spaar|\beigen rekening\b|kruispost|naar (?:mijn )?spaar|van (?:mijn )?spaar/;
const ATM_RE = /geldautomaat|\bopname\b|\bgea\b|\bcash opname\b|geldopname/;
const FEE_RE =
  /\bbankkosten\b|kosten (?:betaal|zakelijke)?rekening|maandpakket|\bpakketkosten\b|debetrente|creditrente|\brente\b/;
// PSP / card-terminal SETTLEMENT credits (money paid out TO you). NOT the same as a
// "betaalautomaat" DEBIT, which is you paying at a terminal — that is a purchase.
//
// [ACQUIRER-COVERAGE] Two groups: (1) payout PHRASES that only ever appear on a settlement
// credit (afrek., geldservice, ING DD&C, "…afrek"), and (2) the acquirer/PSP VENDOR names.
// Group 2 mirrors card-reconcile.ACQUIRER_VENDOR_RE one-for-one so the classifier can NEVER
// recognise fewer acquirers than the fee-dedup does — the old list missed Worldline,
// Paysquare, Equens, Buckaroo, Nets, Klarna and (Rabo)OmniKassa, so their daily payout fell
// through to the sign-based 'omzet' fallback and was double-counted on top of the till's
// takings. A vendor name only classifies as income when the line is a CREDIT (guarded in
// classifyBankTransaction / isPosPayoutDescription), so a purchase AT one of these terminals
// (a debit) still correctly falls through to 'unknown'.
const POS_PAYOUT_RE =
  /ing dd&c|afrek\.|geldservice|\bccv\b|stripe|mollie|adyen|sum\s?up|zettle|izettle|\bworldline\b|paysquare|\bequens\b|buckaroo|\bnets\b|klarna|rabo\s?omnikassa|omnikassa/;

/**
 * Does this line's text look like a card-acquirer / PSP PAYOUT (a settlement credit)?
 * Pure pattern test — the caller must gate on a CREDIT (amount ≥ 0) for a true payout, as a
 * debit at the same terminal is a purchase. Exported so the result engine can recognise a
 * card settlement the owner may have (mis)categorised as plain 'omzet' and still treat it as
 * a covered-day witness rather than a second helping of revenue.
 */
export function isPosPayoutDescription(description: string | null, counterpartName: string | null = null): boolean {
  return POS_PAYOUT_RE.test(hay(counterpartName, description));
}

function hay(counterpartName: string | null, description: string | null): string {
  return `${counterpartName ?? ''} ${description ?? ''}`.toLowerCase();
}

/**
 * Classify a single bank line. `amount`: positive = credit (in), negative = debit (out).
 * Order matters: the most specific / highest-consequence identities are checked first.
 */
export function classifyBankTransaction(
  counterpartName: string | null,
  description: string | null,
  amount: number,
): TxIdentity {
  const h = hay(counterpartName, description);

  if (TAX_RE.test(h)) return 'tax';
  if (PRIVE_RE.test(h)) return 'prive';
  if (TRANSFER_RE.test(h) || ATM_RE.test(h)) return 'transfer';

  // Card/PSP takings are income and only make sense as a credit. A terminal DEBIT
  // ("betaalautomaat …") is a purchase, so it must fall through to 'unknown'.
  if (amount >= 0 && POS_PAYOUT_RE.test(h)) return 'pos_income';

  if (FEE_RE.test(h)) return 'fee';

  return 'unknown';
}

/**
 * Does this DEBIT still need a purchase document (bon)? The only thing "nog te
 * documenteren" should count. Income never needs one; transfers, tax, private and
 * fees are not deductible costs, so they don't either. Everything else (an
 * unexplained outgoing payment) probably does.
 */
export function needsDocument(
  counterpartName: string | null,
  description: string | null,
  amount: number,
): boolean {
  if (amount >= 0) return false; // income / payouts never need a purchase document
  return classifyBankTransaction(counterpartName, description, amount) === 'unknown';
}

// ─── Ontbrekende bon (missing receipt) ─────────────────────────────────────────
// The ONE definition of "this bank payment still needs a purchase document (bon)".
// It was copy-pasted in three places (the readiness score, the daily-truth counter,
// and the bank page's list); a single pure predicate keeps them from drifting apart.
//
// A row is a missing receipt when ALL hold:
//   - status === 'pending'  → not yet linked (matched) and not owner-ignored (not_found);
//   - invoice_id is empty   → no receipt/invoice attached yet (attach keeps status
//     'pending' on purpose, since one payment can settle several invoices, so the
//     linked test MUST be invoice_id, not status);
//   - amount < 0            → a debit; income never needs a purchase document;
//   - it is a business cost → either not categorized yet AND the classifier can't
//     explain it away (needsDocument), or the owner already called it 'kosten'.
// Categorizing it as fee / prive / transfer / tax / pos_income answers "geen bon nodig"
// and drops it from the list.

export interface MissingReceiptTx {
  status: string | null;
  invoice_id: string | null;
  amount: number;
  category: string | null;
  counterpart_name: string | null;
  description: string | null;
}

export function isMissingReceipt(tx: MissingReceiptTx): boolean {
  if (tx.status !== 'pending') return false; // matched (linked) or not_found (ignored)
  if (tx.invoice_id) return false;           // a receipt/invoice is already attached
  if (tx.amount >= 0) return false;          // income / payouts never need a bon
  if (tx.category == null) {
    // Not categorized yet — only an unexplained outgoing payment still needs one.
    return needsDocument(tx.counterpart_name, tx.description, tx.amount);
  }
  // Categorized: only a business cost still needs a bon; the non-cost identities
  // (fee / prive / transfer / tax / pos_income) mean "geen bon nodig".
  return tx.category === 'kosten';
}

// ─── Counterpart memory ───────────────────────────────────────────────────────
// Normalized key so the SAME shop is recognised across statements regardless of the
// processor prefix / punctuation the bank attaches ("SUMUP *JANSEN", "Jansen B.V.",
// "JANSEN" all collapse to "jansen"). Shares the noise vocabulary with the matcher.

const KEY_NOISE = new Set([
  // legal suffixes
  'bv', 'nv', 'vof', 'cv', 'ltd', 'gmbh', 'maatschap', 'holding', 'inzake',
  // payment processors / methods — MUST cover every acquirer POS_PAYOUT_RE knows, else the
  // processor name survives the key and becomes a false "distinctive" similarity token
  // (two unrelated shops settled via the same PSP would look alike). Parity is asserted by a test.
  'sumup', 'ccv', 'mollie', 'adyen', 'stripe', 'zettle', 'izettle', 'paypal',
  'payout', 'buckaroo', 'sisow', 'klarna', 'ideal', 'pin', 'pos', 'bea', 'gea',
  'betaalautomaat', 'geldautomaat',
  'worldline', 'paysquare', 'equens', 'nets', 'omnikassa', 'rabo',
]);

/**
 * A stable memory key for a counterpart, or null when there's no usable name
 * (e.g. a line that is only a processor tag). Pure.
 */
export function counterpartKey(counterpartName: string | null): string | null {
  if (!counterpartName) return null;
  const tokens = counterpartName
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length >= 2 && !KEY_NOISE.has(t));
  if (tokens.length === 0) return null;
  return tokens.join(' ');
}

// The category vocabulary stored on a transaction (and in memory):
//   transfer | tax | prive | pos_income | fee   (auto-detectable identities)
//   kosten | omzet                              (the business classification of the rest)
export type Category = TxIdentity | 'kosten' | 'omzet';

export interface IdentitySuggestion {
  category: Category;
  // 'memory'  = an EXACT category the owner confirmed for this counterpart before
  // 'similar' = borrowed from a DIFFERENT but similar counterpart the owner categorized
  //             (a suggestion to review, never confident — see below)
  // 'ai'      = a pattern match, or the bare sign fallback
  source: 'memory' | 'ai' | 'similar';
  // TRUE only when the suggestion rests on real evidence FOR THIS counterpart: a
  // category the owner confirmed for it before (memory), or a specific pattern match
  // (tax / prive / transfer / pos_income / fee). FALSE for the bare kosten/omzet
  // fallback (a guess by sign alone) AND for a 'similar' suggestion (a look-alike is a
  // helpful pre-select, but the owner must confirm — two shops sharing a name/place
  // aren't the same business). A safe bulk-apply must use ONLY the confident ones —
  // blanket-applying a guess would silently mis-book transfers, tax and private lines.
  confident: boolean;
  // On a 'similar' suggestion: the memorized counterpart key it resembles (for a
  // "lijkt op …" hint). Absent otherwise.
  similarTo?: string;
}

// ─── Similarity: learn from a LOOK-ALIKE counterpart ───────────────────────────
// When a brand-new counterpart has no exact memory, a previously-categorized
// counterpart with (nearly) the same name is a strong hint — "Jansen Groothandel
// Amsterdam" resembles the "Jansen" you already coded as kosten. This is a SUGGESTION
// the owner reviews (confident:false), never an auto-book: a shared place/first name
// ("Amsterdam Transport" vs "Amsterdam Catering") could mislead, and only a tap may
// move money into the P&L.

export interface MemoryEntry {
  key: string;       // a counterpartKey() value
  category: string;
}

export interface SimilarMemoryHit {
  category: string;
  matchedKey: string; // the memorized key it resembles
  score: number;      // 0..1 token-containment score
}

// Generic tokens that carry no business identity — a match on these alone must never
// suggest. Distinct from KEY_NOISE (processors/legal suffixes, stripped upstream). Two
// groups: (1) Dutch tussenvoegsels + a few universals, and (2) high-frequency first
// names — "Pieter Bakker" and "Pieter Jansen" are different people, so a shared given
// name is not a business-identity match. Kept conservative to avoid suppressing a genuine
// sole-trader look-alike (a shared SURNAME token still carries the match).
const GENERIC_TOKENS = new Set([
  'van', 'de', 'der', 'den', 'het', 'een', 'en', 'the', 'and', 'aan',
  'pieter', 'jan', 'hendrik', 'willem', 'johan', 'kees', 'henk', 'dirk', 'cor', 'gerard',
  'sandra', 'marieke', 'anna', 'maria', 'linda', 'ingrid', 'petra', 'johanna',
]);

function keyTokens(key: string): string[] {
  return key.split(/\s+/).filter((t) => t.length > 0);
}

/**
 * Find the memorized counterpart most similar to `key` and return its category as a
 * SUGGESTION. Pure. Returns null when nothing is similar enough, or when the equally
 * best-matching memories DISAGREE on the category (ambiguous → we don't guess).
 *
 * Similarity = token containment: |shared tokens| / |tokens of the shorter name|, so a
 * subset relation ("jansen" ⊂ "jansen groothandel") scores 1.0. Requires at least one
 * DISTINCTIVE shared token (≥4 chars, non-generic) so "van der berg" and "van der meer"
 * don't collapse together on the tussenvoegsel alone.
 */
export function bestSimilarMemory(
  key: string | null,
  memory: MemoryEntry[],
  minScore = 0.5,
): SimilarMemoryHit | null {
  if (!key) return null;
  const aTokens = keyTokens(key);
  if (aTokens.length === 0) return null;
  const aSet = new Set(aTokens);

  const hits: SimilarMemoryHit[] = [];
  for (const m of memory) {
    if (!m.key || !m.category) continue;
    if (m.key === key) continue; // an exact match is handled by memory, not here
    const bSet = new Set(keyTokens(m.key));
    if (bSet.size === 0) continue;
    // Count DISTINCT shared tokens over DISTINCT token counts, so a repeated token in either
    // name (counterpartKey doesn't dedup: "Jansen & Jansen" → "jansen jansen") can never push
    // the score above 1.0 and silently defeat the disagreeing-category guard below.
    const shared = [...bSet].filter((t) => aSet.has(t));
    if (shared.length === 0) continue;
    if (!shared.some((t) => t.length >= 4 && !GENERIC_TOKENS.has(t))) continue; // no distinctive overlap
    const score = shared.length / Math.min(aSet.size, bSet.size);
    if (score < minScore) continue;
    hits.push({ category: m.category, matchedKey: m.key, score });
  }
  if (hits.length === 0) return null;

  // Best by score. When the TOP score is shared by memories that disagree on the
  // category, the look-alike is genuinely ambiguous → suggest nothing.
  hits.sort((x, y) => y.score - x.score);
  const top = hits[0];
  const topTies = hits.filter((h) => Math.abs(h.score - top.score) < 1e-9);
  if (new Set(topTies.map((h) => h.category)).size > 1) return null;
  return top;
}

/**
 * Suggest a category for a transaction. Memory (a category the owner confirmed for
 * this EXACT counterpart before) always wins — that's how the system gets smarter.
 * Else the pure pattern classifier; else, if the caller resolved a similar-counterpart
 * category, borrow it as a review-only suggestion; else an unexplained line is most
 * likely a business cost (debit) or revenue (credit). Pure — the caller does the
 * memory lookup, the similarity resolution and the write.
 */
export function suggestIdentity(
  counterpartName: string | null,
  description: string | null,
  amount: number,
  memoryCategory?: string | null,
  similar?: SimilarMemoryHit | null,
): IdentitySuggestion {
  if (memoryCategory) return { category: memoryCategory as Category, source: 'memory', confident: true };
  const id = classifyBankTransaction(counterpartName, description, amount);
  if (id !== 'unknown') return { category: id, source: 'ai', confident: true };
  // A look-alike counterpart: pre-select its category, but NEVER confident (owner confirms).
  if (similar) return { category: similar.category as Category, source: 'similar', confident: false, similarTo: similar.matchedKey };
  // Fallback: sign alone. A plausible default to SHOW, but never to auto-apply.
  return { category: amount < 0 ? 'kosten' : 'omzet', source: 'ai', confident: false };
}
