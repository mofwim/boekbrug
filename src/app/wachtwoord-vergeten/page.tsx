'use client'

// src/app/wachtwoord-vergeten/page.tsx
// Password reset — step 1: ask for e-mail, send a reset link.

import { useState } from 'react'
import { getBrowserClient } from '@/lib/supabase'
import { ErrorMessage } from '@/components/ui/Feedback'
import { herstelmailFout } from '@/lib/auth-errors'
import { EMAIL_REGEX } from '@/lib/validation'

export default function WachtwoordVergetenPage() {
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [sent, setSent] = useState(false)

  async function handleReset() {
    // [DUBBEL-VERSTUREN] Enter ging langs de uitgeschakelde knop heen, en elke poging telt mee
    // voor de verzendlimiet van Supabase — die je juist de mail onthoudt waar je op wacht.
    if (loading) return

    const schoonEmail = email.trim()
    if (!schoonEmail) {
      setError('Vul je e-mailadres in')
      return
    }
    // De oude controle was `includes('@') && includes('.')` en liet "jan.de@vries" door: een
    // adres zonder domeinnaam. Dan is de mail onderweg naar niets en wacht iemand op post die
    // nooit komt — bij een herstelmail heb je geen enkele andere aanwijzing dat het misging.
    if (!EMAIL_REGEX.test(schoonEmail)) {
      setError('Dit e-mailadres klopt niet')
      return
    }

    setLoading(true)
    setError('')

    const { error: resetError } = await getBrowserClient().auth.resetPasswordForEmail(schoonEmail, {
      redirectTo: `${window.location.origin}/wachtwoord-herstellen`,
    })

    if (resetError) {
      // [AUTH-FOUT] Een ratelimiet is geen verzendstoring: "probeer opnieuw" is dan precies het
      // verkeerde advies, want elke nieuwe poging verlengt de wachttijd.
      setError(herstelmailFout({ status: resetError.status, message: resetError.message }).tekst)
      setLoading(false)
      return
    }

    setSent(true)
    setLoading(false)
  }

  if (sent) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
        <div className="bg-white p-8 rounded-2xl shadow-sm w-full max-w-md text-center">
          <div aria-hidden="true" style={{ fontSize: '48px', marginBottom: '16px' }}>📧</div>
          <h1 className="text-2xl font-bold text-gray-900">Check je e-mail</h1>
          <p className="text-gray-500 text-sm mt-2">
            We hebben je een link gestuurd.
          </p>
          <a
            href="/login"
            className="inline-block mt-6 text-sm text-blue-600 font-medium hover:underline"
          >
            Terug naar inloggen
          </a>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
      <div className="bg-white p-8 rounded-2xl shadow-sm w-full max-w-md">

        <div className="text-center mb-8">
          <h1 className="text-2xl font-bold text-gray-900">Wachtwoord vergeten?</h1>
          <p className="text-gray-500 text-sm mt-2">
            Vul je e-mail in. We sturen je een link om een nieuw wachtwoord te kiezen.
          </p>
        </div>

        <form onSubmit={e => { e.preventDefault(); handleReset() }} className="space-y-4">
            <div>
              <label htmlFor="reset-email" className="block text-sm font-medium text-gray-700 mb-1">E-mailadres</label>
              <input
                id="reset-email"
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                autoComplete="email"
                enterKeyHint="go"
                className="w-full border border-gray-300 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="jouw@email.nl"
                style={{ fontSize: '16px' }} // prevent iOS zoom
              />
            </div>

            <ErrorMessage message={error} />

            <button
              type="submit"
              disabled={loading || !email}
              className="w-full bg-blue-600 text-white rounded-xl py-2.5 text-sm font-semibold hover:bg-blue-700 active:scale-[0.98] transition-all disabled:opacity-50"
            >
              {loading ? 'Bezig...' : 'Stuur de link'}
            </button>

            <a
              href="/login"
              className="block text-center text-sm text-gray-500 hover:text-gray-700"
            >
              Terug naar inloggen
            </a>
        </form>

      </div>
    </div>
  )
}
