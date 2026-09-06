'use client'

// src/modules/accountant/pages/StandBadge.tsx
// [SNEL-BORD] Hoe oud het cijfer is dat je nu leest.
//
// Het werkbord toont de opgenomen stand van een klant onmiddellijk en haalt de verse er daarna
// achteraan. Dat is alleen te verantwoorden als er bij het cijfer staat WANNEER het is berekend:
// readiness beslist of een kwartaal ingediend kan worden, en "klaar" boven een administratie waar
// vanochtend twee facturen in zijn gevallen is geen kleine onnauwkeurigheid — dat is de app die een
// boekhouder aanraadt aangifte te doen.
//
// Eigen bestandje, en dat is opzet: zo is deze regel met props te renderen in een rendertest. In het
// werkbord zelf zou hij pas na een fetch verschijnen, en dan bewijst geen enkele test wat er staat.
//
// [TAAL] Dit component draagt geen eigen taal: welke zin bij welke ouderdom hoort staat in
// readiness-cache.ts (ageMessageKey), de zinnen zelf staan in messages.ts.

import { useLocale } from '@/lib/i18n/use-locale'
import { translator } from '@/lib/i18n/t'
import { cacheFreshness, ageMessageKey } from '@/lib/readiness-cache'

export function StandBadge({
  computedAt, now, refreshFailed,
}: {
  /** Het moment waarop /api/readiness dit rapport maakte, ISO. */
  computedAt: string
  /** Meegegeven in plaats van Date.now(), zodat een test één moment kan vastzetten. */
  now: number
  /** Het bijwerken is geprobeerd en mislukt — dan blijft het cijfer staan, met die mededeling. */
  refreshFailed?: boolean
}) {
  const t = translator(useLocale())
  const vers = cacheFreshness(computedAt, now)
  // Onleesbaar of te oud: dan hoort dit cijfer helemaal niet op het bord, en zegt de rij niets in
  // plaats van iets waarvan we de betekenis niet kennen. Het bord filtert daar al op; dit is het
  // tweede slot, want een badge zonder cijfer is een lege belofte.
  if (!vers.usable) return null

  const leeftijd = t(ageMessageKey(vers.band, vers.amount), { n: vers.amount })

  return (
    <span
      style={{
        fontSize: 11,
        color: refreshFailed ? '#B26A00' : '#5F6368',
        whiteSpace: 'nowrap',
      }}
    >
      {refreshFailed ? `${leeftijd} · ${t('bh.stand.mislukt')}` : leeftijd}
    </span>
  )
}
