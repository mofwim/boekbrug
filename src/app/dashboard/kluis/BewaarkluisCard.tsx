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
// [TAAL] A component holds no language of its own.
import { useLocale } from '@/lib/i18n/use-locale'
import { translator } from '@/lib/i18n/t'

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
  const t = translator(useLocale())
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
        setFout(body?.error || t('kluis.cardFout'))
        setBezig(false)
        return
      }
      // Volledige navigatie: Stripe Checkout is een andere origin.
      window.location.href = body.url
    } catch {
      setFout(t('kluis.cardGeenVerbinding'))
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
        {t('kluis.cardKop')}
      </h2>

      <p style={{ fontSize: 14, color: M3.neutral, margin: '0 0 12px', lineHeight: 1.6 }}>
        {t('kluis.cardUitleg', { maanden: offerte.gratisMaanden })}
      </p>

      {offerte.alGeregeld ? (
        <div style={{ background: '#CEEAD6', border: '1px solid #137333', color: '#0d652d', borderRadius: 12, padding: '14px 16px', fontSize: 14.5, lineHeight: 1.6 }}>
          <strong>{t('kluis.cardGeregeldKop')}</strong>
          {t('kluis.cardGeregeldRest', { year: offerte.keepThroughYear ?? '' })}
        </div>
      ) : offerte.leeg ? (
        <p style={{ fontSize: 13.5, color: M3.neutral, margin: 0, lineHeight: 1.6 }}>
          {offerte.uitleg}
        </p>
      ) : offerte.years === 0 ? (
        <p style={{ fontSize: 13.5, color: M3.neutral, margin: 0, lineHeight: 1.6 }}>
          {t('kluis.cardVerstreken', { year: offerte.keepThroughYear ?? '' })}
        </p>
      ) : (
        <>
          <p style={{ fontSize: 14, color: M3.neutral, margin: '0 0 12px', lineHeight: 1.6 }}>
            {t('kluis.cardAanbod', { jaar: offerte.lastFiscalYear ?? '', tot: offerte.keepThroughYear ?? '' })}
          </p>

          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 14 }}>
            <Stat label={t('kluis.cardStatJaren')} value={String(offerte.years)} />
            <Stat
              label={t('kluis.cardStatVooruit')}
              value={eur(offerte.prepayTotalEur ?? 0)}
              sub={t('kluis.cardStatVooruitSub', { bedrag: eur(offerte.annualTotalEur ?? 0) })}
            />
            <Stat label={t('kluis.cardStatArchief')} value={offerte.archiefOmvang ?? '—'} sub={t('kluis.cardStatStukken', { count: offerte.documentCount ?? 0 })} />
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
            {bezig ? t('kluis.bezig') : t('kluis.cardKnop', { bedrag: eur(offerte.prepayTotalEur ?? 0) })}
          </button>

          {fout && <div style={{ marginTop: 10, fontSize: 13, color: M3.error }}>{fout}</div>}

          <p style={{ fontSize: 12.5, color: M3.neutral, margin: '12px 0 0', lineHeight: 1.6 }}>
            {t('kluis.cardVoetnoot')}
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
