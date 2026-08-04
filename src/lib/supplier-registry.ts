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
// [SUPPLIER-ALIAS] What the owner has already taught us a printed name means — see
// src/lib/supplier-alias.ts. Best-effort by the same contract as this whole function.
import { supplierIdForPrintedName } from '@/lib/supplier-alias-write'
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

/** Canonical KVK key: digits only, exactly 8 (a real Dutch Chamber-of-Commerce number). The KVK
 *  is a legal-entity id — the strong key that tells two same-named companies apart. Junk → null. */
export function normalizeKvk(kvk: string | null | undefined): string | null {
  if (!kvk) return null
  const d = String(kvk).replace(/\D/g, '')
  return d.length === 8 ? d : null
}

export interface SupplierResolution {
  id: string
  name: string
}

type DB = SupabaseClient<Database>
type SupplierUpdate = Database['public']['Tables']['suppliers']['Update']

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
    const kvk = normalizeKvk(vendor.kvk)
    const btw = (vendor.btw ?? '').trim() || null
    const key = supplierNameKey(cleanName)
    const reliableName = isReliableSupplierName(cleanName)

    // Nothing to key on → don't manufacture a junk supplier island. KVK is now a valid key too.
    if (!iban && !kvk && !reliableName) return null

    // ── 0. [SUPPLIER-ALIAS] Has the owner already told us what this spelling means? ──
    //
    // Ahead of every other tier, because it is the only one that knows something the paper does
    // not: the owner corrected this exact misread before. Without it the reader repeats its
    // mistake every month, resolution finds no match on the wrong name, and a SECOND supplier row
    // appears for a company the owner already named — which is how one shop ends up as three
    // islands with the history split between them.
    //
    // Only when there is no IBAN. An IBAN is a stronger statement about identity than a name the
    // owner mapped, and letting an alias outrank it would let a stale lesson redirect a payment.
    if (!iban) {
      const aliased = await supplierIdForPrintedName(supabase, userId, cleanName)
      if (aliased) {
        const { data: byAlias } = await supabase
          .from('suppliers').select('id, name').eq('id', aliased).eq('user_id', userId).maybeSingle()
        if (byAlias) return { id: byAlias.id, name: byAlias.name }
      }
    }

    // ── 1. IBAN tier (strongest): one supplier per (user, IBAN) ──────────────────
    if (iban) {
      const { data: byIban } = await supabase
        .from('suppliers')
        .select('id, name, name_key, kvk_number, btw_number')
        .eq('user_id', userId)
        .eq('iban', iban)
        .limit(1)
        .maybeSingle()

      if (byIban) {
        // Opportunistically backfill a missing name_key / KVK / BTW (non-fatal) so later invoices
        // from this supplier also resolve here and the identity gets richer. Never rename the name.
        const patch: SupplierUpdate = {}
        if (!byIban.name_key && key) patch.name_key = key
        if (!byIban.kvk_number && kvk) patch.kvk_number = kvk
        if (!byIban.btw_number && btw) patch.btw_number = btw
        if (Object.keys(patch).length) {
          await supabase.from('suppliers').update(patch).eq('id', byIban.id)
        }
        return { id: byIban.id, name: byIban.name }
      }

      // Before creating an IBAN-keyed supplier, adopt an existing row that already identifies this
      // same company by a strong key and attach the IBAN — so we never split one company across an
      // IBAN row and a KVK/name row. Strongest first:
      //   (a) KVK match: a KVK-keyed row that has no IBAN yet (this vendor's earlier KVK-only
      //   invoice). Without this, an IBAN+KVK invoice would insert, hit the (user,kvk) index → 23505,
      //   then re-read by IBAN only (the KVK row's iban is NULL) → miss → return null forever.
      if (kvk) {
        const { data: byKvk } = await supabase
          .from('suppliers')
          .select('id, name')
          .eq('user_id', userId)
          .eq('kvk_number', kvk)
          .is('iban', null)
          .limit(1)
          .maybeSingle()
        if (byKvk) {
          await supabase.from('suppliers').update({ iban }).eq('id', byKvk.id)
          return { id: byKvk.id, name: byKvk.name }
        }
      }
      //   (b) NAME match: a name-only record for the same company (no IBAN yet): attach the IBAN.
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

      // Create, keyed by IBAN. Plain INSERT — NOT an upsert with onConflict: the (user_id, iban)
      // unique index is PARTIAL (`WHERE iban IS NOT NULL`), and PostgREST's onConflict cannot
      // carry that predicate, so an ON CONFLICT arbiter would fail to resolve and the create would
      // silently no-op. A plain insert still enforces the partial index; on the rare concurrent-
      // sync race we catch the unique violation (23505) and re-read the row the winner created.
      const { data: created, error: createErr } = await supabase
        .from('suppliers')
        .insert({
          user_id: userId,
          name: cleanName || 'Onbekende leverancier',
          name_key: key || null,
          iban,
          kvk_number: kvk,
          btw_number: btw,
        })
        .select('id, name')
        .single()
      if (!createErr && created) return { id: created.id, name: created.name }

      // The insert failed. Two causes, both reconciled by re-reading the winner:
      //   • lost an (user, iban) race → re-read by iban finds it;
      //   • the (user, kvk) index rejected because a KVK-keyed row already exists (its iban may be
      //     NULL, so an iban re-read alone would miss it) → fall back to a kvk re-read, and attach
      //     our IBAN to that row so future IBAN-only invoices from this vendor resolve here too.
      const { data: retryByIban } = await supabase
        .from('suppliers')
        .select('id, name, iban')
        .eq('user_id', userId)
        .eq('iban', iban)
        .limit(1)
        .maybeSingle()
      if (retryByIban) return { id: retryByIban.id, name: retryByIban.name }

      if (kvk) {
        const { data: retryByKvk } = await supabase
          .from('suppliers')
          .select('id, name, iban')
          .eq('user_id', userId)
          .eq('kvk_number', kvk)
          .limit(1)
          .maybeSingle()
        if (retryByKvk) {
          if (!retryByKvk.iban) {
            await supabase.from('suppliers').update({ iban }).eq('id', retryByKvk.id)
          }
          return { id: retryByKvk.id, name: retryByKvk.name }
        }
      }
      return null
    }

    // ── 2. KVK tier (no IBAN, but a legal KVK): the strong identity that keeps two same-named
    // companies apart and unites one company's differently-spelled invoices. ────────────────────
    if (kvk) {
      const { data: byKvk } = await supabase
        .from('suppliers')
        .select('id, name, name_key, btw_number')
        .eq('user_id', userId)
        .eq('kvk_number', kvk)
        .limit(1)
        .maybeSingle()
      if (byKvk) {
        const patch: SupplierUpdate = {}
        if (!byKvk.name_key && key) patch.name_key = key
        if (!byKvk.btw_number && btw) patch.btw_number = btw
        if (Object.keys(patch).length) {
          await supabase.from('suppliers').update(patch).eq('id', byKvk.id)
        }
        return { id: byKvk.id, name: byKvk.name }
      }

      // Before creating, adopt an existing same-company row that has no KVK yet (an IBAN-keyed or
      // name-only row from an earlier invoice that didn't print a KVK) and tag it with this KVK —
      // so a KVK-only invoice doesn't spawn a DUPLICATE of a supplier we already hold under the
      // same name. Mirrors the IBAN tier's name-adoption and its same-name-collision risk posture.
      if (reliableName) {
        const { data: byName } = await supabase
          .from('suppliers')
          .select('id, name')
          .eq('user_id', userId)
          .eq('name_key', key)
          .is('kvk_number', null)
          .order('created_at', { ascending: true })
          .limit(1)
          .maybeSingle()
        if (byName) {
          await supabase.from('suppliers').update({ kvk_number: kvk }).eq('id', byName.id)
          return { id: byName.id, name: byName.name }
        }
      }

      // Create, keyed by KVK. Plain insert; on the (user_id, kvk_number) unique-index race — or
      // when an IBAN-keyed row was already backfilled with this KVK — the 23505 re-read returns the
      // winner, reconciling the two identities instead of splitting the supplier.
      const { data: created, error: createErr } = await supabase
        .from('suppliers')
        .insert({
          user_id: userId,
          name: cleanName || 'Onbekende leverancier',
          name_key: key || null,
          iban: null,
          kvk_number: kvk,
          btw_number: btw,
        })
        .select('id, name')
        .single()
      if (!createErr && created) return { id: created.id, name: created.name }

      const { data: retry } = await supabase
        .from('suppliers')
        .select('id, name')
        .eq('user_id', userId)
        .eq('kvk_number', kvk)
        .limit(1)
        .maybeSingle()
      return retry ? { id: retry.id, name: retry.name } : null
    }

    // ── 3. Name tier (no IBAN, no KVK): match by normalized name key ──────────────
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
        kvk_number: kvk,
        btw_number: btw,
      })
      .select('id, name')
      .single()
    return created ? { id: created.id, name: created.name } : null
  } catch (e) {
    console.error('[SUPPLIER-REGISTRY] resolve failed (non-fatal)', e)
    return null
  }
}
