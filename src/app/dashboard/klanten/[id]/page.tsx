// src/app/dashboard/klanten/[id]/page.tsx
// [KLANTEN] Customer detail — the mini-CRM view (gateway #2): contact + notes + the full
// invoice history and running totals for one customer. Server-rendered (RLS), then a small
// client for notes editing + quick actions.
export const dynamic = 'force-dynamic'

import { redirect } from 'next/navigation'
import { createServerSupabaseClient } from '@/lib/supabase-server'
import { getSessionUser } from '@/lib/session-user'
import KlantDetailClient, { type KlantInvoice } from './KlantDetailClient'

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createServerSupabaseClient()
  // [WATERVAL] Memoised per request (session-user.ts) — the dashboard layout above already asked.
  const user = await getSessionUser()
  if (!user) redirect('/login')

  const { data: client } = await supabase
    .from('clients')
    .select('id, name, email, kvk_number, btw_number, iban, address, postal_code, city, notes')
    .eq('id', id)
    .eq('user_id', user.id)
    .maybeSingle()
  if (!client) redirect('/dashboard/klanten')

  // This customer's invoices: linked by the robust client_id, PLUS legacy invoices that
  // predate the link (client_id NULL, matched by the name snapshot). Both scoped to the
  // owner's outgoing invoices. Two queries keeps the name match safe from filter-string
  // injection (a client name can contain commas/parentheses).
  const base = () => supabase
    .from('invoices')
    .select('id, invoice_number, invoice_date, due_date, status, total_inc_btw, direction')
    .eq('sender_id', user.id)
    .eq('direction', 'outgoing')
  const [{ data: byId }, { data: byName }] = await Promise.all([
    base().eq('client_id', id),
    base().is('client_id', null).eq('client_name', client.name),
  ])
  const seen = new Set<string>()
  const invoices: KlantInvoice[] = [...(byId ?? []), ...(byName ?? [])]
    .filter((iv) => (seen.has(iv.id) ? false : (seen.add(iv.id), true)))
    .map((iv) => ({
      id: iv.id, invoice_number: iv.invoice_number, invoice_date: iv.invoice_date,
      due_date: iv.due_date, status: iv.status, total_inc_btw: iv.total_inc_btw,
    }))
    .sort((a, b) => (b.invoice_date ?? '').localeCompare(a.invoice_date ?? ''))

  const PAID = new Set(['paid'])
  const billed = invoices.reduce((s, iv) => s + (iv.total_inc_btw ?? 0), 0)
  const open = invoices.filter((iv) => !PAID.has(iv.status ?? '')).reduce((s, iv) => s + (iv.total_inc_btw ?? 0), 0)

  return <KlantDetailClient client={client} invoices={invoices} totals={{ billed, open, count: invoices.length }} />
}
