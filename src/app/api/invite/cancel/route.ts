// src/app/api/invite/cancel/route.ts
// [UITNODIGING] Het kantoor trekt een eigen openstaande uitnodiging in.
//
// De helft van de intrekkingen is een tikfout in het adres: samen met de duplicaatgrens (die nu
// per kantoor en per geldigheidsvenster telt) is intrekken + opnieuw versturen de reparatieweg.
// De andere helft is gewoon van gedachten veranderd — en een uitnodiging die niemand meer wil,
// hoort niet veertien dagen als geladen link in iemands mailbox te liggen.
//
// Service-role, want invitations heeft geen UPDATE-policy; [RLS-UIT] de afscherming staat in de
// query — id ÉN zzper_id ÉN invited_by ÉN status, dus alleen een eigen, nog open
// kantoor-uitnodiging valt in te trekken. De status wordt 'declined': dat is de bestaande
// eindtoestand voor "dit gaat niet door", en de acceptatieroute weigert hem al (filter op
// 'pending'), dus de gemailde link is vanaf dit moment echt dood.

import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase-server'
import { createPipelineClient } from '@/lib/supabase-pipeline'

export async function POST(request: NextRequest) {
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json().catch(() => ({}))
  const id = typeof body?.id === 'string' ? body.id : null
  if (!id) return NextResponse.json({ error: 'Ongeldig' }, { status: 400 })

  const pipeline = createPipelineClient()
  const { data: updated, error } = await pipeline
    .from('invitations')
    .update({ status: 'declined' })
    .eq('id', id)
    .eq('zzper_id', user.id)
    .eq('invited_by', 'accountant')
    .eq('status', 'pending')
    .select('id')

  if (error) {
    console.error('[UITNODIGING] cancel failed', { id, error: error.message })
    return NextResponse.json({ error: 'Intrekken mislukt — probeer het opnieuw.' }, { status: 500 })
  }
  if (!updated || updated.length === 0) {
    // Al geaccepteerd, al ingetrokken, of niet van dit kantoor — in alle drie is er hier niets
    // meer te doen, en dat is een normaal antwoord, geen fout.
    return NextResponse.json({ error: 'Deze uitnodiging staat niet meer open.' }, { status: 409 })
  }
  return NextResponse.json({ success: true })
}
