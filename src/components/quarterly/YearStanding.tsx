'use client'

// src/components/quarterly/YearStanding.tsx
// [JAARSTAND] Het jaar in vier regels, boven het Kwartaaloverzicht.
//
// Dit scherm heet "Kwartaaloverzicht" en toonde één kwartaal. Waarheid toont één kwartaal. De
// aangifte toont één kwartaal. Wie wilde weten wélke aangiftes van dit jaar nog openstaan, moest
// ze één voor één openen en onthouden wat de vorige zei — en de eerste keer dat je dat merkt is
// meestal vlak voor een deadline.
//
// WAT DIT COMPONENT NIET DOET: oordelen. Het vraagt /api/readiness per kwartaal — exact hetzelfde
// eindpunt dat het kwartaalscherm zelf gebruikt — en zet vier antwoorden om in vier regels. Er
// staat hier geen enkele regel over wat een kwartaal klaar maakt; die staat in buildReadiness en
// hoort daar te blijven. Verandert readiness, dan verandert deze strook mee.

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useLocale } from '@/lib/i18n/use-locale'
import { translator } from '@/lib/i18n/t'
import { yearStanding, blockedCount, yearNeedsAttention, type QuarterAnswer, type QuarterStanding } from '@/lib/year-standing'

/** Kleur per stand. Alleen "blokkeert" en "onbekend" mogen de aandacht trekken. */
const KLEUR: Record<QuarterStanding['state'], { rand: string; stip: string; tekst: string }> = {
  ingediend: { rand: '#E0E0E0', stip: '#5F6368', tekst: '#5F6368' },
  klaar:     { rand: '#C8E6C9', stip: '#188038', tekst: '#188038' },
  loopt:     { rand: '#E0E0E0', stip: '#9AA0A6', tekst: '#5F6368' },
  blokkeert: { rand: '#FADAD5', stip: '#B3261E', tekst: '#B3261E' },
  onbekend:  { rand: '#FDE8C8', stip: '#B26A00', tekst: '#B26A00' },
}

const LABEL_KEY = {
  ingediend: 'jaar.stand.ingediend',
  klaar: 'jaar.stand.klaar',
  loopt: 'jaar.stand.loopt',
  blokkeert: 'jaar.stand.blokkeert',
  onbekend: 'jaar.stand.onbekend',
} as const

export function YearStanding({ year, currentQuarter }: { year: number; currentQuarter: number }) {
  const t = translator(useLocale())
  const router = useRouter()
  const [rijen, setRijen] = useState<QuarterStanding[] | null>(null)
  const [bezig, setBezig] = useState(true)

  useEffect(() => {
    let afgebroken = false
    ;(async () => {
      // De laadstand hoort bij het ophalen zelf: binnen de async-wikkel, vóór de eerste await —
      // dezelfde tick als een synchrone zet, zonder setState in de effect-body (zie de
      // gelijke constructie in QuarterlyOverview).
      setBezig(true)
      // Welke kwartalen zijn al voorbij? Een lopend kwartaal wordt niet bevraagd: het kan nog niet
      // worden ingediend, dus een oordeel erover zou een vraag beantwoorden die niemand stelt.
      const nu = new Date()
      const ditJaar = nu.getUTCFullYear()
      const lopend = year === ditJaar ? Math.floor(nu.getUTCMonth() / 3) + 1 : year > ditJaar ? 0 : 5

      const [ingediend, ...verdicts] = await Promise.all([
        // [NO-SILENT-EMPTY] Een mislukte lezing geeft null, niet een lege lijst — anders leest
        // "we konden het niet ophalen" als "er is niets ingediend".
        fetch(`/api/btw/filed?year=${year}`)
          .then((r) => (r.ok ? r.json() : null))
          .then((j: { filed?: number[] } | null) => (Array.isArray(j?.filed) ? j!.filed! : null))
          .catch(() => null),
        ...([1, 2, 3, 4] as const).map(async (q) => {
          if (q >= lopend) return { quarter: q, report: null, running: true } satisfies QuarterAnswer
          try {
            const res = await fetch(`/api/readiness?year=${year}&quarter=${q}`)
            if (!res.ok) return { quarter: q, report: null } satisfies QuarterAnswer
            const json = await res.json()
            return { quarter: q, report: json?.report ?? null } satisfies QuarterAnswer
          } catch {
            return { quarter: q, report: null } satisfies QuarterAnswer
          }
        }),
      ])
      if (afgebroken) return
      const antwoorden = (verdicts as QuarterAnswer[]).map((a) =>
        ingediend?.includes(a.quarter) ? { ...a, filed: true } : a,
      )
      setRijen(yearStanding(antwoorden, year))
      setBezig(false)
    })()
    return () => { afgebroken = true }
  }, [year])

  if (bezig) {
    return (
      <p style={{ fontSize: 13, color: '#5F6368', margin: '0 0 16px' }}>{t('jaar.stand.bezig')}</p>
    )
  }
  if (!rijen) return null

  const open = blockedCount(rijen)
  const aandacht = yearNeedsAttention(rijen)

  return (
    <section
      style={{
        border: `1px solid ${aandacht ? '#FADAD5' : '#E0E0E0'}`,
        borderRadius: 12, padding: '14px 16px', marginBottom: 20,
        background: aandacht ? '#FFF8F7' : '#fff',
      }}
    >
      <p style={{ fontSize: 14, fontWeight: 600, color: '#202124', margin: 0 }}>
        {t('jaar.stand.kop')}
      </p>
      {open > 0 && (
        <p style={{ fontSize: 13, color: '#B3261E', fontWeight: 600, margin: '4px 0 0' }}>
          {open === 1 ? t('jaar.stand.openstaandEen') : t('jaar.stand.openstaand', { n: open })}
        </p>
      )}
      <p style={{ fontSize: 12, color: '#5F6368', margin: '4px 0 10px' }}>{t('jaar.stand.uitleg')}</p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {rijen.map((r) => {
          const kleur = KLEUR[r.state]
          const isHuidig = r.quarter === currentQuarter
          return (
            <button
              key={r.quarter}
              onClick={() => router.push(`/dashboard/quarterly?year=${year}&quarter=${r.quarter}`)}
              className="pressable-row"
              style={{
                display: 'flex', alignItems: 'center', gap: 10, width: '100%',
                textAlign: 'start', background: isHuidig ? '#F1F3F4' : 'transparent',
                border: `1px solid ${kleur.rand}`, borderRadius: 8,
                padding: '9px 12px', cursor: 'pointer', font: 'inherit',
              }}
            >
              <span style={{
                flexShrink: 0, width: 8, height: 8, borderRadius: 4, background: kleur.stip,
              }} aria-hidden />
              <span style={{ fontSize: 13, fontWeight: 600, color: '#202124', minWidth: 62 }}>
                {r.label}
              </span>
              <span style={{ fontSize: 12.5, color: kleur.tekst, fontWeight: r.state === 'blokkeert' ? 600 : 400 }}>
                {t(LABEL_KEY[r.state])}
              </span>
              {/* De reden staat er woordelijk bij zoals readiness hem schreef. Niet samengevat en
                  niet opnieuw vertaald: dat zou een tweede versie van hetzelfde gat opleveren. */}
              {r.reason && (
                <span style={{ fontSize: 12, color: '#5F6368', marginInlineStart: 'auto', textAlign: 'end' }}>
                  {r.reason}
                </span>
              )}
            </button>
          )
        })}
      </div>
    </section>
  )
}
