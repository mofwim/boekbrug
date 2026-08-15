'use client'

// [ACTING-FOR] Het werkbord zelf. Alle regels (stand, openstaand, mag-ik-herinneren) komen uit
// src/lib/sales-overview.ts en zijn daar getest; dit bestand toont ze alleen.
//
// DE KLOK KOMT VAN DE SERVER, ALS PROP.
// `stateOf` en `canRemind` hebben `nowMs` nodig. Date.now() aanroepen tijdens het renderen
// is in deze codebase een lint-fout met reden (react-hooks/purity): dezelfde render zou twee
// uitkomsten kunnen geven. Hem in een effect zetten mag ook niet (set-state-in-effect), en zou
// bovendien een flits opleveren waarin nog geen enkele factuur een stand heeft.
//
// De pagina is force-dynamic, dus de server rendert hem bij elk bezoek en weet dus hoe laat het
// is. Eén getal erbij, en zowel de server- als de client-render komen op dezelfde uitkomst uit —
// geen hydratieverschil, geen flits, geen onzuivere render.

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { FONT, M3, R } from '@/lib/design/tokens'
import {
  stateOf, outstandingAmount, summarise, canRemind,
  type SalesInvoice, type InvoiceState,
} from '@/lib/sales-overview'
import { useLocale } from '@/lib/i18n/use-locale'
import { translator } from '@/lib/i18n/t'

const EURO = new Intl.NumberFormat('nl-NL', { style: 'currency', currency: 'EUR' })
const DATUM = (s: string | null) => {
  const ms = s ? Date.parse(s) : NaN
  return Number.isFinite(ms) ? new Date(ms).toLocaleDateString('nl-NL', { day: 'numeric', month: 'short' }) : '—'
}

const KLEUR: Record<InvoiceState, string> = {
  concept: M3.warning,
  open: M3.neutral,
  'te-laat': M3.error,
  betaald: M3.success,
  vervallen: M3.mutedText,
}
const LABEL: Record<InvoiceState, string> = {
  concept: 'concept',
  open: 'open',
  'te-laat': 'te laat',
  betaald: 'betaald',
  vervallen: 'vervallen',
}

/** [CREDITNOTA-NO-CHASE] Een creditnota is het tegendeel van een vordering, geen late factuur. */
const isCreditnota = (f: SalesInvoice) => (f.invoice_type ?? 'factuur') !== 'factuur'

export default function VerkoopClient({
  facturen,
  bedrijf,
  nu,
  gecrediteerd,
}: {
  facturen: SalesInvoice[]
  bedrijf: string
  /** Servertijd in ms — zie de kop waarom hij niet hier wordt opgehaald. */
  nu: number
  /**
   * [DEEL-CREDIT] Per factuur-id: hoeveel er is gecrediteerd, positief. Een gewoon object en geen
   * Map, omdat het de servergrens over moet; hieronder wordt het er één, want dat is wat
   * summarise() vraagt. Afwezig = niets gecrediteerd, en dan is elk bedrag exact wat het was.
   */
  gecrediteerd?: Record<string, number>
}) {
  // [TAAL] `vert`, niet `t`: dit bestand noemt zijn totalen al `t`.
  const vert = translator(useLocale())
  const router = useRouter()
  const [bezig, setBezig] = useState<string | null>(null)
  const [melding, setMelding] = useState<{ tekst: string; goed: boolean } | null>(null)

  async function herinner(id: string) {
    setBezig(id); setMelding(null)
    try {
      const res = await fetch(`/api/invoice/${id}/reminder`, { method: 'POST' })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        setMelding({ tekst: json?.error || vert('vk.herinnerenMislukt'), goed: false })
        return
      }
      setMelding({ tekst: vert('vk.herinneringVerstuurd'), goed: true })
      router.refresh()
    } catch {
      setMelding({ tekst: vert('vk.herinnerenMisluktVerbinding'), goed: false })
    } finally {
      setBezig(null)
    }
  }

  const creditMap = useMemo(() => new Map(Object.entries(gecrediteerd ?? {})), [gecrediteerd])
  const t = summarise(facturen, nu, creditMap)
  const kaart: React.CSSProperties = {
    background: M3.surface, border: `1px solid ${M3.hairline}`, borderRadius: R.lg,
  }

  return (
    <div style={{ minHeight: '100vh', background: M3.bg, fontFamily: FONT }}>
      <div style={{ maxWidth: 900, margin: '0 auto', padding: '24px 16px 48px' }}>

        <h1 style={{ fontSize: 22, fontWeight: 700, color: M3.onSurface, margin: '0 0 6px' }}>
          {vert('vk.maken')}
        </h1>

        {/* [ACTING-FOR] De belangrijkste zin op dit scherm. Iemand die facturen uitgeeft onder het
            BTW-nummer van een ander hoort dat te WETEN, en niet te moeten afleiden. */}
        <p style={{ fontSize: 14.5, color: M3.neutral, margin: '0 0 18px', lineHeight: 1.55 }}>
          {vert('vk.namens')} <strong style={{ color: M3.onSurface }}>{bedrijf}</strong>. Ze gaan uit
          op hun naam en BTW-nummer, met hun doorlopende factuurnummers. Hieronder staat alleen wat
          jij zelf hebt gemaakt.
        </p>

        {/* Wat er nog binnen moet komen — het getal waar dit werk over gaat. */}
        <div style={{ ...kaart, padding: 18, marginBottom: 16, display: 'flex', gap: 24, flexWrap: 'wrap' }}>
            <div>
              <div style={{ fontSize: 12, fontWeight: 700, color: M3.mutedText, textTransform: 'uppercase', letterSpacing: 0.4 }}>
                {vert('vk.staatOpen')}
              </div>
              <div style={{ fontSize: 24, fontWeight: 700, color: M3.onSurface, marginTop: 2 }}>
                {EURO.format(t.outstanding)}
              </div>
              <div style={{ fontSize: 12.5, color: M3.mutedText }}>{t.open + t.overdue} facturen</div>
            </div>
            {t.overdue > 0 && (
              <div>
                <div style={{ fontSize: 12, fontWeight: 700, color: M3.error, textTransform: 'uppercase', letterSpacing: 0.4 }}>
                  {vert('vk.teLaat')}
                </div>
                <div style={{ fontSize: 24, fontWeight: 700, color: M3.error, marginTop: 2 }}>
                  {EURO.format(t.overdueAmount)}
                </div>
                <div style={{ fontSize: 12.5, color: M3.mutedText }}>
                  {t.overdue} {t.overdue === 1 ? 'factuur' : 'facturen'} — hier kun je vandaag iets aan doen
                </div>
              </div>
            )}
            {t.drafts > 0 && (
              <div>
                <div style={{ fontSize: 12, fontWeight: 700, color: M3.warning, textTransform: 'uppercase', letterSpacing: 0.4 }}>
                  {vert('status.draft', undefined)}
                </div>
                <div style={{ fontSize: 24, fontWeight: 700, color: M3.warning, marginTop: 2 }}>{t.drafts}</div>
                <div style={{ fontSize: 12.5, color: M3.mutedText }}>{vert('vkp.nogNietVerstuurd')}</div>
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
          {vert('lijst.nieuw')} →
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
            {vert('vk.jouwFacturen')}
          </h2>

          {facturen.length === 0 ? (
            <div style={{ ...kaart, padding: '28px 20px', textAlign: 'center', color: M3.neutral, fontSize: 14.5 }}>
              {vert('vk.geenFacturen')}
            </div>
          ) : (
            <div style={{ ...kaart, overflow: 'hidden' }}>
              {facturen.map((f, i) => {
                // [CREDITNOTA-NO-CHASE] Een creditnota draagt status 'sent' en een vervaldatum van
                // vandaag, dus stateOf() noemt hem morgen 'te laat'. Hij is niet te laat — er valt
                // niets te innen. Zonder deze regel sprak het scherm zichzelf tegen: een rood
                // "te laat · nog € 50" met eronder de zin dat een creditnota geen vordering is.
                const credit = isCreditnota(f)
                const stand = stateOf(f, nu)
                const rest = outstandingAmount(f, creditMap.get(f.id) ?? 0)
                const oordeel = canRemind(f, nu, creditMap.get(f.id) ?? 0)
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
                          {f.client_name || vert('vk.zonderKlant')}
                        </div>
                        <div style={{ fontSize: 12.5, color: M3.mutedText, marginTop: 2 }}>
                          {/* Een concept heeft nog GEEN nummer, en dat is geen ontbrekend gegeven
                              maar de waarheid: het nummer valt pas bij versturen (Art. 35). */}
                          {f.invoice_number ?? 'concept — nog geen nummer'}
                          {f.due_date ? ` · vervalt ${DATUM(f.due_date)}` : ''}
                        </div>
                      </Link>
                      <div style={{ textAlign: 'end', flexShrink: 0 }}>
                        <div style={{ fontSize: 14.5, fontWeight: 700, color: M3.onSurface }}>
                          {EURO.format(Math.abs(Number(f.total_inc_btw ?? 0)))}
                        </div>
                        <div style={{ fontSize: 11.5, fontWeight: 700, marginTop: 3, color: credit ? M3.mutedText : KLEUR[stand] }}>
                          {credit ? 'creditnota' : LABEL[stand]}
                          {!credit && stand === 'te-laat' && rest > 0 && rest !== Math.abs(Number(f.total_inc_btw ?? 0))
                            ? ` · nog ${EURO.format(rest)}`
                            : ''}
                        </div>
                      </div>
                    </div>

                    {/* De knop staat er ALLEEN als hij ook echt iets doet. Een grijze knop met een
                        tooltip is een belofte die niet wordt ingelost; een zin die zegt waarom het
                        niet kan, helpt wel. */}
                    {!credit && stand === 'te-laat' && (
                      <div style={{ marginTop: 10 }}>
                        {oordeel.allowed ? (
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
                            {bezig === f.id ? vert('lijst.bezig') : vert('vk.herinneringSturen')}
                          </button>
                        ) : (
                          <p style={{ fontSize: 12.5, color: M3.mutedText, margin: 0, lineHeight: 1.5 }}>
                            {oordeel.reason}
                          </p>
                        )}
                        {(f.reminder_count ?? 0) > 0 && (
                          <span style={{ fontSize: 12, color: M3.mutedText, marginInlineStart: oordeel.allowed ? 10 : 0 }}>
                            {f.reminder_count} eerder verstuurd
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
