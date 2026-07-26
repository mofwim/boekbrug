'use client'

// src/app/dashboard/kluis/KluisClient.tsx
// [KLUIS] The compliance-vault overview: one card per fiscal year with the 7-year
// retention clock, honest completeness counts, gap notes, and a one-click export
// bundle (ZIP of that year's documents + a manifest). The door stays open — the
// export always works — so retention is the pull, never a cage.

import { useState } from 'react'
import type { YearSummary } from '@/lib/compliance-vault'
import { M3, FONT, FONT_NUM } from '@/lib/design/tokens'
import BewaarkluisCard from './BewaarkluisCard'

const eur = new Intl.NumberFormat('nl-NL', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 })

export default function KluisClient({
  summaries,
  currentYear,
  purpose = 'boekhouden',
  justPaid = false,
}: {
  summaries: YearSummary[]
  currentYear: number
  /** [KLUIS] Waarvoor het account is aangemaakt. Bepaalt uitsluitend de begroeting. */
  purpose?: 'boekhouden' | 'archief'
  justPaid?: boolean
}) {
  const isArchief = purpose === 'archief'
  return (
    <div style={{ minHeight: '100vh', background: M3.bg, fontFamily: FONT }}>
      <div style={{ maxWidth: 720, margin: '0 auto', padding: '20px 16px 80px' }}>
        {/* [HEADER-SYSTEM] Title "Kluis" + back live in the shared sub-page bar;
            the in-body h1 was removed. Descriptive subtitle stays. */}
        <header style={{ margin: '16px 0 8px' }}>
          {/* [MERGE] main heeft de in-body h1 bewust weggehaald: de titel woont nu in de
              gedeelde sub-paginabalk. Die keuze blijft staan — het onderscheid tussen een
              archiefaccount en een gewone gebruiker verhuist daarom naar de ondertitel, waar
              het net zo goed werkt en het headersysteem niet doorbreekt. */}
          <p style={{ fontSize: 14.5, color: M3.neutral, margin: 0, lineHeight: 1.5 }}>
            {isArchief ? (
              <>
                Je archief, per jaar bij elkaar. De Belastingdienst vraagt je stukken{' '}
                <strong>7 jaar</strong> te bewaren — hier staan ze klaar, doorzoekbaar en met
                één knop per jaar te exporteren.
              </>
            ) : (
              <>
                Je administratie, per jaar bij elkaar. De Belastingdienst vraagt je stukken{' '}
                <strong>7 jaar</strong> te bewaren — hier staan ze klaar, met één knop te
                exporteren voor je boekhouder.
              </>
            )}
          </p>
        </header>

        {justPaid && (
          <div
            role="status"
            style={{ background: '#CEEAD6', border: '1px solid #137333', color: '#0d652d', borderRadius: 12, padding: '14px 16px', marginTop: 14, fontSize: 14.5, lineHeight: 1.55 }}
          >
            <strong>Bedankt — je Bewaarkluis is geregeld.</strong>
            <br />
            Je btw-factuur staat klaar in je e-mail. Je archief blijft staan voor de resterende
            bewaarjaren, en exporteren blijft altijd werken.
          </div>
        )}

        {summaries.length === 0 ? (
          isArchief ? (
            // [KLUIS] Het eerste scherm van iemand die via /bewaarplicht binnenkwam. Hij heeft
            // net een account gemaakt en verder nog niets gedaan; een kale zin "nog geen
            // stukken" zou hem laten zoeken waar hij moet beginnen. Eén duidelijke volgende
            // stap, en geen woord over facturen of btw — daar kwam hij niet voor.
            <div style={{ background: M3.surface, borderRadius: 16, border: `1px solid ${M3.outlineVariant}`, padding: 22, marginTop: 16 }}>
              <h2 style={{ fontSize: 18, fontWeight: 700, color: M3.onSurface, margin: '0 0 8px' }}>
                Welkom. Breng je administratie binnen.
              </h2>
              <p style={{ fontSize: 14.5, color: M3.neutral, margin: '0 0 12px', lineHeight: 1.6 }}>
                Upload je bonnen, facturen en bankafschriften — los of in één keer. Wij zetten ze
                per jaar en per kwartaal op hun plek, doorzoekbaar, en je kunt elk jaar met één
                knop als ZIP exporteren.
              </p>
              <a
                href="/dashboard/upload"
                style={{
                  display: 'inline-block', background: M3.vault, color: '#fff', borderRadius: 999,
                  padding: '11px 20px', textDecoration: 'none', fontSize: 14, fontWeight: 600,
                }}
              >
                Bestanden toevoegen →
              </a>
              <p style={{ fontSize: 13, color: M3.neutral, margin: '14px 0 0', lineHeight: 1.6 }}>
                Alles wat je hier neerzet blijft van jou en is altijd te exporteren. Wij nemen je
                bewaarplicht niet over — wij zijn je tweede exemplaar, nooit je enige. En de rest
                van BoekBrug staat gewoon klaar voor als je hem ooit nodig hebt: er is niets
                afgesloten en niets te ontgrendelen.
              </p>
            </div>
          ) : (
            <div style={{ textAlign: 'center', color: M3.neutral, fontSize: 14.5, padding: '48px 16px', background: M3.surface, borderRadius: 16, border: `1px solid ${M3.outlineVariant}`, marginTop: 16 }}>
              Nog geen stukken in de kluis. Zodra je facturen verstuurt of bankafschriften en bonnen uploadt,
              verschijnen ze hier — netjes per jaar en kwartaal.
            </div>
          )
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14, marginTop: 16 }}>
            {summaries.map((s) => <YearCard key={s.year} s={s} currentYear={currentYear} />)}
          </div>
        )}

        {/* [KLUIS] De Bewaarkluis staat ONDER het archief, nooit erboven: eerst ziet de
            gebruiker zijn eigen stukken, dan pas wat het kost om ze na een opzegging te
            laten staan. Andersom leest het als een dreigement. */}
        <BewaarkluisCard />
      </div>
    </div>
  )
}

function YearCard({ s, currentYear }: { s: YearSummary; currentYear: number }) {
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  async function exportYear() {
    setBusy(true); setErr('')
    try {
      const res = await fetch(`/api/kluis/export?year=${s.year}`)
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        setErr(j.error || 'Export mislukt'); setBusy(false); return
      }
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url; a.download = `boekbrug-administratie-${s.year}.zip`
      document.body.appendChild(a); a.click(); a.remove()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
    } catch {
      setErr('Export mislukt')
    }
    setBusy(false)
  }

  const yearsLeft = s.keepThroughYear - currentYear
  const retentionLabel = s.withinRetention
    ? `Bewaren t/m ${s.keepThroughYear}${yearsLeft > 0 ? ` · nog ${yearsLeft} jaar` : ' · dit jaar afloopt'}`
    : `Bewaarplicht verlopen (sinds ${s.keepThroughYear + 1}) — mag weg`

  return (
    <div style={{ background: M3.surface, borderRadius: 16, border: `1px solid ${M3.outlineVariant}`, padding: 18 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontSize: 22, fontWeight: 700, color: M3.onSurface }}>{s.year}</div>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginTop: 4, fontSize: 12.5, fontWeight: 600, color: s.withinRetention ? M3.vault : M3.neutral, background: s.withinRetention ? '#e0e0e0' : '#F1F3F4', borderRadius: 999, padding: '3px 10px' }}>
            🛡️ {retentionLabel}
          </div>
        </div>
        <button onClick={exportYear} disabled={busy} style={{ background: M3.vault, color: '#fff', border: 'none', borderRadius: 999, padding: '9px 16px', cursor: 'pointer', fontSize: 13, fontWeight: 600, fontFamily: FONT, whiteSpace: 'nowrap' }}>
          {busy ? 'Bezig…' : '⬇︎ Exporteer jaar'}
        </button>
      </div>

      {err && <div style={{ marginTop: 8, fontSize: 12.5, color: M3.error }}>{err}</div>}

      {/* Counts */}
      <div style={{ display: 'flex', gap: 10, marginTop: 14, flexWrap: 'wrap' }}>
        <Stat label="Facturen uit" value={String(s.outgoingCount)} sub={eur.format(s.outgoingTotal)} />
        <Stat label="Facturen in" value={String(s.incomingCount)} />
        <Stat label="Bankafschriften" value={String(s.bankStatements)} />
        <Stat label="Documenten" value={String(s.documentCount)} />
      </div>

      {/* Quarter strip */}
      <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
        {s.quarters.map((q) => (
          <div key={q.quarter} style={{ flex: 1, textAlign: 'center', background: '#F8F9FA', border: `1px solid ${q.missingBankStatement ? '#FCE8B2' : M3.outlineVariant}`, borderRadius: 10, padding: '8px 4px' }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: M3.neutral }}>Q{q.quarter}</div>
            <div style={{ fontSize: 11.5, color: M3.neutral, marginTop: 2 }}>{q.outgoingCount + q.incomingCount} fact.</div>
            <div style={{ fontSize: 11.5, color: q.missingBankStatement ? M3.warning : M3.neutral }}>
              {q.missingBankStatement ? '⚠ geen afschr.' : `${q.bankStatements} afschr.`}
            </div>
          </div>
        ))}
      </div>

      {/* Honest gap notes */}
      {s.gaps.length > 0 && (
        <div style={{ marginTop: 12, fontSize: 12.5, color: M3.warning, background: '#FFF8E6', border: '1px solid #FFE9A8', borderRadius: 10, padding: '10px 12px', lineHeight: 1.5 }}>
          {s.gaps.map((g, i) => <div key={i}>{g}</div>)}
        </div>
      )}
    </div>
  )
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div style={{ flex: 1, minWidth: 120, background: '#F8F9FA', borderRadius: 12, padding: '10px 12px' }}>
      <div style={{ fontSize: 11.5, color: M3.neutral, marginBottom: 2 }}>{label}</div>
      <div style={{ fontFamily: FONT_NUM, fontSize: 18, fontWeight: 700, color: M3.onSurface }}>{value}</div>
      {sub && <div style={{ fontSize: 11.5, color: M3.neutral, marginTop: 1 }}>{sub}</div>}
    </div>
  )
}
