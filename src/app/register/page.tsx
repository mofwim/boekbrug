'use client'

// src/app/register/page.tsx
// [COLD-START] Registration = identity only. Name + email + password (or Google).
// Role and company details are collected in onboarding, which is purpose-built for
// it (AI reads your details from an invoice, or a two-field manual form). Keeping
// the very first screen light is the single biggest reduction in first-run friction
// — and it removes the old duplication (company asked at register AND onboarding).

import { Suspense, useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase'
import { useRouter, useSearchParams } from 'next/navigation'
import { ErrorMessage } from '@/components/ui/Feedback'

function RegisterContent() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [fullName, setFullName] = useState('')
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

  // [AUTH-FRONTDOOR] Google sign-up — basic identity scopes only. Gmail import is a
  // separate, in-context consent (/api/email/connect). Role is chosen in onboarding.
  async function handleGoogleRegister() {
    setGoogleLoading(true)
    setError('')
    const resetTimer = setTimeout(() => setGoogleLoading(false), 10_000)

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
        // callback so the code is exchanged for a session (landing on the site root
        // would drop the code and leave the user unauthenticated).
        emailRedirectTo: `${window.location.origin}/api/auth/callback`,
        // Only the name — the on_auth_user_created trigger reads full_name from here,
        // so it is set even before the user confirms. Role/company come in onboarding.
        data: { full_name: fullName },
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
    // (a privacy measure that avoids leaking which addresses are registered).
    if (data.user.identities && data.user.identities.length === 0) {
      setError('Dit e-mailadres is al geregistreerd — log in in plaats daarvan')
      setLoading(false)
      return
    }

    // [AUTH-FRONTDOOR] With email confirmation ON, signUp returns a user but NO
    // session. The account exists and the mail is sent; the trigger already created
    // the profile (with the name from metadata). Nothing to write here — just guide
    // the user to their inbox. (A profile write now would fail RLS: auth.uid() null.)
    const { data: sessionData } = await supabase.auth.getSession()
    if (!sessionData.session) {
      setEmailSent(true)
      setLoading(false)
      return
    }

    // Confirmation disabled → we have a session. The trigger-created profile is
    // already complete for onboarding (role/company are collected there), so we just
    // move on. Full onboarding starts at the welcome screen.
    const redirectUrl = searchParams.get('redirect')
    router.push(redirectUrl ? decodeURIComponent(redirectUrl) : '/onboarding')
  }

  // [BOEK-015] email confirmation screen
  if (emailSent) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
        <div className="bg-white p-8 rounded-2xl shadow-sm w-full max-w-md text-center">
          <div style={{ fontSize: '48px', marginBottom: '16px' }}>📧</div>
          <h1 style={{ fontSize: '22px', fontWeight: 700, color: '#1c1c1e', margin: '0 0 8px' }}>
            Controleer je e-mail
          </h1>
          <p style={{ fontSize: '15px', color: '#6b6b6e', margin: '0 0 24px' }}>
            We hebben een bevestigingslink gestuurd naar <strong>{email}</strong>.
            Klik op de link om je account te activeren.
          </p>
          <a
            href="/login"
            style={{
              display: 'inline-block', padding: '14px 24px', borderRadius: '12px',
              background: '#1A73E8', color: '#fff', textDecoration: 'none',
              fontSize: '15px', fontWeight: 600,
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
          <p className="text-gray-500 text-sm mt-1">Account aanmaken — in één minuut</p>
        </div>

        {/* Google sign-up */}
        <button
          onClick={handleGoogleRegister}
          disabled={googleLoading || loading}
          className="w-full flex items-center justify-center gap-3 border border-gray-200 rounded-xl py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50 active:scale-[0.98] transition-all disabled:opacity-50 mb-6"
        >
          {googleLoading ? (
            <span className="w-5 h-5 border-2 border-gray-300 border-t-blue-600 rounded-full animate-spin" />
          ) : (
            <GoogleIcon />
          )}
          {googleLoading ? 'Bezig met verbinden...' : 'Registreren met Google'}
        </button>

        {/* Divider */}
        <div className="flex items-center gap-3 mb-6">
          <div className="flex-1 h-px bg-gray-100" />
          <span className="text-xs text-gray-400">of met e-mail</span>
          <div className="flex-1 h-px bg-gray-100" />
        </div>

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Volledige naam</label>
            <input
              type="text" value={fullName} onChange={e => setFullName(e.target.value)}
              className="w-full border border-gray-300 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              placeholder="Jan de Vries"
              style={{ fontSize: '16px' }}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">E-mailadres</label>
            <input
              type="email" value={email} onChange={e => setEmail(e.target.value)}
              className="w-full border border-gray-300 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              placeholder="jouw@email.nl"
              style={{ fontSize: '16px' }}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Wachtwoord</label>
            <input
              type="password" value={password} onChange={e => setPassword(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleRegister()}
              className="w-full border border-gray-300 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              placeholder="Minimaal 6 tekens"
              style={{ fontSize: '16px' }}
            />
          </div>

          <ErrorMessage message={error} />

          <button
            onClick={handleRegister}
            disabled={loading || googleLoading}
            className="w-full bg-blue-600 text-white rounded-xl py-2.5 text-sm font-semibold hover:bg-blue-700 active:scale-[0.98] transition-all disabled:opacity-50"
          >
            {loading ? 'Bezig...' : 'Account aanmaken'}
          </button>

          <button
            onClick={() => {
              const redirectUrl = searchParams.get('redirect')
              router.push(redirectUrl ? `/login?redirect=${encodeURIComponent(redirectUrl)}` : '/login')
            }}
            disabled={loading || googleLoading}
            className="w-full border border-gray-200 text-gray-700 rounded-xl py-2.5 text-sm font-medium hover:bg-gray-50 disabled:opacity-50"
          >
            Al een account? Inloggen
          </button>
        </div>

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
