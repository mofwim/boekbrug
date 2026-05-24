// src/lib/invoice-numbering.ts
// [BOEK-031] Shared invoice number generator — May 2026
// =====================================================
// Format: "001-2026" / "CR-001-2026" / "PF-001-2026"
//
// Per Dutch Belastingdienst (Article 35 — Wet OB 1968):
// Numbers must be sequential without gaps.
//
// TODO: Replace SELECT-then-INSERT with PostgreSQL sequence
// to prevent race conditions in concurrent send scenarios.
// =====================================================

import type { SupabaseClient } from '@supabase/supabase-js'

export type InvoiceNumberType = 'factuur' | 'creditnota' | 'pro_forma'

/**
 * Generates the next sequential invoice number for a user.
 *
 * @param supabase — Supabase client (server or service role)
 * @param userId — sender_id (the freelancer)
 * @param type — invoice type for prefix selection
 * @returns formatted invoice number, e.g. "017-2026", "CR-003-2026", "PF-005-2026"
 */
export async function generateInvoiceNumber(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any>,
  userId: string,
  type: InvoiceNumberType
): Promise<string> {
  const year = new Date().getFullYear()
  const prefix = type === 'creditnota' ? 'CR-'
    : type === 'pro_forma' ? 'PF-'
    : ''

  // Find highest existing sequence for this user + year + type
  const { data } = await supabase
    .from('invoices')
    .select('invoice_number')
    .eq('sender_id', userId)
    .eq('invoice_type', type)
    .ilike('invoice_number', `${prefix}%-${year}`)
    .order('created_at', { ascending: false })
    .limit(50)

  let maxSeq = 0
  for (const inv of data ?? []) {
    const num = inv.invoice_number ?? ''
    // Extract sequence: "CR-016-2026" → 16, "001-2026" → 1
    const parts = num.replace(/^(CR-|PF-)/, '').split('-')
    const seq = parseInt(parts[0], 10)
    if (!isNaN(seq) && seq > maxSeq) maxSeq = seq
  }

  const nextSeq = String(maxSeq + 1).padStart(3, '0')
  return `${prefix}${nextSeq}-${year}`
}