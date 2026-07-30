// src/app/api/auth/callback/route.ts
// [Google-OAuth] OAuth callback — exchange code for session, route user correctly
//
// IMPORTANT: Supabase Redirect URL must be set to:
//   https://boekbrug.nl/api/auth/callback
// NOT https://boekbrug.nl/ — that causes the code to land on the homepage unused.

import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase-server'
import { safeRedirect } from '@/lib/safe-redirect'

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl
  const code = searchParams.get('code')
  // `next` param — fallback destination after login. [SEC-REDIRECT] Accept ONLY a same-origin
  // relative path; anything else falls back to /dashboard, so a crafted ?next=//evil.com can't
  // turn login into an open redirect. De regel die hier stond staat nu in src/lib/safe-redirect.ts:
  // dit was de ENIGE van de drie plekken die de bestemming controleerde, en /login en /register
  // deden het niet — een controle op één van de drie is geen controle.
  const next = safeRedirect(searchParams.get('next'), '/dashboard')

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

  // [AUTH-FRONTDOOR] The only metadata we carry is the display name — from the
  // email signup (register/page.tsx passes data.full_name) or from Google. Role and
  // company are collected in onboarding, so there is nothing else to enrich here.
  const metaName = user.user_metadata?.full_name || user.user_metadata?.name || ''

  // [Google-OAuth] Check if this user already has a profile
  const { data: existingProfile } = await supabase
    .from('profiles')
    .select('id, onboarding_done, full_name')
    .eq('id', user.id)
    .single()

  if (!existingProfile) {
    // [BOEK-015] fix: use UPSERT — the on_auth_user_created trigger may have
    // already created a profile row. INSERT would 23505 and leave the user
    // stuck. onboarding_step: 1 (not 0) so the wizard renders Step 1.
    await supabase.from('profiles').upsert({
      id: user.id,
      full_name: metaName,
      email: user.email || '',
      role: 'zzper', // default — the real role is chosen during onboarding
      onboarding_done: false,
      onboarding_step: 1,
    }, { onConflict: 'id' })

    // Always send new users to onboarding
    return NextResponse.redirect(new URL('/onboarding', req.url))
  }

  // [BOEK-015] The trigger creates a bare profile (email only). Backfill the name
  // from metadata on first sign-in, but only if it is still empty — never overwrite
  // a name the user has since edited.
  if (metaName) {
    await supabase
      .from('profiles')
      .update({ full_name: metaName })
      .eq('id', user.id)
      .is('full_name', null)
  }

  // [Google-OAuth] Existing user — check onboarding
  if (!existingProfile.onboarding_done) {
    return NextResponse.redirect(new URL('/onboarding', req.url))
  }

  // [Google-OAuth] Existing user, onboarding done → go to dashboard (or `next` param)
  //
  // NOTE: Gmail connection is intentionally NOT handled here.
  // OAuth tokens are stored ENCRYPTED in Vault by /api/email/callback/gmail
  // (BOEK-011 + BOEK-SECURITY) via saveEmailTokens(), which writes the
  // *_secret_id reference columns. The previous code here upserted raw
  // access_token/refresh_token into email_connections, but those plaintext
  // columns no longer exist (replaced by Vault refs), so the write failed
  // silently and broke the type check after types were regenerated.
  // Gmail linking is a deliberate user action via the "Connect Gmail" flow.
  return NextResponse.redirect(new URL(next, req.url))
}