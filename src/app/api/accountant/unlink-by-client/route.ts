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

  // [unlink#2] A client may hold MORE THAN ONE accountant row (a mid-switch, or the
  // consent-bug injection). The old maybeSingle() ERRORS on 2+ rows → link=null → a
  // spurious 404, leaving the client unable to unlink ANY accountant. Fetch them all
  // and unlink every one.
  const { data: links } = await supabase
    .from('accountant_clients')
    .select('id, accountant_id')
    .eq('zzper_id', user.id)

  const validLinks = (links ?? []).filter((l) => !!l.accountant_id)
  if (validLinks.length === 0) {
    return NextResponse.json({ error: 'Geen boekhouder gekoppeld.' }, { status: 404 })
  }

  const pipeline = createPipelineClient()
  const { data: client } = await pipeline
    .from('profiles').select('full_name, company_name').eq('id', user.id).single()
  const clientName = client?.company_name || client?.full_name || 'Een klant'

  // Delete ALL of this client's links in one scoped statement (zzper_id = user.id).
  const { error } = await supabase
    .from('accountant_clients')
    .delete()
    .eq('zzper_id', user.id)

  if (error) {
    return NextResponse.json({ error: 'Ontkoppelen mislukt. Probeer het opnieuw.' }, { status: 500 })
  }

  // Notify + audit each former accountant (best-effort; never blocks the unlink).
  for (const link of validLinks) {
    const accountantId = link.accountant_id as string
    const { data: accountant } = await pipeline
      .from('profiles').select('full_name, company_name, email').eq('id', accountantId).single()
    const accountantName = accountant?.company_name || accountant?.full_name || 'Boekhouder'

    if (accountant?.email) {
      try {
        await sendAccountantUnlinkedNotification({ toEmail: accountant.email, accountantName, clientName })
      } catch (err) {
        console.error('[unlink-by-client] email failed:', err)
      }
    }

    await logAuditAction({
      userId: user.id,
      action: 'accountant.client_unlinked',
      entityType: 'accountant_client',
      entityId: link.id,
      oldValue: { accountant_id: accountantId, zzper_id: user.id, initiated_by: 'client' },
      ipAddress: getClientIP(req),
    })
  }

  return NextResponse.json({ ok: true })
}