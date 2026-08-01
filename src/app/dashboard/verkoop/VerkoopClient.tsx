'use client'

// [NAMENS] Het werkbord zelf. Alle regels (stand, openstaand, mag-ik-herinneren) komen uit
// src/lib/verkoop-overzicht.ts en zijn daar getest; dit bestand toont ze alleen.
//
// DE KLOK KOMT VAN DE SERVER, ALS PROP.
// `standVan` en `magHerinneren` hebben `nowMs` nodig. Date.now() aanroepen tijdens het renderen
// is in deze codebase een lint-fout met reden (react-hooks/purity): dezelfde render zou twee
// uitkomsten kunnen geven. Hem in een effect zetten mag ook niet (set-state-in-effect), en zou
// bovendien een flits opleveren waarin nog geen enkele factuur een stand heeft.
//
// De pagina is force-dynamic, dus de server rendert hem bij elk bezoek en weet dus hoe laat het
// is. Eén getal erbij, en zowel de server- als de client-render komen op dezelfde uitkomst uit —
// geen hydratieverschil, geen flits, geen onzuivere render.

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { FONT, M3, R } from '@/lib/design/tokens'
import {
  standVan, openstaandBedrag, telOp, magHerinneren,
  type VerkoopFactuur, type FactuurStand,
} from '@/lib/verkoop-overzicht'

const EURO = new Intl.NumberFormat('nl-NL', { style: 'currency', currency: 'EUR' })
const DATUM = (s: string | null) => {
  const ms = s ? Date.parse(s) : NaN
  return Number.isFinite(ms) ? new Date(ms).toLocaleDateString('nl-NL', { day: 'numeric', month: 'short' }) : '—'
}

const KLEUR: Record<FactuurStand, string> = {
  concept: M3.warning,
  open: M3.neutral,
  'te-laat': M3.error,
  betaald: M3.success,
  vervallen: M3.mutedText,
}
const LABEL: Record<FactuurStand, string> = {
  concept: 'concept',
  open: 'open',
  'te-laat': 'te laat',
  betaald: 'betaald',
  vervallen: 'vervallen',
}

export default function VerkoopClient({
  facturen,
  bedrijf,
  nu,
}: {
  facturen: VerkoopFactuur[]
  bedrijf: string
  /** Servertijd in ms — zie de kop waarom hij niet hier wordt opgehaald. */
  nu: number
}) {
  const router = useRouter()
  const [bezig, setBezig] = useState<string | null>(null)
  const [melding, setMelding] = useState<{ tekst: string; goed: boolean } | null>(null)

  async function herinner(id: string) {
    setBezig(id); setMelding(null)
    try {
      const res = await fetch(`/api/invoice/${id}/reminder`, { method: 'POST' })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        setMelding({ tekst: json?.error || 'Herinneren lukte niet', goed: false })
        return
      }
      setMelding({ tekst: 'Herinnering verstuurd ✓', goed: true })
      router.refresh()
    } catch {
      setMelding({ tekst: 'Herinneren lukte niet — controleer je verbinding', goed: false })
    } finally {
      setBezig(null)
    }
  }

  const t = telOp(facturen, nu)
  const kaart: React.CSSProperties = {
    background: M3.surface, border: `1px solid ${M3.hairline}`, borderRadius: R.lg,
  }

  return (
    <div style={{ minHeight: '100vh', background: M3.bg, fontFamily: FONT }}>
      <div style={{ maxWidth: 900, margin: '0 auto', padding: '24px 16px 48px' }}>

        <h1 style={{ fontSize: 22, fontWeight: 700, color: M3.onSurface, margin: '0 0 6px' }}>
          Facturen maken
        </h1>

        {/* [NAMENS] De belangrijkste zin op dit scherm. Iemand die facturen uitgeeft onder het
            BTW-nummer van een ander hoort dat te WETEN, en niet te moeten afleiden. */}
        <p style={{ fontSize: 14.5, color: M3.neutral, margin: '0 0 18px', lineHeight: 1.55 }}>
          Je maakt facturen namens <strong style={{ color: M3.onSurface }}>{bedrijf}</strong>. Ze gaan uit
          op hun naam en BTW-nummer, met hun doorlopende factuurnummers. Hieronder staat alleen wat
          jij zelf hebt gemaakt.
        </p>

        {/* Wat er nog binnen moet komen — het getal waar dit werk over gaat. */}
        <div style={{ ...kaart, padding: 18, marginBottom: 16, display: 'flex', gap: 24, flexWrap: 'wrap' }}>
            <div>
              <div style={{ fontSize: 12, fontWeight: 700, color: M3.mutedText, textTransform: 'uppercase', letterSpacing: 0.4 }}>
                Staat open
              </div>
              <div style={{ fontSize: 24, fontWeight: 700, color: M3.onSurface, marginTop: 2 }}>
                {EURO.format(t.openstaand)}
              </div>
              <div style={{ fontSize: 12.5, color: M3.mutedText }}>{t.open + t.teLaat} facturen</div>
            </div>
            {t.teLaat > 0 && (
              <div>
                <div style={{ fontSize: 12, fontWeight: 700, color: M3.error, textTransform: 'uppercase', letterSpacing: 0.4 }}>
                  Te laat
                </div>
                <div style={{ fontSize: 24, fontWeight: 700, color: M3.error, marginTop: 2 }}>
                  {EURO.format(t.teLaatBedrag)}
                </div>
                <div style={{ fontSize: 12.5, color: M3.mutedText }}>
                  {t.teLaat} {t.teLaat === 1 ? 'factuur' : 'facturen'} — hier kun je vandaag iets aan doen
                </div>
              </div>
            )}
            {t.concepten > 0 && (
              <div>
                <div style={{ fontSize: 12, fontWeight: 700, color: M3.warning, textTransform: 'uppercase', letterSpacing: 0.4 }}>
                  Concept
                </div>
                <div style={{ fontSize: 24, fontWeight: 700, color: M3.warning, marginTop: 2 }}>{t.concepten}</div>
                <div style={{ fontSize: 12.5, color: M3.mutedText }}>nog niet verstuurd</div>
              </div>
            )}
        </div>

        <Link
          href="/dashboard/invoice/new"
          style={{
            display: 'inline-block', background: M3.primary, color: M3.onPrimary,
            padding: '12px 22px', borderRadius: 999, textDecoration: 'none',
            fontWeight: 600, fontSize: 15,
          }}
        >
          Nieuwe factuur →
        </Link>

        {melding && (
          <p style={{
            fontSize: 14, marginTop: 14, marginBottom: 0, padding: '10px 12px', borderRadius: R.sm, lineHeight: 1.5,
            color: melding.goed ? M3.success : M3.error,
            background: melding.goed ? M3.successContainer : M3.errorContainer,
          }}>
            {melding.tekst}
          </p>
        )}

        <div style={{ marginTop: 24 }}>
          <h2 style={{ fontSize: 16, fontWeight: 700, color: M3.onSurface, margin: '0 0 10px' }}>
            Jouw facturen
          </h2>

          {facturen.length === 0 ? (
            <div style={{ ...kaart, padding: '28px 20px', textAlign: 'center', color: M3.neutral, fontSize: 14.5 }}>
              Je hebt nog geen facturen gemaakt. Begin met de knop hierboven.
            </div>
          ) : (
            <div style={{ ...kaart, overflow: 'hidden' }}>
              {facturen.map((f, i) => {
                const stand = standVan(f, nu)
                const rest = openstaandBedrag(f)
                const oordeel = magHerinneren(f, nu)
                return (
                  <div
                    key={f.id}
                    style={{
                      padding: '14px 16px',
                      borderTop: i === 0 ? 'none' : `1px solid ${M3.outlineVariant}`,
                    }}
                  >
                    <div style={{ display: 'flex', gap: 12, alignItems: 'center', justifyContent: 'space-between' }}>
                      <Link
                        href={`/dashboard/invoice/${f.id}`}
                        style={{ minWidth: 0, textDecoration: 'none', color: 'inherit', flex: 1 }}
                      >
                        <div style={{ fontSize: 14.5, fontWeight: 600, color: M3.onSurface, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {f.client_name || 'Zonder klant'}
                        </div>
                        <div style={{ fontSize: 12.5, color: M3.mutedText, marginTop: 2 }}>
                          {/* Een concept heeft nog GEEN nummer, en dat is geen ontbrekend gegeven
                              maar de waarheid: het nummer valt pas bij versturen (Art. 35). */}
                          {f.invoice_number ?? 'concept — nog geen nummer'}
                          {f.due_date ? ` · vervalt ${DATUM(f.due_date)}` : ''}
                        </div>
                      </Link>
                      <div style={{ textAlign: 'right', flexShrink: 0 }}>
                        <div style={{ fontSize: 14.5, fontWeight: 700, color: M3.onSurface }}>
                          {EURO.format(Math.abs(Number(f.total_inc_btw ?? 0)))}
                        </div>
                        <div style={{ fontSize: 11.5, fontWeight: 700, marginTop: 3, color: KLEUR[stand] }}>
                          {LABEL[stand]}
                          {stand === 'te-laat' && rest > 0 && rest !== Math.abs(Number(f.total_inc_btw ?? 0))
                            ? ` · nog ${EURO.format(rest)}`
                            : ''}
                        </div>
                      </div>
                    </div>

                    {/* De knop staat er ALLEEN als hij ook echt iets doet. Een grijze knop met een
                        tooltip is een belofte die niet wordt ingelost; een zin die zegt waarom het
                        niet kan, helpt wel. */}
                    {stand === 'te-laat' && (
                      <div style={{ marginTop: 10 }}>
                        {oordeel.mag ? (
                          <button
                            onClick={() => herinner(f.id)}
                            disabled={bezig === f.id}
                            style={{
                              background: bezig === f.id ? M3.outline : 'none',
                              border: `1px solid ${M3.primary}`,
                              color: bezig === f.id ? M3.onPrimary : M3.primary,
                              padding: '7px 16px', borderRadius: 999, fontSize: 13, fontWeight: 600,
                              cursor: bezig === f.id ? 'default' : 'pointer', fontFamily: FONT,
                            }}
                          >
                            {bezig === f.id ? 'Bezig…' : 'Herinnering sturen'}
                          </button>
                        ) : (
                          <p style={{ fontSize: 12.5, color: M3.mutedText, margin: 0, lineHeight: 1.5 }}>
                            {oordeel.reden}
                          </p>
                        )}
                        {(f.herinneringen ?? 0) > 0 && (
                          <span style={{ fontSize: 12, color: M3.mutedText, marginLeft: oordeel.mag ? 10 : 0 }}>
                            {f.herinneringen} eerder verstuurd
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* Eerlijk over wat hij NIET ziet. Beter dan dat hij het zelf ontdekt en denkt dat er
            iets stuk is. */}
        <p style={{ fontSize: 12.5, color: M3.mutedText, marginTop: 22, lineHeight: 1.6 }}>
          Je ziet hier bewust niet de bankrekening, de omzet of de facturen van collega&apos;s van {bedrijf}.
          Of een factuur betaald is, zet {bedrijf} of de bankafstemming — jij leest het alleen.
          Klopt er iets niet aan een verstuurde factuur? Maak er een creditnota van; aanpassen kan
          niet meer, want het nummer is dan al uitgegeven.
        </p>
      </div>
    </div>
  )
}
