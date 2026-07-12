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
const POS_PAYOUT_RE =
  /ing dd&c|afrek\.|geldservice|\bccv\b.*afrek|stripe(?:\s+payout)?|mollie(?:\s+payout)?|adyen|sumup|zettle/;

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

// ─── Counterpart memory ───────────────────────────────────────────────────────
// Normalized key so the SAME shop is recognised across statements regardless of the
// processor prefix / punctuation the bank attaches ("SUMUP *JANSEN", "Jansen B.V.",
// "JANSEN" all collapse to "jansen"). Shares the noise vocabulary with the matcher.

const KEY_NOISE = new Set([
  // legal suffixes
  'bv', 'nv', 'vof', 'cv', 'ltd', 'gmbh', 'maatschap', 'holding', 'inzake',
  // payment processors / methods
  'sumup', 'ccv', 'mollie', 'adyen', 'stripe', 'zettle', 'izettle', 'paypal',
  'payout', 'buckaroo', 'sisow', 'klarna', 'ideal', 'pin', 'pos', 'bea', 'gea',
  'betaalautomaat', 'geldautomaat',
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
  source: 'memory' | 'ai';
}

/**
 * Suggest a category for a transaction. Memory (a category the owner confirmed for
 * this counterpart before) always wins — that's how the system gets smarter. Else the
 * pure classifier; and an otherwise-unexplained line is most likely a business cost
 * (debit) or revenue (credit). Pure — the caller does the memory lookup and the write.
 */
export function suggestIdentity(
  counterpartName: string | null,
  description: string | null,
  amount: number,
  memoryCategory?: string | null,
): IdentitySuggestion {
  if (memoryCategory) return { category: memoryCategory as Category, source: 'memory' };
  const id = classifyBankTransaction(counterpartName, description, amount);
  if (id !== 'unknown') return { category: id, source: 'ai' };
  return { category: amount < 0 ? 'kosten' : 'omzet', source: 'ai' };
}
