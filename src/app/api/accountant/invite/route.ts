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

  // [BOEK-028][DEBUG] Runtime probe — what does Postgres see under THIS session?
  // getUser() above proved the JWT is valid at the Auth layer, but the RLS
  // policy reads auth.uid() inside Postgres. If the JWT isn't reaching PostgREST,
  // auth.uid() is null there and the EXISTS(profiles ...) check fails → 42501.
  // This selects the caller's own profile row: it only returns a row if
  // profiles_select_own (id = auth.uid()) passes, i.e. auth.uid() is populated.
  const { data: selfProfile, error: selfErr } = await supabase
    .from('profiles')
    .select('id, role')
    .eq('id', user.id)
    .maybeSingle()

  console.error('[BOEK-028][DEBUG] runtime session probe:', {
    getUser_id: user.id,
    selfProfile_found: !!selfProfile,
    selfProfile_role: selfProfile?.role ?? null,
    selfProfile_error: selfErr?.message ?? null,
  })

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

  if (error) {
    // [BOEK-028][DEBUG] temporary — surface the real Supabase error to diagnose the 500.
    // Remove the console.error + debug fields once the root cause is fixed.
    console.error('[BOEK-028] invitations insert failed:', {
      message: error.message,
      details: error.details,
      hint: error.hint,
      code: error.code,
    })
    return NextResponse.json(
      {
        error: 'Uitnodiging versturen mislukt.',
        debug: {
          message: error.message,
          details: error.details,
          hint: error.hint,
          code: error.code,
          // runtime session probe — is auth.uid() reaching Postgres?
          probe_selfProfile_found: !!selfProfile,
          probe_selfProfile_role: selfProfile?.role ?? null,
        },
      },
      { status: 500 }
    )
  }
  return NextResponse.json({ ok: true })
}