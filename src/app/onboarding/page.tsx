// src/app/api/auth/callback/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl
  const code = searchParams.get('code')
  const next = searchParams.get('next') ?? '/dashboard'

  if (!code) {
    return NextResponse.redirect(new URL('/login?error=no_code', req.url))
  }

  // Build redirect response FIRST — cookies must be set on THIS response
  const redirectOnboarding = NextResponse.redirect(new URL('/onboarding', req.url))
  const redirectDashboard = NextResponse.redirect(new URL(next, req.url))
  const redirectError = NextResponse.redirect(new URL('/login?error=auth_failed', req.url))

  // Create supabase client that writes cookies onto the redirect response
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => req.cookies.getAll(),
        setAll: (cookies) => {
          cookies.forEach(({ name, value, options }) => {
            redirectOnboarding.cookies.set(name, value, options)
            redirectDashboard.cookies.set(name, value, options)
          })
        },
      },
    }
  )

  const { data, error } = await supabase.auth.exchangeCodeForSession(code)
  const user = data?.user ?? (await supabase.auth.getUser()).data.user

  if (error || !user) {
    console.error('[Google-OAuth] exchangeCodeForSession failed:', error?.message)
    return redirectError
  }

  // Check existing profile
  const { data: existingProfile } = await supabase
    .from('profiles')
    .select('id, onboarding_done')
    .eq('id', user.id)
    .single()

  if (!existingProfile) {
    const googleName = user.user_metadata?.full_name || user.user_metadata?.name || ''
    const googleEmail = user.email || ''

    await supabase.from('profiles').insert({
      id: user.id,
      full_name: googleName,
      email: googleEmail,
      role: 'zzper',
      onboarding_done: false,
      onboarding_step: 0,
    })

    return redirectOnboarding
  }

  if (!existingProfile.onboarding_done) {
    return redirectOnboarding
  }

  // Store Gmail token if available
  const session = data.session
  if (session?.provider_token) {
    await supabase.from('email_connections').upsert(
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

  return redirectDashboard
}