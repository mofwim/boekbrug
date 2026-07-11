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

  // [AUTH-FRONTDOOR] Signup/OAuth metadata. Email registration stores role +
  // company + KVK + BTW here (register/page.tsx), because when email confirmation
  // is ON there is no session at signup to write the profile directly. Google
  // sign-in provides only name/email. We read it here, where a real session
  // finally exists, to enrich the (trigger-created) profile row.
  const md = (user.user_metadata ?? {}) as Record<string, string | undefined>
  const metaName = md.full_name || md.name || ''

  // [Google-OAuth] Check if this user already has a profile
  const { data: existingProfile } = await supabase
    .from('profiles')
    .select('id, onboarding_done, role, full_name, company_name, kvk_number, btw_number, onboarding_step')
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
      company_name: md.company_name || null,
      kvk_number: md.kvk_number || null,
      btw_number: md.btw_number || null,
      role: md.role || 'zzper', // metadata role (email register) or default
      onboarding_done: false,
      // company data present → registration collected it → skip Welcome/Role.
      onboarding_step: md.company_name ? 4 : 1,
    }, { onConflict: 'id' })

    // Always send new users to onboarding
    return NextResponse.redirect(new URL('/onboarding', req.url))
  }

  // [AUTH-FRONTDOOR] Enrich the (trigger-created) profile from signup metadata.
  // This carries the data entered at registration through the email-confirmation
  // round-trip, where an RLS-protected write was not yet possible. Fill ONLY empty
  // fields so a returning user's later edits are never overwritten.
  const patch: {
    full_name?: string
    company_name?: string
    kvk_number?: string
    btw_number?: string
    role?: string
    onboarding_step?: number
  } = {}
  if (!existingProfile.full_name && metaName) patch.full_name = metaName
  if (!existingProfile.company_name && md.company_name) patch.company_name = md.company_name
  if (!existingProfile.kvk_number && md.kvk_number) patch.kvk_number = md.kvk_number
  if (!existingProfile.btw_number && md.btw_number) patch.btw_number = md.btw_number
  // Role: apply the chosen role only while onboarding is still incomplete and the
  // row still holds the trigger default ('zzper') — never override a later change.
  if (
    md.role && md.role !== existingProfile.role &&
    !existingProfile.onboarding_done && existingProfile.role === 'zzper'
  ) {
    patch.role = md.role
  }
  // Registration collected company data → skip the wizard's Welcome/Role steps.
  if (
    md.company_name && !existingProfile.onboarding_done &&
    (existingProfile.onboarding_step ?? 0) < 4
  ) {
    patch.onboarding_step = 4
  }
  if (Object.keys(patch).length > 0) {
    await supabase.from('profiles').update(patch).eq('id', user.id)
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