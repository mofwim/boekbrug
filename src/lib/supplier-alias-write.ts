// src/lib/supplier-alias-write.ts
// [SUPPLIER-ALIAS] The I/O half: turn one name correction into something the app still knows next
// month. The decision itself is pure (supplier-alias.ts); this is the reads and the two writes.
//
// Called from BOTH correction doors — the verify queue's confirm route and the pay screen's
// correction sheet — because they are the same act performed in two places, and a lesson learned at
// one door and not the other is a feature the owner cannot rely on.
//
// ── NEVER FATAL ──
// The correction has already been saved when this runs. Learning from it is the bonus, so every
// failure here degrades to "we did not remember this one" and never to a refused correction. That
// is also why it returns what it did rather than throwing: the caller tells the owner, and "we
// remembered" must not be said when nothing was written.

import type { SupabaseClient } from '@supabase/supabase-js'
import { columnExists } from '@/lib/column-probe'
// [TYPES] Sinds supplier_aliases.sql is toegepast staat de tabel in de gegenereerde types, dus
// mag deze client strak: de compiler kijkt nu elke kolomnaam hier na in plaats van de database bij
// de eerste echte schrijfactie.
import type { Database } from '@/types/database.types'

import { supplierNameKey, isReliableSupplierName, normalizeIban, normalizeKvk } from '@/lib/supplier-registry'
import { planSupplierAlias, aliasWouldHijack, aliasLearnedText } from '@/lib/supplier-alias'

 
type Client = SupabaseClient<Database>

export interface AliasLearnResult {
  /** True when a spelling→supplier link was stored. */
  learned: boolean
  /** True when the supplier record itself now carries the owner's name. */
  renamed: boolean
  /** The sentence to show, or null when there is nothing to say. Dutch — owner-facing. */
  message: string | null
}

const NOTHING: AliasLearnResult = { learned: false, renamed: false, message: null }

/**
 * [DEPLOY-SAFE] Does this database have the alias table yet?
 *
 * Code ships before migrations are applied, and in that window the correct behaviour is exactly
 * today's: the correction saves, nothing is learned, nothing errors. Cached after the first
 * success — a table does not disappear.
 */
export async function supplierAliasSupported(supabase: Client): Promise<boolean> {
  // [KAS-PROBE] One definition, in column-probe.ts. A NO here stops aliases being written, so the
  // same supplier keeps splitting into two rows — which is the thing this table exists to prevent.
  return columnExists(supabase, 'supplier_aliases', 'id', 'supplier aliases would stop being written')
}

/**
 * Learn from one corrected supplier name.
 *
 * The order is deliberate and each step can stop the whole thing:
 *   1. the pure plan — is there anything here worth remembering at all?
 *   2. WHICH supplier — by the invoice's own link, then by a strong key, then by the corrected
 *      name. A supplier is created only when the owner has given a reliable name, which is the same
 *      bar resolveSupplierForImport uses;
 *   3. the hijack check — an alias whose key already belongs to a DIFFERENT supplier is refused.
 *      This is the one way this feature could lose data rather than find it;
 *   4. the two writes: the alias always, the rename only when the invoice identified the company by
 *      something stronger than a name.
 */
export async function learnSupplierAlias(
  supabase: Client,
  userId: string,
  input: {
    printedName: string | null | undefined
    correctedName: string | null | undefined
    supplierId?: string | null
    vendorIban?: string | null
    kvk?: string | null
  },
): Promise<AliasLearnResult> {
  try {
    if (!(await supplierAliasSupported(supabase))) return NOTHING

    const plan = planSupplierAlias(input)
    if (!plan.learn) return NOTHING

    const iban = normalizeIban(input.vendorIban)
    const kvk = normalizeKvk(input.kvk)

    // ── Which supplier does this correction speak about? ──
    // Every read here captures its error. [NO-SILENT-EMPTY]: "this supplier does not exist" and
    // "we could not look" arrive as the same null otherwise, and acting on the first would create a
    // duplicate supplier row for a company the owner already has.
    let supplierId: string | null = input.supplierId ?? null
    const findBy = async (column: string, value: string): Promise<string | null> => {
      const { data, error } = await supabase
        .from('suppliers').select('id').eq('user_id', userId).eq(column, value).limit(1).maybeSingle()
      if (error) throw new Error(error.message)
      return (data as { id: string } | null)?.id ?? null
    }
    if (!supplierId && iban) supplierId = await findBy('iban', iban)
    if (!supplierId && kvk) supplierId = await findBy('kvk_number', kvk)
    if (!supplierId) supplierId = await findBy('name_key', plan.canonicalKey)
    // The misread spelling may already BE a supplier row — the island this correction is here to
    // stop growing. Adopting it (rather than making a second one) is what merges the history.
    if (!supplierId) supplierId = await findBy('name_key', plan.aliasKey)

    if (!supplierId) {
      // Create, on the same bar the registry uses: a reliable name only. planSupplierAlias already
      // refused an unreliable one, so reaching here means we have something to key on.
      if (!isReliableSupplierName(plan.canonicalName)) return NOTHING
      const { data: made, error: makeErr } = await supabase
        .from('suppliers')
        .insert({
          user_id: userId, name: plan.canonicalName, name_key: plan.canonicalKey,
          iban: iban ?? null, kvk_number: kvk ?? null,
        })
        .select('id').maybeSingle()
      if (makeErr || !made) return NOTHING
      supplierId = (made as { id: string }).id
    }

    // ── Would this alias steal a name that already belongs to someone else? ──
    const { data: all, error: allErr } = await supabase
      .from('suppliers').select('id, name_key').eq('user_id', userId)
    if (allErr) throw new Error(allErr.message)
    const suppliers = (all ?? []) as { id: string; name_key: string | null }[]
    if (aliasWouldHijack(plan.aliasKey, suppliers, supplierId)) {
      // Refused on purpose and reported as "not learned". The owner corrected one invoice; they did
      // not ask for every future invoice spelled that way to be re-pointed at another company.
      console.warn('[SUPPLIER-ALIAS] refused — that spelling is already another supplier', {
        userId, aliasKey: plan.aliasKey, supplierId,
      })
      return NOTHING
    }

    // ── Write 1: the alias. This is the one that survives to next month. ──
    const { error: aliasErr } = await supabase
      .from('supplier_aliases')
      .upsert(
        { user_id: userId, alias_key: plan.aliasKey, supplier_id: supplierId, printed_name: (input.printedName ?? '').trim() || null },
        { onConflict: 'user_id,alias_key' },
      )
    if (aliasErr) throw new Error(aliasErr.message)

    // ── Write 2: the rename, only where the invoice said WHICH company this is. ──
    let renamed = false
    if (plan.mayRename) {
      const { error: renameErr } = await supabase
        .from('suppliers')
        .update({ name: plan.canonicalName, name_key: plan.canonicalKey, updated_at: new Date().toISOString() })
        .eq('id', supplierId).eq('user_id', userId)
      // A failed rename is not a failed lesson: the alias above already carries the recognition,
      // which is the half that stops the owner retyping this. Logged, not raised.
      if (renameErr) console.error('[SUPPLIER-ALIAS] alias stored but rename failed', { userId, supplierId, error: renameErr.message })
      else renamed = true
    }

    return {
      learned: true,
      renamed,
      message: aliasLearnedText(plan, (input.printedName ?? '').trim()),
    }
  } catch (e) {
    // The correction itself is already saved. Losing the lesson costs one more retype next month;
    // failing the request would cost the correction.
    console.error('[SUPPLIER-ALIAS] could not learn from this correction', {
      userId, error: e instanceof Error ? e.message : String(e),
    })
    return NOTHING
  }
}

/**
 * The spelling→supplier links this owner has taught the app.
 *
 * Read by resolveSupplierForImport BEFORE it creates a supplier, so a misread the owner has already
 * corrected once resolves to the right company instead of founding a new island every month.
 *
 * Returns an empty map when the table is not there yet, and THROWS on a real read failure — the two
 * are different answers, and only the first means "this owner has taught us nothing".
 */
export async function loadSupplierAliases(supabase: Client, userId: string): Promise<Map<string, string>> {
  const { data, error } = await supabase
    .from('supplier_aliases').select('alias_key, supplier_id').eq('user_id', userId)
  if (error) {
    // 42P01 undefined_table — the migration has not been applied. Not a failure to read.
    if ((error as { code?: string }).code === '42P01') return new Map()
    throw new Error(error.message)
  }
  return new Map(((data ?? []) as { alias_key: string; supplier_id: string }[]).map((r) => [r.alias_key, r.supplier_id]))
}

/**
 * Has the owner already told us what this printed name means?
 *
 * Best-effort by contract, and that is the right direction here: this runs inside
 * resolveSupplierForImport, whose own contract is that resolution NEVER throws to the import. A
 * failed alias read costs the same as no alias — the import falls through to its normal keys.
 */
export async function supplierIdForPrintedName(
  supabase: Client,
  userId: string,
  printedName: string | null | undefined,
): Promise<string | null> {
  const key = supplierNameKey(printedName)
  if (!key) return null
  // [LES-TELT-MEE] A placeholder may never resolve, however it got into the table. planSupplierAlias
  // now refuses to store such a key, but a row written before that guard existed would send every
  // invoice whose sender the reader could not read to one company — and both callers of this
  // function decide identity with the answer. One guard here, rather than one at each caller that
  // remembers to.
  if (!isReliableSupplierName(printedName ?? '')) return null
  try {
    const { data, error } = await supabase
      .from('supplier_aliases').select('supplier_id')
      .eq('user_id', userId).eq('alias_key', key).limit(1).maybeSingle()
    if (error) return null
    return (data as { supplier_id: string } | null)?.supplier_id ?? null
  } catch {
    return null
  }
}
