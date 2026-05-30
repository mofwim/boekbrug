// src/app/api/accountant/unlink-by-client/route.ts
// Client (ZZP'er) unlinks their accountant — with email notification + audit log
// Historical data is preserved (invoices link to sender_id, not accountant)

import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase-server'
import { createPipelineClient } from '@/lib/supabase-pipeline'
import { sendAccountantUnlinkedNotification } from '@/lib/email'
import { logAuditAction, getClientIP } from '@/lib/audit'

export async function POST(req: NextRequest) {
  const supabase = await createServerSupabaseClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Niet ingelogd.' }, { status: 401 })

  // Find the link — client side: zzper_id = user.id
  const { data: link } = await supabase
    .from('accountant_clients')
    .select('id, accountant_id')
    .eq('zzper_id', user.id)
    .maybeSingle()

  if (!link || !link.accountant_id) {
    return NextResponse.json({ error: 'Geen boekhouder gekoppeld.' }, { status: 404 })
  }

  const accountantId = link.accountant_id

  // Fetch accountant + client info BEFORE deleting (service role bypasses RLS)
  const pipeline = createPipelineClient()
  const [{ data: accountant }, { data: client }] = await Promise.all([
    pipeline.from('profiles').select('full_name, company_name, email').eq('id', accountantId).single(),
    pipeline.from('profiles').select('full_name, company_name').eq('id', user.id).single(),
  ])

  // Delete the link
  const { error } = await supabase
    .from('accountant_clients')
    .delete()
    .eq('id', link.id)

  if (error) {
    return NextResponse.json({ error: 'Ontkoppelen mislukt. Probeer het opnieuw.' }, { status: 500 })
  }

  const clientName = client?.company_name || client?.full_name || 'Een klant'
  const accountantName = accountant?.company_name || accountant?.full_name || 'Boekhouder'

  // Email notification — best-effort, doesn't block unlink
  if (accountant?.email) {
    try {
      await sendAccountantUnlinkedNotification({
        toEmail: accountant.email,
        accountantName,
        clientName,
      })
    } catch (err) {
      console.error('[unlink-by-client] email failed:', err)
    }
  }

  // Audit log — legal record of who terminated the connection and when
  await logAuditAction({
    userId: user.id,
    action: 'accountant.client_unlinked',
    entityType: 'accountant_client',
    entityId: link.id,
    oldValue: { accountant_id: accountantId, zzper_id: user.id, initiated_by: 'client' },
    ipAddress: getClientIP(req),
  })

  return NextResponse.json({ ok: true })
}