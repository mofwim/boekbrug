// src/lib/vendor-identity.ts
// [LEVERANCIER-ID] Two things a purchase invoice prints about who is being paid, checked
// mechanically: the account number and the btw number. Pure — no I/O, no model, no opinion.
//
// ── WHY THESE TWO, AND WHY NOW ──
//
// The checklist already answers "did this supplier's account number CHANGE" — the fraud question,
// and the most valuable row on the panel. It never asked whether the number is a possible IBAN at
// all. Those are different failures with different causes:
//
//   · changed  → someone (or something) redirected the payment. Malice, or a hijacked mailbox.
//   · impossible → one character was read wrong, or printed wrong. No malice needed, and the
//     money goes nowhere or somewhere random.
//
// An IBAN carries its own checksum (ISO 7064 mod-97) for exactly this: change one digit and it
// stops validating. The reader canonicalises what it finds (uppercase, no spaces) and stores it
// WITHOUT that check — its own comment says "future mod-97 validation at QR-prepare time". So a
// misread digit reaches the pay screen looking perfectly ordinary. This is that check, at the
// moment the owner is deciding to pay.
//
// The btw number is the other half of the same question and it is a LEGAL one: art. 35a Wet OB
// requires the supplier's btw-identificatienummer on a factuur, and without a valid one the
// voorbelasting on that cost is refusable. The reader keeps a well-formed NL id as a supplier key
// and drops everything else — correct for a key, and it meant the malformed case, the only case
// worth mentioning, disappeared without a word. [BTW-NUMMER-GELEZEN] in ai.ts now keeps what was
// printed; this file judges it.
//
// ── THE THIRD ANSWER ──
//
// Both checks refuse to speak when there is nothing to check. An invoice that prints no account
// number is not an invoice with a bad one, and a kassabon carries no btw number by design (a
// vereenvoudigde factuur is not an art. 35 invoice). "Not checked" is a first-class answer here
// for the same reason it is everywhere else in invoice-checks.ts: a tick that was not earned is
// worse than no row at all.

// The mod-97 checksum, country-agnostic, already written and tested for the payment QR. Reusing it
// keeps ONE definition of "is this a possible IBAN" — validation.ts's validateIban is NL-only by
// design (it guards the owner's OWN iban field) and would reject a German supplier out of hand.
import { isValidIban, normalizeIban } from './epc-qr'

export type IdentityVerdict = 'ok' | 'bad' | 'absent'

/**
 * Is what the invoice printed a possible IBAN?
 *
 * 'absent' when nothing was read — there is no evidence either way. 'bad' when the characters are
 * there and the checksum refuses them: that is a misprint or a misread, and it is the one case
 * where a payment can be prepared against a number that cannot exist.
 */
export function checkVendorIban(raw: string | null | undefined): IdentityVerdict {
  const v = normalizeIban(raw ?? '')
  if (!v) return 'absent'
  return isValidIban(v) ? 'ok' : 'bad'
}

/**
 * Is what the invoice printed a usable btw-identificatienummer?
 *
 * Two shapes are accepted, and the distinction is deliberate:
 *   · NL — the strict national form, NL + 9 digits + B + 2 digits. Anything else claiming to be
 *     Dutch is wrong, and a Dutch supplier is the overwhelmingly common case.
 *   · another EU member state — two letters plus 2–12 alphanumerics. Per-country rules exist and
 *     are not encoded here on purpose: refusing a Belgian supplier's valid number because this
 *     app only learned the Dutch shape would be a false alarm on a correct invoice, which is how
 *     a warning stops being read. GB is excluded — it left the EU VAT system, so a GB number on a
 *     purchase invoice is a question, not a passing detail.
 */
export function checkVendorBtw(raw: string | null | undefined): IdentityVerdict {
  const v = String(raw ?? '').replace(/[\s.-]/g, '').toUpperCase()
  if (!v) return 'absent'
  if (v.startsWith('NL')) return /^NL\d{9}B\d{2}$/.test(v) ? 'ok' : 'bad'
  // The EU-27 prefixes plus the two that are not country codes (EL = Greece, XI = Northern
  // Ireland under the Windsor Framework). A prefix outside this set is not an EU VAT id.
  const EU = new Set([
    'AT', 'BE', 'BG', 'CY', 'CZ', 'DE', 'DK', 'EE', 'EL', 'ES', 'FI', 'FR', 'HR', 'HU', 'IE',
    'IT', 'LT', 'LU', 'LV', 'MT', 'PL', 'PT', 'RO', 'SE', 'SI', 'SK', 'XI',
  ])
  if (!EU.has(v.slice(0, 2))) return 'bad'
  return /^[A-Z]{2}[A-Z0-9]{2,12}$/.test(v) ? 'ok' : 'bad'
}


/**
 * [BTW-NUMMER-BEWAARD] The supplier's btw-identificatienummer, ready to store on the invoice row.
 *
 * ai.ts reads this number off every purchase invoice and then loses it. Its own filter is right on
 * its terms — only `NL\d{9}B\d{2}` may become a supplier KEY, so a German or Belgian number is
 * dropped — and what survives is `_vendor_btw_printed` in field_confidence, which the invoice-checks
 * screen reads to tell an owner their supplier printed a malformed number.
 *
 * Nothing wrote it to `invoices.client_btw_number`, which is the column the rest of the app reads
 * as "the counterparty's VAT number". On an incoming invoice that column IS the supplier's — the
 * same row holds the supplier's name in client_name. The consequence was quiet and total:
 * buildForeignPurchases (icp.ts) filters `direction === "incoming"` and then classifies
 * clientVatNumber, so the EU-purchase listing — rubriek 4b, the verlegde BTW an accountant has to
 * place — could never return a single row for anyone. Not "rarely": never, on any account, for any
 * quarter. eu-inkopen.csv was written from an empty list and read as "no EU purchases".
 *
 * What this returns, and what it refuses:
 *   • the printed number when checkVendorBtw calls its SHAPE valid — NL and the EU-27 alike,
 *     normalised the way every other reader here normalises (no spaces, dots or dashes, upper);
 *   • null for a malformed one. A wrong VAT number on a fiscal listing is a correction letter;
 *     a missing one leaves the invoice visible as an ordinary cost, which is where it already was.
 *     The malformed value is NOT lost — it stays in _vendor_btw_printed, where the invoice-checks
 *     row already tells the owner about it.
 *
 * The NL-filtered value is accepted as a fallback so a path that never carried field_confidence
 * still stores what it had.
 */
export function supplierBtwForInvoice(
  printed: string | null | undefined,
  vendorBtw?: string | null,
): string | null {
  for (const raw of [printed, vendorBtw]) {
    if (checkVendorBtw(raw) !== 'ok') continue
    return String(raw).replace(/[\s.-]/g, '').toUpperCase()
  }
  return null
}
