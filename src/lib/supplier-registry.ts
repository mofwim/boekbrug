// src/lib/supplier-registry.ts
// [SUPPLIER-REGISTRY] Resolve an incoming invoice's vendor to a CANONICAL supplier record, so
// the same company stops appearing under many spellings ("Silifke / Hocaoglu", "Hocaoglu",
// "M.H. BAL GROOTHANDEL VOF" …). The invoice then stores supplier_id + the supplier's canonical
// name, instead of a fresh free-text snapshot each time.
//
// Identity, most reliable first:
//   1. IBAN  — the account you pay; unique per supplier, stable across name spellings.
//   2. normalized name key (supplierNameKey) — the fallback when no IBAN is printed.
//
// SAFETY CONTRACT: resolution is best-effort and NEVER throws to the caller. A DB hiccup or a
// junk vendor returns null → the invoice still imports with its raw client_name and a null
// supplier_id (exactly the pre-registry behaviour). We create a supplier ONLY when we have a
// reliable key (an IBAN, or a reliable name) — never a "Onbekende leverancier" island.

import { normalizeVendor, isReliableVendor } from '@/lib/safecore'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database.types'

// Legal-suffix noise stripped from the match key — mirrors vendorCoreKey in email-integration.
// Universally-safe suffixes only, never real name words.
const VENDOR_SUFFIX_NOISE = new Set([
  'bv', 'nv', 'vof', 'cv', 'ltd', 'gmbh', 'bvba', 'holding', 'maatschap', 'inc', 'llc',
])

/** Normalized match key: lowercased, legal suffixes + punctuation stripped, collapsed. Pure.
 *  Empty string when there's nothing usable (→ not a reliable key). */
export function supplierNameKey(name: string | null | undefined): string {
  const tokens = normalizeVendor(name)
    .replace(/\./g, '')            // collapse dotted acronyms: "b.v." → "bv"
    .replace(/[^a-z0-9\s]/g, ' ')  // other punctuation → separator
    .split(/\s+/)
    .filter((t) => t.length > 0 && !VENDOR_SUFFIX_NOISE.has(t))
  return tokens.join(' ')
}

/** Canonicalize an IBAN for storage/matching: strip whitespace, uppercase. Returns null when it
 *  is obviously not an IBAN (a real one is ≥15 chars, alphanumeric). We do NOT mod-97 validate
 *  here — that is a payment-time concern; we only avoid keying a supplier on junk. Pure. */
export function normalizeIban(iban: string | null | undefined): string | null {
  if (!iban) return null
  const s = String(iban).replace(/\s+/g, '').toUpperCase()
  return s.length >= 15 && /^[A-Z0-9]+$/.test(s) ? s : null
}

/** A name is usable as a match/creation key only when it is reliable (not a placeholder/junk)
 *  and its normalized core is specific enough (≥3 chars) to not merge unrelated vendors. Pure. */
export function isReliableSupplierName(name: string | null | undefined): boolean {
  return isReliableVendor(name) && supplierNameKey(name).length >= 3
}

export interface SupplierResolution {
  id: string
  name: string
}

type DB = SupabaseClient<Database>

/**
 * [SUPPLIER-REGISTRY] Find-or-create the canonical supplier for an incoming invoice.
 *
 * @returns the resolved supplier (id + canonical name to store on the invoice), or null when we
 *          could not (or should not) resolve one — the caller then keeps the raw client_name.
 *
 * Never throws: any error is swallowed and returns null (best-effort enrichment, never a blocker).
 */
export async function resolveSupplierForImport(
  supabase: DB,
  userId: string,
  vendor: {
    name: string | null | undefined
    iban?: string | null
    kvk?: string | null
    btw?: string | null
  },
): Promise<SupplierResolution | null> {
  try {
    const cleanName = (vendor.name ?? '').trim()
    const iban = normalizeIban(vendor.iban)
    const key = supplierNameKey(cleanName)
    const reliableName = isReliableSupplierName(cleanName)

    // Nothing to key on → don't manufacture a junk supplier island.
    if (!iban && !reliableName) return null

    // ── 1. IBAN tier (strongest): one supplier per (user, IBAN) ──────────────────
    if (iban) {
      const { data: byIban } = await supabase
        .from('suppliers')
        .select('id, name, name_key')
        .eq('user_id', userId)
        .eq('iban', iban)
        .limit(1)
        .maybeSingle()

      if (byIban) {
        // Opportunistically backfill a missing name_key (non-fatal) so later name-only
        // invoices from this supplier also resolve here. Never rename the canonical name.
        if (!byIban.name_key && key) {
          await supabase.from('suppliers').update({ name_key: key }).eq('id', byIban.id)
        }
        return { id: byIban.id, name: byIban.name }
      }

      // Before creating an IBAN-keyed supplier, adopt an existing NAME-only record for the same
      // company (so we don't split one supplier into a name row + an IBAN row): attach the IBAN.
      if (reliableName) {
        const { data: byName } = await supabase
          .from('suppliers')
          .select('id, name')
          .eq('user_id', userId)
          .eq('name_key', key)
          .is('iban', null)
          .limit(1)
          .maybeSingle()
        if (byName) {
          await supabase.from('suppliers').update({ iban }).eq('id', byName.id)
          return { id: byName.id, name: byName.name }
        }
      }

      // Create, keyed by IBAN. upsert on the (user_id, iban) unique index → race-safe under
      // concurrent sync (a parallel insert of the same IBAN resolves to the same row).
      const { data: created, error: createErr } = await supabase
        .from('suppliers')
        .upsert(
          {
            user_id: userId,
            name: cleanName || 'Onbekende leverancier',
            name_key: key || null,
            iban,
            kvk_number: vendor.kvk ?? null,
            btw_number: vendor.btw ?? null,
          },
          { onConflict: 'user_id,iban' },
        )
        .select('id, name')
        .single()
      if (!createErr && created) return { id: created.id, name: created.name }

      // upsert lost a race / errored → re-read the winner.
      const { data: retry } = await supabase
        .from('suppliers')
        .select('id, name')
        .eq('user_id', userId)
        .eq('iban', iban)
        .limit(1)
        .maybeSingle()
      return retry ? { id: retry.id, name: retry.name } : null
    }

    // ── 2. Name tier (no IBAN on this invoice): match by normalized name key ──────
    const { data: byName } = await supabase
      .from('suppliers')
      .select('id, name')
      .eq('user_id', userId)
      .eq('name_key', key)
      .order('created_at', { ascending: true }) // oldest = the canonical original
      .limit(1)
      .maybeSingle()
    if (byName) return { id: byName.id, name: byName.name }

    const { data: created } = await supabase
      .from('suppliers')
      .insert({
        user_id: userId,
        name: cleanName,
        name_key: key,
        iban: null,
        kvk_number: vendor.kvk ?? null,
        btw_number: vendor.btw ?? null,
      })
      .select('id, name')
      .single()
    return created ? { id: created.id, name: created.name } : null
  } catch (e) {
    console.error('[SUPPLIER-REGISTRY] resolve failed (non-fatal)', e)
    return null
  }
}
