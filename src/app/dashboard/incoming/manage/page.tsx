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
import type { ComponentProps } from 'react'

// Row shape the client expects — derived from its props (the type itself is not exported).
type IncomingRow = ComponentProps<typeof IncomingManageClient>['initialInvoices'][number]

// Exactly the columns the management UI needs — payment fields + accountant_status
// for the read-only 'Verwerkt' badge (3b-2). No amounts edited here, but shown.
const COLS =
  'id, invoice_number, client_name, status, accountant_status, direction, total_inc_btw, amount_paid, total_ex_btw, btw_amount, invoice_date, due_date, payment_method, payment_date, created_at, document_id, pdf_url, vendor_iban, payment_reference, payment_prepared_at, field_confidence'

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ focus?: string }>
}) {
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
  //
  // [INBOX-CROWD-OUT] Fetched as TWO queries, not one. The old single query
  // (received+paid mixed, newest 200 by created_at) let a stream of newly
  // imported/paid rows push an older UNPAID invoice off the list entirely —
  // it stayed on Vandaag's "Te betalen" (which reads ALL received rows) but
  // was invisible and thus unpayable here. Unpaid rows are the actionable
  // ones: they get their own query with a limit no real backlog reaches.
  const { data: receivedRows } = await supabase
    .from('invoices')
    .select(COLS)
    .eq('receiver_id', user.id)
    .eq('direction', 'incoming')
    .eq('status', 'received')
    .order('created_at', { ascending: false })
    .limit(1000)

  const { data: paidRows } = await supabase
    .from('invoices')
    .select(COLS)
    .eq('receiver_id', user.id)
    .eq('direction', 'incoming')
    .eq('status', 'paid')
    .order('created_at', { ascending: false })
    .limit(200)

  const rows = [...(receivedRows ?? []), ...(paidRows ?? [])] as unknown as IncomingRow[]

  // [INBOX-CROWD-OUT] Deep-link guarantee: Vandaag routes here with ?focus={id}
  // (and ?action=pay). If that row still fell outside the fetched window (e.g. a
  // paid row beyond the 200 cap), fetch it by id so the focus/pay flow always
  // lands. Same receiver/direction/status guards — never someone else's row.
  const { focus } = await searchParams
  if (focus && !rows.some((r) => r.id === focus)) {
    const { data: focused } = await supabase
      .from('invoices')
      .select(COLS)
      .eq('id', focus)
      .eq('receiver_id', user.id)
      .eq('direction', 'incoming')
      .in('status', ['received', 'paid'])
      .maybeSingle()
    if (focused) rows.unshift(focused as unknown as IncomingRow)
  }

  return (
    <IncomingManageClient
      profile={profile}
      initialInvoices={rows}
    />
  )
}