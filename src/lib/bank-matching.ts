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
  // [PARTIAL-PAY] amount already settled by earlier instalments (magnitude; 0/absent when fully
  // open). The matcher targets the REMAINING balance (|total| − amount_paid), so the next
  // instalment's payment matches on amount instead of scoring low against the full invoice.
  amount_paid?: number | null;
  invoice_date: string | null; // ISO "YYYY-MM-DD"
  due_date: string | null; // ISO
  client_name: string | null; // counterpart (customer for outgoing, vendor for incoming)
  direction: "outgoing" | "incoming" | null;
  status: string | null; // 'sent' | 'overdue' | 'paid' | 'received' | ...
  accountant_status: string | null; // 'verwerkt' → excluded (B.4)
  // [BANK-IBAN] The counterpart's bank account on the invoice — the supplier's IBAN on an
  // incoming (purchase) invoice, or the customer's on an outgoing one. When the bank line's
  // counterpart IBAN equals this, it is a STRONG, supplier-specific identity signal (a bare
  // amount can collide across suppliers; a full IBAN cannot). Null when unknown → simply not used.
  vendor_iban?: string | null;
}

/** Which signal(s) fired for a candidate. */
export type MatchSignal = "reference" | "amount" | "date" | "counterpart" | "iban";

/** Normalize an IBAN for comparison: upper-case, strip every non-alphanumeric char (spaces,
 *  dots). Returns "" for a value too short to be a real IBAN (never match on junk).
 *  [BANK-IBAN-HARDEN] The floor is 15 — the shortest real IBAN in the world (Norway/Belgium);
 *  a Dutch one is 18. Below 15 it cannot be an IBAN (e.g. an 8-char BIC like "INGBNL2A"), and
 *  matching on such a token could — in theory — collide two non-account strings. Since the
 *  invoice-side writer already drops any vendor_iban < 15 chars, keeping both sides at the true
 *  IBAN minimum means a match requires two genuinely-equal real IBANs = the same account. */
export function normalizeIban(v: string | null | undefined): string {
  const s = (v ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  return s.length >= 15 ? s : "";
}

/** Do the bank line's counterpart IBAN and the invoice's IBAN refer to the same account?
 *  Only true when BOTH are present and normalize-equal — never true on a missing side. */
export function ibanMatches(txIban: string | null | undefined, invoiceIban: string | null | undefined): boolean {
  const a = normalizeIban(txIban);
  const b = normalizeIban(invoiceIban);
  return a.length > 0 && a === b;
}

/** A scored invoice candidate for one transaction. */
export interface MatchCandidate {
  invoiceId: string;
  invoiceNumber: string | null;
  // [BANK-BATCH-RECONCILE] The invoice's own gross total (total_inc_btw). The UI needs
  // it to reconcile a multi-invoice payment: sum the referenced invoices and check the
  // total equals the bank debit — the honest proof that a batch payment covers exactly
  // these invoices (no per-invoice amount appears in the statement, only the sum does).
  amount: number | null;
  // [BANK-CHOICE-CLARITY] The invoice date. When several candidates share the same
  // amount (e.g. monthly rent), the DATE is the only thing that tells them apart — so the
  // "kies de juiste factuur" list must show it, or the owner is guessing between numbers.
  invoiceDate: string | null;
  confidence: number; // 0..1
  signals: MatchSignal[];
  reason: string; // short Dutch explanation
  // [BANK-AMOUNT-ONLY] The raw counterpart-name similarity (0..1) for THIS pairing. A sim ≥ the
  // nameSimThreshold (0.5) is enough to LIST a candidate, but auto-BOOKING on name alone
  // (the 'amount_only' tier) demands a STRONG match — see autoConfirmTier / HIGH_NAME_SIM.
  // Optional: candidates built outside matchTransactions (e.g. batch reconcile) may omit it.
  nameSim?: number;
  // [BANK-AMOUNT-ONLY-TOKENS] Whether the two counterpart names identify the same party strongly
  // (see isStrongNameIdentity). nameSim alone cannot express this: "Jansen B.V." and "Jansen
  // Holding" both reduce to the single token {jansen}, giving a containment of 1.0 — a perfect
  // score from one shared surname. The amount_only tier books money with no human, so it needs
  // this, not just the ratio. Optional: candidates built outside matchTransactions may omit it.
  nameIdentity?: boolean;
  // [BANK-DEDUP-SUPPLIER] The invoice's counterpart, carried so dedupeCandidates can tell a
  // re-imported duplicate (same number + amount + SAME supplier) from a cross-supplier
  // collision (same number pattern + same amount, different supplier — a real second invoice
  // that must never be hidden). Optional: candidates built outside matchTransactions omit it,
  // and an absent supplier only ever merges with another absent one (the old behaviour).
  clientName?: string | null;
  // [PARTIAL-PAY] What earlier instalments already settled (magnitude, 0 when fully open) and
  // what is therefore still OPEN on this invoice. scorePair already targets the remaining
  // balance (see amountTarget above) — it just never EXPORTED it, so the confirm UI compared
  // the payment against the FULL total and cried "deelbetaling?" at the very instalment that
  // completes the invoice. Both are magnitudes; a creditnota's negative total is abs()'d here.
  // Optional: candidates built outside matchTransactions (e.g. batch reconcile) may omit them.
  amountPaid?: number;
  remaining?: number;
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

// [BANK-MATCH-VERIFY] Statuses that must NEVER be offered as a bank-match candidate:
//   paid/archived — already settled or closed; draft — not issued; processing — the
//   verify queue (intake/email imports land here, "never auto-paid, even for receipts").
// Why 'processing' matters: its number and amount come straight from OCR and are NOT yet
// human-verified, so auto-booking one as paid would (a) trust an unverified figure and
// (b) silently promote it out of the verify queue with no way back (unlink can only restore
// by direction). An imported invoice becomes matchable the moment the owner verifies it
// (→ received/sent). This keeps "verify first, then reconcile" — the correct order.
const EXCLUDED_STATUSES = new Set(["paid", "draft", "archived", "processing"]);

// ─── Text / number helpers (pure) ───────────────────────────────────────────

/** Lowercase + strip everything except [a-z0-9] for robust reference matching. */
export function normalizeRef(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * Does the invoice number appear in the transaction's reference/description?
 * Guards against trivially short numbers (e.g. "1") matching everything.
 */
/**
 * [CREDIT-NETTING] Is this pairing a credit note being NETTED against a payment, rather than
 * refunded by one?
 *
 * A purchase credit note refunded in cash arrives as money IN; deducted from a payment run it
 * rides along on money OUT. This names the second shape — the one the direction guard in
 * isPlausibleMatch would otherwise reject, and the one Dutch wholesale actually uses.
 *
 * It is deliberately separate from the referenceMatches test that accompanies it. This says WHAT
 * the pairing is; the reference says whether the bank vouched for it. Only both together let a
 * credit note through, and this half alone decides something else: a netted credit note is by
 * definition ONE PART of a settlement that has at least one invoice in it too, so it must never
 * become the single 'auto' answer for a payment. Booking € 819,95 onto a −€ 24,25 credit note
 * unattended would be worse than the bug this whole rule exists to remove.
 */
export function isNettedCreditNote(
  tx: Pick<BankTransaction, "amount">,
  inv: Pick<InvoiceForMatching, "total_inc_btw" | "direction">,
): boolean {
  if (!((inv.total_inc_btw ?? 0) < 0)) return false;
  return inv.direction === (tx.amount > 0 ? "outgoing" : "incoming");
}

export function referenceMatches(
  tx: Pick<BankTransaction, "reference" | "description">,
  invoiceNumber: string | null
): boolean {
  if (!invoiceNumber) return false;
  const needle = normalizeRef(invoiceNumber);
  if (needle.length < 4) return false; // too short → unsafe
  // [TRUST-MATCH-YEAR] A needle that IS a bare calendar year can whole-token match the year in any
  // free-text description ("Huur juli 2026") — the parser already drops bare years from extracted
  // references (bank-parser), but the description scan below had no such guard, so an owner whose
  // sequential numbering reaches "2026" could get a SILENT 'certain' booking on a coincidental
  // cent-exact amount. A year is not identity; refuse it here (the amount/name/date signals still
  // list the pair as a human choice — fail-safe, never fail-silent).
  if (/^20[2-3]\d$/.test(needle)) return false;
  // [TRUST-MATCH] A plain substring test let a short PURELY-NUMERIC invoice number
  // match as a fragment of a LONGER number: invoice "2050" matched reference
  // "26302050" and auto-pre-selected the WRONG invoice for a one-click confirm. For a
  // numeric needle we require it to be a WHOLE number token — not flanked by another
  // digit. The haystack KEEPS SPACES as token boundaries (stripping only punctuation),
  // so two space-separated numbers in a reference — "12345 1001" — do NOT fuse into
  // one digit run that would hide a real match, while a hyphenated number still
  // matches its printed form ("2026-014" → "2026014", hyphen removed, no space added).
  const haystack = `${tx.reference ?? ""} ${tx.description ?? ""}`
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, "")
    .replace(/\s+/g, " ");
  // [TRUST-MATCH-ALNUM] The digit-boundary guard now applies to ALPHANUMERIC invoice
  // numbers too, not only pure digits. Previously an alphanumeric needle fell back to a
  // raw substring test, so invoice "MF26" matched reference "MF260" (a DIFFERENT invoice,
  // one sequence number later) → a 0.97 'auto' + a false "factuurnummer staat in
  // bankafschrift" line + one tap paid the WRONG invoice. A trailing/leading DIGIT extends
  // the number and changes identity, so it is never a clean boundary; a LETTER before the
  // number is fine (a printed prefix like "INV2050" still matches invoice "2050").
  for (let idx = haystack.indexOf(needle); idx >= 0; idx = haystack.indexOf(needle, idx + 1)) {
    const before = idx > 0 ? haystack[idx - 1] : "";
    const after = idx + needle.length < haystack.length ? haystack[idx + needle.length] : "";
    // A space (or string edge) is a clean boundary; an adjacent DIGIT means the needle is a
    // slice of a bigger number ("2050"⊂"26302050", "MF26"⊂"MF260") → not a real match.
    if (!/[0-9]/.test(before) && !/[0-9]/.test(after)) return true;
  }
  return false;
}

// [BANK-PARTIAL] Dutch (and common) markers that a bank payment is only PART of an
// invoice — an instalment / down-payment / "second part". Word-boundary matched so
// "termijn" doesn't fire inside an unrelated word. Used to keep a partial payment out of
// one-tap auto-confirm (which would mark the whole invoice paid).
// [BANK-PARTIAL-WORDS] `gedeeltelijke?` — the INFLECTED form is what people actually write
// ("gedeeltelijke betaling"); the bare stem never matched it because \b sits between two
// letters. `voorschot` (an advance) is the other real-world marker that was missing: an
// advance is by definition not the full bill, and without the word an exact-amount voorschot
// could auto-book an unrelated same-amount invoice.
const PARTIAL_PAYMENT_RE =
  /\b(deelbetaling|deelbetaald|gedeeltelijke?|aanbetaling|voorschot|termijn|termijnbetaling|\d+e?\s*termijn|\d+e\s*deel|deel\s*\d+|restbetaling|resterend|part\s*payment|installment|instalment)\b/i;

/** Does the payment text look like an instalment / partial payment? */
export function isPartialPaymentHint(text: string | null | undefined): boolean {
  if (!text) return false;
  // "tweede/eerste/derde deel" spelled out, plus the regex markers.
  if (/\b(eerste|tweede|derde|vierde|laatste)\s+deel\b/i.test(text)) return true;
  return PARTIAL_PAYMENT_RE.test(text);
}

/** Exact amount match within tolerance (compares absolute values). */
export function amountMatches(
  txAmount: number,
  invoiceTotal: number | null,
  epsilon: number
): boolean {
  if (invoiceTotal == null) return false;
  // [M7-CREDITNOTA] Compare MAGNITUDES on both sides. A creditnota carries a NEGATIVE total
  // (sign convention), and its refund is a real bank line of the opposite money direction — a
  // €50 refund (tx ±50) must match a −€50 creditnota. Abs-ing the invoice side is a no-op for a
  // normal (positive) invoice, so this never changes ordinary matching.
  //
  // [BANK-CENTS-EXACT] Compared in INTEGER CENTS, not raw floats. `|242 − 241.99| <= 0.01` is a
  // lottery in binary floating point: the subtraction lands a hair above 0.01 for some cent-pairs
  // (0.010000000000019…) and a hair below for others — the SAME one-cent difference matched or
  // didn't depending on which euros were involved. Rounding both sides to cents first makes the
  // documented tolerance mean exactly what it says, deterministically. The tolerance itself is
  // unchanged policy: OCR/xlsx totals are legitimately a rounding tick off, and within-a-cent
  // counts as equal everywhere else in the app (CENT_EPSILON, apply_bank_payment's v_eps).
  const diffCents = Math.abs(Math.round(Math.abs(txAmount) * 100) - Math.round(Math.abs(invoiceTotal) * 100));
  return diffCents <= Math.round(epsilon * 100);
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
  // [BANK-AMOUNT-ONLY-TOKENS] "holding" was here and must NOT be: it is not a legal-form
  // suffix like bv/nv/vof but a distinguishing part of the name. Stripping it made
  // "Jansen Holding" and "Jansen B.V." — two SEPARATE legal entities that routinely both
  // exist and both invoice — collapse to the identical token set {jansen}, scoring a perfect
  // 1.000 similarity. With an equal amount and a nearby date that was enough to auto-book a
  // payment against the wrong company's invoice with no human in the loop. Keeping the token
  // makes the two names differ, which is the truth.
  "inzake",
]);

// [BANK-MATCH-PSP] Payment-processor / method tokens that bank statements bolt onto
// a counterpart name ("SUMUP *JANSEN", "CCV*STORE", "iDEAL Bol.com", "Betaalautomaat
// …"). They are pure noise for name matching — stripping them reveals the real
// merchant/customer so it can match the invoice's client_name. Removing tokens can
// only sharpen the match; the "unrelated names ~ low" test guards against drift.
const PAYMENT_NOISE = new Set([
  "sumup", "ccv", "mollie", "adyen", "stripe", "zettle", "izettle", "paypal",
  "payout", "buckaroo", "sisow", "klarna", "ideal", "pin", "pos", "bea", "gea",
  "betaalautomaat", "geldautomaat",
]);

function nameTokens(s: string): Set<string> {
  const tokens = s
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(
      (t) => t.length >= 2 && !LEGAL_SUFFIXES.has(t) && !PAYMENT_NOISE.has(t)
    );
  return new Set(tokens);
}

// [BANK-NAME-PARTICLES] Dutch name particles (tussenvoegsels). They appear in MILLIONS of
// surnames — de Vries, van Dijk, van den Berg are the most common names in the country — so a
// shared particle carries ZERO identity. They still count for general similarity (a candidate
// may be LISTED on them), but never toward the "same party, book money with no human" bar.
const NAME_PARTICLES = new Set([
  "de", "den", "der", "van", "ten", "ter", "te", "het", "op", "aan", "tot", "in", "bij", "onder",
]);

/**
 * Counterpart name similarity 0..1.
 * Jaccard over tokens, boosted by containment (one name's tokens ⊆ the other's),
 * so "JANSEN BV INZAKE FACTUUR" still matches invoice client "Jansen BV".
 */
/**
 * Do two counterpart names identify the SAME party strongly enough to book money without a
 * human? True when they share at least two meaningful tokens, OR when their meaningful token
 * sets are identical (the same name, spelled the same way). Pure.
 *
 * [BANK-AMOUNT-ONLY-TOKENS] Exists because a RATIO cannot tell "the same company" from "a shared
 * surname". `Jansen B.V.` vs `Jansen Holding` both reduce to the single token {jansen} once
 * LEGAL_SUFFIXES strips `bv` and `holding`, so containment is 1.0 and nameSimilarity returns a
 * perfect 1.000 for two unrelated companies — enough to clear HIGH_NAME_SIM and auto-book.
 *
 * Set equality is what keeps the honest single-word supplier working: `Jansen BV` vs `Jansen BV`
 * (or KPN, Vodafone — one meaningful token each) is an exact identity, not a coincidence. The
 * dangerous shape is precisely the ASYMMETRIC one: one name's only token is a subset of a longer,
 * different name.
 */
export function isStrongNameIdentity(a: string | null, b: string | null): boolean {
  if (!a || !b) return false;
  const setA = nameTokens(a);
  const setB = nameTokens(b);
  if (setA.size === 0 || setB.size === 0) return false;
  // [BANK-NAME-PARTICLES] Identity is judged on the MEANINGFUL tokens only. "J. de Vries" and
  // "De Vries Transport" share {de, vries} — two tokens, which cleared the old shared>=2 bar and
  // auto-booked an unrelated private person's €150 (a Marktplaats sale) onto a transport
  // company's invoice, unattended. One of those two tokens is a particle a third of the country
  // carries; the REAL overlap is the single surname {vries}, exactly the asymmetric
  // shared-surname case this function was built to reject. Stripping particles keeps every
  // honest match working: "Van den Berg Installaties" ↔ "van den Berg Installaties B.V." still
  // shares {berg, installaties} (>=2), and the single-word supplier ("KPN" ↔ "KPN") still passes
  // via set equality — which now also demands at least one meaningful token, so two names that
  // are ONLY particles can never identify anything.
  const meaningfulA = new Set([...setA].filter((t) => !NAME_PARTICLES.has(t)));
  const meaningfulB = new Set([...setB].filter((t) => !NAME_PARTICLES.has(t)));
  if (meaningfulA.size === 0 || meaningfulB.size === 0) return false;
  let shared = 0;
  for (const t of meaningfulA) if (meaningfulB.has(t)) shared++;
  if (shared >= 2) return true;
  return meaningfulA.size === meaningfulB.size && shared === meaningfulA.size;
}

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

  // Direction / sign guard (M-confirmed). [M7-CREDITNOTA] A creditnota (negative total) REVERSES
  // the money direction of its own settlement: a supplier's creditnota TO us (direction incoming)
  // is refunded as money IN (credit, tx > 0), and our creditnota to a customer (direction
  // outgoing) is refunded as money OUT (debit, tx < 0). So for a creditnota the sign→direction
  // map is flipped; without this, every credit-note refund was rejected here and could never be
  // reconciled. A normal invoice is unchanged.
  const isCreditNote = (inv.total_inc_btw ?? 0) < 0;
  const requiredDirection: "outgoing" | "incoming" =
    tx.amount > 0
      ? (isCreditNote ? "incoming" : "outgoing")
      : (isCreditNote ? "outgoing" : "incoming");
  // [CREDIT-NETTING] …but a credit note is settled two ways, and the rule above only knows one.
  //
  // It knows the REFUND: the supplier sends the money back, so an incoming creditnota is matched
  // by a credit (money in). True, and rare. What Dutch wholesale actually does is NET it — the
  // credit is deducted from the next payment run and never travels on its own. Dutch Sweets billed
  // RE0801378 at € 871,40, issued three credit notes of −24,25, −20,39 and −6,81, and one debit of
  // € 819,95 left the account with all four numbers printed in its omschrijving. 871,40 − 51,45 =
  // 819,95, to the cent.
  //
  // Against that debit every credit note failed the guard above — it demands 'outgoing' for them
  // and they are purchase documents. So one slot was built instead of four, the netting in
  // reconcileBatch had nothing to net, and the card offered a DEELBETALING of € 819,95 with
  // "€ 51,45 blijft open" — the € 51,45 being, exactly, the three credit notes it had just refused
  // to look at. Confirming it leaves a debt that will never be paid because it was already
  // settled, beside three credits that will never be applied.
  //
  // The relaxation is bounded by evidence, not by a guess: the payment's own text must NAME this
  // document. referenceMatches is the identity rule this file already trusts everywhere, with its
  // boundary guards intact ("MF26" must not match "MF260"), so a credit note can never drift onto
  // an unrelated debit — the bank has to have printed its number. Where nothing is named, nothing
  // changes.
  if (inv.direction !== requiredDirection) {
    if (!(isNettedCreditNote(tx, inv) && referenceMatches(tx, inv.invoice_number))) return false;
  }

  // [BANK-MATCH-STRICT] Date sanity: a payment cannot happen meaningfully BEFORE
  // the invoice was issued. A €323,68 monthly fee invoice dated 15-06 must NOT
  // match a transaction from 30-05 or 17-04 (those paid EARLIER invoices, likely
  // not in the system).
  //
  // [BANK-MATCH-ARREARS] Grace widened 3 → 10 days: a SEPA automatische incasso /
  // subscription is often charged on the 1st while the supplier's invoice carries a
  // LATER document date (bill-in-arrears) — e.g. debit on 01-06, invoice dated 05-06.
  // At 3 days that real, imported invoice was excluded from the candidate list
  // ENTIRELY (not just denied 'auto'), so the line stayed "Geen factuur" forever and
  // the owner's only tool was attach-invoice → a duplicate. 10 days surfaces it as a
  // `choice` (the score, not this gate, still gates 'auto'), while a genuinely earlier
  // payment (16+ days, the previous month's bill) is still rejected.
  // tx.date and invoice_date are ISO "YYYY-MM-DD"; skip the check if either missing.
  if (tx.date && inv.invoice_date) {
    const txT = Date.parse(tx.date);
    const invT = Date.parse(inv.invoice_date);
    if (!Number.isNaN(txT) && !Number.isNaN(invT)) {
      const GRACE_MS = 10 * 86_400_000; // 10 days (bill-in-arrears / incasso skew)
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
): { confidence: number; signals: MatchSignal[]; reason: string; nameSim: number } {
  const signals: MatchSignal[] = [];
  const reasons: string[] = [];

  const refOk = referenceMatches(tx, inv.invoice_number);
  // [PARTIAL-PAY] When earlier instalments already settled part of the invoice, the payment we're
  // scoring should match the REMAINING balance, not the full total — so the €600 second instalment
  // of a €1000 invoice (€400 paid) scores an exact 'amount' hit against the €600 that's left. Sign
  // is preserved (a creditnota total is negative; amount_paid is a magnitude). A fully-open invoice
  // (amount_paid 0/absent) keeps the full total → identical to before, so the auto path (which
  // excludes partials entirely) is unchanged.
  const paidSoFar = Math.max(0, inv.amount_paid ?? 0);
  const amountTarget: number | null =
    inv.total_inc_btw == null || paidSoFar <= 0.005
      ? inv.total_inc_btw
      : (inv.total_inc_btw < 0 ? -1 : 1) * Math.max(0, Math.abs(inv.total_inc_btw) - paidSoFar);
  const amtOk = amountMatches(tx.amount, amountTarget, opts.amountEpsilon);
  const ibanOk = ibanMatches(tx.counterpartIban, inv.vendor_iban);
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
    // Reference is near-identity: invoice number printed in the payment. BUT the amount is
    // the money-truth: a €50 payment that merely quotes invoice 2026-014 (€500) must NOT
    // auto-mark it fully paid. So a reference WITHOUT a matching amount stays below
    // autoConfidence (0.7) → a human CHOICE (still a strong, listed candidate), never 'auto'.
    // Only reference + exact amount reaches the one-click 'betaald' pre-selection.
    confidence = amtOk ? 0.97 : 0.65;
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
      reasons.push(
        paidSoFar > 0.005
          ? `bedrag komt overeen met het restant (€${(amountTarget ?? 0).toFixed(2)})`
          : `bedrag €${inv.total_inc_btw} komt exact overeen`,
      );
    }
    // [BANK-IBAN] Same bank account as the invoice's counterpart — a strong, supplier-specific
    // identity. Paired with an EXACT amount it reaches 'auto' (IBAN + amount ≈ reference + amount:
    // a payment to this exact supplier account for this exact sum). Alone (no exact amount) it does
    // NOT reach auto — a same-supplier invoice of a different amount must never be auto-paid — the
    // !amtOk cap below keeps it a weak, listed candidate.
    if (ibanOk) {
      confidence += 0.45;
      signals.push("iban");
      reasons.push("zelfde rekeningnummer (IBAN) als op de factuur");
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
    // Without an exact amount and without a reference, a pair stays weak — even a matching IBAN,
    // because the same supplier can have several invoices of different amounts.
    if (!amtOk) confidence = Math.min(confidence, 0.35);
    // [BANK-IDENTITY-OUTRANKS] A pair with NO identity signal (no printed number, no matching
    // IBAN) is capped strictly BELOW the reference+amount score (0.97). Before this cap,
    // amount (0.5) + date (≤0.25) + name (≤0.3) could sum to a full 1.0 — so a COINCIDENCE
    // outranked a payment that literally prints the invoice number. That was not cosmetic:
    // candidates sort by confidence, `best` is the top, and the one-to-one guard hands each
    // invoice to the highest-confidence claimant. Concretely (reproduced): two payments to the
    // same supplier, same amount — the one QUOTING the invoice number ended as "Geen factuur"
    // while the reference-less one claimed the invoice and, via the amount_only tier,
    // auto-booked it with no human. topReachesAuto's own doctrine already says a printed number
    // "is decisive identity … immune to the same-amount collisions"; the numbers just didn't
    // obey it.
    //
    // The full ordering is a three-step identity hierarchy, each strictly below the last:
    //   0.97  printed invoice number + exact amount   — DOCUMENT identity (names the bill)
    //   0.96  matching IBAN + exact amount (+date)    — SUPPLIER identity (names the account)
    //   0.95  amount + name + date                    — coincidence, however pretty
    // IBAN sits between on purpose: a full account match IS identity (autoConfirmTier books it
    // 'certain'), but it identifies the SUPPLIER, not the bill — a same-supplier same-amount
    // payment with an IBAN match must not steal an invoice from the payment that literally
    // prints that invoice's number (reproduced: it did, and booked silently as 'certain').
    // Thresholds are untouched: 0.95/0.96 clear autoConfidence (0.7) exactly as before, so
    // every single-candidate outcome is unchanged — only who WINS when the ranks compete.
    confidence = Math.min(confidence, ibanOk ? 0.96 : 0.95);
  }

  // [BANK-PARTIAL] A payment whose reference/description says it is an INSTALMENT
  // ("2e termijn", "deelbetaling", "aanbetaling", "Tweede deel factuur …") must never be a
  // one-tap 'auto' that marks the invoice fully paid — the amount is only part of the bill.
  // Cap it to a human 'choice' so the owner sees it and decides; the UI also warns when the
  // paid amount is below the invoice total (there is no partial-paid state in the model).
  if (isPartialPaymentHint(`${tx.reference ?? ""} ${tx.description ?? ""}`)) {
    confidence = Math.min(confidence, 0.6);
    reasons.push("lijkt een deelbetaling — controleer");
  }

  // [PARTIAL-PAY] Completing an already-partly-paid invoice is a human decision, never a silent
  // auto-book: cap it to a 'choice' (still a strong, listed candidate) so the owner sees "restant"
  // and confirms. The auto path excludes partials outright, so this only shapes the suggestion UI —
  // and it prevents a misleading 'auto' badge on the last instalment.
  if (paidSoFar > 0.005) {
    confidence = Math.min(confidence, 0.6);
    reasons.push(`restant van deelbetaling (€${(amountTarget ?? 0).toFixed(2)} open)`);
  }

  confidence = Math.min(1, Math.max(0, confidence));
  const reason = reasons.length ? reasons.join(" · ") : "geen duidelijke match";
  return { confidence, signals, reason, nameSim: sim };
}

/**
 * [BANK-DEDUP-CANDIDATES] Collapse candidates that are the SAME bill re-imported twice —
 * same normalized invoice number AND same gross amount to the cent (e.g. "26 / 3958" vs
 * "26/3958" from a re-generated PDF, which the exact-string import dedup misses). Keeps
 * the FIRST occurrence, so call AFTER sorting by confidence to keep the strongest. A
 * candidate with no usable number/amount is never collapsed (can't prove it's a
 * duplicate), and requiring the AMOUNT to match too means a mere invoice-number collision
 * across two genuinely different bills is never hidden.
 */
export function dedupeCandidates(candidates: MatchCandidate[]): MatchCandidate[] {
  const seen = new Set<string>();
  const out: MatchCandidate[] = [];
  for (const c of candidates) {
    const num = normalizeRef(c.invoiceNumber ?? "");
    if (num.length === 0 || c.amount == null || !Number.isFinite(c.amount)) {
      out.push(c); // no safe identity → keep (never hide something we can't prove is a dup)
      continue;
    }
    // [BANK-DEDUP-SUPPLIER] The SUPPLIER is part of the duplicate's identity. Two invoices from
    // DIFFERENT suppliers can legitimately share a number pattern AND an amount ("2026-07" for a
    // €121 monthly fee is not a rare shape) — collapsing those hid the real open invoice behind
    // an unrelated one and manufactured a false "single clear winner" for the auto path. A
    // genuine re-import of the same bill carries the same supplier, so the intended collapse
    // (same doc twice) still happens; an unknown supplier ("") only ever merges with another
    // unknown, which is the pre-existing conservative behaviour.
    const key = `${num}|${Math.round(Math.abs(c.amount) * 100)}|${normalizeRef(c.clientName ?? "")}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(c);
  }
  return out;
}

/**
 * [BANK-AUTO-CONFIRM] Is this match near-certain enough for the app to book it WITHOUT a
 * human tap? The whole point of "quiet by default": the owner shouldn't chase hundreds of
 * one-tap confirms — the app should silently handle the sure ones and reserve attention for
 * the genuinely ambiguous. Safe ONLY when:
 *   - outcome is 'auto' with a best candidate,
 *   - the invoice NUMBER is printed in the statement AND the amount matches to the cent
 *     (both signals → the 0.97 match; either alone is not enough),
 *   - it is a SINGLE invoice (a multi-invoice batch needs the owner to allocate),
 *   - the payment is not flagged as an instalment/deelbetaling.
 * BTW/omzet/kosten are on accrual (invoice date), so this only sets the paid/linked status
 * — never a tax figure — and it is fully reversible. Anything short of certain stays human.
 */
export function isSafeAutoConfirm(m: TransactionMatch): boolean {
  return autoConfirmTier(m) === "certain";
}

/** The two auto-confirm tiers, or null when a match must stay a human decision. */
export type AutoConfirmTier =
  | "certain" // invoice number printed (or IBAN) + exact amount — decisive identity, booked silently
  | "amount_only"; // exact amount + matching counterpart NAME, single clear winner — booked but FLAGGED

// [BANK-AMOUNT-ONLY] Auto-booking on NAME alone (no printed number/IBAN) demands a STRONG name, not
// the mere 0.5 that lists a candidate. nameSimilarity gives 0.9–1.0 for the same supplier (exact
// tokens / full containment) but ~0.6 for a shared-token collision ("De Vries Bouw" vs "De Vries
// Transport"). A same-amount coincidence from such a look-alike must NOT auto-mark an invoice paid
// unattended — below the bar it stays a human one-tap (outcome 'auto' still pre-selects it in the UI).
export const HIGH_NAME_SIM = 0.8;

/**
 * [BANK-AMOUNT-ONLY] Which tier — if any — may auto-book this match?
 * Shared gates (both tiers): outcome 'auto' with a best candidate, the amount matches to the cent,
 * it is a SINGLE invoice (parseReferenceNumbers ≤ 1 — a multi-invoice batch has its own path), and
 * it is not flagged an instalment/deelbetaling.
 *   - 'certain': the invoice NUMBER is printed in the statement OR the supplier IBAN matches. A
 *     printed number / full IBAN is supplier-specific identity — immune to same-amount collisions.
 *     Booked silently (this is the original safe set).
 *   - 'amount_only': neither reference nor IBAN, but the counterpart NAME matches (an identity floor
 *     — bare amount+date is too weak to ever auto-book). The matcher only yields 'auto' when ONE
 *     candidate clearly leads, so a recurring same-amount supplier with several open invoices ties
 *     to 'choice' and never reaches here. Booked, but the UI flags it "controleer" and it is one-tap
 *     reversible. BTW/omzet are on accrual, so no tier ever moves a tax figure.
 */
export function autoConfirmTier(m: TransactionMatch): AutoConfirmTier | null {
  if (m.outcome !== "auto" || !m.best) return null;
  if (parseReferenceNumbers(m.transaction.reference).length > 1) return null;
  if (isPartialPaymentHint(`${m.transaction.reference ?? ""} ${m.transaction.description ?? ""}`)) {
    return null;
  }
  const sig = m.best.signals;
  if (!sig.includes("amount")) return null; // the amount is the money-truth — required by both tiers
  if (sig.includes("reference") || sig.includes("iban")) return "certain";
  if (sig.includes("counterpart")) {
    // [BANK-AMOUNT-ONLY] Auto-book on name ONLY when the name is a STRONG match. A merely-similar
    // name (0.5–0.8: a shared token like a common first word + "B.V.") is enough to LIST the
    // candidate but too weak to mark an invoice paid with no human — a same-amount coincidence from
    // a different supplier could win. Below the bar → null (stays a human one-tap, still pre-selected).
    //
    // [BANK-AMOUNT-ONLY-DATE] AND require date proximity (the 'date' signal: within the 45-day
    // window of the invoice/due date). Without it, name+amount alone booked UNBOUNDED into the
    // future: a €150 credit from an unrelated "J. Jansen" (single shared surname token → sim ≥ 0.9)
    // arriving MONTHS after an open €150 invoice to "Jansen Consultancy" auto-marked it paid — the
    // real debtor never chased. A payment plausibly settling an invoice arrives near it; one that
    // doesn't is exactly the coincidence this tier must not book. Fail-safe: outside the window the
    // pair stays a pre-selected human one-tap.
    //
    // [BANK-AMOUNT-ONLY-TOKENS] AND require a real name IDENTITY, not just a high ratio. The
    // similarity score alone cannot carry this tier: `Jansen B.V.` vs `Jansen Holding` scores a
    // perfect 1.000, because `bv` and `holding` are both in LEGAL_SUFFIXES so each name collapses
    // to the single token {jansen}. Two unrelated companies sharing a common Dutch surname, with
    // an equal amount and a nearby date, were auto-booked with no human ever looking.
    // isStrongNameIdentity still passes the honest single-word supplier (`Jansen BV` ↔ `Jansen
    // BV`, KPN, Vodafone) because their token sets are EQUAL; it rejects only the asymmetric case
    // where one name's lone token is a subset of a different, longer one. Below the bar the pair
    // still lists and stays pre-selected — one human tap, which is the right cost here.
    const identityEnough = m.best.nameIdentity !== false;
    // [BANK-REF-CONTRADICTS] The payment PRINTS a document number that is NOT this invoice's —
    // then this tier must never book. The reproduced shape: a transfer quoting an invoice the
    // owner had not imported yet ("factuur 20260812"), same supplier, same amount as an OLDER
    // open invoice → amount_only booked the older one while the text named a different bill.
    // The winner reached this branch WITHOUT the 'reference' signal, so by definition none of
    // the printed number-tokens is its number; any such token is therefore a contradiction.
    // (A bare klantnummer also vetoes — conservative on purpose: the line stays a pre-selected
    // one-tap for the human, which is the documented cost of never booking against the text.)
    const winnerNum = normalizeRef(m.best.invoiceNumber ?? "");
    const printed = parseReferenceNumbers(m.transaction.reference);
    const contradicts = printed.some((t) => !(winnerNum === t || winnerNum.includes(t)));
    if (contradicts) return null;
    return (m.best.nameSim ?? 0) >= HIGH_NAME_SIM && sig.includes("date") && identityEnough
      ? "amount_only"
      : null;
  }
  return null; // amount + date only, no identity → too weak, stays human
}

// [BANK-REF-DECISIVE] Should the top of a candidate list be booked as 'auto'?
// Yes when it clears autoConfidence AND EITHER:
//   - it beats the 2nd candidate by autoMargin (a clear numeric lead — the original rule), OR
//   - it UNIQUELY carries the printed-reference identity (invoice number in the statement +
//     exact amount) that no other candidate has. A printed invoice number is decisive identity:
//     it is immune to the same-amount / same-supplier collisions that otherwise drown it. Example
//     (the ONS IT case): five monthly subscription invoices all €32,67 — the four without their
//     number printed score ~0.90 on amount+counterpart+date and pull the 0.97 reference match's
//     margin below autoMargin, forcing a 5-way 'choice' even though the bank literally prints
//     "Incasso fact. 1260405". The uniqueness guard is essential: if TWO candidates both cite a
//     printed number (e.g. a mis-parsed batch), neither is decisive → it stays a human 'choice'.
// This only promotes to 'auto'; isSafeAutoConfirm still gates what the app books without a tap
// (reference+amount, single reference, not an instalment), so a wrong printed-number match is
// impossible here — referenceMatches already requires a whole-token, digit-bounded hit.
// [BANK-ELIMINATION-NO-PROMOTE] `phantomSecond` is the strongest confidence among candidates the
// one-to-one guard CLAIMED AWAY from this transaction. A leftover candidate must beat the
// removed competitor by the same margin it would have needed against a present one — otherwise
// elimination MANUFACTURES the "single clear winner". The reproduced shape is the duplicate
// payment: rent paid twice, the quoting payment claims July, and the second payment's July/June
// near-tie collapses to June alone — which the old re-derivation promoted to 'auto' and the
// amount_only tier then BOOKED: a never-paid June invoice marked paid by July's duplicate,
// unattended. With the phantom in the margin, that leftover stays a human 'choice'. A printed
// reference remains decisive (uniqueRef): the statement itself names the top's OWN document, an
// identity no removed same-amount competitor can dilute. Callers outside the claim loop pass
// nothing → -Infinity → behaviour identical to before.
function topReachesAuto(
  free: MatchCandidate[],
  opts: MatchOptions,
  phantomSecond: number = Number.NEGATIVE_INFINITY,
): boolean {
  const top = free[0];
  if (!top || top.confidence < opts.autoConfidence) return false;
  // [BANK-REF-CONTRADICTS] A candidate list that CONTAINS a reference-matched invoice — the
  // payment prints THAT invoice's number — while the TOP is a different, non-reference invoice
  // is a contradiction, never an 'auto'. The concrete shape: a partial invoice whose number is
  // printed in the statement is capped at 0.6 (completing a partial is a human decision), and a
  // bare amount+date coincidence from another supplier then out-scored it (0.75) and became the
  // pre-selected one-tap for the WRONG bill, with the true, name-printed invoice sitting right
  // below it in the list. The statement told us which document this payment is for; a top pick
  // that ignores that is exactly the ambiguity a human must resolve.
  const topHasRef = top.signals.includes("reference") && top.signals.includes("amount");
  if (!top.signals.includes("reference") && free.some((c) => c.signals.includes("reference"))) {
    return false;
  }
  const second = Math.max(free[1]?.confidence ?? Number.NEGATIVE_INFINITY, phantomSecond);
  const strongLead = !Number.isFinite(second) || top.confidence - second >= opts.autoMargin;
  const uniqueRef = topHasRef && !free.slice(1).some((c) => c.signals.includes("reference"));
  return strongLead || uniqueRef;
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
  // [CREDIT-NETTING] Aligned with `matches`: the netted-creditnota ids of each transaction. It is
  // kept as a parallel array rather than as a field because the greedy assignment pass below
  // RE-DERIVES every outcome from scratch, and a guard that lives only in the first pass is a
  // guard that does not exist — which is exactly how the first version of this let a lone
  // creditnota through to 'auto' with 0.97 confidence.
  const nettedPerTx: Array<Set<string>> = [];

  for (const tx of transactions) {
    const candidates: MatchCandidate[] = [];
    // [CREDIT-NETTING] Which of this line's candidates are credit notes riding along on a payment
    // rather than being refunded by one. Collected here because this is the only place that holds
    // both the transaction and the invoice row; the auto-decision below has candidates only.
    const nettedIds = new Set<string>();

    for (const inv of invoices) {
      if (!isEligible(tx, inv)) continue;
      if (isNettedCreditNote(tx, inv)) nettedIds.add(inv.id);
      const { confidence, signals, reason, nameSim } = scorePair(tx, inv, opts);
      if (confidence < opts.choiceThreshold) continue;
      // [PARTIAL-PAY] Export what's already settled and what's left, so the confirm UI can
      // compare the payment against the REMAINING balance instead of the full total.
      const alreadyPaid = Math.max(0, inv.amount_paid ?? 0);
      const stillOpen = Math.max(0, Math.abs(inv.total_inc_btw ?? 0) - alreadyPaid);
      candidates.push({
        invoiceId: inv.id,
        invoiceNumber: inv.invoice_number,
        amount: inv.total_inc_btw,
        invoiceDate: inv.invoice_date,
        confidence,
        signals,
        reason,
        nameSim,
        nameIdentity: isStrongNameIdentity(tx.counterpartName, inv.client_name),
        clientName: inv.client_name, // [BANK-DEDUP-SUPPLIER] dedupe key component
        amountPaid: alreadyPaid,
        remaining: stillOpen,
      });
    }

    candidates.sort((a, b) => b.confidence - a.confidence);
    // [BANK-DEDUP-CANDIDATES] Collapse a duplicate invoice (same number+amount) so the
    // owner never sees the same bill twice in "Kies de juiste factuur".
    const trimmed = dedupeCandidates(candidates).slice(0, opts.maxCandidates);

    let outcome: MatchOutcome = "none";
    let best: MatchCandidate | null = null;

    if (trimmed.length > 0) {
      // [CREDIT-NETTING] A netted credit note is one PART of a settlement — the payment it rides
      // on also carries at least one invoice. It can therefore never be the whole answer, so it
      // never becomes an unattended booking however well it scores. It stays a listed candidate
      // and the owner confirms the set. (A credit note genuinely REFUNDED by its own transaction
      // is not netted, is not in this set, and reaches 'auto' exactly as before.)
      if (topReachesAuto(trimmed, opts) && !nettedIds.has(trimmed[0].invoiceId)) {
        outcome = "auto";
        best = trimmed[0];
      } else {
        outcome = "choice";
      }
    }

    matches.push({ transaction: tx, outcome, best, candidates: trimmed });
    nettedPerTx.push(nettedIds);
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
    // [BANK-ELIMINATION-NO-PROMOTE] The strongest confidence elimination took FROM this tx —
    // fed into topReachesAuto as a phantom second, so a leftover cannot inherit a margin its
    // removed competitor never granted it (see topReachesAuto's header for the duplicate-rent
    // shape this closes).
    const claimedAway = m.candidates
      .filter((c) => claimed.has(c.invoiceId))
      .reduce((mx, c) => Math.max(mx, c.confidence), Number.NEGATIVE_INFINITY);

    if (free.length === 0) {
      m.outcome = "none";
      m.best = null;
      m.candidates = [];
      continue;
    }

    // Re-derive outcome from the remaining free candidates.
    const top = free[0];

    // [CREDIT-NETTING] Same rule as the first pass: a creditnota riding along on a payment is a
    // PART, never the whole answer, so it stays a human choice however well it scores.
    if (topReachesAuto(free, opts, claimedAway) && !(nettedPerTx[i]?.has(top.invoiceId) ?? false)) {
      m.outcome = "auto";
      m.best = top;
      claimed.add(top.invoiceId); // auto → this invoice is taken
    } else {
      m.outcome = "choice";
      m.best = null;
      // [BANK-CHOICE-NOCLAIM] Do NOT claim a 'choice' candidate. The human hasn't picked
      // yet, and claiming the ARBITRARY top of a near-tie removed that invoice from every
      // other transaction — turning a genuine second payment into a false "geen factuur",
      // or forcing the remaining single candidate into a one-tap 'auto' on a pick that was
      // actually ambiguous. Only a confident 'auto' (an invoice is paid once) claims; a
      // 'choice' keeps every candidate available until the owner confirms one (after which
      // it becomes paid and drops out of the next match on its own).
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
    if (isReferenceNumberToken(part)) seen.add(normalizeRef(part.trim()));
  }
  return [...seen];
}

/**
 * Could this one comma-separated part BE an invoice number? At least four characters after
 * normalization, and containing a digit. Pure.
 *
 * [BANK-REF-DIGITS] The digit test is what stops free text from parsing as a multi-invoice
 * payment. The parser stores free text as the reference when it cannot extract a number, so
 * "Huur juli, Kerkstraat 12" split into ["huurjuli", "kerkstraat12"] — two "invoices". That
 * silently disabled auto-booking for the line (autoConfirmTier bails above one number) and sent
 * unlink down the batch path, which zeroes amount_paid and payment_date instead of subtracting
 * the instalment.
 *
 * Exported so the UI can ask the SAME question the server asks. The bank page had four hand-rolled
 * `split(',').filter(Boolean).length` copies that counted every comma-separated fragment, so
 * "045, 26302050" was two numbers on screen and one on the server — the row was hidden from bulk
 * confirm for a reason the server did not share.
 */
export function isReferenceNumberToken(part: string): boolean {
  const norm = normalizeRef(part.trim());
  return norm.length >= 4 && /\d/.test(norm);
}

/**
 * [BANK-COVERAGE-BY-MONEY] Is every euro of this bank line sitting on an invoice?
 *
 * This is the AUTHORITATIVE answer to "is this payment finished?", and it is deliberately
 * arithmetic. `appliedTotal` is Σ bank_tx_invoices.amount_applied for the line — the figure
 * every booking path (apply_bank_payment, book_bank_batch, confirm) now writes.
 *
 * It lives here, beside isFullyCovered, because the two routes that ask the question must
 * never answer it differently — and they did. confirm/route.ts was moved to money by
 * [BANK-ONE-PAYMENT-MANY-INVOICES] while match/route.ts kept counting number-shaped tokens in
 * the reference, so a line whose every euro was booked still reported allCovered=false as soon
 * as one reference token was not a paid invoice number (a customer or order number, a POS batch
 * counter, or the free text the extractor falls back to when it finds no invoice number). Such a
 * line never leaves "Te bevestigen": confirming it again can only return 409, the client treats
 * that as done and re-fetches, and the card comes straight back — an unbreakable loop.
 *
 * Returns null when the line is NOT MEASURABLE (no join rows, or a link written before
 * amount_applied existed): the sum is then a lower bound, not the truth, and answering
 * "covered" from it would hide money. Callers fall back to isFullyCovered, which is
 * conservative by design — an unresolved number keeps the line visible, never hides on doubt.
 *
 * @param txAmount     the bank line's signed amount (magnitude is what counts).
 * @param appliedTotal Σ amount_applied over the line's links, or null when not measurable.
 */
export function bankLineFullyApplied(
  txAmount: number | null | undefined,
  appliedTotal: number | null | undefined,
): boolean | null {
  if (appliedTotal == null || !Number.isFinite(appliedTotal)) return null;
  const amount = Math.abs(Number(txAmount ?? 0));
  if (!Number.isFinite(amount)) return null;
  // Same cent tolerance the confirm route books with, so the two can never disagree.
  return Math.round((amount - Math.max(0, appliedTotal)) * 100) / 100 <= 0.01;
}

/**
 * Is every invoice number listed in this transaction's reference now backed by a
 * PAID invoice? Presence check only — no amount arithmetic (decision: amount is
 * for display confidence, never a subset-sum reconciliation).
 *
 * [BANK-COVERAGE-BY-MONEY] This is the FALLBACK, not the primary rule: it can only speak
 * about invoice NUMBERS, and a bank reference routinely carries tokens that are not invoice
 * numbers at all. Use bankLineFullyApplied first and come here only when it returns null.
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

/**
 * Which of a transaction's reference numbers are already backed by a PAID invoice —
 * the normalized subset of parseReferenceNumbers(reference) that is in paidNumbers.
 *
 * [BANK-SLOT-PERSIST] The multi-invoice card marks a slot "Betaald" from the SESSION's
 * confirmed set, which is lost on reload; the paid invoice is then excluded from the
 * matcher's candidates (paid), so its slot had no candidate and showed "Koppelen" /
 * "0/N bevestigd" — a false "unpaid", and re-uploading it would double-book the bill.
 * The match route returns this list per partially-linked tx so the UI can mark those
 * slots paid on reload. Consistent with isFullyCovered (same paidSet, same equality).
 */
export function coveredReferenceNumbers(
  reference: string | null,
  paidNumbers: Iterable<string>
): string[] {
  const refNumbers = parseReferenceNumbers(reference);
  const paidSet = paidNumbers instanceof Set ? paidNumbers : new Set(paidNumbers);
  return refNumbers.filter((n) => paidSet.has(n));
}

/**
 * [BANK-SLOT-RECOVERED] Which PAID invoice numbers does this reference cover — answered in the
 * paid invoices' OWN (full, normalized) numbers, so the UI's bundle slots can recognise them.
 *
 * coveredReferenceNumbers above answers in reference TOKENS, and for a recovered bundle
 * ([BUNDEL-REF-RECOVER]) those two vocabularies don't meet: the extractor stores "2026-045" as
 * the fragment "045", the slot shows the invoice's real "2026-045", and the paid set holds
 * "2026045". Equality matches nothing on either side, so after a reload a genuinely PAID
 * invoice re-appeared as an open "Koppelen" slot — inviting the owner to upload (and book) the
 * same bill twice. This helper closes the vocabulary gap with the SAME containment rule the
 * slot recovery itself uses (a token is covered by a paid number that IS it or CONTAINS it —
 * tokens are ≥4 chars with a digit, so "045" can only sit inside its own family of numbers
 * within one transaction's context). Exact matches keep working unchanged: a full token equals
 * the full paid number.
 */
export function coveredNumbersRecovered(
  reference: string | null,
  paidNumbers: Iterable<string>
): string[] {
  const refNumbers = parseReferenceNumbers(reference);
  if (refNumbers.length === 0) return [];
  const paid = paidNumbers instanceof Set ? [...paidNumbers] : [...paidNumbers];
  const out = new Set<string>();
  for (const p of paid) {
    if (refNumbers.some((t) => p === t || p.includes(t))) out.add(p);
  }
  return [...out];
}