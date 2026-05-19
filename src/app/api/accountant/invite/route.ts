// src/app/api/accountant/invite/route.ts
// [BOEK-028] Invite client by email — May 2026

import { type NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase-server'

export async function POST(req: NextRequest) {
  const supabase = await createServerSupabaseClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Niet ingelogd.' }, { status: 401 })

  const body = await req.json() as { email?: string }
  const email = (body.email ?? '').trim().toLowerCase()
  if (!email) return NextResponse.json({ error: 'E-mailadres ontbreekt.' }, { status: 400 })

  const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
  if (!emailOk) return NextResponse.json({ error: 'Ongeldig e-mailadres.' }, { status: 400 })

  const { data: existing } = await supabase
    .from('invitations')
    .select('id, status')
    .eq('accountant_email', email)
    .eq('invited_by', 'accountant')
    .maybeSingle()

  if (existing?.status === 'pending') {
    return NextResponse.json(
      { error: 'Er is al een uitnodiging verstuurd naar dit adres.' },
      { status: 400 }
    )
  }

  const { error } = await supabase
    .from('invitations')
    .insert({ accountant_email: email, invited_by: 'accountant', status: 'pending' })

  if (error) return NextResponse.json({ error: 'Uitnodiging versturen mislukt.' }, { status: 500 })
  return NextResponse.json({ ok: true })
}