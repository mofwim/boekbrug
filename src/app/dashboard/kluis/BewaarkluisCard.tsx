'use client'

// src/app/dashboard/kluis/BewaarkluisCard.tsx
// [KLUIS] De offerte voor de Bewaarkluis, in de kluis zelf.
//
// Toon: dit is de enige plek in de app waar iets wordt aangeboden dat pas nut heeft als de
// gebruiker weggaat. Dat maakt het gevoelig — een verkooppraatje op de pagina waar iemand
// zijn eigen administratie bekijkt, leest snel als "wij houden je stukken gijzelbaar".
// Vandaar de volgorde van de tekst hieronder: eerst wat er GRATIS gebeurt (twaalf maanden
// bewaren, altijd kunnen exporteren), dan pas wat het kost om langer te blijven staan.
//
// De offerte komt van de server (/api/kluis/offerte) en wordt nergens in de browser
// berekend: wat hier staat en wat er wordt afgerekend komt uit dezelfde berekening.

import { useCallback, useEffect, useState } from 'react'
import { M3, FONT, FONT_NUM } from '@/lib/design/tokens'

type Offerte = {
  leeg: boolean
  /** [KLUIS] Al gekocht — dan tonen wij wat er staat en verkopen wij niets. */
  alGeregeld?: boolean
  uitleg?: string
  gratisMaanden: number
  lastFiscalYear?: number
  documentCount?: number
  archiefOmvang?: string
  years?: number
  keepThroughYear?: number
  perYearEur?: number
  prepayTotalEur?: number
  annualTotalEur?: number
  prepaySavingEur?: number
}

const eur = (n: number) => `€ ${Number.isInteger(n) ? n : n.toFixed(2).replace('.', ',')}`

export default function BewaarkluisCard() {
  const [offerte, setOfferte] = useState<Offerte | null>(null)
  const [laden, setLaden] = useState(true)
  const [bezig, setBezig] = useState(false)
  const [fout, setFout] = useState('')

  useEffect(() => {
    // IIFE zodat de effectfunctie zelf synchroon blijft (react-hooks/set-state-in-effect).
    void (async () => {
      try {
        const res = await fetch('/api/kluis/offerte')
        if (res.ok) setOfferte(await res.json())
      } catch {
        /* geen offerte tonen is beter dan een foutmelding op een leespagina */
      }
      setLaden(false)
    })()
  }, [])

  const bestel = useCallback(async () => {
    setBezig(true)
    setFout('')
    try {
      const res = await fetch('/api/kluis/offerte', { method: 'POST' })
      const body = await res.json().catch(() => ({}))
      if (!res.ok || !body?.url) {
        setFout(body?.error || 'Er ging iets mis. Probeer het opnieuw.')
        setBezig(false)
        return
      }
      // Volledige navigatie: Stripe Checkout is een andere origin.
      window.location.href = body.url
    } catch {
      setFout('Geen verbinding. Controleer je internet en probeer opnieuw.')
      setBezig(false)
    }
  }, [])

  if (laden || !offerte) return null

  return (
    <section
      style={{
        background: '#FFFBF2',
        border: '1px solid #E8C89A',
        borderRadius: 16,
        padding: 18,
        marginTop: 16,
        fontFamily: FONT,
      }}
    >
      <h2 style={{ fontSize: 17, fontWeight: 700, color: M3.onSurface, margin: '0 0 6px' }}>
        Als je ooit stopt
      </h2>

      <p style={{ fontSize: 14, color: M3.neutral, margin: '0 0 12px', lineHeight: 1.6 }}>
        Je bewaarplicht loopt door als je onderneming stopt — en ook als je stopt met BoekBrug.
        Zeg je op, dan bewaren wij je administratie eerst nog <strong>{offerte.gratisMaanden} maanden
        kosteloos</strong>, en exporteren blijft die hele tijd werken. Wij verwijderen nooit iets
        zonder je minstens 30 dagen vooraf te mailen.
      </p>

      {offerte.alGeregeld ? (
        <div style={{ background: '#CEEAD6', border: '1px solid #137333', color: '#0d652d', borderRadius: 12, padding: '14px 16px', fontSize: 14.5, lineHeight: 1.6 }}>
          <strong>Je Bewaarkluis is geregeld.</strong> Wij bewaren je administratie tot en met{' '}
          <strong>{offerte.keepThroughYear}</strong>. Je hoeft verder niets te doen — en
          exporteren blijft die hele tijd gewoon werken.
        </div>
      ) : offerte.leeg ? (
        <p style={{ fontSize: 13.5, color: M3.neutral, margin: 0, lineHeight: 1.6 }}>
          {offerte.uitleg}
        </p>
      ) : offerte.years === 0 ? (
        <p style={{ fontSize: 13.5, color: M3.neutral, margin: 0, lineHeight: 1.6 }}>
          Je bewaarplicht voor deze administratie is verstreken (t/m {offerte.keepThroughYear}).
          Je hoeft hier niets voor te betalen.
        </p>
      ) : (
        <>
          <p style={{ fontSize: 14, color: M3.neutral, margin: '0 0 12px', lineHeight: 1.6 }}>
            Wil je dat je stukken daarna online blijven staan — geordend, doorzoekbaar en per jaar
            te exporteren — dan is daar de <strong>Bewaarkluis</strong> voor. Je jongste boekjaar is{' '}
            {offerte.lastFiscalYear}, dus je moet nog tot en met <strong>{offerte.keepThroughYear}</strong>{' '}
            kunnen leveren.
          </p>

          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 14 }}>
            <Stat label="Resterende bewaarjaren" value={String(offerte.years)} />
            <Stat
              label="Eenmalig vooruit"
              value={eur(offerte.prepayTotalEur ?? 0)}
              sub={`in plaats van ${eur(offerte.annualTotalEur ?? 0)} per jaar`}
            />
            <Stat label="Je archief weegt" value={offerte.archiefOmvang ?? '—'} sub={`${offerte.documentCount ?? 0} stukken`} />
          </div>

          <button
            onClick={bestel}
            disabled={bezig}
            style={{
              background: '#7C5800',
              color: '#fff',
              border: 'none',
              borderRadius: 999,
              padding: '11px 20px',
              cursor: bezig ? 'default' : 'pointer',
              fontSize: 14,
              fontWeight: 600,
              fontFamily: FONT,
              opacity: bezig ? 0.7 : 1,
            }}
          >
            {bezig ? 'Bezig…' : `Bewaarkluis regelen — ${eur(offerte.prepayTotalEur ?? 0)} eenmalig`}
          </button>

          {fout && <div style={{ marginTop: 10, fontSize: 13, color: M3.error }}>{fout}</div>}

          <p style={{ fontSize: 12.5, color: M3.neutral, margin: '12px 0 0', lineHeight: 1.6 }}>
            Wij nemen je bewaarplicht niet over — die blijft van jou. Bewaar daarom altijd ook je
            eigen kopie: wij zijn je tweede exemplaar, nooit je enige. Stoppen wij ooit zelf, dan
            hoor je dat 90 dagen van tevoren, krijg je je volledige archief toegestuurd en betalen
            wij het niet-verbruikte deel terug.
          </p>
        </>
      )}
    </section>
  )
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div style={{ flex: 1, minWidth: 150, background: '#fff', border: '1px solid #EFDCC0', borderRadius: 12, padding: '10px 12px' }}>
      <div style={{ fontSize: 11.5, color: M3.neutral, marginBottom: 2 }}>{label}</div>
      <div style={{ fontFamily: FONT_NUM, fontSize: 18, fontWeight: 700, color: M3.onSurface }}>{value}</div>
      {sub && <div style={{ fontSize: 11.5, color: M3.neutral, marginTop: 1 }}>{sub}</div>}
    </div>
  )
}
