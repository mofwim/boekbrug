'use client'

// src/modules/accountant/pages/WorkDonePanel.tsx
// [WERK-GEDAAN] Wat de app deed, geteld — op het werkbord van het kantoor.
//
// Dit is het enige scherm in BoekBrug dat over de WAARDE van het product gaat in plaats van over
// de administratie. Daarom is het ook het scherm waar een verzonnen getal het meest kost: een
// boekhouder die één cijfer natelt en het niet vindt, gelooft de rest ook niet meer.
//
// Dus: het paneel toont uitsluitend TELLINGEN, en zegt er zelf bij waarom het geen uren noemt.
// De omrekening naar tijd of geld hoort bij het kantoor (zie estimateMinutes in work-done.ts, dat
// zonder hun eigen getal null teruggeeft en nergens een standaard heeft).
//
// [NO-SILENT-EMPTY] Twee toestanden mogen NOOIT als "nul handelingen" lezen: de telling die nog
// niet is aangezet, en de klanten waarvan het niet gelezen kon worden. Beide krijgen een eigen zin.

import { useEffect, useState } from 'react'
import { useLocale } from '@/lib/i18n/use-locale'
import { translator } from '@/lib/i18n/t'
import { EL1, M3, R } from '@/lib/design/tokens'
import { workDoneLedger, type WorkDoneCounts, type WorkDoneLedger } from '@/lib/work-done'

interface Antwoord {
  ok?: boolean
  from?: string
  to?: string
  office?: WorkDoneCounts | null
  perClient?: Record<string, WorkDoneCounts>
  unreadable?: string[]
  countsUnavailable?: boolean
}

/** dd-mm-jjjj, zoals elke datum die deze app aan een Nederlander laat zien. */
function nlDatum(iso: string): string {
  const [j, m, d] = iso.split('-')
  return `${d}-${m}-${j}`
}

export function WorkDonePanel({ from, to }: { from: string; to: string }) {
  const t = translator(useLocale())
  const [antwoord, setAntwoord] = useState<Antwoord | null>(null)
  const [bezig, setBezig] = useState(true)

  useEffect(() => {
    let afgebroken = false
    void (async () => {
      setBezig(true)
      try {
        const res = await fetch(`/api/work-done?from=${from}&to=${to}`)
        if (!res.ok) { if (!afgebroken) { setAntwoord(null); setBezig(false) } return }
        const json = (await res.json()) as Antwoord
        if (!afgebroken) { setAntwoord(json); setBezig(false) }
      } catch {
        // Een mislukte lezing is geen nul: het paneel verdwijnt liever dan dat het beweert dat de
        // app niets deed.
        if (!afgebroken) { setAntwoord(null); setBezig(false) }
      }
    })()
    return () => { afgebroken = true }
  }, [from, to])

  if (bezig || !antwoord?.ok) return null

  const kaart = (inhoud: React.ReactNode) => (
    <section style={{ backgroundColor: M3.surface, borderRadius: R.lg, boxShadow: EL1, padding: '14px 16px' }}>
      <p style={{ fontSize: 14, fontWeight: 600, color: '#202124', margin: 0 }}>{t('bh.gedaan.kop')}</p>
      {inhoud}
    </section>
  )

  // [NO-SILENT-EMPTY] De migratie staat nog niet op deze omgeving — zeg dat, tel geen nul.
  if (antwoord.countsUnavailable) {
    return kaart(
      <p style={{ fontSize: 12.5, color: '#B26A00', margin: '6px 0 0' }}>{t('bh.gedaan.nogNiet')}</p>,
    )
  }

  const office = antwoord.office
  if (!office) return null
  const geteld = Object.keys(antwoord.perClient ?? {}).length
  const ledger: WorkDoneLedger = workDoneLedger(`${from}/${to}`, office)
  if (ledger.total === 0) return null

  const onleesbaar = antwoord.unreadable?.length ?? 0

  return kaart(
    <>
      <p style={{ fontSize: 22, fontWeight: 700, color: '#137333', margin: '6px 0 0' }}>
        {t('bh.gedaan.totaal', { n: ledger.total.toLocaleString('nl-NL') })}
      </p>
      <p style={{ fontSize: 12, color: '#5F6368', margin: '2px 0 10px' }}>
        {t('bh.gedaan.periode', {
          van: nlDatum(from),
          tot: nlDatum(to),
          klanten: geteld === 1 ? t('bh.gedaan.klantenEen') : t('bh.gedaan.klanten', { n: geteld }),
        })}
      </p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {ledger.lines.map(l => (
          <p key={l.key} style={{ fontSize: 13, color: '#202124', margin: 0 }}>
            {l.sentence}
          </p>
        ))}
      </div>

      {/* De zin die dit paneel eerlijk houdt: wij tellen, het kantoor rekent om. */}
      <p style={{ fontSize: 11.5, color: '#5F6368', margin: '10px 0 0', lineHeight: 1.45 }}>
        {t('bh.gedaan.uitleg')}
      </p>

      {onleesbaar > 0 && (
        <p style={{ fontSize: 11.5, color: '#B26A00', margin: '6px 0 0' }}>
          {t('bh.gedaan.deelsOnleesbaar', { n: onleesbaar })}
        </p>
      )}
    </>,
  )
}
