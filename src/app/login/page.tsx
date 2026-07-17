'use client'

// src/app/login/page.tsx
// [Google-OAuth] Add Google OAuth login — May 2026

import { Suspense, useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase'
import { useRouter, useSearchParams } from 'next/navigation'
import { ErrorMessage } from '@/components/ui/Feedback'

function LoginContent() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [googleLoading, setGoogleLoading] = useState(false)
  const [error, setError] = useState('')
  const [needsConfirm, setNeedsConfirm] = useState(false)
  const [resendMsg, setResendMsg] = useState('')
  const router = useRouter()
  const searchParams = useSearchParams()
  const supabase = createClient()

  // [Google-OAuth] Reset loading state when user returns via browser back button
  // pageshow + focus + visibilitychange covers all browsers
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

  // [Google-OAuth] Google login via Supabase OAuth
  async function handleGoogleLogin() {
    setGoogleLoading(true)
    setError('')

    // [Google-OAuth] Auto-reset after 10s in case user cancels or goes back
    const resetTimer = setTimeout(() => setGoogleLoading(false), 10_000)

    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        // Basic sign-in only — we no longer request Gmail inbox access here.
        // Gmail connecting is a separate, opt-in step during onboarding.
        scopes: 'email profile',
        redirectTo: `${window.location.origin}/api/auth/callback`,
      },
    })

    clearTimeout(resetTimer)

    if (error) {
      setGoogleLoading(false)
      setError('Google login mislukt — probeer opnieuw')
    }
  }

  async function handleLogin() {
    setLoading(true)
    setError('')
    setNeedsConfirm(false)
    setResendMsg('')

    const { error } = await supabase.auth.signInWithPassword({ email, password })

    if (error) {
      // Distinguish "not confirmed yet" from a real wrong password/e-mail.
      const code = (error as { code?: string }).code
      const msg = error.message?.toLowerCase() ?? ''
      if (code === 'email_not_confirmed' || msg.includes('confirm')) {
        setNeedsConfirm(true)
      } else {
        setError('E-mail of wachtwoord is onjuist')
      }
      setLoading(false)
      return
    }

    const redirectUrl = searchParams.get('redirect')
    router.push(redirectUrl ? decodeURIComponent(redirectUrl) : '/dashboard')
  }

  // Re-send the confirmation e-mail for an unconfirmed account.
  async function handleResend() {
    setResendMsg('')
    const { error } = await supabase.auth.resend({ type: 'signup', email })
    setResendMsg(error ? 'Versturen mislukt — probeer opnieuw.' : 'We hebben de mail opnieuw gestuurd.')
  }

  function goToRegister() {
    const redirectUrl = searchParams.get('redirect')
    router.push(redirectUrl
      ? `/register?redirect=${encodeURIComponent(redirectUrl)}`
      : '/register'
    )
  }

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
      <div className="bg-white p-8 rounded-2xl shadow-sm w-full max-w-md">

        <div className="text-center mb-8">
          <h1 className="text-2xl font-bold text-gray-900">BoekBrug</h1>
          <p className="text-gray-500 text-sm mt-1">De brug tussen jou en je boekhouder</p>
        </div>

        {/* [Google-OAuth] Google login button */}
        <button
          onClick={handleGoogleLogin}
          disabled={googleLoading || loading}
          className="w-full flex items-center justify-center gap-3 border border-gray-200 rounded-xl py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50 active:scale-[0.98] transition-all disabled:opacity-50 mb-6"
        >
          {googleLoading ? (
            <span className="w-5 h-5 border-2 border-gray-300 border-t-blue-600 rounded-full animate-spin" />
          ) : (
            <GoogleIcon />
          )}
          {googleLoading ? 'Bezig met verbinden...' : 'Inloggen met Google'}
        </button>

        {/* Divider */}
        <div className="flex items-center gap-3 mb-6">
          <div className="flex-1 h-px bg-gray-100" />
          <span className="text-xs text-gray-400">of</span>
          <div className="flex-1 h-px bg-gray-100" />
        </div>

        <div className="space-y-4">
          <div>
            <label htmlFor="login-email" className="block text-sm font-medium text-gray-700 mb-1">E-mailadres</label>
            <input
              id="login-email"
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              autoComplete="email"
              className="w-full border border-gray-300 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              placeholder="jouw@email.nl"
              style={{ fontSize: '16px' }} // prevent iOS zoom
            />
          </div>

          <div>
            <label htmlFor="login-password" className="block text-sm font-medium text-gray-700 mb-1">Wachtwoord</label>
            <input
              id="login-password"
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleLogin()}
              autoComplete="current-password"
              className="w-full border border-gray-300 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              placeholder="••••••••"
              style={{ fontSize: '16px' }} // prevent iOS zoom
            />
            <div className="text-right mt-1">
              <a href="/wachtwoord-vergeten" className="text-sm text-blue-600 hover:underline">
                Wachtwoord vergeten?
              </a>
            </div>
          </div>

          <ErrorMessage message={error} />

          {/* Unconfirmed e-mail — offer to re-send the confirmation link. */}
          {needsConfirm && (
            <div className="flex flex-col gap-2 bg-amber-50 border border-amber-100 rounded-xl px-4 py-3">
              <p className="text-sm text-amber-700">Je moet eerst je e-mail bevestigen.</p>
              <button
                type="button"
                onClick={handleResend}
                className="self-start text-sm font-medium text-blue-600 hover:underline"
              >
                Stuur de mail opnieuw
              </button>
              {resendMsg && <p className="text-sm text-amber-700">{resendMsg}</p>}
            </div>
          )}

          <button
            onClick={handleLogin}
            disabled={loading || googleLoading}
            className="w-full bg-blue-600 text-white rounded-xl py-2.5 text-sm font-semibold hover:bg-blue-700 active:scale-[0.98] transition-all disabled:opacity-50"
          >
            {loading ? 'Bezig...' : 'Inloggen'}
          </button>

          <button
            onClick={goToRegister}
            disabled={loading || googleLoading}
            className="w-full border border-gray-200 text-gray-700 rounded-xl py-2.5 text-sm font-medium hover:bg-gray-50 disabled:opacity-50"
          >
            Nieuw account aanmaken
          </button>
        </div>

      </div>
    </div>
  )
}

// Inline Google SVG icon — no external dependency
function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M17.64 9.205c0-.639-.057-1.252-.164-1.841H9v3.481h4.844a4.14 4.14 0 0 1-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.875 2.684-6.615Z" fill="#4285F4"/>
      <path d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18Z" fill="#34A853"/>
      <path d="M3.964 10.71A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.042l3.007-2.332Z" fill="#fbbc04"/>
      <path d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58Z" fill="#EA4335"/>
    </svg>
  )
}

export default function LoginPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <p className="text-gray-400 text-sm">Laden...</p>
      </div>
    }>
      <LoginContent />
    </Suspense>
  )
}