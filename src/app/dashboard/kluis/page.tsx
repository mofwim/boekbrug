// src/app/dashboard/kluis/page.tsx
// [KLUIS] Compliance-kluis (anchor gateway #5). Server-rendered (RLS): fetches the
// owner's invoices + documents, runs the pure retention/completeness math, and hands
// the per-year summaries to the client. The vault is the "never-cancelled" anchor —
// the whole 7-year bewaarplicht history in one place, always exportable.
export const dynamic = 'force-dynamic'

import { redirect } from 'next/navigation'
import { createServerSupabaseClient } from '@/lib/supabase-server'
import { summarizeVault, type VaultInvoice, type VaultDocument } from '@/lib/compliance-vault'
import KluisClient from './KluisClient'

export default async function Page() {
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  // Real records: the owner's own invoices (both directions) and stored documents.
  const [{ data: invoices }, { data: documents }] = await Promise.all([
    supabase
      .from('invoices')
      .select('invoice_date, direction, invoice_type, status, total_inc_btw')
      .eq('sender_id', user.id),
    supabase
      .from('documents')
      .select('doc_type, year, period, trashed')
      .eq('user_id', user.id),
  ])

  // The current year drives the retention window. We compute it once, on the server,
  // rather than in the client (Date.now() is unavailable in some render contexts and
  // a server value keeps the window stable within one render).
  const currentYear = new Date().getUTCFullYear()

  const summaries = summarizeVault(
    currentYear,
    (invoices ?? []) as VaultInvoice[],
    (documents ?? []) as VaultDocument[],
  )

  return <KluisClient summaries={summaries} currentYear={currentYear} />
}
