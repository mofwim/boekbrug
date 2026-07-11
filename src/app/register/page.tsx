'use client'

// src/app/register/page.tsx
// [Google-OAuth] Add Google OAuth registration — May 2026

import { Suspense, useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase'
import { useRouter, useSearchParams } from 'next/navigation'
import { ErrorMessage } from '@/components/ui/Feedback'

function RegisterContent() {
  const [step, setStep] = useState(1)
  const [role, setRole] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [fullName, setFullName] = useState('')
  const [companyName, setCompanyName] = useState('')
  const [kvk, setKvk] = useState('')
  const [btw, setBtw] = useState('')
  const [loading, setLoading] = useState(false)
  const [googleLoading, setGoogleLoading] = useState(false)
  const [error, setError] = useState('')
  const [emailSent, setEmailSent] = useState(false)
  const router = useRouter()
  const searchParams = useSearchParams()
  const supabase = createClient()

  // [Google-OAuth] Reset loading when user returns via browser back button
  useEffect(() => {
    const reset = () => setGoogleLoading(false)
    window.addEventListener('pageshow', reset)
    document.addEventListener('visibilitychange', reset)
    window.addEventListener('focus', reset)
    return () => {
      window.removeEventListener('pageshow', reset)
      document.removeEventListener('visibilitychange', reset)
      window.removeEventListener('focus', reset)
    }
  }, [])

  // [Google-OAuth] Google register/login via Supabase OAuth
  // Role is stored in step 1 — passed as state through OAuth so callback can save it
  async function handleGoogleRegister() {
    if (!role) {
      // Step 1 not done yet — show role picker first
      setStep(1)
      return
    }

    setGoogleLoading(true)
    setError('')

    // [Google-OAuth] Auto-reset after 10s in case user cancels or goes back
    const resetTimer = setTimeout(() => setGoogleLoading(false), 10_000)

    // [AUTH-FRONTDOOR] Sign-in needs only basic identity scopes. Gmail import is a
    // SEPARATE, in-context consent (/api/email/connect) — requesting gmail.readonly
    // here made Google warn "this app wants to read your email" for every visitor
    // and forced the whole OAuth client into restricted-scope (CASA) review. The
    // role the user picked in step 1 is re-confirmed in onboarding, so it need not
    // ride along here. offline/consent params are dropped: they only fetch a Google
    // refresh token for Gmail API access, which this login flow never uses.
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        scopes: 'openid email profile',
        redirectTo: `${window.location.origin}/api/auth/callback`,
      },
    })

    clearTimeout(resetTimer)

    if (error) {
      setError('Google registratie mislukt — probeer opnieuw')
      setGoogleLoading(false)
    }
  }

  async function handleRegister() {
    if (password.length < 6) {
      setError('Wachtwoord moet minimaal 6 tekens zijn')
      return
    }

    setLoading(true)
    setError('')

    const { data, error: signUpError } = await supabase.auth.signUp({
      email,
      password,
      options: {
        // [AUTH-FRONTDOOR] The confirmation link must return through our PKCE
        // callback so the code is exchanged for a session. Landing on the site
        // root would drop the code and leave the user unauthenticated.
        emailRedirectTo: `${window.location.origin}/api/auth/callback`,
        // [AUTH-FRONTDOOR] Carry the registration data as user metadata. When email
        // confirmation is ON there is NO session after signUp, so a direct,
        // RLS-protected profile write is impossible here; the callback applies this
        // metadata once the user confirms and a real session exists.
        data: {
          full_name: fullName,
          company_name: companyName,
          kvk_number: kvk,
          btw_number: btw,
          role,
        },
      },
    })

    if (signUpError) {
      if (signUpError.status === 422 || signUpError.message?.toLowerCase().includes('already')) {
        setError('Dit e-mailadres is al geregistreerd — log in in plaats daarvan')
      } else {
        setError('Registratie mislukt — probeer opnieuw')
      }
      setLoading(false)
      return
    }

    if (!data.user) {
      setError('Registratie mislukt — probeer opnieuw')
      setLoading(false)
      return
    }

    // Supabase returns a user with EMPTY identities[] when the email already exists
    // (security measure to avoid leaking which emails are registered).
    // Detect this and show the correct message instead of failing on profile insert.
    if (data.user.identities && data.user.identities.length === 0) {
      setError('Dit e-mailadres is al geregistreerd — log in in plaats daarvan')
      setLoading(false)
      return
    }

    // [AUTH-FRONTDOOR] Decide on the SESSION before any profile write. When email
    // confirmation is enabled, signUp returns a user but NO session — the account
    // exists and the mail is sent, but auth.uid() is null, so an RLS-protected
    // profile write would fail and surface a FALSE "Profiel aanmaken mislukt" error
    // even though registration succeeded. The data is safely in user metadata; the
    // callback enriches the profile after the user confirms.
    const { data: sessionData } = await supabase.auth.getSession()
    if (!sessionData.session) {
      setEmailSent(true)
      setLoading(false)
      return
    }

    // [BOEK-015] Confirmation disabled → we have a session now. The
    // on_auth_user_created trigger already inserted a bare profile row; UPSERT
    // enriches it with the real registration data (avoids a 23505 on INSERT).
    // onboarding_step 4: register already collected role + company + KVK + BTW,
    // so the wizard skips Welcome/Role (page.tsx roleWasSet reads step>=2).
    const { error: profileError } = await supabase
      .from('profiles')
      .upsert({
        id: data.user.id,
        role,
        full_name: fullName,
        company_name: companyName,
        kvk_number: kvk,
        btw_number: btw,
        email,
        onboarding_step: 4,
      }, { onConflict: 'id' })

    if (profileError) {
      console.error('[AUTH-FRONTDOOR] register profile upsert failed:', profileError)
      setError('Profiel aanmaken mislukt — probeer opnieuw')
      setLoading(false)
      return
    }

    const redirectUrl = searchParams.get('redirect')
    router.push(redirectUrl ? decodeURIComponent(redirectUrl) : '/onboarding')
  }

  // [BOEK-015] email confirmation screen
  if (emailSent) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
        <div className="bg-white p-8 rounded-2xl shadow-sm w-full max-w-md text-center">
          <div style={{ fontSize: "48px", marginBottom: "16px" }}>📧</div>
          <h1 style={{ fontSize: "22px", fontWeight: 700, color: "#1c1c1e", margin: "0 0 8px" }}>
            Controleer je e-mail
          </h1>
          <p style={{ fontSize: "15px", color: "#6b6b6e", margin: "0 0 24px" }}>
            We hebben een bevestigingslink gestuurd naar <strong>{email}</strong>.
            Klik op de link om je account te activeren.
          </p>
          <a
            href="/login"
            style={{
              display: "inline-block", padding: "14px 24px", borderRadius: "12px",
              background: "#1A73E8", color: "#fff", textDecoration: "none",
              fontSize: "15px", fontWeight: 600,
            }}
          >
            Naar inloggen
          </a>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
      <div className="bg-white p-8 rounded-2xl shadow-sm w-full max-w-md">

        <div className="text-center mb-8">
          <h1 className="text-2xl font-bold text-gray-900">BoekBrug</h1>
          <p className="text-gray-500 text-sm mt-1">Account aanmaken</p>
        </div>

        {/* Stap 1 — Rol kiezen */}
        {step === 1 && (
          <div className="space-y-4">
            <p className="text-sm font-medium text-gray-700 text-center">Wie ben jij?</p>
            <button
              onClick={() => { setRole('zzper'); setStep(2) }}
              className="w-full border-2 border-gray-200 rounded-xl p-4 text-left hover:border-blue-500 active:scale-[0.98] transition-all"
            >
              <p className="font-medium text-gray-900">ZZP'er</p>
              <p className="text-sm text-gray-500">Ik stuur en ontvang facturen</p>
            </button>
            <button
              onClick={() => { setRole('accountant'); setStep(2) }}
              className="w-full border-2 border-gray-200 rounded-xl p-4 text-left hover:border-blue-500 active:scale-[0.98] transition-all"
            >
              <p className="font-medium text-gray-900">Boekhouder</p>
              <p className="text-sm text-gray-500">Ik beheer facturen van mijn klanten</p>
            </button>
          </div>
        )}

        {/* Stap 2 — Kies methode */}
        {step === 2 && (
          <div className="space-y-4">

            {/* [Google-OAuth] Google register button — shown prominently in step 2 */}
            <button
              onClick={handleGoogleRegister}
              disabled={googleLoading || loading}
              className="w-full flex items-center justify-center gap-3 border border-gray-200 rounded-xl py-3 text-sm font-medium text-gray-700 hover:bg-gray-50 active:scale-[0.98] transition-all disabled:opacity-50"
            >
              {googleLoading ? (
                <span className="w-5 h-5 border-2 border-gray-300 border-t-blue-600 rounded-full animate-spin" />
              ) : (
                <GoogleIcon />
              )}
              {googleLoading ? 'Bezig met verbinden...' : 'Registreren met Google'}
            </button>

            {/* Divider */}
            <div className="flex items-center gap-3">
              <div className="flex-1 h-px bg-gray-100" />
              <span className="text-xs text-gray-400">of met e-mail</span>
              <div className="flex-1 h-px bg-gray-100" />
            </div>

            {/* Email + password fields */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Volledige naam</label>
              <input type="text" value={fullName} onChange={e => setFullName(e.target.value)}
                className="w-full border border-gray-300 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="Jan de Vries"
                style={{ fontSize: '16px' }} />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Bedrijfsnaam</label>
              <input type="text" value={companyName} onChange={e => setCompanyName(e.target.value)}
                className="w-full border border-gray-300 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="Jouw Bedrijf BV"
                style={{ fontSize: '16px' }} />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">KVK-nummer</label>
              <input type="text" value={kvk} onChange={e => setKvk(e.target.value)}
                className="w-full border border-gray-300 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="12345678"
                style={{ fontSize: '16px' }} />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">BTW-nummer</label>
              <input type="text" value={btw} onChange={e => setBtw(e.target.value)}
                className="w-full border border-gray-300 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="NL123456789B01"
                style={{ fontSize: '16px' }} />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">E-mailadres</label>
              <input type="email" value={email} onChange={e => setEmail(e.target.value)}
                className="w-full border border-gray-300 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="jouw@email.nl"
                style={{ fontSize: '16px' }} />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Wachtwoord</label>
              <input
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleRegister()}
                className="w-full border border-gray-300 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="••••••••"
                style={{ fontSize: '16px' }} />
            </div>

            <ErrorMessage message={error} />

            <button onClick={handleRegister} disabled={loading || googleLoading}
              className="w-full bg-blue-600 text-white rounded-xl py-2.5 text-sm font-semibold hover:bg-blue-700 active:scale-[0.98] transition-all disabled:opacity-50">
              {loading ? 'Bezig...' : 'Account aanmaken'}
            </button>

            <button onClick={() => setStep(1)}
              className="w-full text-gray-500 text-sm hover:text-gray-700">
              ← Terug
            </button>
          </div>
        )}

      </div>
    </div>
  )
}

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M17.64 9.205c0-.639-.057-1.252-.164-1.841H9v3.481h4.844a4.14 4.14 0 0 1-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.875 2.684-6.615Z" fill="#4285F4"/>
      <path d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18Z" fill="#34A853"/>
      <path d="M3.964 10.71A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.042l3.007-2.332Z" fill="#FBBC05"/>
      <path d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58Z" fill="#EA4335"/>
    </svg>
  )
}

export default function RegisterPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <p className="text-gray-400 text-sm">Laden...</p>
      </div>
    }>
      <RegisterContent />
    </Suspense>
  )
}