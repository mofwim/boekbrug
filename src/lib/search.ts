// lib/search.ts
// Search for invoices and documents (BOEK-012)
// Uses ilike — works perfectly for invoice numbers like "2026-004"
// Parallel queries via Promise.all for speed
// src/lib/search.ts
// ilike search — werkt voor factuurnum, naam, email
// Voor accountant: zoekt ook in facturen van al zijn klanten

import { SupabaseClient } from '@supabase/supabase-js'

export interface SearchResult {
  id: string
  invoice_number: string
  client_name: string
  status: string
  total_inc_btw: number
  invoice_date: string
}

interface SearchOptions {
  supabase: SupabaseClient
  query: string
  userId: string
  role: 'zzper' | 'accountant' | string
}

export async function searchInvoices({
  supabase,
  query,
  userId,
  role,
}: SearchOptions): Promise<SearchResult[]> {
  const q = query.trim()
  if (!q) return []

  const likeFilter = `invoice_number.ilike.%${q}%,client_name.ilike.%${q}%,client_email.ilike.%${q}%`

  if (role === 'accountant') {
    // Get all client IDs for this accountant
    const { data: links } = await supabase
      .from('accountant_clients')
      .select('zzper_id')
      .eq('accountant_id', userId)

    const clientIds = (links ?? []).map((l: any) => l.zzper_id)

    // Search both accountant's own invoices and all clients' invoices
    const allIds = [userId, ...clientIds]

    const { data, error } = await supabase
      .from('invoices')
      .select('id, invoice_number, client_name, status, total_inc_btw, invoice_date')
      .in('sender_id', allIds)
      .or(likeFilter)
      .order('created_at', { ascending: false })
      .limit(10)

    if (error) return []
    return data ?? []
  }

  // ZZP: only own invoices
  const { data, error } = await supabase
    .from('invoices')
    .select('id, invoice_number, client_name, status, total_inc_btw, invoice_date')
    .eq('sender_id', userId)
    .or(likeFilter)
    .order('created_at', { ascending: false })
    .limit(10)

  if (error) return []
  return data ?? []
}