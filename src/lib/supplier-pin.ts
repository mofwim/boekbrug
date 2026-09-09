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
//
// [TAAL] A refusal is a CODE plus the field, never a sentence: this module is pure and holds no
// language. The route translates the code with the language of whoever is typing
// (SUPPLIER_PIN_REFUSAL_KEY below), so an Arabic owner reads the IBAN warning in Arabic.

import { isReliableSupplierName, supplierNameKey } from './supplier-registry'
// [LEVERANCIER-ID] The same two mechanical checks the invoice checklist runs, so the panel and the
// editor can never disagree about what a valid number looks like.
import { checkVendorIban, checkVendorBtw } from './vendor-identity'
import type { MessageKey } from './i18n/messages'
// [LEVERANCIER-STANDAARD] The category vocabulary a default may come from — the bank's own.
import { ALLOWED_CATEGORIES, type BankCategory } from './bank-categories'
// [LEVERANCIER-LAND] The supplier's country as a code — what puts their invoices in rubriek 4a/4b.
import { normalizeCountry } from './client-country'

export interface SupplierPinInput {
  name?: string | null
  iban?: string | null
  kvk?: string | null
  btw?: string | null
  /**
   * [LEVERANCIER-LAND] ISO code, two letters. ABSENT (undefined) = not on this form, stored value
   * untouched — the four-field pin modal does not carry it; '' or null = the owner cleared it.
   */
  country?: string | null
  /**
   * [LEVERANCIER-STANDAARD] The two defaults. ABSENT (undefined) means "not on this form" and
   * leaves the stored value alone — the pin modal on an invoice does not carry them. Null or ''
   * means the owner cleared it. That distinction is what keeps a four-field form from wiping a
   * default the owner set on the six-field one.
   */
  defaultBtwRate?: string | number | null
  defaultCategory?: string | null
}

/** The rates the law has. A default outside them is a typo, never a fourth rate. */
export const LEGAL_DEFAULT_RATES = [0, 9, 21] as const
export type LegalRate = (typeof LEGAL_DEFAULT_RATES)[number]

export interface SupplierPinValues {
  name: string
  /** null = the owner cleared it. */
  iban: string | null
  kvk: string | null
  btw: string | null
  /** The normalized key the registry resolves on — derived here so the caller cannot forget it. */
  nameKey: string
  /** undefined = not on the form; null = cleared. */
  defaultBtwRate?: LegalRate | null
  defaultCategory?: BankCategory | null
  /** [LEVERANCIER-LAND] undefined = not on the form; null = cleared (read as the Netherlands). */
  country?: string | null
}

/** Why a form was refused. Each code has exactly one sentence in the catalogue. */
export type SupplierPinRefusal =
  | 'name_empty' | 'name_unreliable' | 'name_no_key' | 'iban_checksum' | 'kvk_shape' | 'btw_shape'
  | 'rate_unknown' | 'category_unknown' | 'country_shape'

export type SupplierPinPlan =
  | { ok: true; values: SupplierPinValues }
  /** It names the FIELD — a form that says "ongeldig" says nothing — and the reason as a code. */
  | { ok: false; field: 'name' | 'iban' | 'kvk' | 'btw' | 'rate' | 'category' | 'country'; code: SupplierPinRefusal }

/**
 * The sentence behind each refusal, as a catalogue key. Literal keys, not assembled from the code:
 * the [TAAL] gate looks for each declared key as a literal string to prove it is rendered.
 */
export const SUPPLIER_PIN_REFUSAL_KEY: Record<SupplierPinRefusal, MessageKey> = {
  name_empty: 'lev.fout.naamLeeg',
  name_unreliable: 'lev.fout.naamOnbetrouwbaar',
  name_no_key: 'lev.fout.naamSleutel',
  iban_checksum: 'lev.fout.iban',
  kvk_shape: 'lev.fout.kvk',
  btw_shape: 'lev.fout.btw',
  rate_unknown: 'lev.fout.tarief',
  category_unknown: 'lev.fout.categorie',
  country_shape: 'lev.fout.land',
}

/** A default rate as typed: '', null → cleared; '9', 9 → 9; anything else → not a rate. */
function readDefaultRate(raw: string | number | null | undefined): LegalRate | null | 'bad' {
  if (raw === null || raw === undefined) return null
  const text = String(raw).trim()
  if (text === '') return null
  if (!/^\d{1,2}$/.test(text)) return 'bad'
  const n = Number(text)
  return (LEGAL_DEFAULT_RATES as readonly number[]).includes(n) ? (n as LegalRate) : 'bad'
}

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
    return { ok: false, field: 'name', code: 'name_empty' }
  }
  // The same bar the registry uses to refuse manufacturing a junk supplier island. A placeholder
  // ("onbekend", "factuur") as a supplier name would collect every unidentified invoice in the book.
  if (!isReliableSupplierName(name)) {
    return { ok: false, field: 'name', code: 'name_unreliable' }
  }
  const nameKey = supplierNameKey(name)
  if (!nameKey) {
    return { ok: false, field: 'name', code: 'name_no_key' }
  }

  const ibanRaw = String(input.iban ?? '').trim()
  const ibanState = checkVendorIban(ibanRaw)
  if (ibanState === 'bad') {
    return { ok: false, field: 'iban', code: 'iban_checksum' }
  }
  const iban = ibanState === 'ok' ? ibanRaw.replace(/\s+/g, '').toUpperCase() : null

  const kvk = normalizeKvk(input.kvk)
  if (kvk && kvk.length !== 8) {
    return { ok: false, field: 'kvk', code: 'kvk_shape' }
  }

  const btwRaw = String(input.btw ?? '').trim()
  const btwState = checkVendorBtw(btwRaw)
  if (btwState === 'bad') {
    return { ok: false, field: 'btw', code: 'btw_shape' }
  }
  const btw = btwState === 'ok' ? btwRaw.replace(/[\s.-]/g, '').toUpperCase() : null

  const values: SupplierPinValues = { name, iban, kvk: kvk || null, btw, nameKey }

  // [LEVERANCIER-STANDAARD] Only when the form carries them. `'defaultBtwRate' in input` is the
  // test, not truthiness: null is an answer (clear it) and undefined is silence.
  if ('defaultBtwRate' in input) {
    const rate = readDefaultRate(input.defaultBtwRate)
    if (rate === 'bad') return { ok: false, field: 'rate', code: 'rate_unknown' }
    values.defaultBtwRate = rate
  }
  if ('defaultCategory' in input) {
    const cat = String(input.defaultCategory ?? '').trim()
    if (cat === '') values.defaultCategory = null
    else if (ALLOWED_CATEGORIES.has(cat as BankCategory)) values.defaultCategory = cat as BankCategory
    else return { ok: false, field: 'category', code: 'category_unknown' }
  }
  // [LEVERANCIER-LAND] Same discipline: only when the form carries it, cleared by '' — and a typed
  // country that is not a two-letter code is refused, never stored as NULL (which reads as NL).
  if ('country' in input) {
    const raw = String(input.country ?? '').trim()
    if (raw === '') values.country = null
    else {
      const code = normalizeCountry(raw)
      if (!code) return { ok: false, field: 'country', code: 'country_shape' }
      values.country = code
    }
  }

  return { ok: true, values }
}

/**
 * What changed between what stands and what the owner wants — so the route writes only that, and
 * the sentence afterwards can say what actually moved.
 *
 * A field that did not change is not "confirmed": it is untouched. The distinction matters to the
 * audit trail, which an accountant reads a year later to reconstruct who said what.
 */
export interface SupplierWritable {
  name: string
  name_key: string
  iban: string | null
  kvk_number: string | null
  btw_number: string | null
  default_btw_rate: number | null
  default_category: string | null
  country: string | null
}

export function supplierPinChanges(
  current: {
    name?: string | null; iban?: string | null; kvk_number?: string | null; btw_number?: string | null
    default_btw_rate?: number | null; default_category?: string | null; country?: string | null
  },
  next: SupplierPinValues,
): Partial<SupplierWritable> {
  const out: Partial<SupplierWritable> = {}
  if ((current.name ?? '') !== next.name) {
    out.name = next.name
    out.name_key = next.nameKey
  }
  if ((current.iban ?? null) !== next.iban) out.iban = next.iban
  if ((current.kvk_number ?? null) !== next.kvk) out.kvk_number = next.kvk
  if ((current.btw_number ?? null) !== next.btw) out.btw_number = next.btw
  // A default not on the form (undefined) is untouched; one on the form is compared like the rest.
  if (next.defaultBtwRate !== undefined && (current.default_btw_rate ?? null) !== next.defaultBtwRate) {
    out.default_btw_rate = next.defaultBtwRate
  }
  if (next.defaultCategory !== undefined && (current.default_category ?? null) !== next.defaultCategory) {
    out.default_category = next.defaultCategory
  }
  if (next.country !== undefined && (current.country ?? null) !== next.country) {
    out.country = next.country
  }
  return out
}
