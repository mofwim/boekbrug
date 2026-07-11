// src/lib/invoice-numbering.ts
// [BOEK-031] Shared invoice number generator — May 2026
// [FACTUUR-B] Atomic + customizable numbering — June 2026
// =====================================================
// Format (default):  "20260001" / "CR-20260001" / "PF-20260001"
// Custom (factuur):   driven by profiles.invoice_number_template, e.g.
//                     "045-2026", "2026-045", "045/2026", "INV-045-2026",
//                     "2764283" (continuous). creditnota / pro_forma always
//                     keep their system format — customization is factuur-only.
//
// Per Dutch Belastingdienst (Article 35 — Wet OB 1968):
// numbers must be sequential without gaps, and forward-only (no rollback
// once issued).
//
// [FACTUUR-B] The SELECT-then-compute race is gone. The raw sequence is now
// allocated atomically by the SECURITY DEFINER rpc next_invoice_seq() (single
// source of truth, single read+increment statement, row-locked on conflict).
// This lib only FORMATS that integer, via formatInvoiceNumber() from
// invoice-template.ts (the single source of truth for {seq}/{year} rendering,
// shared with the onboarding/Settings extraction). The contract is unchanged
// -- same signature, same return shape -- so the two call sites
// (api/invoice/send/route.ts, api/invoice/creditnota/route.ts) are untouched.
//
// When profiles.invoice_number_template is NULL (no onboarding template
// written yet), the system default {year}{seq} padding 4 applies (e.g.
// 20260001) — the unified product-wide format. Customization activates
// per-user the moment a template is stored.
// =====================================================

import type { SupabaseClient } from '@supabase/supabase-js'
import { formatInvoiceNumber } from './invoice-template'

export type InvoiceNumberType = 'factuur' | 'creditnota' | 'pro_forma'

/**
 * Resolves the effective template + padding for a (user, type).
 *  - creditnota / pro_forma : always the system format (CR-/PF-){year}{seq}.
 *  - factuur                : the user's custom template if configured,
 *                             otherwise the default {year}{seq}.
 */
async function resolveFormat(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any>,
  userId: string,
  type: InvoiceNumberType
): Promise<{ template: string; padding: number }> {
  const prefix = type === 'creditnota' ? 'CR-' : type === 'pro_forma' ? 'PF-' : ''
  // System default for every type (the factuur prefix is empty).
  // [FACTUUR-UNIFY] YEAR+sequence, padding 4 — one format across the whole
  // product (matches the free /factuur-maken generator, e.g. 20260001).
  let template = `${prefix}{year}{seq}`
  let padding = 4

  // Customization applies to factuur only (decision: factuur-only).
  if (type === 'factuur') {
    const { data: prof } = await supabase
      .from('profiles')
      .select('invoice_number_template, invoice_number_padding')
      .eq('id', userId)
      .single()

    const custom = prof?.invoice_number_template
    if (typeof custom === 'string' && custom.trim() !== '') {
      template = custom
      const p = prof?.invoice_number_padding
      padding = typeof p === 'number' && p > 0 ? p : 4
    }
  }

  return { template, padding }
}

/**
 * Generates the next sequential invoice number for a user.
 *
 * @param supabase — authenticated session client (carries auth.uid())
 * @param userId — sender_id (the freelancer); MUST equal auth.uid()
 * @param type — invoice type (prefix / customization selection)
 * @returns formatted invoice number, e.g. "20260045", "CR-20260003".
 *          Returns '' on allocation failure — the callers already guard with
 *          `if (!generated)` and return a clean 500. We NEVER fabricate a
 *          number on error (that would risk a duplicate or a gap).
 *
 * [FACTUUR-B] Atomic: the raw sequence comes from next_invoice_seq() in one
 * read+increment statement — no race window, forward-only (Art. 35). Yearly
 * reset vs continuous is inferred from the template: {year} present => reset
 * (counter keyed by calendar year); absent => continuous (counter keyed by the
 * year=0 sentinel).
 */
export async function generateInvoiceNumber(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any>,
  userId: string,
  type: InvoiceNumberType
): Promise<string> {
  // Server year — matches the prior implementation's behavior exactly.
  const year = new Date().getFullYear()

  const { template, padding } = await resolveFormat(supabase, userId, type)

  // {year} in the template => yearly reset (key by the calendar year);
  // {year} absent          => continuous numbering (key by the 0 sentinel).
  const counterYear = template.includes('{year}') ? year : 0

  // Atomic allocation — single source of truth, no SELECT-then-compute window.
  const { data, error } = await supabase.rpc('next_invoice_seq', {
    p_user_id: userId,
    p_year: counterYear,
    p_type: type,
  })

  const seq = typeof data === 'number' ? data : Number(data)
  if (error || !Number.isFinite(seq) || seq <= 0) {
    // Fail cleanly — caller returns a 500. Surfaces in Vercel runtime logs.
    console.error('[FACTUUR-B] next_invoice_seq failed', { userId, type, counterYear, error })
    return ''
  }

  return formatInvoiceNumber(template, seq, padding, year)
}