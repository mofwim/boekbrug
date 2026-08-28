'use client'

// src/modules/accountant/pages/VoorbeeldDossier.tsx
// [PROEFDOSSIER] Het voorbeelddossier — wat een boekhouder ziet vóór zijn eerste klant.
//
// Eén scherm, één doel: laten zien wat "een kloppend klantdossier" IS voordat er een klant is.
// De cijfers komen uit voorbeeld-dossier.ts (puur, afgeleid, getest) en raken geen database. De
// eerlijkheidsclaim van het product staat hier niet als zin maar als rekensom in beeld: de
// factuur met een open vraag telt nergens in mee, en het scherm zegt dat erbij.
//
// Fictief, en onmiskenbaar fictief: de banner bovenaan, de klantnaam zelf, en geen enkele knop
// die iets zou kunnen opslaan. De enige uitgang is "nodig je eerste klant uit".

import Link from 'next/link'
import { M3, R, EL1 } from '@/lib/design/tokens'
import { formatEuroNL } from '@/lib/format-nl'
import { translator } from '@/lib/i18n/t'
import { useLocale } from '@/lib/i18n/use-locale'
import {
  VOORBEELD_KLANT,
  VOORBEELD_KWARTAAL,
  VOORBEELD_VERKOOP,
  VOORBEELD_INKOOP,
  inclVan,
  dossierTotalen,
} from '@/lib/voorbeeld-dossier'

const kaart: React.CSSProperties = { backgroundColor: M3.surface, borderRadius: R.lg, boxShadow: EL1, overflow: 'hidden' }
const kopStijl: React.CSSProperties = { padding: '12px 16px', borderBottom: '1px solid #E0E0E0' }
const kopTekst: React.CSSProperties = { fontSize: 14, fontWeight: 600, color: '#202124', margin: 0 }

function StatusChip({ tekst, kleur, achtergrond }: { tekst: string; kleur: string; achtergrond: string }) {
  return (
    <span style={{ fontSize: 12, fontWeight: 600, color: kleur, backgroundColor: achtergrond, borderRadius: 9999, padding: '3px 10px', whiteSpace: 'nowrap' }}>
      {tekst}
    </span>
  )
}

export default function VoorbeeldDossier() {
  const locale = useLocale()
  const t = translator(locale)
  const totalen = dossierTotalen()

  return (
    <main style={{ maxWidth: 720, margin: '0 auto', padding: '16px 16px 96px', display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* ── Fictief, en onmiskenbaar fictief ── */}
      <div style={{ backgroundColor: '#FEF7E0', border: '1px solid #F9DEA0', borderRadius: R.lg, padding: '12px 16px' }}>
        <p style={{ fontSize: 13.5, fontWeight: 700, color: '#7A5C00', margin: 0 }}>{t('bh.demo.banner.titel')}</p>
        <p style={{ fontSize: 13, color: '#7A5C00', margin: '4px 0 0', lineHeight: 1.55 }}>{t('bh.demo.banner.uitleg')}</p>
      </div>

      {/* ── De klantkop: wat elke rij in je klantenlijst wordt ── */}
      <div style={{ ...kaart, padding: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <h1 style={{ fontSize: 17, fontWeight: 700, color: '#202124', margin: 0 }}>{VOORBEELD_KLANT}</h1>
          <StatusChip tekst={VOORBEELD_KWARTAAL} kleur="#1967D2" achtergrond="#E8F0FE" />
        </div>
        <p style={{ fontSize: 13, color: '#5F6368', margin: '6px 0 0' }}>
          {t('bh.demo.gereedheid', {
            verwerkt: totalen.verwerkteInkoop,
            totaal: VOORBEELD_INKOOP.length,
            vragen: totalen.openVragen,
          })}
        </p>
      </div>

      {/* ── De drie tegels — afgeleid uit de regels hieronder, nooit los ingetikt ── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
        {[
          { label: t('bh.demo.tegel.omzet'), waarde: totalen.omzetEx },
          { label: t('bh.demo.tegel.kosten'), waarde: totalen.kostenEx },
          { label: t('bh.demo.tegel.saldo'), waarde: totalen.saldo },
        ].map((tegel) => (
          <div key={tegel.label} style={{ ...kaart, padding: '14px 16px' }}>
            <p style={{ fontSize: 12, color: '#5F6368', margin: 0 }}>{tegel.label}</p>
            <p style={{ fontSize: 18, fontWeight: 700, color: '#202124', margin: '4px 0 0', fontVariantNumeric: 'tabular-nums' }}>
              {formatEuroNL(tegel.waarde)}
            </p>
          </div>
        ))}
      </div>

      {/* ── Verkoop ── */}
      <div style={kaart}>
        <div style={kopStijl}><h2 style={kopTekst}>{t('bh.demo.verkoop.kop')}</h2></div>
        {VOORBEELD_VERKOOP.map((r) => (
          <div key={r.nummer} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 16px', borderBottom: '1px solid #F1F3F4' }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <p style={{ fontSize: 13.5, color: '#202124', margin: 0, fontWeight: 500 }}>{r.klant}</p>
              <p style={{ fontSize: 12, color: '#5F6368', margin: '2px 0 0' }}>
                {/* [TAAL] dir="ltr": een factuurnummer leest links-naar-rechts, ook in het Arabisch. */}
                <span dir="ltr">{r.nummer}</span> · {r.btwTarief}% btw
              </p>
            </div>
            <p style={{ fontSize: 13.5, color: '#202124', margin: 0, fontVariantNumeric: 'tabular-nums' }}>{formatEuroNL(inclVan(r.exBtw, r.btwTarief))}</p>
            {r.status === 'paid'
              ? <StatusChip tekst={t('status.paid')} kleur="#188038" achtergrond="#E6F4EA" />
              : <StatusChip tekst={t('status.sent')} kleur="#1967D2" achtergrond="#E8F0FE" />}
          </div>
        ))}
      </div>

      {/* ── Inkoop — met de rij waar het product om draait ── */}
      <div style={kaart}>
        <div style={kopStijl}><h2 style={kopTekst}>{t('bh.demo.inkoop.kop')}</h2></div>
        {VOORBEELD_INKOOP.map((r) => (
          <div key={r.leverancier} style={{ padding: '10px 16px', borderBottom: '1px solid #F1F3F4', backgroundColor: r.status === 'vraag' ? '#FEF7E0' : undefined }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <p style={{ fontSize: 13.5, color: '#202124', margin: 0, fontWeight: 500 }}>{r.leverancier}</p>
                <p style={{ fontSize: 12, color: '#5F6368', margin: '2px 0 0' }}>{r.btwTarief}% btw</p>
              </div>
              <p style={{ fontSize: 13.5, color: '#202124', margin: 0, fontVariantNumeric: 'tabular-nums' }}>{formatEuroNL(inclVan(r.exBtw, r.btwTarief))}</p>
              {r.status === 'verwerkt'
                ? <StatusChip tekst={t('bh.demo.chip.verwerkt')} kleur="#188038" achtergrond="#E6F4EA" />
                : <StatusChip tekst={t('bh.demo.chip.vraag')} kleur="#B26A00" achtergrond="#FDE293" />}
            </div>
            {r.status === 'vraag' && r.vraag && (
              <div style={{ marginTop: 8, paddingInlineStart: 12, borderInlineStart: '3px solid #F9AB00' }}>
                {/* [TAAL-DB] De vraag zelf staat in het dossier zoals hij naar een echte klant zou
                    gaan — Nederlands, want dat is de taal van de administratie. */}
                <p style={{ fontSize: 13, color: '#5C4400', margin: 0, lineHeight: 1.5 }}>{r.vraag}</p>
                <p style={{ fontSize: 12.5, color: '#7A5C00', margin: '4px 0 0', fontWeight: 600 }}>{t('bh.demo.vraag.teltNietMee')}</p>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* ── Waarom dit dossier te vertrouwen is — de rekensom zegt het, dit legt hem uit ── */}
      <div style={{ ...kaart, padding: 16 }}>
        <h2 style={{ ...kopTekst, marginBottom: 6 }}>{t('bh.demo.eerlijk.kop')}</h2>
        <p style={{ fontSize: 13.5, color: '#3C4043', margin: 0, lineHeight: 1.6 }}>{t('bh.demo.eerlijk.tekst')}</p>
        <p style={{ fontSize: 13.5, color: '#3C4043', margin: '10px 0 0', lineHeight: 1.6 }}>{t('bh.demo.pakket.tekst')}</p>
      </div>

      {/* ── De enige uitgang — een Link, geen router: dit is navigatie, geen handeling, en zo
          rendert het scherm ook in de render-poort (react-dom/server kent geen app-router). */}
      <Link
        href="/dashboard/clients/beheer"
        style={{ backgroundColor: '#1A73E8', color: '#fff', borderRadius: 9999, padding: '14px 24px', fontSize: 15, fontWeight: 600, textAlign: 'center', textDecoration: 'none', display: 'block' }}
      >
        {t('bh.demo.cta')}
      </Link>
    </main>
  )
}
