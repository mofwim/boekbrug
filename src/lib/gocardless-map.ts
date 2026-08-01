// src/lib/gocardless-map.ts
// [GOCARDLESS] Berlin Group JSON → our canonical BankTransaction. Pure, no I/O.
//
// ── The one property this file exists to protect ──────────────────────────────────────────────
//
// A transaction can now enter BoekBrug by TWO doors: the owner uploads an MT940/CAMT file, or
// his bank feeds it to us over PSD2. Sooner or later both doors carry the SAME transaction —
// he connects his bank in March and then uploads January–March for the accountant, or a
// bookkeeper uploads the quarter that the daily sync already collected.
//
// Cross-upload dedup (bank-import.ts) keys on
//
//     contentKey = date | amount | dedupName(counterpartName) | norm(reference)
//
// so if this mapper derives a counterpart name or a reference even SLIGHTLY differently from
// bank-parser.ts, the same transaction gets two different keys, lands in the table twice, and
// every figure built on it doubles: omzet, kosten, the btw-aangifte, the kwartaalpakket the
// accountant signs. That is not a display bug — it is a wrong tax return.
//
// This is the exact failure [BANK-REF-ONE-SOURCE] already documents between MT940 and CAMT:
// two copies of one rule, only one of them fixed. So this file does NOT re-implement those
// rules. It reshapes the JSON into what parseCAMT053Entry sees and then calls the SAME
// helpers — extractInvoiceReference, deriveReadableName — in the SAME order. Every branch below
// mirrors a numbered branch there; when you change one, change both.
//
// ── Why the mapping is nearly free ────────────────────────────────────────────────────────────
//
// Berlin Group JSON and CAMT.053 XML are the same data model, so each field has an exact twin:
//
//     <Ustrd>                        remittanceInformationUnstructured(+Array)
//     <Strd><CdtrRefInf><Ref>        remittanceInformationStructured(+Array)
//     <Dbtr><Nm> / <Cdtr><Nm>        debtorName / creditorName
//     <DbtrAcct><IBAN>               debtorAccount.iban / creditorAccount.iban
//     <ValDt><Dt> / <BookgDt><Dt>    valueDate / bookingDate
//     <EndToEndId>                   endToEndId
//     <NtryRef>                      entryReference / transactionId
//     <Amt> + <CdtDbtInd>            transactionAmount.amount  (already SIGNED — no indicator)

import type { BankTransaction } from "./bank-parser";
import { extractInvoiceReference, deriveReadableName, isValidIsoDate } from "./bank-parser";
import type { GoCardlessRawTransaction } from "./gocardless-client";

/** What a mapping run produced: the usable transactions plus one line per dropped entry. */
export interface GoCardlessMapResult {
  transactions: BankTransaction[];
  /** Dutch, owner-facing: each one is a transaction we could NOT read, i.e. money not imported.
   *  Surfaced exactly like the parser's parseErrors — a silent drop is the thing we refuse. */
  warnings: string[];
}

/**
 * Collect the remittance text, in document order, de-duplicated.
 *
 * Mirrors parseCAMT053Entry's `ustrdParts`: every <Ustrd> first, then [CAMT-STRD-REF]'s
 * structured <CdtrRefInf><Ref>. Banks split long remittance across the array form (ISO 20022
 * caps one element at 140 chars) and some send ONLY the structured field — a betaalverzoek
 * whose betalingskenmerk is the invoice number. Reading just one of the four would truncate an
 * invoice number out of existence and leave the payment in "Geen factuur".
 */
export function collectRemittance(tx: GoCardlessRawTransaction): string {
  const parts: string[] = [];
  const push = (raw: unknown) => {
    if (typeof raw !== "string") return;
    const part = raw.trim();
    if (part && !parts.includes(part)) parts.push(part);
  };

  // Unstructured first — the array form before the scalar, because when a bank sends both, the
  // array is the complete text and the scalar is usually its first (truncated) element. Pushing
  // the array first means the scalar then de-duplicates away instead of repeating a fragment.
  if (Array.isArray(tx.remittanceInformationUnstructuredArray)) {
    for (const p of tx.remittanceInformationUnstructuredArray) push(p);
  }
  push(tx.remittanceInformationUnstructured);

  if (Array.isArray(tx.remittanceInformationStructuredArray)) {
    for (const p of tx.remittanceInformationStructuredArray) push(p);
  }
  push(tx.remittanceInformationStructured);

  return parts.join(" ");
}

/**
 * The booking date, as a plain ISO date.
 *
 * Prefers valueDate over bookingDate — the same order parseCAMT053Entry uses (<ValDt> before
 * <BookgDt>), and the reason matters for dedup: an MT940 upload of the same transaction carries
 * the value date, so choosing the booking date here would shift the date by a day or two on
 * weekend bookings and defeat the fingerprint.
 *
 * The *DateTime variants are accepted as a last resort and truncated to their date part, since
 * bank_transactions.date is a Postgres `date`.
 */
export function pickTransactionDate(tx: GoCardlessRawTransaction): string | null {
  const candidates = [tx.valueDate, tx.bookingDate, tx.valueDateTime, tx.bookingDateTime];
  for (const raw of candidates) {
    if (typeof raw !== "string") continue;
    const date = raw.trim().slice(0, 10);
    if (isValidIsoDate(date)) return date;
  }
  return null;
}

/**
 * The signed amount in euros, or null when unreadable.
 *
 * transactionAmount.amount is a STRING in the Berlin Group model ("-15.00") and already carries
 * its sign — there is no CdtDbtInd to apply, so applying one would flip every debit. A
 * non-finite value must never reach the database: it poisons every sum downstream
 * (reconciliation, kwartaaltotalen). Same guard as [H3] in the CAMT parser.
 */
export function parseSignedAmount(tx: GoCardlessRawTransaction): number | null {
  const raw = tx.transactionAmount?.amount;
  if (raw === null || raw === undefined || raw === "") return null;
  const n = typeof raw === "string" ? Number(raw.trim()) : raw;
  return typeof n === "number" && Number.isFinite(n) ? n : null;
}

/**
 * Map ONE transaction. Returns null when the entry cannot be read; the caller records a warning
 * so a dropped line is always visible rather than silently missing from the owner's money.
 */
export function mapGoCardlessTransaction(tx: GoCardlessRawTransaction): BankTransaction | null {
  const amount = parseSignedAmount(tx);
  if (amount === null) return null;

  const date = pickTransactionDate(tx);
  if (!date) return null;

  const description = collectRemittance(tx);
  const currency =
    typeof tx.transactionAmount?.currency === "string" && tx.transactionAmount.currency
      ? tx.transactionAmount.currency
      : "EUR";

  // Counterpart. Money IN → the other party is the debtor (who paid us); money OUT → the
  // creditor (whom we paid). Exactly parseCAMT053Entry's isCredit ? "Dbtr" : "Cdtr".
  //
  // A zero-amount line has no direction to read; treating it as credit matches the CAMT parser,
  // whose <CdtDbtInd> defaults to CRDT when absent.
  const isCredit = amount >= 0;
  let counterpartName = cleanString(isCredit ? tx.debtorName : tx.creditorName);
  const counterpartIban = cleanString(
    isCredit ? tx.debtorAccount?.iban : tx.creditorAccount?.iban,
  );

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
  // never from a re-implementation here, and endToEndId is only a fallback for a real transfer
  // (on a POS batch it holds the batch id, which is not an invoice number).
  const isPosEntry = /BETAALAUTOMAAT|AFREK\.|Verzamelbetaling/i.test(description);
  let reference = extractInvoiceReference(description || null, {
    isPos: isPosEntry,
    isCard: false,
  });
  if (!reference && !isPosEntry) {
    const e2e = cleanString(tx.endToEndId);
    reference = e2e && !/^NOTPROVIDED$/i.test(e2e) ? e2e : null;
  }

  // [BANK-PARSE-CARD] A card purchase has no related party either — derive the store name and
  // drop the terminal noise the structured pass may have taken for a reference.
  if (!counterpartName && /TERMINALID|PASVOLGNR|TRANSACTIENR|CCV\*|BCK\*|BETAALPAS|\bNLD\b/i.test(description)) {
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
    // The bank's own id. Kept for debugging and for the sync's per-account watermark; it is
    // deliberately NOT part of the dedup fingerprint, because the file export of the same
    // transaction carries a different one (see the contentKey header in bank-import.ts).
    transactionId: cleanString(tx.transactionId) ?? cleanString(tx.internalTransactionId) ?? cleanString(tx.entryReference),
    rawLine: "",
  };
}

/**
 * Map a whole booked list. Order is preserved; unreadable entries become a Dutch warning naming
 * what we could see of them, so "we imported 40 of 42 lines" is never a silent 40.
 */
export function mapGoCardlessTransactions(
  raw: GoCardlessRawTransaction[],
): GoCardlessMapResult {
  const transactions: BankTransaction[] = [];
  const warnings: string[] = [];

  for (const tx of raw) {
    const mapped = mapGoCardlessTransaction(tx);
    if (mapped) {
      transactions.push(mapped);
      continue;
    }
    warnings.push(describeUnreadable(tx));
  }

  return { transactions, warnings };
}

/** One Dutch line describing a transaction we could not read, with whatever identified it. */
function describeUnreadable(tx: GoCardlessRawTransaction): string {
  const bits: string[] = [];
  const date = cleanString(tx.bookingDate) ?? cleanString(tx.valueDate);
  if (date) bits.push(date);
  const amount = tx.transactionAmount?.amount;
  if (amount !== null && amount !== undefined && amount !== "") bits.push(`bedrag "${String(amount)}"`);
  const remi = collectRemittance(tx);
  if (remi) bits.push(`"${remi.slice(0, 60)}"`);
  const id = cleanString(tx.transactionId);
  if (!bits.length && id) bits.push(`id ${id}`);
  return bits.length
    ? `Een banktransactie kon niet gelezen worden (${bits.join(", ")}) — datum of bedrag ontbreekt of is ongeldig.`
    : "Een banktransactie kon niet gelezen worden — datum of bedrag ontbreekt of is ongeldig.";
}

function cleanString(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  return s ? s : null;
}
