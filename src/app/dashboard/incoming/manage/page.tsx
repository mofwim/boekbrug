// src/app/dashboard/incoming/manage/page.tsx
// [BRIDGE-POLISH 3b] Server wrapper for the incoming-invoice MANAGEMENT surface.
// Mirrors facturen/page.tsx: auth -> profile -> pass to the client component.
//
// Scope (decided with M): this surface manages CONFIRMED incoming invoices
// (status 'received' = unpaid Crediteur, or 'paid'). The verification QUEUE
// (status 'processing' / 'archived') stays in incoming/IncomingInvoicesClient.
// So this page fetches only received + paid incoming rows for the current user
// as RECEIVER. No hook reuse (useInfiniteInvoices is sender_id-only); a plain
// server fetch is passed as initial data and the client manages it locally.

export const dynamic = 'force-dynamic'

import { redirect } from 'next/navigation'
import { createServerSupabaseClient } from '@/lib/supabase-server'
import IncomingManageClient from './IncomingManageClient'

// Exactly the columns the management UI needs — payment fields + accountant_status
// for the read-only 'Verwerkt' badge (3b-2). No amounts edited here, but shown.
const COLS =
  'id, invoice_number, client_name, status, accountant_status, direction, total_inc_btw, total_ex_btw, btw_amount, invoice_date, due_date, payment_method, payment_date, created_at, document_id, pdf_url, vendor_iban, payment_reference, payment_prepared_at, field_confidence'

export default async function Page() {
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .single()

  if (!profile) redirect('/login')

  // Confirmed incoming invoices where the current user is the RECEIVER.
  // RLS already scopes to the user; the explicit receiver_id + direction keep
  // the query precise. 'received' (unpaid Crediteur) and 'paid' only.
  const { data: rows } = await supabase
    .from('invoices')
    .select(COLS)
    .eq('receiver_id', user.id)
    .eq('direction', 'incoming')
    .in('status', ['received', 'paid'])
    .order('created_at', { ascending: false })
    .limit(200)

  return (
    <IncomingManageClient
      profile={profile}
      initialInvoices={(rows ?? []) as unknown as any[]}
    />
  )
}