'use client'

// src/app/wachtwoord-herstellen/page.tsx
// Password reset — step 2: user arrives via the e-mail link and picks a new
// password. The recovery link gives this browser a temporary session, which
// updateUser() then uses to set the new password.

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase'
import { ErrorMessage } from '@/components/ui/Feedback'

export default function WachtwoordHerstellenPage() {
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState(false)

  // [BUILD-NO-SECRETS] The client is built where it is USED, never during render.
  //
  // `createClient()` sat in the component body, and this is the one page in the app that Next
  // still prerenders statically — so `next build` constructed a Supabase browser client at BUILD
  // time and threw when the keys were absent, failing the whole export on a page that needs
  // Supabase only in a browser, after a click. The build therefore depended on runtime secrets:
  // it could not run in CI, could not run locally without a live .env, and a single missing
  // variable turned a config mistake into a deploy that never shipped.
  //
  // Nothing here needs a client while rendering: all three calls live in an effect or a handler,
  // both of which run only in the browser. Missing keys now surface at RUNTIME, where
  // /api/health already names them — instead of at build time, where the message was a stack
  // trace pointing at a page that has nothing to do with the problem.
  const getSupabase = () => createClient()

  // Turn the recovery link into an active session. The browser client
  // auto-detects the link on load; if it used the PKCE ?code= form we
  // exchange it here as a fallback.
  useEffect(() => {
    const init = async () => {
      const supabase = getSupabase()
      const { data } = await supabase.auth.getSession()
      if (data.session) return
      const code = new URLSearchParams(window.location.search).get('code')
      if (code) {
        await supabase.auth.exchangeCodeForSession(code).catch(() => {})
      }
    }
    init()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function handleUpdate() {
    if (password.length < 6) {
      setError('Kies een wachtwoord van minstens 6 tekens')
      return
    }
    if (password !== confirm) {
      setError('De wachtwoorden zijn niet gelijk')
      return
    }

    setLoading(true)
    setError('')

    const { error: updateError } = await getSupabase().auth.updateUser({ password })

    if (updateError) {
      setError('Opslaan mislukt. Vraag een nieuwe link aan.')
      setLoading(false)
      return
    }

    setDone(true)
    setLoading(false)
  }

  if (done) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
        <div className="bg-white p-8 rounded-2xl shadow-sm w-full max-w-md text-center">
          <div aria-hidden="true" style={{ fontSize: '48px', marginBottom: '16px' }}>✅</div>
          <h1 className="text-2xl font-bold text-gray-900">Wachtwoord opgeslagen</h1>
          <p className="text-gray-500 text-sm mt-2">Je kunt nu inloggen met je nieuwe wachtwoord.</p>
          <a
            href="/login"
            className="inline-block mt-6 px-6 py-2.5 rounded-xl bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700"
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
          <h1 className="text-2xl font-bold text-gray-900">Nieuw wachtwoord</h1>
          <p className="text-gray-500 text-sm mt-2">Kies een nieuw wachtwoord voor je account.</p>
        </div>

        <div className="space-y-4">
          <div>
            <label htmlFor="new-password" className="block text-sm font-medium text-gray-700 mb-1">Nieuw wachtwoord</label>
            <input
              id="new-password"
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              autoComplete="new-password"
              className="w-full border border-gray-300 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              placeholder="••••••••"
              style={{ fontSize: '16px' }} // prevent iOS zoom
            />
          </div>

          <div>
            <label htmlFor="confirm-password" className="block text-sm font-medium text-gray-700 mb-1">Herhaal wachtwoord</label>
            <input
              id="confirm-password"
              type="password"
              value={confirm}
              onChange={e => setConfirm(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleUpdate()}
              autoComplete="new-password"
              className="w-full border border-gray-300 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              placeholder="••••••••"
              style={{ fontSize: '16px' }} // prevent iOS zoom
            />
          </div>

          <ErrorMessage message={error} />

          <button
            onClick={handleUpdate}
            disabled={loading || !password || !confirm}
            className="w-full bg-blue-600 text-white rounded-xl py-2.5 text-sm font-semibold hover:bg-blue-700 active:scale-[0.98] transition-all disabled:opacity-50"
          >
            {loading ? 'Bezig...' : 'Wachtwoord opslaan'}
          </button>
        </div>

      </div>
    </div>
  )
}
