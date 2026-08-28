'use client'

// src/app/invite/accept/page.tsx
// [UITNODIGING] De pagina waar een uitnodiging een koppeling wordt.
//
// Dit is de belangrijkste pagina van het distributiekanaal: één kantoor dat vijftig klanten
// uitnodigt, stuurt vijftig mensen HIERheen. Vier dingen waren er stuk, en elk droeg dezelfde
// vorm — de pagina wist iets en zei het niet:
//
//   · De zin stond in één richting. `zzperName` is voor een klantuitnodiging de BOEKHOUDER, en
//     de klant las "X wil je toevoegen als boekhouder" — alsof HIJ de boekhouder was. De API gaf
//     `invitedBy` al terug; de pagina las het niet.
//   · De server rekende drie verschillende weigeringen uit (verkeerd e-mailadres mét remedie,
//     verlopen, koppelen mislukt) en de pagina gooide ze alle drie weg voor één zin "verlopen of
//     al gebruikt". Precies de fout waar [SERVER-ZIN] voor bestaat.
//   · De registratielink droeg niets mee: geen rol (dus de genodigde klant kon "Boekhouder"
//     kiezen en in het verkeerde portaal eindigen), geen e-mailadres (dus een ander adres typen
//     was de standaardfout, en de acceptatie weigerde daarna terecht maar onbegrijpelijk).
//   · "Weigeren" schreef niets — de uitnodiging bleef veertien dagen leven.
//
// Hardcoded Nederlands is hier bovendien niet neutraal: de genodigde is een klant van een
// kantoor, en de eerste kantoren op dit product lezen Arabisch. Alles komt uit de catalogus.

import { Suspense, useState, useEffect } from 'react'
import { getBrowserClient } from '@/lib/supabase'
import { useRouter, useSearchParams } from 'next/navigation'
import type { User } from '@supabase/supabase-js'
import { translator } from '@/lib/i18n/t'
import { useLocale } from '@/lib/i18n/use-locale'
import { failureText } from '@/lib/server-message'

function AcceptInviteContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const token = searchParams.get('token')
  const locale = useLocale()
  const t = translator(locale)

  const [status, setStatus] = useState<'loading' | 'ready' | 'accepted' | 'declined' | 'error'>('loading')
  // [SERVER-ZIN] De zin van de server, of onze eigen terugval — nooit een kale status.
  const [errorText, setErrorText] = useState<string | null>(null)
  const [inviterName, setInviterName] = useState('')
  // [UITNODIGING] Wie nodigt wie uit? 'accountant' = een kantoor nodigt een klant; al het andere
  // (ook de oude rijen zonder waarde) = een ondernemer nodigt zijn boekhouder.
  const [fromAccountant, setFromAccountant] = useState(false)
  // Het uitgenodigde adres — reist mee naar /register zodat het goede adres er al staat.
  const [invitedEmail, setInvitedEmail] = useState<string | null>(null)
  const [user, setUser] = useState<User | null>(null)

  useEffect(() => {
    async function load() {
      if (!token) { setStatus('error'); return }

      const infoRes = await fetch(`/api/invite/info?token=${token}`)
      if (!infoRes.ok) {
        const json = await infoRes.json().catch(() => ({}))
        setErrorText(failureText(infoRes.status, json, t('uitn.fout.ongeldig')))
        setStatus('error')
        return
      }

      const info = await infoRes.json()
      setInviterName(info.zzperName ?? '')
      setFromAccountant(info.invitedBy === 'accountant')
      setInvitedEmail(typeof info.accountantEmail === 'string' ? info.accountantEmail : null)

      const { data: { user } } = await getBrowserClient().auth.getUser()
      setUser(user)
      setStatus('ready')
    }
    load()
    // [TAAL] `t` wisselt alleen met de taal; de lading hangt aan het token.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token])

  async function handleAccept() {
    setStatus('loading')
    const res = await fetch('/api/invite/accept', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    })
    if (res.ok) {
      setStatus('accepted')
      setTimeout(() => router.push('/dashboard'), 2000)
    } else {
      // [SERVER-ZIN] De server zegt WAT er mis is — verkeerd adres mét remedie, verlopen, of
      // koppelen mislukt — en dat is precies wat hier vroeger werd weggegooid.
      const json = await res.json().catch(() => ({}))
      setErrorText(failureText(res.status, json, t('uitn.fout.ongeldig')))
      setStatus('error')
    }
  }

  async function handleDecline() {
    setStatus('loading')
    // Best-effort: ook als het schrijven faalt is weggaan het juiste antwoord voor deze
    // bezoeker. Maar bij succes is de uitnodiging ECHT dicht in plaats van veertien dagen open.
    await fetch('/api/invite/decline', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    }).catch(() => null)
    setStatus('declined')
  }

  // De registratielink draagt alles wat deze pagina al weet: de bestemming (terug hierheen), de
  // rol die bij deze RICHTING hoort, en het uitgenodigde adres. Een genodigde klant komt zo nooit
  // meer voor de vraag "Wie ben jij?" te staan met "Boekhouder" als valstrik.
  const terug = `/invite/accept?token=${token}`
  const registerHref =
    `/register?redirect=${encodeURIComponent(terug)}` +
    `&rol=${fromAccountant ? 'zzper' : 'accountant'}` +
    (invitedEmail ? `&email=${encodeURIComponent(invitedEmail)}` : '')
  const loginHref = `/login?redirect=${encodeURIComponent(terug)}`

  if (status === 'loading') return (
    <div className="min-h-screen bg-[#f8f9fa] flex items-center justify-center">
      <p className="text-gray-400 text-sm">{t('uitn.laden')}</p>
    </div>
  )

  if (status === 'error') return (
    <div className="min-h-screen bg-[#f8f9fa] flex items-center justify-center">
      <div className="bg-white rounded-2xl p-8 shadow-sm text-center max-w-sm">
        <p className="text-2xl mb-3">❌</p>
        <p className="font-semibold text-gray-900">{t('uitn.fout.titel')}</p>
        <p className="text-sm text-gray-500 mt-1">{errorText ?? t('uitn.fout.ongeldig')}</p>
        <button onClick={() => router.push('/login')}
          className="mt-4 bg-blue-600 text-white px-6 py-2 rounded-xl text-sm font-semibold">
          {t('uitn.inloggen')}
        </button>
      </div>
    </div>
  )

  if (status === 'accepted') return (
    <div className="min-h-screen bg-[#f8f9fa] flex items-center justify-center">
      <div className="bg-white rounded-2xl p-8 shadow-sm text-center max-w-sm">
        <p className="text-2xl mb-3">✅</p>
        <p className="font-semibold text-gray-900">{t('uitn.klaar.titel')}</p>
        <p className="text-sm text-gray-500 mt-1">{t('uitn.klaar.uitleg')}</p>
      </div>
    </div>
  )

  if (status === 'declined') return (
    <div className="min-h-screen bg-[#f8f9fa] flex items-center justify-center">
      <div className="bg-white rounded-2xl p-8 shadow-sm text-center max-w-sm">
        <p className="text-2xl mb-3">👋</p>
        <p className="font-semibold text-gray-900">{t('uitn.geweigerd.titel')}</p>
        <p className="text-sm text-gray-500 mt-1">{t('uitn.geweigerd.uitleg')}</p>
      </div>
    </div>
  )

  return (
    <div className="min-h-screen bg-[#f8f9fa] flex items-center justify-center">
      <div className="bg-white rounded-2xl p-8 shadow-sm text-center max-w-sm w-full">
        <p className="text-3xl mb-4">🤝</p>
        <h1 className="text-lg font-bold text-gray-900 mb-1">{t('uitn.titel')}</h1>
        <p className="text-sm text-gray-500 mb-6">
          {/* De zin volgt de RICHTING van de uitnodiging — zie de kop van dit bestand. */}
          {fromAccountant
            ? t('uitn.vanKantoor', { naam: inviterName })
            : t('uitn.vanOndernemer', { naam: inviterName })}
        </p>

        {user ? (
          <div className="space-y-3">
            <p className="text-xs text-gray-400">{t('uitn.ingelogdAls', { email: user.email ?? '' })}</p>
            <button onClick={handleAccept}
              className="w-full bg-blue-600 text-white py-3 rounded-xl text-sm font-semibold hover:bg-blue-700">
              {t('uitn.accepteren')}
            </button>
            <button onClick={handleDecline}
              className="w-full border border-gray-200 text-gray-600 py-3 rounded-xl text-sm font-medium">
              {t('uitn.weigeren')}
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-sm text-gray-500">{t('uitn.eerstAccount')}</p>
            <button
              onClick={() => router.push(registerHref)}
              className="w-full bg-blue-600 text-white py-3 rounded-xl text-sm font-semibold hover:bg-blue-700">
              {t('uitn.registreren')}
            </button>
            <button
              onClick={() => router.push(loginHref)}
              className="w-full border border-gray-200 text-gray-600 py-3 rounded-xl text-sm font-medium">
              {t('uitn.inloggen')}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

export default function AcceptInvitePage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-[#f8f9fa] flex items-center justify-center">
        <p className="text-gray-400 text-sm">…</p>
      </div>
    }>
      <AcceptInviteContent />
    </Suspense>
  )
}
