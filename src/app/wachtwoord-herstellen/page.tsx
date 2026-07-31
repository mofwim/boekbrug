'use client'

// src/app/wachtwoord-herstellen/page.tsx
// Password reset — step 2: user arrives via the e-mail link and picks a new
// password. The recovery link gives this browser a temporary session, which
// updateUser() then uses to set the new password.

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase'
import { ErrorMessage } from '@/components/ui/Feedback'
import { wachtwoordOpslaanFout } from '@/lib/auth-errors'

export default function WachtwoordHerstellenPage() {
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState(false)
  // Of deze link ons daadwerkelijk een sessie heeft opgeleverd. 'bezig' tot we het weten.
  const [linkStatus, setLinkStatus] = useState<'bezig' | 'goed' | 'verlopen'>('bezig')

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
      if (data.session) { setLinkStatus('goed'); return }

      const code = new URLSearchParams(window.location.search).get('code')
      if (code) {
        const { error } = await supabase.auth.exchangeCodeForSession(code)
        setLinkStatus(error ? 'verlopen' : 'goed')
        return
      }
      // Geen sessie en geen code: hier is niemand via een herstelmail binnengekomen.
      setLinkStatus('verlopen')
    }
    init()
  }, [])

  async function handleUpdate() {
    // [DUBBEL-VERSTUREN] Enter ging langs de uitgeschakelde knop heen.
    if (loading) return

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
      // [AUTH-FOUT] Hier stond één zin voor élke fout: "Opslaan mislukt. Vraag een nieuwe link
      // aan." Dat is bij een te zwak wachtwoord ronduit verkeerd advies — je vraagt een nieuwe
      // link aan, kiest hetzelfde wachtwoord, en komt precies even ver. Alleen een écht verlopen
      // link stuurt nog naar een nieuwe aanvraag; de rest is hier gewoon opnieuw te proberen.
      const fout = wachtwoordOpslaanFout({
        code: (updateError as { code?: string }).code,
        status: updateError.status,
        message: updateError.message,
      })
      setError(fout.tekst)
      if (fout.linkVerlopen) setLinkStatus('verlopen')
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

  // Een link die het niet doet, zegt dat vóórdat je iets intikt.
  //
  // Dit scherm toonde altijd het formulier. Was de link verlopen, al gebruikt, of geopend op een
  // ander apparaat dan waar hij is aangevraagd (de codeverifier staat in díé browser), dan merkte
  // je dat pas nadat je twee keer een wachtwoord had ingetikt en op opslaan had gedrukt. En de
  // melding die je dan kreeg — "Vraag een nieuwe link aan" — was voor élke fout dezelfde, dus ook
  // als er niets mis was met de link.
  if (linkStatus === 'verlopen') {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
        <div className="bg-white p-8 rounded-2xl shadow-sm w-full max-w-md text-center">
          <div aria-hidden="true" style={{ fontSize: '48px', marginBottom: '16px' }}>⏳</div>
          <h1 className="text-2xl font-bold text-gray-900">Deze link werkt niet meer</h1>
          <p className="text-gray-500 text-sm mt-2">
            Een herstellink is kort geldig en kan maar één keer gebruikt worden. Open hem ook in
            dezelfde browser waarin je hem hebt aangevraagd.
          </p>
          <a
            href="/wachtwoord-vergeten"
            className="inline-block mt-6 px-6 py-2.5 rounded-xl bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700"
          >
            Vraag een nieuwe link aan
          </a>
          <a href="/login" className="block mt-4 text-sm text-gray-500 hover:text-gray-700">
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
          <h1 className="text-2xl font-bold text-gray-900">Nieuw wachtwoord</h1>
          <p className="text-gray-500 text-sm mt-2">Kies een nieuw wachtwoord voor je account.</p>
        </div>

        <form onSubmit={e => { e.preventDefault(); handleUpdate() }} className="space-y-4">
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
                autoComplete="new-password"
                enterKeyHint="go"
                className="w-full border border-gray-300 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="••••••••"
                style={{ fontSize: '16px' }} // prevent iOS zoom
              />
            </div>

            <ErrorMessage message={error} />

            <button
              type="submit"
              disabled={loading || linkStatus === 'bezig' || !password || !confirm}
              className="w-full bg-blue-600 text-white rounded-xl py-2.5 text-sm font-semibold hover:bg-blue-700 active:scale-[0.98] transition-all disabled:opacity-50"
            >
              {loading ? 'Bezig...' : 'Wachtwoord opslaan'}
            </button>
        </form>

      </div>
    </div>
  )
}
