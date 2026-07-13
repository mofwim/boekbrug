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

  // [SEC-INVITE] zzper_id MUST be the inviting accountant's own id. The invitations
  // INSERT policy is WITH CHECK (auth.uid() = zzper_id); omitting it left zzper_id
  // NULL and the insert was rejected (42501), so accountant-initiated invites never
  // saved. On accept, the accountant→client branch also reads accountantId from
  // zzper_id, so it must carry the accountant here.
  const { error } = await supabase
    .from('invitations')
    .insert({ zzper_id: user.id, accountant_email: email, invited_by: 'accountant', status: 'pending' })

  if (error) {
    // 42501 = RLS rejected the insert. With the policy verified correct, this
    // in practice means auth.uid() was null inside Postgres → an expired/stale
    // session JWT that reached PostgREST after lapsing. The real fix is session
    // refresh in middleware (see PATCH_NOTE), but until that ships we give the
    // user an actionable message (refresh restores a valid token) instead of a
    // generic failure, and return 401 so the client can trigger a re-auth.
    if (error.code === '42501') {
      return NextResponse.json(
        { error: 'Je sessie is verlopen. Vernieuw de pagina en probeer opnieuw.' },
        { status: 401 }
      )
    }
    return NextResponse.json({ error: 'Uitnodiging versturen mislukt.' }, { status: 500 })
  }
  return NextResponse.json({ ok: true })
}