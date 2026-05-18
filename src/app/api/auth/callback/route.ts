// src/app/api/auth/callback/route.ts
// [Google-OAuth] OAuth callback — exchange code, create profile for new users
// This is where Supabase redirects after Google login/register

import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase-server'

export async function GET(req: NextRequest) {
  const { searchParams, origin } = req.nextUrl
  const code = searchParams.get('code')
  const stateRaw = searchParams.get('state')

  // Parse state — passed from register page with role + redirect
  // From login: state is absent, redirect is a direct param
  // From register: state = JSON { role, redirect }
  let role: string | null = null
  let redirectTarget = '/dashboard'

  if (stateRaw) {
    try {
      const decoded = JSON.parse(decodeURIComponent(stateRaw))
      role = decoded.role || null
      redirectTarget = decoded.redirect || '/dashboard'
    } catch {
      // Malformed state — ignore, continue without role
    }
  } else {
    // From login page — redirect is a direct query param
    const redirectParam = searchParams.get('redirect')
    if (redirectParam) redirectTarget = decodeURIComponent(redirectParam)
  }

  if (!code) {
    return NextResponse.redirect(`${origin}/login?error=no_code`)
  }

  const supabase = await createServerSupabaseClient()

  // Exchange code for session
  const { data, error } = await supabase.auth.exchangeCodeForSession(code)

  if (error || !data.user) {
    return NextResponse.redirect(`${origin}/login?error=auth_failed`)
  }

  const user = data.user

  // [Google-OAuth] Check if profile already exists
  const { data: existingProfile } = await supabase
    .from('profiles')
    .select('id, onboarding_done')
    .eq('id', user.id)
    .single()

  if (!existingProfile) {
    // [Google-OAuth] New user — create profile from Google data
    const googleName = user.user_metadata?.full_name || user.user_metadata?.name || ''
    const googleEmail = user.email || ''

    await supabase.from('profiles').insert({
      id: user.id,
      full_name: googleName,
      email: googleEmail,
      role: role || 'zzper', // default role if login (not register) flow
      onboarding_done: false,
      onboarding_step: 0,
    })

    // New user always goes to onboarding
    return NextResponse.redirect(`${origin}/onboarding`)
  }

  // [Google-OAuth] Existing user — check onboarding status
  if (!existingProfile.onboarding_done) {
    return NextResponse.redirect(`${origin}/onboarding`)
  }

  // [Google-OAuth] Store Google access_token in email_connections for BOEK-011
  // The token from signInWithOAuth is in data.session
  const session = data.session
  if (session?.provider_token) {
    // Upsert Gmail connection — same token flow as manual Gmail connect
    // This enables BOEK-011 without requiring a separate Gmail OAuth step
    const gmailEmail = user.email || ''
    await supabase
      .from('email_connections')
      .upsert(
        {
          user_id: user.id,
          provider: 'gmail',
          access_token: session.provider_token,
          refresh_token: session.provider_refresh_token || '',
          email: gmailEmail,
          connected_at: new Date().toISOString(),
        },
        { onConflict: 'user_id,provider' }
      )
  }

  return NextResponse.redirect(`${origin}${redirectTarget}`)
}