'use client'

// src/app/wachtwoord-herstellen/page.tsx
// Password reset — step 2: user arrives via the e-mail link and picks a new
// password. The recovery link gives this browser a temporary session, which
// updateUser() then uses to set the new password.

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase'
import { ErrorMessage } from '@/components/ui/Feedback'
import { wachtwoordOpslaanFout } from '@/lib/auth-errors'
// [2FA] Zie het blok bij `tweedeStap` hieronder: dit is de ene plek waar de middleware niet komt.
import { asAalLevel, owesSecondStep } from '@/lib/mfa'
// [TAAL] De rest van dit scherm is nog hard-gecodeerd Nederlands van vóór de vertaling. De twee
// nieuwe zinnen hieronder zijn dat niet: 2FA-taal hoort in de taal die de eigenaar heeft gekozen,
// en één zin uit de catalogus is er één minder die vastzit.
import { translator } from '@/lib/i18n/t'
import { useLocale } from '@/lib/i18n/use-locale'

/**
 * [2FA] Does this recovery session still owe the second step?
 *
 * ── WHY THIS CHECK CANNOT LIVE IN THE MIDDLEWARE ──
 *
 * Every other screen is covered there: mfaGate() runs on each navigation and redirects a session
 * that has not done the second step. This one page slips past it, and not by oversight — by the
 * shape of the flow. The recovery link is opened by someone with NO session, so the middleware
 * sees an anonymous request to a public path and lets it through, correctly. The session is then
 * created HERE, in the browser, by exchangeCodeForSession(); and the new password is set from the
 * same page, without a single navigation in between. There is no request left for a guard to judge.
 *
 * Without this check, two-step verification protects nothing against the one attacker it most
 * needs to: whoever can read the owner's e-mail asks for a reset link, chooses a new password, and
 * signs in — the second factor never comes up, because the account he is signing into is one he
 * now knows the password of. A lock on every door in the building, and the key under the mat.
 *
 * ── AND WHY IT STILL LEANS OPEN WHEN IT CANNOT TELL ──
 *
 * Same direction as the middleware, for a harder reason. An unreadable level here would otherwise
 * show "enter the code from your app" to someone who has no app — a dead end with no way past it,
 * on the screen of a person who is here precisely because they cannot get in. The failure that
 * opens this branch is a session read going wrong milliseconds after a session was successfully
 * established, which is rare and, crucially, nothing an attacker can bring about: he can hold the
 * mailbox and the link, and neither makes getAuthenticatorAssuranceLevel() fail.
 */
async function tweedeStapNodig(supabase: ReturnType<typeof createClient>): Promise<boolean> {
  try {
    const { data, error } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel()
    if (error || !data) {
      // Loud, because "two-step is on and the reset link walks straight past it" is a failure that
      // looks exactly like success from this screen.
      console.error('[2FA] Kon het verificatieniveau niet lezen op het herstelscherm', error?.message)
      return false
    }
    return owesSecondStep(asAalLevel(data.currentLevel), asAalLevel(data.nextLevel))
  } catch (fout) {
    console.error('[2FA] Verificatieniveau wierp een fout op het herstelscherm', fout)
    return false
  }
}

export default function WachtwoordHerstellenPage() {
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState(false)
  // Of deze link ons daadwerkelijk een sessie heeft opgeleverd. 'bezig' tot we het weten.
  // [2FA] 'tweedeStap' is de vierde uitkomst: de link werkt, maar dit account vraagt eerst om de
  // code uit de app. Zie tweedeStapNodig() hieronder.
  const [linkStatus, setLinkStatus] = useState<'bezig' | 'goed' | 'verlopen' | 'tweedeStap'>('bezig')
  const t = translator(useLocale())

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
      if (!data.session) {
        const code = new URLSearchParams(window.location.search).get('code')
        // Geen sessie en geen code: hier is niemand via een herstelmail binnengekomen.
        if (!code) { setLinkStatus('verlopen'); return }
        const { error } = await supabase.auth.exchangeCodeForSession(code)
        if (error) { setLinkStatus('verlopen'); return }
      }
      setLinkStatus(await tweedeStapNodig(supabase) ? 'tweedeStap' : 'goed')
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

  // [2FA] De link werkt, maar dit account vraagt eerst om de code uit de app. Geen formulier dus:
  // een wachtwoordveld dat er staat en straks toch wordt geweigerd is erger dan geen veld.
  //
  // Doorverwijzen naar /verificatie in plaats van hier een tweede codeveld te bouwen. Dat scherm
  // kent alle drie de uitkomsten al uit elkaar te houden (verifieerd / verkeerde code / we konden
  // het niet controleren) en heeft de uitweg voor wie zijn telefoon kwijt is; een tweede, kleinere
  // kopie ervan zou precies die zorgvuldigheid missen. Na de zes cijfers komt hij hier terug — met
  // een sessie op aal2, zodat dit scherm meteen het formulier laat zien.
  if (linkStatus === 'tweedeStap') {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
        <div className="bg-white p-8 rounded-2xl shadow-sm w-full max-w-md text-center">
          <div aria-hidden="true" style={{ fontSize: '48px', marginBottom: '16px' }}>🔐</div>
          <h1 className="text-2xl font-bold text-gray-900">{t('mfa.herstel.titel')}</h1>
          <p className="text-gray-500 text-sm mt-2" style={{ lineHeight: 1.6 }}>
            {t('mfa.herstel.uitleg')}
          </p>
          <a
            href="/verificatie?redirect=%2Fwachtwoord-herstellen"
            className="inline-block mt-6 px-6 py-2.5 rounded-xl bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700"
          >
            {t('mfa.verifieer')}
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
