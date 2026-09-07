// src/app/dashboard/bedrijfsmiddelen/BedrijfsmiddelenPanels.tsx
// [BEDRIJFSMIDDEL] Everything that draws a row of the register — pure, so the render gate can hand
// it real rows. State and network live in BedrijfsmiddelenClient.tsx. A component holds no
// language of its own: every word comes through `t`.

import type { AssetCandidate } from '@/lib/asset-candidates'

export interface AssetView {
  id: string
  description: string
  cost: number
  residual_value: number
  useful_life_years: number
  in_use_from: string
  disposed_on: string | null
  yearly: number
  book_value: number
  invoice_number: string | null
  supplier_name: string | null
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type T = (k: any, p?: Record<string, string | number>) => string

const eur = (n: number) => `€ ${n.toLocaleString('nl-NL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const nlDate = (ymd: string) => { const [y, m, d] = ymd.split('-'); return `${d}-${m}-${y}` }
const CARD: React.CSSProperties = { background: '#fff', border: '1px solid #E0E0E0', borderRadius: 12, padding: '14px 16px' }

export function RegisterList({ assets, t, onDispose, onDelete }: {
  assets: AssetView[]; t: T; onDispose?: (a: AssetView) => void; onDelete?: (a: AssetView) => void
}) {
  if (assets.length === 0) {
    return <p style={{ fontSize: 13.5, color: '#5F6368', margin: 0 }}>{t('bm.leeg')}</p>
  }
  return (
    <div style={{ display: 'grid', gap: 10 }}>
      {assets.map((a) => (
        <div key={a.id} style={{ ...CARD, opacity: a.disposed_on ? 0.7 : 1 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'baseline' }}>
            <div>
              <div style={{ fontSize: 14.5, fontWeight: 600, color: '#202124' }}>{a.description}</div>
              <div style={{ fontSize: 12.5, color: '#5F6368', marginTop: 2 }}>
                {[a.supplier_name, a.invoice_number].filter(Boolean).join(' · ')}
                {a.supplier_name || a.invoice_number ? ' · ' : ''}
                {t('bm.kolom.inGebruik')} {nlDate(a.in_use_from)}
                {a.disposed_on ? ` · ${t('bm.afgevoerd', { datum: nlDate(a.disposed_on) })}` : ''}
              </div>
            </div>
            <div style={{ textAlign: 'end', fontSize: 13, color: '#202124', whiteSpace: 'nowrap' }}>
              <div>{t('bm.kolom.aanschaf')} {eur(a.cost)}</div>
              <div style={{ color: '#5F6368' }}>{t('bm.kolom.perJaar')} {eur(a.yearly)}</div>
              <div style={{ fontWeight: 600 }}>{t('bm.kolom.boekwaarde')} {eur(a.book_value)}</div>
            </div>
          </div>
          {(onDispose || onDelete) && (
            <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
              {onDispose && !a.disposed_on && (
                <button type="button" onClick={() => onDispose(a)} style={BTN_LIGHT}>{t('bm.afvoeren')}</button>
              )}
              {onDelete && <button type="button" onClick={() => onDelete(a)} style={BTN_LIGHT}>{t('bm.verwijderen')}</button>}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

export function CandidateList({ candidates, t, onYes, onNo }: {
  candidates: AssetCandidate[]; t: T; onYes?: (c: AssetCandidate) => void; onNo?: (c: AssetCandidate) => void
}) {
  if (candidates.length === 0) return null
  return (
    <section style={{ ...CARD, background: '#FFF8E1', borderColor: '#FFE082' }}>
      <h2 style={{ fontSize: 14.5, fontWeight: 600, margin: '0 0 4px', color: '#8D6E00' }}>{t('bm.kandidaten.titel')}</h2>
      <p style={{ fontSize: 13, margin: '0 0 10px', color: '#8D6E00', lineHeight: 1.5 }}>{t('bm.kandidaten.uitleg')}</p>
      <div style={{ display: 'grid', gap: 8 }}>
        {candidates.map((c) => (
          <div key={c.invoiceId} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap', fontSize: 13.5, color: '#202124' }}>
            <span>
              <strong>{c.supplierName}</strong>{c.invoiceNumber ? ` · ${c.invoiceNumber}` : ''}{c.invoiceDate ? ` · ${nlDate(c.invoiceDate)}` : ''} · {eur(c.amount)}
            </span>
            <span style={{ display: 'flex', gap: 6 }}>
              <button type="button" onClick={() => onYes?.(c)} style={BTN_DARK}>{t('bm.kandidaat.ja')}</button>
              <button type="button" onClick={() => onNo?.(c)} style={BTN_LIGHT}>{t('bm.kandidaat.nee')}</button>
            </span>
          </div>
        ))}
      </div>
    </section>
  )
}

export const BTN_DARK: React.CSSProperties = { padding: '7px 12px', borderRadius: 8, border: 'none', background: '#1A73E8', color: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }
export const BTN_LIGHT: React.CSSProperties = { padding: '7px 12px', borderRadius: 8, border: '1px solid #E0E0E0', background: '#fff', color: '#202124', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }
