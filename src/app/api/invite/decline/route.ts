// src/app/api/invite/decline/route.ts
// [UITNODIGING] "Weigeren" schrijft nu echt iets.
//
// De knop bestond en deed niets: hij navigeerde weg en liet de uitnodiging veertien dagen
// 'pending' staan. 'declined' is nota bene altijd al een toegestane status in de database
// geweest (invitations.status CHECK) — er was alleen geen code die hem ooit schreef.
//
// Het token is hier de credential, precies zoals bij /api/invite/info: wie de link heeft, mag
// de uitnodiging zien en mag haar dus ook afslaan — ingelogd of niet. Er valt niets te stelen:
// weigeren koppelt niets en onthult niets. Service-role omdat er geen UPDATE-policy op
// invitations bestaat ([RLS-UIT]: het token in de query IS de afscherming — uniek, onraadbaar,
// en alleen per mail verstuurd).

import { NextRequest, NextResponse } from 'next/server'
import { createPipelineClient } from '@/lib/supabase-pipeline'

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}))
  const token = typeof body?.token === 'string' ? body.token : null
  if (!token) return NextResponse.json({ error: 'Ongeldig' }, { status: 400 })

  const pipeline = createPipelineClient()
  // Alleen een nog openstaande uitnodiging valt te weigeren; een geaccepteerde blijft wat ze is.
  const { error } = await pipeline
    .from('invitations')
    .update({ status: 'declined' })
    .eq('token', token)
    .eq('status', 'pending')

  if (error) {
    console.error('[UITNODIGING] decline write failed', { error: error.message })
    return NextResponse.json({ error: 'Weigeren mislukt' }, { status: 500 })
  }
  return NextResponse.json({ success: true })
}
