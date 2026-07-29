// src/lib/epc-qr.ts
// [PAY-SAFE] EPC069-12 "SEPA Credit Transfer" QR payload + IBAN validation.
//
// Pure functions, NO I/O, NO money movement. The string produced here is the
// standard the owner's OWN banking app scans to PRE-FILL a transfer screen
// (IBAN + name + amount + reference). BoekBrug never processes the payment —
// the owner confirms it inside their bank. This file only RENDERS the data the
// owner already has loaded in their browser; nothing is sent anywhere.
//
// Spec: European Payments Council EPC069-12 ("Quick Response Code: Guidelines
// to Enable the Scan2Pay Service"). The payload is a fixed 12-line block.

// ─── IBAN validation (ISO 7064 mod-97-10) ─────────────────────────────────────
// Reused principle from BRIDGE-POLISH. We validate at PREPARE time (the point of
// use), not at extraction/storage time — a malformed IBAN is stored raw and
// caught here, so we never build a QR around an invalid account number.

/** Canonicalize: strip whitespace, uppercase. */
export function normalizeIban(raw: string): string {
  return raw.replace(/\s+/g, '').toUpperCase()
}

/**
 * Validate an IBAN via ISO 7064 mod-97-10.
 * Returns true only for a structurally valid IBAN (length 15–34, alphanumeric,
 * country prefix, checksum === 1). Does NOT verify the account exists — only
 * that the number is well-formed (catches OCR slips, typos, junk).
 */
export function isValidIban(raw: string | null | undefined): boolean {
  if (!raw) return false
  const iban = normalizeIban(raw)
  if (iban.length < 15 || iban.length > 34) return false
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]+$/.test(iban)) return false

  // Move the first four chars to the end, then convert letters → numbers
  // (A=10 … Z=35) and compute the remainder mod 97 in chunks (avoids BigInt).
  const rearranged = iban.slice(4) + iban.slice(0, 4)
  let remainder = 0
  for (const ch of rearranged) {
    const code = ch.charCodeAt(0)
    const value =
      code >= 48 && code <= 57
        ? ch // digit
        : (code - 55).toString() // letter → 10..35
    for (const d of value) {
      remainder = (remainder * 10 + (d.charCodeAt(0) - 48)) % 97
    }
  }
  return remainder === 1
}

// ─── EPC QR payload ───────────────────────────────────────────────────────────

/**
 * EPC069-12 line 11 (unstructured remittance) is capped at 140 characters, and the payload
 * builder below TRUNCATES to fit. That truncation is invisible to the payer and to us, so a
 * caller that packs several invoice numbers into one reference must check the length ITSELF
 * before minting a request — a dropped number is a payment that can never be reconciled to the
 * invoice it settled. See buildBundelBetaalverzoek / buildBundelBetaling.
 */
export const EPC_REMITTANCE_MAX = 140

export interface EpcQrInput {
  iban: string // vendor IBAN (the party to be paid)
  name: string // vendor / beneficiary name
  amount: number // EUR, incl. BTW
  reference?: string | null // payment reference (betalingskenmerk) or invoice nr
}

export interface EpcQrResult {
  ok: boolean
  payload?: string // the EPC069-12 text to encode into the QR
  error?: string // why it could not be built (Dutch, UI-ready)
}

/**
 * Build the EPC069-12 payload. Returns ok:false with a Dutch reason when the
 * data can't make a safe QR (invalid IBAN, non-positive amount, missing name).
 *
 * Line layout (exactly 12 logical lines; trailing empty lines may be omitted):
 *   1  Service Tag           "BCD"
 *   2  Version               "002"
 *   3  Character set         "1"  (UTF-8)
 *   4  Identification        "SCT" (SEPA Credit Transfer)
 *   5  BIC                   (optional — left empty; not required within SEPA)
 *   6  Beneficiary name      (max 70)
 *   7  Beneficiary IBAN
 *   8  Amount                "EUR12.34"  (0.01–999999999.99)
 *   9  Purpose               (optional — empty)
 *   10 Structured reference  (ISO 11649) — empty (we use unstructured)
 *   11 Unstructured remittance (max 140) — the reference/invoice nr
 *   12 Beneficiary to originator info (optional — empty)
 */
export function buildEpcQrPayload(input: EpcQrInput): EpcQrResult {
  const iban = normalizeIban(input.iban ?? '')
  if (!isValidIban(iban)) {
    return { ok: false, error: 'IBAN ontbreekt of is ongeldig — geen QR mogelijk' }
  }

  // [M3] Strip CR/LF from the beneficiary name BEFORE it goes on line 6 of the newline-
  // delimited EPC payload. Without this, a name like "Legit BV\nNL91...ATTACKER" would
  // shift the following lines and place an attacker IBAN on the IBAN line of the QR the
  // owner scans, while the on-screen IBAN still shows the real one. The remittance line
  // below already strips the same way.
  const name = (input.name ?? '').replace(/[\r\n]+/g, ' ').trim().slice(0, 70)
  if (!name) {
    return { ok: false, error: 'Naam van de leverancier ontbreekt' }
  }

  const amount = input.amount
  if (!Number.isFinite(amount) || amount <= 0 || amount > 999999999.99) {
    return { ok: false, error: 'Bedrag ongeldig — geen QR mogelijk' }
  }
  const amountStr = `EUR${amount.toFixed(2)}`

  // Unstructured remittance — strip CR/LF (line-delimited format) and cap at the spec limit.
  const remittance = (input.reference ?? '')
    .replace(/[\r\n]+/g, ' ')
    .trim()
    .slice(0, EPC_REMITTANCE_MAX)

  const lines = [
    'BCD', // 1 service tag
    '002', // 2 version
    '1', // 3 charset = UTF-8
    'SCT', // 4 SEPA Credit Transfer
    '', // 5 BIC (optional, empty)
    name, // 6 beneficiary name
    iban, // 7 beneficiary IBAN
    amountStr, // 8 amount
    '', // 9 purpose (empty)
    '', // 10 structured reference (empty)
    remittance, // 11 unstructured remittance
    '', // 12 beneficiary-to-originator (empty)
  ]

  return { ok: true, payload: lines.join('\n') }
}