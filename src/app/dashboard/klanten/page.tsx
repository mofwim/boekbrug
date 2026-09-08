// src/app/dashboard/klanten/page.tsx
// [BOEK-029] Server wrapper — fetches profile, passes to client component
// May 2026

export const dynamic = 'force-dynamic'

import { redirect } from 'next/navigation'
import { createServerSupabaseClient } from '@/lib/supabase-server'
import { getSessionUser } from '@/lib/session-user'
import { fetchAllRows } from '@/lib/supabase-paginate'
// [BESTE] The open balance per customer — through the one engine every openstaand figure uses.
import { summarise, type SalesInvoice } from '@/lib/sales-overview'
import { creditedTotalsFrom } from '@/lib/credited-invoices'
import KlantenClient from './KlantenClient'

/** The clock, read once outside the render — `Date.now()` in a component body is impure. */
function readClock(): number {
  return new Date().getTime()
}

type OpenRow = SalesInvoice & { client_id: string | null; original_invoice_id: string | null }

export default async function Page() {
  const supabase = await createServerSupabaseClient()
  // [WATERVAL] Memoised per request (session-user.ts) — the dashboard layout above already asked.
  const user = await getSessionUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .single()

  if (!profile) redirect('/login')

  // [BESTE] What each customer still owes, the way every package shows it on the list. Only the
  // rows that can be open plus the creditnotas that net against them; grouped on client_id, and
  // on the name for the legacy rows the detail page also matches on the name. [VOL-GELEZEN]
  // paged. [NO-SILENT-EMPTY] a failed read is null: no customer wears an amount, none wears a zero.
  const openByClient = await Promise.all([
    fetchAllRows<OpenRow>((from, to) =>
      supabase.from('invoices')
        .select('id, client_id, invoice_number, client_name, client_email, invoice_date, due_date, total_inc_btw, amount_paid, status, invoice_type, original_invoice_id')
        .eq('sender_id', user.id).eq('direction', 'outgoing')
        .or('status.in.(sent,overdue,processing),invoice_type.eq.creditnota')
        .order('id', { ascending: true }).range(from, to)),
    fetchAllRows<{ id: string; name: string }>((from, to) =>
      supabase.from('clients').select('id, name').eq('user_id', user.id).order('id', { ascending: true }).range(from, to)),
  ])
    .then(([rows, clients]) => {
      const idByName = new Map(clients.map((c) => [c.name, c.id]))
      const credited = creditedTotalsFrom(rows.filter((r) => (r.invoice_type ?? 'factuur') === 'creditnota'))
      const groups = new Map<string, OpenRow[]>()
      for (const r of rows) {
        const key = r.client_id ?? (r.client_name ? idByName.get(r.client_name) : undefined)
        if (!key) continue
        groups.set(key, [...(groups.get(key) ?? []), r])
      }
      const nowMs = readClock()
      const out: Record<string, number> = {}
      for (const [key, group] of groups) out[key] = summarise(group, nowMs, credited).outstanding
      return out
    })
    .catch((e) => {
      console.error('[BESTE] open balance per customer failed — the list renders without it', {
        userId: user.id, error: e instanceof Error ? e.message : String(e),
      })
      return null
    })

  return <KlantenClient profile={profile} openByClient={openByClient} />
}
