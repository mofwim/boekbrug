// src/lib/supplier-edit.ts
// [LEVERANCIER-BEWERKEN] The decisions behind editing a supplier from /dashboard/leveranciers. Pure.
// Run: npx tsx --test src/lib/supplier-edit.test.ts
//
// ── WHAT AN EDIT IS, AND IS NOT ──
//
// The suppliers row is the MASTER record: what the registry resolves next month's invoice on, what
// the IBAN-change gate compares against, what the incasso mandate hangs off. Editing it changes the
// future. It does not change the past: an invoice already in the books keeps what was printed on
// it (its own vendor_iban, its own btw number), because that document is what the Belastingdienst
// reads and art. 52 AWR wants it kept as it was. The only thing that travels back is the DISPLAY
// name on the linked invoices — the same rule the pin route already follows, because client_name
// is the key half the screens group on and a rename that leaves it behind splits a company in two.
//
// ── WHY THE IBAN IS SPECIAL ──
//
// "Supplier's new bank account" is the most common invoice fraud there is: a genuine-looking mail,
// one changed line. Vendor-master practice is therefore: treat a changed account number as a
// fraud trigger, keep the old number, and confirm through a channel you already had — never the
// phone number in the message that asks for the change. This module decides when that applies and
// what to keep; the screen says it in the owner's language.
//
// ── DUPLICATES ARE A MERGE, NOT AN ERROR ──
//
// suppliers has one row per (user, IBAN) and per (user, KVK). Typing a number that another
// supplier already carries is nearly always the same company twice — and the app has a merge door
// for exactly that. So the unique violation is turned into "that number belongs to X; merge them"
// rather than a bare refusal.

import { planSupplierPin, supplierPinChanges, type SupplierPinInput, type SupplierPinValues } from './supplier-pin'

/** What the supplier row carries now, as the route reads it. */
export interface SupplierCurrent {
  name: string
  iban: string | null
  kvk_number: string | null
  btw_number: string | null
  /** [LEVERANCIER-STANDAARD] Absent on a row read before the columns existed; read as null. */
  default_btw_rate?: number | null
  default_category?: string | null
  /** [LEVERANCIER-LAND] Read apart by the route; absent on a row read before the column existed. */
  country?: string | null
}

export type SupplierChanges = ReturnType<typeof supplierPinChanges>

/** An account number that moved: what stood, and what stands now. Null = the IBAN did not change. */
export interface IbanMove {
  from: string | null
  to: string | null
}

/**
 * The account-number change in this edit, if any.
 *
 * A move FROM a real number is what the history table records and what the screen warns about. A
 * move from nothing (the supplier had no IBAN yet) is an addition, not a replacement — no warning,
 * nothing to keep — so `from` is null there and callers can tell the two apart.
 */
export function ibanMove(current: Pick<SupplierCurrent, 'iban'>, changes: SupplierChanges): IbanMove | null {
  if (!('iban' in changes)) return null
  return { from: (current.iban ?? '').trim() || null, to: changes.iban ?? null }
}

/** Which unique key a Postgres 23505 hit, from the index name the error carries. */
export function duplicateField(error: { code?: string | null; message?: string | null } | null | undefined): 'iban' | 'kvk' | null {
  if (!error || error.code !== '23505') return null
  const msg = error.message ?? ''
  if (/suppliers_user_iban_uidx/.test(msg)) return 'iban'
  if (/suppliers_user_kvk_uidx/.test(msg)) return 'kvk'
  return null
}

/** The trail an accountant reads a year later: only the fields that moved, old beside new. */
export function supplierEditTrail(current: SupplierCurrent, changes: SupplierChanges): {
  old: Record<string, string | number | null>
  new: Record<string, string | number | null>
} {
  const old: Record<string, string | number | null> = {}
  const next: Record<string, string | number | null> = {}
  if ('name' in changes) { old.name = current.name; next.name = changes.name ?? null }
  if ('iban' in changes) { old.iban = current.iban; next.iban = changes.iban ?? null }
  if ('kvk_number' in changes) { old.kvk_number = current.kvk_number; next.kvk_number = changes.kvk_number ?? null }
  if ('btw_number' in changes) { old.btw_number = current.btw_number; next.btw_number = changes.btw_number ?? null }
  if ('default_btw_rate' in changes) { old.default_btw_rate = current.default_btw_rate ?? null; next.default_btw_rate = changes.default_btw_rate ?? null }
  if ('default_category' in changes) { old.default_category = current.default_category ?? null; next.default_category = changes.default_category ?? null }
  if ('country' in changes) { old.country = current.country ?? null; next.country = changes.country ?? null }
  return { old, new: next }
}

export type SupplierEditPlan =
  | { ok: true; values: SupplierPinValues; changes: SupplierChanges; iban: IbanMove | null }
  | { ok: false; field: 'name' | 'iban' | 'kvk' | 'btw' | 'rate' | 'category' | 'country'; code: import('./supplier-pin').SupplierPinRefusal }

/**
 * Read the edit form against the row as it stands: the same validation the pin route runs, then
 * only what moved, then whether the account number is among it.
 */
export function planSupplierEdit(current: SupplierCurrent, input: SupplierPinInput): SupplierEditPlan {
  const plan = planSupplierPin(input)
  if (!plan.ok) return plan
  const changes = supplierPinChanges(current, plan.values)
  return { ok: true, values: plan.values, changes, iban: ibanMove(current, changes) }
}
