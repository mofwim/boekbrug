// src/app/api/accountant/unlink/route.ts
// [BOEK-028] Unlink client from accountant — May 2026

import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase-server'

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

  return NextResponse.json({ ok: true })
}