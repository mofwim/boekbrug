// src/app/api/auth/callback/route.ts
// [Google-OAuth] OAuth callback — exchange code for session, route user correctly
//
// IMPORTANT: Supabase Redirect URL must be set to:
//   https://boekbrug.nl/api/auth/callback
// NOT https://boekbrug.nl/ — that causes the code to land on the homepage unused.

import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase-server'

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl
  const code = searchParams.get('code')
  // `next` param — fallback destination after login
  const next = searchParams.get('next') ?? '/dashboard'

  // [Google-OAuth] No code = something went wrong upstream
  if (!code) {
    return NextResponse.redirect(new URL('/login?error=no_code', req.url))
  }

  const supabase = await createServerSupabaseClient()

  // [Google-OAuth] Exchange code for session — this is the critical step
  const { data, error } = await supabase.auth.exchangeCodeForSession(code)

  // [Google-OAuth] Fallback: getUser if data.user came back null
  const user = data?.user ?? (await supabase.auth.getUser()).data.user

  if (error || !user) {
    console.error('[Google-OAuth] exchangeCodeForSession failed:', error?.message)
    return NextResponse.redirect(new URL('/login?error=auth_failed', req.url))
  }

  // [Google-OAuth] Check if this user already has a profile
  const { data: existingProfile } = await supabase
    .from('profiles')
    .select('id, onboarding_done')
    .eq('id', user.id)
    .single()

  if (!existingProfile) {
    // [Google-OAuth] New user — create profile from Google metadata
    const googleName = user.user_metadata?.full_name || user.user_metadata?.name || ''
    const googleEmail = user.email || ''

    await supabase.from('profiles').insert({
      id: user.id,
      full_name: googleName,
      email: googleEmail,
      role: 'zzper', // default — user picks role during onboarding
      onboarding_done: false,
      onboarding_step: 0,
    })

    // Always send new users to onboarding
    return NextResponse.redirect(new URL('/onboarding', req.url))
  }

  // [Google-OAuth] Existing user — check onboarding
  if (!existingProfile.onboarding_done) {
    return NextResponse.redirect(new URL('/onboarding', req.url))
  }

  // [Google-OAuth] Store Google provider_token in email_connections for BOEK-011
  // provider_token = Google access token with gmail.readonly scope
  // This means: one Google login = Gmail automatically connected, no extra step
  const session = data.session
  if (session?.provider_token) {
    await supabase
      .from('email_connections')
      .upsert(
        {
          user_id: user.id,
          provider: 'gmail',
          access_token: session.provider_token,
          refresh_token: session.provider_refresh_token || '',
          email: user.email || '',
          connected_at: new Date().toISOString(),
        },
        { onConflict: 'user_id,provider' }
      )
  }

  // [Google-OAuth] Existing user, onboarding done → go to dashboard (or `next` param)
  return NextResponse.redirect(new URL(next, req.url))
}