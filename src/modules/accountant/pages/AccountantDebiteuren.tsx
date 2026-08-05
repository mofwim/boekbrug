'use client'

// src/modules/accountant/pages/AccountantDebiteuren.tsx
// [DEBITEUREN] Waar staat het geld van mijn klanten — het scherm.
//
// WAT DIT SCHERM PROBEERT TE ZIJN
// De ochtendlijst van een boekhouder. Niet "hier zijn acht administraties", maar "hier staat geld
// stil, bij wie, en hoe lang al". Vandaar de volgorde: oudste schuld bovenaan, niet het grootste
// bedrag. Een factuur van €120 uit januari is een slechter teken dan één van €4.000 van vorige
// week, en dit scherm bestaat om het eerste soort te vinden voordat het oninbaar wordt.
//
// WAAROM ONBRUIKBARE RIJEN BLIJVEN STAAN
// Een rij die vandaag niet gemaild kan worden verdwijnt niet. "Er staan drie facturen open bij
// deze klant en geen ervan kan vandaag herinnerd worden" is iets anders dan "er staat niets open",
// en een bord dat alleen knoppen toont vertelt het eerste als het tweede. De reden staat er dus
// bij, in een zin — nooit een grijze knop zonder uitleg.
//
// EN DE ZIN DIE HIER NIET WEG MAG
// Aan de andere kant van elke knop zit een klant van de ONDERNEMER, geen gebruiker van ons. De
// boekhouder mailt in diens naam en de relatie die eronder lijdt is diens relatie. Daarom staat er
// boven de lijst dat de ondernemer bericht krijgt van elke herinnering die hier uitgaat.

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { M3, R, EL1, COLUMN } from '@/lib/design/tokens'
import { boardTotals, type DebtorGroup, type DebtorRow } from '@/lib/accountant-debtors'
import VraagMachtiging, { type KoppelKlant } from './VraagMachtiging'

/** Eén rij, met het extra veld dat de pagina meegeeft om de grijze knop te kunnen uitleggen. */
export interface SchermRij extends DebtorRow {
  paused: boolean
}

export interface SchermGroep extends Omit<DebtorGroup, 'rows'> {
  rows: SchermRij[]
}

interface Props {
  groepen: SchermGroep[]
  /** Geen enkele klant heeft deze boekhouder gemachtigd — een ander verhaal dan "niets openstaand". */
  geenMandaat?: boolean
  /** [VRAAG-MACHTIGING] De GEKOPPELDE klanten — om te kunnen vragen wat er nog niet is. */
  gekoppeld?: KoppelKlant[]
}

function euro(n: number): string {
  return `€ ${n.toLocaleString('nl-NL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function dagenZin(d: number): string {
  if (d <= 0) return 'vandaag vervallen'
  if (d === 1) return '1 dag te laat'
  if (d < 60) return `${d} dagen te laat`
  const maanden = Math.floor(d / 30)
  return `${maanden} maanden te laat`
}

/** Hoe erger, hoe roder. Alleen als signaal — het getal ernaast is de waarheid. */
function kleurVoor(dagen: number): string {
  if (dagen >= 60) return M3.error
  if (dagen >= 30) return M3.warning
  return M3.onSurfaceVariant
}

export default function AccountantDebiteuren({ groepen, geenMandaat = false, gekoppeld = [] }: Props) {
  const router = useRouter()
  const [bezig, setBezig] = useState<string | null>(null)
  const [klaar, setKlaar] = useState<Record<string, string>>({})
  const [fout, setFout] = useState<Record<string, string>>({})

  const totalen = boardTotals(groepen)

  async function herinner(rij: SchermRij, klantId: string) {
    const id = rij.invoice.id
    setBezig(id)
    setFout((f) => ({ ...f, [id]: '' }))
    try {
      const res = await fetch(`/api/invoice/${id}/reminder`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ namens_klant_id: klantId }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.error || 'De herinnering kon niet worden verstuurd.')
      setKlaar((k) => ({ ...k, [id]: 'Herinnering verstuurd' }))
      // Ververs de server-data: het spoor is veranderd, dus de volgende beurt van deze rij ook.
      router.refresh()
    } catch (e) {
      setFout((f) => ({ ...f, [id]: e instanceof Error ? e.message : 'Er ging iets mis.' }))
    } finally {
      setBezig(null)
    }
  }

  const kaart: React.CSSProperties = {
    background: M3.surface,
    border: `1px solid ${M3.outlineVariant}`,
    borderRadius: R.lg,
    boxShadow: EL1,
  }

  // ── Nog niemand heeft je gemachtigd ────────────────────────────────────────
  if (geenMandaat) {
    return (
      <main style={{ maxWidth: COLUMN.work, margin: '0 auto', padding: 24 }}>
        <h1 style={{ fontSize: 22, fontWeight: 500, color: M3.onSurface, margin: '0 0 12px' }}>
          Openstaande facturen
        </h1>
        <div style={{ ...kaart, padding: 20 }}>
          <p style={{ margin: '0 0 12px', color: M3.onSurface, lineHeight: 1.6 }}>
            Nog geen enkele klant heeft je gemachtigd om namens hem te herinneren.
          </p>
          <p style={{ margin: 0, color: M3.onSurfaceVariant, lineHeight: 1.6, fontSize: 14.5 }}>
            Meekijken in een administratie is iets anders dan mailen naar de klanten van je klant.
            Je klant zet het zelf aan bij <strong>Instellingen → Jouw boekhouder</strong>, met
            dezelfde machtiging waarmee je ook namens hem kunt factureren.
          </p>
          <VraagMachtiging klanten={gekoppeld} kind="facturen" />
        </div>
      </main>
    )
  }

  // ── Alles betaald ──────────────────────────────────────────────────────────
  if (groepen.length === 0) {
    return (
      <main style={{ maxWidth: COLUMN.work, margin: '0 auto', padding: 24 }}>
        <h1 style={{ fontSize: 22, fontWeight: 500, color: M3.onSurface, margin: '0 0 12px' }}>
          Openstaande facturen
        </h1>
        <div style={{ ...kaart, padding: 20 }}>
          <p style={{ margin: 0, color: M3.onSurface, lineHeight: 1.6 }}>
            Niets te laat. Bij geen van je gemachtigde klanten staat een vervallen factuur open.
          </p>
        </div>
      </main>
    )
  }

  return (
    <main style={{ maxWidth: COLUMN.work, margin: '0 auto', padding: 24 }}>
      <h1 style={{ fontSize: 22, fontWeight: 500, color: M3.onSurface, margin: '0 0 4px' }}>
        Openstaande facturen
      </h1>
      <p style={{ margin: '0 0 16px', color: M3.onSurfaceVariant, fontSize: 14.5 }}>
        Oudste schuld bovenaan — niet het grootste bedrag.
      </p>

      {/* ── De ene regel bovenaan ────────────────────────────────────────── */}
      <section style={{ ...kaart, padding: 18, marginBottom: 16 }}>
        <p style={{ margin: 0, fontSize: 26, fontWeight: 500, color: M3.onSurface }}>
          {euro(totalen.outstanding)}
        </p>
        <p style={{ margin: '4px 0 0', fontSize: 14, color: M3.onSurfaceVariant }}>
          te laat · {totalen.invoices} {totalen.invoices === 1 ? 'factuur' : 'facturen'} bij{' '}
          {totalen.clients} {totalen.clients === 1 ? 'klant' : 'klanten'}
        </p>
        <p style={{ margin: '10px 0 0', fontSize: 13.5, color: M3.mutedText, lineHeight: 1.6 }}>
          {totalen.remindable === 0
            ? 'Vandaag kun je er geen enkele herinneren — per factuur staat hieronder waarom.'
            : `${totalen.remindable} ${totalen.remindable === 1 ? 'kan' : 'kunnen'} vandaag een herinnering krijgen.`}{' '}
          De mail gaat uit op naam van je klant, en hij krijgt van elke herinnering bericht.
        </p>
      </section>

      {/* ── Per klant ────────────────────────────────────────────────────── */}
      {groepen.map((groep) => (
        <section key={groep.clientId} style={{ ...kaart, padding: 18, marginBottom: 14 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12 }}>
            <h2 style={{ fontSize: 16, fontWeight: 500, color: M3.onSurface, margin: 0 }}>
              {groep.clientName}
            </h2>
            <span style={{ fontSize: 15, fontWeight: 500, color: M3.onSurface }}>
              {euro(groep.totalOutstanding)}
            </span>
          </div>
          <p style={{ margin: '2px 0 14px', fontSize: 12.5, color: kleurVoor(groep.worstDaysLate) }}>
            oudste: {dagenZin(groep.worstDaysLate)}
          </p>

          {groep.rows.map((rij) => {
            const id = rij.invoice.id
            const isKlaar = Boolean(klaar[id])
            const magNu = rij.verdict.allowed && !isKlaar
            return (
              <div
                key={id}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'flex-start',
                  gap: 12,
                  padding: '12px 0',
                  borderTop: `1px solid ${M3.outlineVariant}`,
                }}
              >
                <div style={{ minWidth: 0 }}>
                  <p style={{ margin: 0, fontSize: 14.5, color: M3.onSurface }}>
                    {rij.invoice.client_name || 'Onbekende afnemer'}
                  </p>
                  <p style={{ margin: '2px 0 0', fontSize: 12.5, color: kleurVoor(rij.daysLate) }}>
                    {rij.invoice.invoice_number || '—'} · {dagenZin(rij.daysLate)}
                    {(rij.invoice.reminder_count ?? 0) > 0 &&
                      ` · ${rij.invoice.reminder_count} ${rij.invoice.reminder_count === 1 ? 'herinnering' : 'herinneringen'} verstuurd`}
                  </p>
                  {/* De reden waarom er geen knop staat. Nooit een grijze knop zonder zin. */}
                  {!rij.verdict.allowed && (
                    <p style={{ margin: '4px 0 0', fontSize: 12.5, color: M3.mutedText, lineHeight: 1.5 }}>
                      {rij.verdict.reason}
                    </p>
                  )}
                  {fout[id] && (
                    <p role="alert" style={{ margin: '4px 0 0', fontSize: 12.5, color: M3.error, lineHeight: 1.5 }}>
                      {fout[id]}
                    </p>
                  )}
                  {isKlaar && (
                    <p style={{ margin: '4px 0 0', fontSize: 12.5, color: M3.success }}>{klaar[id]}</p>
                  )}
                </div>

                <div style={{ textAlign: 'right', flexShrink: 0 }}>
                  <p style={{ margin: 0, fontSize: 14.5, fontWeight: 500, color: M3.onSurface }}>
                    {euro(rij.outstanding)}
                  </p>
                  {magNu && (
                    <button
                      type="button"
                      onClick={() => herinner(rij, groep.clientId)}
                      disabled={bezig === id}
                      style={{
                        marginTop: 6,
                        padding: '6px 12px',
                        background: 'none',
                        border: `1px solid ${M3.primary}`,
                        borderRadius: R.full,
                        color: M3.primary,
                        fontSize: 12.5,
                        cursor: bezig === id ? 'default' : 'pointer',
                        opacity: bezig === id ? 0.5 : 1,
                      }}
                    >
                      {bezig === id ? 'Bezig…' : 'Herinner'}
                    </button>
                  )}
                </div>
              </div>
            )
          })}
        </section>
      ))}

      <p style={{ fontSize: 12.5, color: M3.mutedText, lineHeight: 1.6, margin: '4px 0 0' }}>
        Na drie herinneringen stopt deze knop. Wat daarna komt — een aanmaning of incasso — heeft
        gevolgen die de ondernemer zelf moet willen (art. 6:96 BW), en is dus geen knop hier.
      </p>
    </main>
  )
}
