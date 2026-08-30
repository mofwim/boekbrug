'use client'

// src/app/dashboard/leveranciers/LeveranciersClient.tsx
// [LEVERANCIER-SALDO] De crediteurenstand, zoals de groothandel op de foto hem laat zien —
// gegroepeerd per partij, met een subtotaal, een vervallen-deel en een peildatum erboven.
//
// [TAAL] Dit component houdt geen taal van zichzelf. Elke zin komt kant-en-klaar uit
// supplier-balance-copy.ts, inclusief de richting waarin hij gelezen wordt; hier staat alleen
// hoe het eruitziet. Eén hard-gecodeerde string hier is precies hoe een vertaling voorgoed half
// af blijft: het scherm ziet er in het Nederlands nog goed uit, dus niets wijst het gat aan.

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'

// [DATE-NL] Geen <input type="date">: de segmentvolgorde daarvan volgt de browser-locale, niet de
// ondernemer. Op een scherm waar de datum bepaalt WELK bedrag er staat, is 08-09 of 09-08 het
// verschil tussen twee verschillende crediteurenstanden.
import DateFieldNL from '@/components/ui/DateFieldNL'

import { M3, R, FONT, FONT_NUM } from '@/lib/design/tokens'
import { useLocale } from '@/lib/i18n/use-locale'
import { translator } from '@/lib/i18n/t'
import type { CorroborationPanel, SupplierBalancePanel } from '@/lib/supplier-balance-copy'

export default function LeveranciersClient({
  balance,
  corroboration,
  asOf,
  today,
}: {
  /** Null = de lezing is mislukt. Nooit een leeg paneel: zie de zin die dan verschijnt. */
  balance: SupplierBalancePanel | null
  corroboration: CorroborationPanel | null
  asOf: string
  today: string
}) {
  const t = translator(useLocale())
  const router = useRouter()
  const [gekozen, setGekozen] = useState(asOf)

  if (!balance) {
    // [NO-SILENT-EMPTY] Een mislukte lezing is geen nul. "Er staat niets open" is hier het
    // gevaarlijkste zinnetje dat het scherm kan tonen, want daar handelt iemand naar.
    return (
      <main style={{ fontFamily: FONT, padding: 20, maxWidth: 860, margin: '0 auto' }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: M3.onSurface, margin: '0 0 10px' }}>
          {t('leveranciers.titel')}
        </h1>
        <div style={{
          background: '#FCE8E6', border: '1px solid #F5C6C2', borderRadius: R.lg,
          padding: 16, color: '#8C1D18', fontSize: 14.5, lineHeight: 1.6,
        }}>
          {t('leveranciers.nietGelezen')}
        </div>
      </main>
    )
  }

  return (
    <main dir={balance.dir} style={{ fontFamily: FONT, padding: 20, maxWidth: 860, margin: '0 auto' }}>
      <h1 style={{ fontSize: 22, fontWeight: 700, color: M3.onSurface, margin: '0 0 2px' }}>
        {balance.heading}
      </h1>
      <p style={{ fontSize: 13, color: M3.neutral, margin: '0 0 14px' }}>{balance.peildatum}</p>

      {/* De peildatum is een INVOERVELD, net als op het scherm van de groothandel: de stand op
          31 december is een ander getal dan de stand van nu, en alleen de eerste is te archiveren. */}
      <form
        style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 16 }}
        onSubmit={(e) => {
          e.preventDefault()
          router.push(gekozen ? `/dashboard/leveranciers?peildatum=${gekozen}` : '/dashboard/leveranciers')
        }}
      >
        <label htmlFor="peildatum" style={{ fontSize: 13.5, color: M3.neutral }}>
          {t('leveranciers.peildatumLabel')}
        </label>
        <DateFieldNL
          id="peildatum" value={gekozen} onChange={setGekozen} max={today}
          aria-label={t('leveranciers.peildatumLabel')}
          style={{ fontSize: 14 }}
        />
        <button type="submit" style={{
          padding: '8px 16px', borderRadius: R.full, background: M3.primary, color: '#fff',
          border: 'none', fontSize: 14, fontWeight: 600, fontFamily: FONT, cursor: 'pointer',
        }}>
          {t('leveranciers.toon')}
        </button>
      </form>

      {balance.basisWaarschuwing && (
        <p style={{
          background: '#FEF7E0', border: '1px solid #FDE293', borderRadius: R.md,
          padding: 12, fontSize: 13.5, color: '#7C5800', lineHeight: 1.55, margin: '0 0 16px',
        }}>
          {balance.basisWaarschuwing}
        </p>
      )}

      {/* Het totaal, groot. Dit is het getal waar aan de telefoon naar gevraagd wordt. */}
      <div style={{
        background: M3.surfaceVariant, borderRadius: R.lg, padding: 16, marginBottom: 18,
        display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12,
      }}>
        <span style={{ fontSize: 14.5, color: M3.neutral }}>{balance.totaalLabel}</span>
        <strong style={{ fontSize: 26, fontFamily: FONT_NUM, color: M3.onSurface }}>{balance.totaal}</strong>
      </div>

      {balance.leeg && (
        <p style={{ fontSize: 15, color: M3.neutral, lineHeight: 1.6 }}>{balance.leeg}</p>
      )}

      {balance.leveranciers.map((l) => (
        <div key={l.key} style={{
          borderTop: `1px solid ${M3.outlineVariant}`, padding: '13px 2px',
          display: 'flex', justifyContent: 'space-between', gap: 14, alignItems: 'baseline',
        }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 15.5, fontWeight: 600, color: M3.onSurface, wordBreak: 'break-word' }}>
              {l.name}
            </div>
            <div style={{ fontSize: 12.5, color: M3.neutral, marginTop: 2, lineHeight: 1.5 }}>
              {[l.aantal, l.vervallen, l.oudste].filter(Boolean).join(' · ')}
            </div>
            {l.onbevestigd && (
              <div style={{ fontSize: 12, color: '#7C5800', marginTop: 3, lineHeight: 1.5 }}>{l.onbevestigd}</div>
            )}
          </div>
          <strong style={{ fontSize: 16, fontFamily: FONT_NUM, color: M3.onSurface, whiteSpace: 'nowrap' }}>
            {l.bedrag}
          </strong>
        </div>
      ))}

      {balance.ouderdom.length > 0 && (
        <section style={{ marginTop: 24 }}>
          <h2 style={{ fontSize: 15, fontWeight: 600, color: M3.onSurface, margin: '0 0 8px' }}>
            {balance.ouderdomKop}
          </h2>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {balance.ouderdom.map((b) => (
              <div key={b.label} style={{
                background: b.vervallen ? '#FCE8E6' : M3.surfaceVariant,
                borderRadius: R.md, padding: '9px 13px', minWidth: 108,
              }}>
                <div style={{ fontSize: 11.5, color: b.vervallen ? '#8C1D18' : M3.neutral }}>{b.label}</div>
                <div style={{ fontSize: 15, fontFamily: FONT_NUM, color: M3.onSurface, marginTop: 2 }}>
                  {b.bedrag}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {(balance.onbevestigd || balance.zonderLeverancier) && (
        <section style={{ marginTop: 20, fontSize: 13, color: M3.neutral, lineHeight: 1.6 }}>
          {balance.onbevestigd && <p style={{ margin: '0 0 6px' }}>{balance.onbevestigd}</p>}
          {balance.zonderLeverancier && <p style={{ margin: 0 }}>{balance.zonderLeverancier}</p>}
        </section>
      )}

      {/* ── De controle ──────────────────────────────────────────────────────────────────────
          Onder de stand, niet erboven: eerst wat je moet betalen, dan wat we van je afvinkingen
          wel en niet konden nakijken. */}
      {corroboration && (
        <section dir={corroboration.dir} style={{ marginTop: 28 }}>
          <h2 style={{ fontSize: 15, fontWeight: 600, color: M3.onSurface, margin: '0 0 8px' }}>
            {corroboration.heading}
          </h2>
          {corroboration.klopt && (
            <p style={{
              background: '#E6F4EA', border: '1px solid #B7DFC9', borderRadius: R.md,
              padding: 12, fontSize: 13.5, color: '#0B8043', lineHeight: 1.6, margin: 0,
            }}>
              {corroboration.klopt}
            </p>
          )}
          {corroboration.regels.map((regel, i) => (
            <p key={i} style={{
              background: '#FEF7E0', border: '1px solid #FDE293', borderRadius: R.md,
              padding: 12, fontSize: 13.5, color: '#7C5800', lineHeight: 1.6, margin: '0 0 8px',
            }}>
              {regel}
            </p>
          ))}
          <p style={{ fontSize: 12.5, color: M3.neutral, marginTop: 6 }}>
            <Link href="/dashboard/bank" style={{ color: M3.primary }}>{t('leveranciers.naarBank')}</Link>
          </p>
        </section>
      )}
    </main>
  )
}
