// src/lib/supplier-pin.ts
// [LEVERANCIER-VASTLEGGEN] What the owner may write onto a supplier, and in what form. Pure.
//
// ── THE REQUEST, AND WHY IT IS NOT A FORM ──
//
// "Let me fix the supplier's details once, and stop guessing every month." Reported on an invoice
// whose leverancier field read "Silifke / Hocaoglu" — a PRODUCT LINE printed at the top of the
// page — while the company sending it is OZ&ER FOOD B.V., named further down beside its KVK, its
// BTW number and its IBAN. The reader will make that same mistake on next month's paper, because
// next month's paper looks exactly the same.
//
// Two halves, and only one of them is a form:
//   · STORING what the owner says — this file, and the route that uses it;
//   · RECOGNISING it next time — supplier-alias.ts, which already exists and is what makes the
//     correction survive contact with the next invoice. The route below leans on it rather than
//     inventing a second way to remember.
//
// ── WHY VALIDATION IS NOT COSMETIC HERE ──
//
// A supplier row is not a label. Its IBAN is what knownIbanForVendor compares next month's invoice
// against — the check that stands between the owner and a redirected payment. Pinning a MISTYPED
// IBAN would not merely be untidy: it would make every future genuine invoice from this supplier
// look like an account change, and the owner would learn to click that warning away. So an account
// number that fails its own checksum is refused here, with the reason, instead of being stored and
// silently poisoning the one gate that matters.
//
// Empty is a real answer and means CLEAR IT. An owner who sees a wrong btw number must be able to
// remove it — that is the difference between an editor and a decoration.

import { isReliableSupplierName, supplierNameKey } from './supplier-registry'
// [LEVERANCIER-ID] The same two mechanical checks the invoice checklist runs, so the panel and the
// editor can never disagree about what a valid number looks like.
import { checkVendorIban, checkVendorBtw } from './vendor-identity'

export interface SupplierPinInput {
  name?: string | null
  iban?: string | null
  kvk?: string | null
  btw?: string | null
}

export interface SupplierPinValues {
  name: string
  /** null = the owner cleared it. */
  iban: string | null
  kvk: string | null
  btw: string | null
  /** The normalized key the registry resolves on — derived here so the caller cannot forget it. */
  nameKey: string
}

export type SupplierPinPlan =
  | { ok: true; values: SupplierPinValues }
  /** Dutch, owner-facing, and it names the FIELD — a form that says "ongeldig" says nothing. */
  | { ok: false; field: 'name' | 'iban' | 'kvk' | 'btw'; error: string }

/** Digits only. A Dutch KVK number is exactly eight of them. */
function normalizeKvk(raw: string | null | undefined): string {
  return String(raw ?? '').replace(/\D/g, '')
}

/**
 * Read one supplier form, or say precisely what is wrong with it.
 *
 * Nothing here is a suggestion: a refusal means the write does not happen, because every value
 * this stores is a key some other part of the app decides with.
 */
export function planSupplierPin(input: SupplierPinInput): SupplierPinPlan {
  const name = String(input.name ?? '').trim().replace(/\s+/g, ' ')
  if (!name) {
    return { ok: false, field: 'name', error: 'Vul de naam van de leverancier in.' }
  }
  // The same bar the registry uses to refuse manufacturing a junk supplier island. A placeholder
  // ("onbekend", "factuur") as a supplier name would collect every unidentified invoice in the book.
  if (!isReliableSupplierName(name)) {
    return {
      ok: false,
      field: 'name',
      error: 'Dit lijkt geen bedrijfsnaam. Neem de naam over zoals hij op de factuur staat.',
    }
  }
  const nameKey = supplierNameKey(name)
  if (!nameKey) {
    return { ok: false, field: 'name', error: 'Deze naam levert geen bruikbare sleutel op.' }
  }

  const ibanRaw = String(input.iban ?? '').trim()
  const ibanState = checkVendorIban(ibanRaw)
  if (ibanState === 'bad') {
    return {
      ok: false,
      field: 'iban',
      error:
        'De controlecijfers van dit rekeningnummer kloppen niet. Neem het over zoals het op de ' +
        'factuur staat — met een verkeerd nummer waarschuwt de app straks bij élke echte factuur ' +
        'van deze leverancier.',
    }
  }
  const iban = ibanState === 'ok' ? ibanRaw.replace(/\s+/g, '').toUpperCase() : null

  const kvk = normalizeKvk(input.kvk)
  if (kvk && kvk.length !== 8) {
    return { ok: false, field: 'kvk', error: 'Een KVK-nummer bestaat uit 8 cijfers.' }
  }

  const btwRaw = String(input.btw ?? '').trim()
  const btwState = checkVendorBtw(btwRaw)
  if (btwState === 'bad') {
    return {
      ok: false,
      field: 'btw',
      error: 'Dit heeft niet de vorm van een btw-nummer. Een Nederlands nummer ziet eruit als NL000000000B00.',
    }
  }
  const btw = btwState === 'ok' ? btwRaw.replace(/[\s.-]/g, '').toUpperCase() : null

  return { ok: true, values: { name, iban, kvk: kvk || null, btw, nameKey } }
}

/**
 * What changed between what stands and what the owner wants — so the route writes only that, and
 * the sentence afterwards can say what actually moved.
 *
 * A field that did not change is not "confirmed": it is untouched. The distinction matters to the
 * audit trail, which an accountant reads a year later to reconstruct who said what.
 */
export function supplierPinChanges(
  current: { name?: string | null; iban?: string | null; kvk_number?: string | null; btw_number?: string | null },
  next: SupplierPinValues,
): Partial<{ name: string; name_key: string; iban: string | null; kvk_number: string | null; btw_number: string | null }> {
  const out: Partial<{ name: string; name_key: string; iban: string | null; kvk_number: string | null; btw_number: string | null }> = {}
  if ((current.name ?? '') !== next.name) {
    out.name = next.name
    out.name_key = next.nameKey
  }
  if ((current.iban ?? null) !== next.iban) out.iban = next.iban
  if ((current.kvk_number ?? null) !== next.kvk) out.kvk_number = next.kvk
  if ((current.btw_number ?? null) !== next.btw) out.btw_number = next.btw
  return out
}
