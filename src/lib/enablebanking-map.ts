// src/lib/enablebanking-map.ts
// [ENABLEBANKING] Berlin Group snake_case JSON → our canonical BankTransaction. Pure, no I/O.
//
// ── Read this before touching the amount ──────────────────────────────────────────────────────
//
// Enable Banking and GoCardless serve the SAME data model and disagree on the one field that
// cannot be got wrong:
//
//     GoCardless      transactionAmount.amount = "-15.00"   ← already signed, no indicator
//     Enable Banking  transaction_amount.amount = "15.0"    ← a MAGNITUDE
//                     credit_debit_indicator    = "DBIT"    ← the sign lives here
//
// Verified against the vendor's own sample export: 611 transactions, 439 of them DBIT, and not
// one amount string carries a minus sign. So copying gocardless-map.ts — whose header states in
// so many words "already SIGNED — no indicator to apply" — would import every expense as income.
// Not a display bug: kosten become omzet, the btw-aangifte inverts, and every figure the
// accountant signs is wrong in the direction that looks like a good quarter.
//
// The split is exactly CAMT.053's <Amt> + <CdtDbtInd>, so parseCAMT053Entry is the template, not
// gocardless-map.ts. Where the two mappers agree (remittance, reference, counterpart, the
// fallbacks) this file mirrors gocardless-map.ts field-rename for field-rename.
//
// ── The one property this file exists to protect ──────────────────────────────────────────────
//
// A transaction can enter BoekBrug by more than one door: the owner uploads an MT940/CAMT file,
// or his bank feeds it to us over PSD2. Sooner or later both doors carry the SAME transaction.
// Cross-upload dedup (bank-import.ts) keys on
//
//     contentKey = date | amount | dedupName(counterpartName) | norm(reference)
//
// so if this mapper derives a name or a reference even SLIGHTLY differently from bank-parser.ts,
// the same transaction lands in the table twice and every figure built on it doubles. That is
// why nothing below re-implements those rules: it reshapes the JSON into what parseCAMT053Entry
// sees and then calls the SAME helpers — extractInvoiceReference, deriveReadableName — in the
// SAME order. Every branch mirrors a numbered branch there; when you change one, change both.
//
// ── What this was written against ─────────────────────────────────────────────────────────────
//
// The vendor's sample accounts-data export (the shape their mock ASPSP serves back). Extra fields
// the live API adds are ignored harmlessly, but two things stay unverified until a real
// /accounts/{id}/transactions response is in hand, and both are called out at their branch:
// whether the live model carries an end-to-end id (the sample has none), and whether
// remittance_information is ever longer than one element.

import type { BankTransaction } from "./bank-parser";
import { extractInvoiceReference, deriveReadableName, isValidIsoDate } from "./bank-parser";

/** The Berlin Group amount object: a decimal STRING plus its currency. */
export interface EnableBankingAmount {
  amount?: string | number | null;
  currency?: string | null;
}

/** A related party. Only the name reaches our tables; the address/id blocks are not stored. */
export interface EnableBankingParty {
  name?: string | null;
}

/** An account reference: an IBAN, or a domestic id under `other` with the scheme that names it. */
export interface EnableBankingAccountRef {
  iban?: string | null;
  other?: {
    identification?: string | null;
    scheme_name?: string | null;
    issuer?: string | null;
  } | null;
}

/** One transaction as Enable Banking serves it. Every field optional — banks omit freely. */
export interface EnableBankingRawTransaction {
  entry_reference?: string | null;
  transaction_amount?: EnableBankingAmount | null;
  credit_debit_indicator?: string | null;
  status?: string | null;
  booking_date?: string | null;
  value_date?: string | null;
  transaction_date?: string | null;
  creditor?: EnableBankingParty | null;
  debtor?: EnableBankingParty | null;
  creditor_account?: EnableBankingAccountRef | null;
  debtor_account?: EnableBankingAccountRef | null;
  remittance_information?: string[] | null;
  reference_number?: string | null;
  bank_transaction_code?: {
    code?: string | null;
    sub_code?: string | null;
    description?: string | null;
  } | null;
  merchant_category_code?: string | null;
  balance_after_transaction?: EnableBankingAmount | null;
}

/** What a mapping run produced. */
export interface EnableBankingMapResult {
  transactions: BankTransaction[];
  /** Dutch, owner-facing: each one is a transaction we could NOT read, i.e. money not imported.
   *  Surfaced exactly like the parser's parseErrors — a silent drop is the thing we refuse. */
  warnings: string[];
  /** Not-yet-booked entries we deliberately passed over. Not a warning: a pending line is not
   *  lost money, it is money the bank has not committed yet and may still change or withdraw. */
  skipped: number;
}

/** The Berlin Group status of a committed entry. Anything else is not final money. */
export const BOOKED_STATUS = "BOOK";

const DEBIT = "DBIT";
const CREDIT = "CRDT";

/**
 * Is this entry booked?
 *
 * A pending entry may still change amount, or vanish. Importing one puts a figure in the books
 * that the bank never committed, and the booked twin arriving days later with a different amount
 * dedups against nothing — so the owner ends up with both. We import only BOOK.
 *
 * An ABSENT status counts as booked: the sync asks the API for booked transactions, so a missing
 * field there means "the one kind we requested", not "unknown".
 */
export function isBooked(tx: EnableBankingRawTransaction): boolean {
  const status = cleanString(tx.status);
  if (!status) return true;
  return status.toUpperCase() === BOOKED_STATUS;
}

/**
 * The signed amount in the account's currency, plus the direction that produced the sign.
 *
 * Returns null when the direction cannot be established, and that refusal is the point. The CAMT
 * parser defaults a missing <CdtDbtInd> to CRDT, which is safe there because the schema makes the
 * element mandatory. Here we have no such guarantee, and defaulting an unsigned magnitude to
 * "credit" would book expenses as income — silently, on every affected line. A dropped line the
 * owner is told about is recoverable; an expense filed as revenue is a wrong tax return.
 *
 * The direction is returned alongside the amount so the sign and the counterpart choice below can
 * never disagree — they are one decision, made once.
 */
export function readSignedAmount(
  tx: EnableBankingRawTransaction,
): { amount: number; isCredit: boolean } | null {
  const raw = tx.transaction_amount?.amount;
  if (raw === null || raw === undefined) return null;

  // Trim BEFORE the emptiness check: Number("") is 0, so a blank or whitespace-only amount that
  // slipped past would enter the books as a fabricated 0,00 rather than as a visible warning.
  const text = typeof raw === "string" ? raw.trim() : String(raw);
  if (!text) return null;

  const parsed = Number(text);
  // A non-finite amount must never reach the database: it poisons every sum downstream
  // (reconciliation, kwartaaltotalen). Same guard as [H3] in the CAMT parser.
  if (!Number.isFinite(parsed)) return null;

  const indicator = cleanString(tx.credit_debit_indicator)?.toUpperCase() ?? null;
  if (indicator === DEBIT || indicator === CREDIT) {
    const magnitude = Math.abs(parsed);
    const isCredit = indicator === CREDIT;
    return { amount: signOf(magnitude, isCredit), isCredit };
  }

  // No usable indicator. A value that carries its own minus sign is still unambiguous — a bank
  // that signs its amounts has told us the direction — so honour it rather than drop money we can
  // read. An unsigned value with no indicator is genuinely undecidable and is refused above.
  if (parsed < 0) return { amount: parsed, isCredit: false };
  return null;
}

/** The signed amount alone. Thin wrapper over readSignedAmount for readability at call sites. */
export function parseSignedAmount(tx: EnableBankingRawTransaction): number | null {
  return readSignedAmount(tx)?.amount ?? null;
}

/**
 * Collect the remittance text, in document order, de-duplicated, line-break flattened.
 *
 * Mirrors parseCAMT053Entry's `ustrdParts`: the free text first, then [CAMT-STRD-REF]'s
 * structured creditor reference — which Enable Banking calls reference_number and which is often
 * the ONLY place a betaalverzoek's betalingskenmerk appears. Reading just one of the two would
 * lose an invoice number and leave the payment in "Geen factuur".
 *
 * The line-break flattening is not cosmetic. Enable Banking packs what a CAMT file splits across
 * several <Ustrd> elements into ONE string with embedded newlines ("Til Mad\nWe have transferred
 * the amount to:\n4092 3342223455" — 80 of 611 lines in the vendor sample). extractInvoiceReference
 * and deriveReadableName are written against the flat form the file door produces, so handing them
 * a multi-line string is handing them text no other door ever shows them. A line break becomes
 * exactly what the file door produces at the same place: the parser trims each <Ustrd> and joins
 * with ONE space, so `\s*[\r\n]+\s*` → " " reproduces it character for character.
 *
 * Runs of ordinary spaces are deliberately LEFT ALONE. [BANK-PARSE-FEE] below splits the charge
 * label on /\s{2,}/, and banks pad their statement text into columns ("otay-shop.dk     15423"),
 * so collapsing every whitespace run would make this door read a fee label — and therefore a
 * counterpart name, and therefore a dedup fingerprint — that the uploaded file does not.
 */
export function collectRemittance(tx: EnableBankingRawTransaction): string {
  const parts: string[] = [];
  const push = (raw: unknown) => {
    if (typeof raw !== "string") return;
    const part = raw.replace(/\s*[\r\n]+\s*/g, " ").trim();
    if (part && !parts.includes(part)) parts.push(part);
  };

  if (Array.isArray(tx.remittance_information)) {
    for (const p of tx.remittance_information) push(p);
  }
  push(tx.reference_number);

  return parts.join(" ");
}

/**
 * The booking date, as a plain ISO date.
 *
 * Prefers value_date over booking_date — the same order parseCAMT053Entry uses (<ValDt> before
 * <BookgDt>), and the reason matters for dedup: an MT940 upload of the same transaction carries
 * the value date, so choosing the booking date here would shift the date by a day or two on
 * weekend bookings and defeat the fingerprint.
 *
 * transaction_date is a last resort (it is null throughout the vendor sample). Datetimes are
 * truncated to their date part, since bank_transactions.date is a Postgres `date`.
 */
export function pickTransactionDate(tx: EnableBankingRawTransaction): string | null {
  const candidates = [tx.value_date, tx.booking_date, tx.transaction_date];
  for (const raw of candidates) {
    if (typeof raw !== "string") continue;
    const date = raw.trim().slice(0, 10);
    if (isValidIsoDate(date)) return date;
  }
  return null;
}

/**
 * The counterpart's IBAN, or null.
 *
 * `other.identification` is NOT an IBAN and must never be stored as one. In the vendor's sample
 * every single one is either a card PAN (scheme_name "CPAN", e.g. "233111XXXXXX4455") or a
 * domestic account number ("BBAN"/"BANK"/"OTHI") — 364 of them, and zero IBANs. Writing a card
 * number into counterpart_iban would put a PAN in a column nobody expects one in, and would match
 * against the owner's own IBANs as if it were an account. It is accepted only when the scheme
 * itself says it is an IBAN.
 */
export function counterpartIbanOf(acc: EnableBankingAccountRef | null | undefined): string | null {
  const iban = cleanString(acc?.iban);
  if (iban) return iban;
  const scheme = cleanString(acc?.other?.scheme_name)?.toUpperCase();
  if (scheme === "IBAN") return cleanString(acc?.other?.identification);
  return null;
}

/**
 * Map ONE transaction. Returns null when the entry cannot be read; the caller records a warning
 * so a dropped line is always visible rather than silently missing from the owner's money.
 */
export function mapEnableBankingTransaction(
  tx: EnableBankingRawTransaction,
): BankTransaction | null {
  const signed = readSignedAmount(tx);
  if (!signed) return null;
  const { amount, isCredit } = signed;

  const date = pickTransactionDate(tx);
  if (!date) return null;

  const description = collectRemittance(tx);
  const currency = cleanString(tx.transaction_amount?.currency) ?? "EUR";

  // Counterpart. Money IN → the other party is the debtor (who paid us); money OUT → the creditor
  // (whom we paid). Exactly parseCAMT053Entry's isCredit ? "Dbtr" : "Cdtr", and deliberately so
  // even where a bank fills the other slot: the vendor sample has 13 card REFUNDS that arrive as
  // CRDT while still naming the shop as `creditor`. Reading that field would give a name the
  // uploaded file cannot give — the CAMT parser looks at <Dbtr> there too — and a name that
  // differs by door is a fingerprint that differs by door, which is a double import. Both doors
  // fall through to deriveReadableName on the same text instead, and agree.
  let counterpartName = cleanString(isCredit ? tx.debtor?.name : tx.creditor?.name);
  const counterpartIban = counterpartIbanOf(isCredit ? tx.debtor_account : tx.creditor_account);

  // [BANK-PARSE-FEE] Bank charges name no party at all. Same rescue as the CAMT parser: take the
  // clean charge label from the head of the description ("Kosten Zakelijk Betalingsverkeer …").
  if (!counterpartName && /Kosten|Betalingsverkeer/i.test(description)) {
    const label = description
      .split(/\s{2,}|Factuurnr\.|Betreft|Periode/i)[0]
      .replace(/\s+/g, " ")
      .trim();
    if (label.length >= 3) counterpartName = label;
  }

  // [BANK-PARSE-REF] The reference comes from the remittance text through the SHARED extractor,
  // never from a re-implementation here.
  //
  // There is no endToEndId fallback, because this model has no end-to-end id: reference_number is
  // the structured creditor reference (CAMT's <CdtrRefInf><Ref>) and is already IN the description
  // above, so extractInvoiceReference has seen it — adding it again as a fallback would smuggle
  // past the POS guard and the bare-year drop that the extractor applies on purpose.
  // entry_reference is <NtryRef>, the bank's own entry id, and is not a reference in CAMT either.
  const isPosEntry = /BETAALAUTOMAAT|AFREK\.|Verzamelbetaling/i.test(description);
  let reference = extractInvoiceReference(description || null, {
    isPos: isPosEntry,
    isCard: false,
  });

  // [BANK-PARSE-CARD] A card purchase has no related party either — derive the store name and
  // drop the terminal noise the structured pass may have taken for a reference.
  if (
    !counterpartName &&
    /TERMINALID|PASVOLGNR|TRANSACTIENR|CCV\*|BCK\*|BETAALPAS|\bNLD\b/i.test(description)
  ) {
    const store = deriveReadableName(description);
    if (store) {
      counterpartName = store;
      reference = null;
    }
  }
  // [BANK-PARSE-READABLE] Still nothing? Derive the most recognisable text from the description
  // so the owner never faces a blank counterpart.
  if (!counterpartName) {
    counterpartName = deriveReadableName(description);
  }

  return {
    date,
    amount,
    currency,
    description,
    counterpartName,
    counterpartIban,
    reference,
    // The bank's own entry id. Kept for debugging only, and it is NOT an identity: the vendor
    // sample holds 611 transactions under 481 distinct entry_reference values — one of them
    // ("3845245274") is shared by 44 unrelated MobilePay lines, and "0000000000" by 21. Treating
    // it as a key would collapse real transactions into one another. Dedup keys on content
    // (see the contentKey header in bank-import.ts), which is why this is safe to store as-is.
    transactionId: cleanString(tx.entry_reference),
    rawLine: "",
  };
}

/**
 * Map a whole list. Order is preserved; unreadable entries become a Dutch warning naming what we
 * could see of them, so "we imported 40 of 42 lines" is never a silent 40. Not-yet-booked entries
 * are counted separately — passed over on purpose, not lost.
 */
export function mapEnableBankingTransactions(
  raw: EnableBankingRawTransaction[],
): EnableBankingMapResult {
  const transactions: BankTransaction[] = [];
  const warnings: string[] = [];
  let skipped = 0;

  for (const tx of raw) {
    if (!isBooked(tx)) {
      skipped += 1;
      continue;
    }
    const mapped = mapEnableBankingTransaction(tx);
    if (mapped) {
      transactions.push(mapped);
      continue;
    }
    warnings.push(describeUnreadable(tx));
  }

  return { transactions, warnings, skipped };
}

/** One Dutch line describing a transaction we could not read, with whatever identified it. */
function describeUnreadable(tx: EnableBankingRawTransaction): string {
  const bits: string[] = [];
  const date = cleanString(tx.booking_date) ?? cleanString(tx.value_date);
  if (date) bits.push(date);
  const amount = tx.transaction_amount?.amount;
  if (amount !== null && amount !== undefined && amount !== "") {
    bits.push(`bedrag "${String(amount)}"`);
  }
  const remi = collectRemittance(tx);
  if (remi) bits.push(`"${remi.slice(0, 60)}"`);
  const id = cleanString(tx.entry_reference);
  if (!bits.length && id) bits.push(`id ${id}`);

  // Name the real cause when it is the DIRECTION rather than the figure. "We could read 88,00 but
  // not whether it went in or out" sends the owner (and support) somewhere quite different from
  // "we could not read the amount" — and it is the cause that says the bank, not the file, is odd.
  const amountText = amount === null || amount === undefined ? "" : String(amount).trim();
  const amountReadable = amountText !== "" && Number.isFinite(Number(amountText));
  const cause =
    amountReadable && !readSignedAmount(tx)
      ? "de bank gaf niet door of het een bij- of afschrijving is"
      : "datum of bedrag ontbreekt of is ongeldig";

  return bits.length
    ? `Een banktransactie kon niet gelezen worden (${bits.join(", ")}) — ${cause}.`
    : `Een banktransactie kon niet gelezen worden — ${cause}.`;
}

/** Zero has no sign in the books; -0 would round-trip through JSON as "-0". */
function signOf(magnitude: number, isCredit: boolean): number {
  if (magnitude === 0) return 0;
  return isCredit ? magnitude : -magnitude;
}

function cleanString(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  return s ? s : null;
}
