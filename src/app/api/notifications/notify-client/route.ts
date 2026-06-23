// src/app/api/notifications/notify-client/route.ts
// [BRIDGE-NOTIF] Accountant → client notification (closes the trust loop).
//
// Why a dedicated route (not /api/notifications/create):
//   /create pins user_id = the caller (anti-spoof) — it can only notify YOURSELF.
//   This route notifies SOMEONE ELSE (the client), so it must verify the
//   accountant↔client link server-side before writing, and write via service_role
//   (notifications has no authenticated INSERT policy — same rule as confirm-route).
//
// Security model:
//   1. Caller must be authenticated.
//   2. Caller must be an accountant linked to the target client
//      (accountant_clients: accountant_id = caller, zzper_id = clientId).
//      No link → 403. This is what prevents notifying arbitrary users.
//   3. Only then: insert a notification for the client via service_role.

import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase-server'
import { createPipelineClient } from '@/lib/supabase-pipeline'

const VALID_TYPES = ['invoice', 'payment', 'message', 'invite', 'status']

export async function POST(req: NextRequest) {
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: {
    clientId?: string
    title?: string
    body?: string
    type?: string
    link?: string
  }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Ongeldige gegevens' }, { status: 400 })
  }

  const { clientId, title, body: notifBody, type, link } = body

  if (!clientId || !title || !type || !VALID_TYPES.includes(type)) {
    return NextResponse.json({ error: 'Ongeldige gegevens' }, { status: 400 })
  }

  // ── Authorization: caller must be an accountant LINKED to this client ──
  // This is the anti-spoof gate. Without an active link, an accountant cannot
  // push a notification to an arbitrary profile id.
  const { data: link_row, error: linkErr } = await supabase
    .from('accountant_clients')
    .select('id')
    .eq('accountant_id', user.id)
    .eq('zzper_id', clientId)
    .limit(1)
    .maybeSingle()

  if (linkErr) {
    console.error('[notify-client] link lookup failed:', linkErr)
    return NextResponse.json({ error: 'Server fout' }, { status: 500 })
  }
  if (!link_row) {
    return NextResponse.json({ error: 'Geen toegang tot deze klant' }, { status: 403 })
  }

  // ── Write the notification for the client (service_role) ──
  try {
    const pipeline = createPipelineClient()
    const { error } = await pipeline.from('notifications').insert({
      user_id: clientId,            // the client — verified linked above
      title,
      body: notifBody ?? null,
      type,
      read: false,
      link: link ?? null,
    })

    if (error) {
      console.error('[notify-client] insert failed:', error)
      return NextResponse.json({ error: 'Aanmaken mislukt' }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('[notify-client] error:', err)
    return NextResponse.json({ error: 'Server fout' }, { status: 500 })
  }
}