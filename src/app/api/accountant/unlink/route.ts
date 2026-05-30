// src/app/api/accountant/unlink/route.ts
// [BOEK-028] Unlink client from accountant — May 2026
// + email notification + audit log + in-app notification to client

import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase-server'
import { createPipelineClient } from '@/lib/supabase-pipeline'
import { sendClientUnlinkedNotification } from '@/lib/email'
import { logAuditAction, getClientIP } from '@/lib/audit'

export async function POST(req: NextRequest) {
  const supabase = await createServerSupabaseClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Niet ingelogd.' }, { status: 401 })

  const body = await req.json()
  const clientId: string = body.clientId ?? ''
  if (!clientId) return NextResponse.json({ error: 'clientId ontbreekt.' }, { status: 400 })

  // Verify ownership — only this accountant can unlink their own client
  const { data: link } = await supabase
    .from('accountant_clients')
    .select('id')
    .eq('accountant_id', user.id)
    .eq('zzper_id', clientId)
    .maybeSingle()

  if (!link) {
    return NextResponse.json(
      { error: 'Klant niet gevonden of geen toegang.' },
      { status: 404 }
    )
  }

  // Fetch client + accountant info BEFORE deleting (service role bypasses RLS)
  const pipeline = createPipelineClient()
  const [{ data: client }, { data: accountant }] = await Promise.all([
    pipeline.from('profiles').select('full_name, company_name, email').eq('id', clientId).single(),
    pipeline.from('profiles').select('full_name, company_name').eq('id', user.id).single(),
  ])

  const { error } = await supabase
    .from('accountant_clients')
    .delete()
    .eq('id', link.id)

  if (error) {
    return NextResponse.json(
      { error: 'Verwijderen mislukt. Probeer het opnieuw.' },
      { status: 500 }
    )
  }

  const clientName = client?.company_name || client?.full_name || 'Klant'
  const accountantName = accountant?.company_name || accountant?.full_name || 'Je boekhouder'

  // Email notification to client — best-effort
  if (client?.email) {
    try {
      await sendClientUnlinkedNotification({
        toEmail: client.email,
        clientName,
        accountantName,
      })
    } catch (err) {
      console.error('[accountant/unlink] email failed:', err)
    }
  }

  // In-app notification to client — via service role
  try {
    await pipeline.from('notifications').insert({
      user_id: clientId,
      title: 'Koppeling beeindigd',
      body: accountantName + ' heeft de koppeling met jou beeindigd. Je gegevens blijven van jou.',
      type: 'invite',
      read: false,
      link: '/dashboard/settings',
    })
  } catch (err) {
    console.error('[accountant/unlink] notification failed:', err)
  }

  // Audit log — legal record
  await logAuditAction({
    userId: user.id,
    action: 'accountant.client_unlinked',
    entityType: 'accountant_client',
    entityId: link.id,
    oldValue: { accountant_id: user.id, zzper_id: clientId, initiated_by: 'accountant' },
    ipAddress: getClientIP(req),
  })

  return NextResponse.json({ ok: true })
}