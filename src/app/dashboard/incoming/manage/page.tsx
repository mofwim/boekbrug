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
// [PAGINATION] pages past PostgREST's silent ~1000-row cap — see supabase-paginate.ts
import { fetchAllRows } from '@/lib/supabase-paginate'
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
  // ones: they get their own query, and it is PAGED — see [PAGINATION] below,
  // where the old "a limit no real backlog reaches" turned out to be exactly
  // the limit PostgREST silently truncates at.
  //
  // [NO-SILENT-EMPTY] Both reads dropped their error, and on THIS screen that is the worst
  // possible answer to give. `const { data }` without `error` is not a smaller answer: supabase-js
  // does not throw, it returns `{ data: null, error }`, so a failed read became `[]` and the page
  // rendered its empty state — "Geen inkoopfacturen". This is the list the owner PAYS from, so
  // that sentence reads as "je hoeft niemand te betalen". Nothing else on the screen contradicted
  // it: the search box and the counter line are both hidden when the list is empty. Same rule as
  // the Kas page and the Brug: the page still renders, but it SAYS that it could not look.
  const readFailed: string[] = []
  const readOrFlag = async <T,>(label: string, run: () => Promise<T[]>): Promise<T[]> => {
    try {
      return await run()
    } catch (e) {
      console.error('[NO-SILENT-EMPTY] inkoopfacturen source read failed', { userId: user.id, source: label, error: e instanceof Error ? e.message : String(e) })
      readFailed.push(label)
      return []
    }
  }

  const [receivedRows, paidRows] = await Promise.all([
    // [PAGINATION] The open rows are PAGED, not capped. `.limit(1000)` sat exactly on PostgREST's
    // own ~1000-row ceiling (supabase-paginate.ts:1-6) — which truncates SILENTLY — so a backlog
    // of 1200 was indistinguishable from a complete list of 1000. And because the order was
    // created_at DESC, what fell off was the OLDEST unpaid invoices: the most overdue ones, the
    // exact rows [INBOX-CROWD-OUT] above exists to keep reachable. A row that is not here cannot
    // be paid from here.
    // [PAGE-KEY] Ordered by id (unique), never created_at: two invoices imported in the same
    // batch share a created_at to the microsecond, and Postgres defines no order among ties, so
    // across .range() windows a row could be served twice or skipped. The client sorts the list
    // itself on every render (sortRows, default 'added_desc'), so the read order costs nothing.
    readOrFlag('openstaande facturen', () => fetchAllRows((from, to) => supabase
      .from('invoices')
      .select(COLS)
      .eq('receiver_id', user.id)
      .eq('direction', 'incoming')
      .eq('status', 'received')
      .order('id', { ascending: true })
      .range(from, to)
    )),
    // The paid side stays a deliberate WINDOW (the 200 most recent), disclosed to the owner by
    // the counter below — an archive of paid invoices does not have to be complete to pay from.
    readOrFlag('betaalde facturen', async () => {
      const { data, error } = await supabase
        .from('invoices')
        .select(COLS)
        .eq('receiver_id', user.id)
        .eq('direction', 'incoming')
        .eq('status', 'paid')
        .order('created_at', { ascending: false })
        .limit(200)
      if (error) throw new Error(error.message)
      return data ?? []
    }),
  ])

  const rows = [...receivedRows, ...paidRows] as unknown as IncomingRow[]

  // [INVOICE-COUNTER] The TRUE number of confirmed inkoopfacturen — not the number the two
  // queries above happened to return. The paid query stops at 200, so a real backlog is larger
  // than the list; the counter in the client derives its breakdown from the loaded rows (so it
  // stays live while the owner pays and matches), and uses this number to SAY that the list is
  // capped instead of quietly presenting 200 as "all you have". head+exact = a count, no rows.
  // Null on failure → the client simply omits the disclosure, never guesses a total. That one was
  // honest already; its error is read only so a failing count is visible in the logs instead of
  // looking like an owner who happens to have none.
  const { count: totalCount, error: countErr } = await supabase
    .from('invoices')
    .select('id', { count: 'exact', head: true })
    .eq('receiver_id', user.id)
    .eq('direction', 'incoming')
    .in('status', ['received', 'paid'])
  if (countErr) console.error('[INVOICE-COUNTER] count read failed — disclosure omitted', { userId: user.id, error: countErr.message })

  // [INBOX-CROWD-OUT] Deep-link guarantee: Vandaag routes here with ?focus={id}
  // (and ?action=pay). If that row still fell outside the fetched window (e.g. a
  // paid row beyond the 200 cap), fetch it by id so the focus/pay flow always
  // lands. Same receiver/direction/status guards — never someone else's row.
  const { focus } = await searchParams
  if (focus && !rows.some((r) => r.id === focus)) {
    const { data: focused, error: focusErr } = await supabase
      .from('invoices')
      .select(COLS)
      .eq('id', focus)
      .eq('receiver_id', user.id)
      .eq('direction', 'incoming')
      .in('status', ['received', 'paid'])
      .maybeSingle()
    // A failed lookup is not "that invoice does not exist" — the deep link simply does not land.
    // Logged rather than flagged: the list itself is fine, and one unopened notification is not
    // worth putting a warning over a working screen.
    if (focusErr) console.error('[INBOX-CROWD-OUT] focus lookup failed — deep link did not land', { userId: user.id, focus, error: focusErr.message })
    if (focused) rows.unshift(focused as unknown as IncomingRow)
  }

  return (
    <IncomingManageClient
      profile={profile}
      initialInvoices={rows}
      totalCount={totalCount ?? null}
      readFailed={readFailed}
    />
  )
}
