'use client'

// src/app/offerte/[token]/OfferteClient.tsx
// [OFFERTE-AKKOORD] Wat de klant ziet: de offerte die hij al heeft, en twee knoppen.
//
// Nederlands, en niet vertaald. Dit is dezelfde soort tekst als de factuur-PDF en de mail die hem
// draagt: hij wordt gelezen door de KLANT van de ondernemer, niet door de ondernemer zelf, en die
// klant is een Nederlandse opdrachtgever. De taalinstelling in de app beschrijft de eigenaar —
// hem toepassen op dit scherm zou een document vertalen voor iemand die nooit een taal koos. Zie
// AGENTS.md.
//
// [PAY-READ-HONEST] Een mislukte lezing zegt "probeer het zo nog eens", nooit "deze link bestaat
// niet". De klant houdt een echte offerte vast; hem wegsturen kost de ondernemer de opdracht.

import { useEffect, useState } from 'react'

interface QuoteLine {
  description: string
  quantity: number | null
  unit: string | null
  lineTotal: number
}

interface QuoteView {
  quoteNumber: string | null
  quoteDate: string | null
  validUntil: string | null
  clientName: string | null
  senderName: string
  totalIncBtw: number
  lines: QuoteLine[]
  answer: 'accepted' | 'declined' | null
  answeredAt: string | null
  answeredBy: string | null
  open: boolean
  expired: boolean
}

const eur = new Intl.NumberFormat('nl-NL', { style: 'currency', currency: 'EUR' })
const dateNL = (iso: string | null) =>
  iso ? new Date(iso.slice(0, 10) + 'T00:00:00').toLocaleDateString('nl-NL', { day: '2-digit', month: 'long', year: 'numeric' }) : null

export default function OfferteClient({ token }: { token: string }) {
  const [view, setView] = useState<QuoteView | null>(null)
  const [laadFout, setLaadFout] = useState<string | null>(null)
  const [bezig, setBezig] = useState(true)
  const [naam, setNaam] = useState('')
  const [versturen, setVersturen] = useState<'accepted' | 'declined' | null>(null)
  const [antwoordFout, setAntwoordFout] = useState<string | null>(null)

  useEffect(() => {
    let afgebroken = false
    ;(async () => {
      try {
        const res = await fetch(`/api/offerte/${token}`)
        const data = await res.json().catch(() => ({}))
        if (afgebroken) return
        if (!res.ok) {
          setLaadFout(data?.error || 'Onbekende offertelink')
        } else {
          setView(data as QuoteView)
        }
      } catch {
        if (!afgebroken) setLaadFout('We kunnen deze offerte nu even niet laden. Probeer het over een minuut opnieuw — je link blijft geldig.')
      } finally {
        if (!afgebroken) setBezig(false)
      }
    })()
    return () => { afgebroken = true }
  }, [token])

  async function antwoord(keuze: 'accepted' | 'declined') {
    setVersturen(keuze)
    setAntwoordFout(null)
    try {
      const res = await fetch(`/api/offerte/${token}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ answer: keuze, name: naam.trim() }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setAntwoordFout(data?.error || 'Het versturen lukte niet. Probeer het zo nog eens.')
        setVersturen(null)
        return
      }
      // Wat er is vastgelegd, tonen zonder opnieuw te laden: de klant heeft geantwoord en ziet
      // meteen dát het is aangekomen.
      setView((v) => v ? { ...v, answer: keuze, answeredAt: data?.answeredAt ?? null, answeredBy: naam.trim() || null, open: false } : v)
      setVersturen(null)
    } catch {
      setAntwoordFout('Het versturen lukte niet. Controleer je verbinding en probeer het opnieuw.')
      setVersturen(null)
    }
  }

  if (bezig) {
    return <Schil><p style={{ color: '#5f6368' }}>Even geduld…</p></Schil>
  }
  if (laadFout || !view) {
    return <Schil><p style={{ color: '#B3261E', lineHeight: 1.6 }}>{laadFout ?? 'Onbekende offertelink'}</p></Schil>
  }

  return (
    <Schil>
      <header style={{ marginBottom: 24 }}>
        <p style={{ fontSize: 13, color: '#5f6368', margin: 0 }}>Offerte van</p>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: '#202124', margin: '2px 0 0' }}>{view.senderName || 'Onbekend'}</h1>
      </header>

      <dl style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '6px 16px', fontSize: 14, margin: '0 0 20px' }}>
        {view.quoteNumber && (<><dt style={{ color: '#5f6368' }}>Offertenummer</dt><dd style={{ margin: 0, color: '#202124' }}>{view.quoteNumber}</dd></>)}
        {view.quoteDate && (<><dt style={{ color: '#5f6368' }}>Datum</dt><dd style={{ margin: 0, color: '#202124' }}>{dateNL(view.quoteDate)}</dd></>)}
        {view.validUntil && (<><dt style={{ color: '#5f6368' }}>Geldig tot</dt><dd style={{ margin: 0, color: view.expired ? '#B3261E' : '#202124' }}>{dateNL(view.validUntil)}</dd></>)}
        {view.clientName && (<><dt style={{ color: '#5f6368' }}>Voor</dt><dd style={{ margin: 0, color: '#202124' }}>{view.clientName}</dd></>)}
      </dl>

      {/* De geldigheidsdatum is voorbij. Dat wordt gezegd, en het blokkeert niets: alsnog akkoord
          gaan is goed nieuws, en de ondernemer beslist zelf of hij het aanneemt. */}
      {view.expired && view.open && (
        <p style={{ background: '#FEF7E0', color: '#7C5800', borderRadius: 10, padding: '10px 12px', fontSize: 13.5, lineHeight: 1.5, margin: '0 0 20px' }}>
          De geldigheidsdatum van deze offerte is verstreken. Je kunt nog steeds laten weten wat je
          ervan vindt — {view.senderName || 'de afzender'} neemt dan contact met je op.
        </p>
      )}

      <div style={{ borderTop: '1px solid #e8eaed', paddingTop: 12, marginBottom: 12 }}>
        {view.lines.map((l, i) => (
          <div key={i} style={{ display: 'flex', gap: 12, padding: '8px 0', borderBottom: '1px solid #f1f3f4', fontSize: 14 }}>
            <span style={{ color: '#5f6368', minWidth: 56 }}>
              {l.quantity !== null ? l.quantity : ''}{l.unit ? ` ${l.unit}` : ''}
            </span>
            <span style={{ flex: 1, color: '#202124' }}>{l.description}</span>
            <span style={{ color: '#202124', fontVariantNumeric: 'tabular-nums' }}>{eur.format(l.lineTotal)}</span>
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 17, fontWeight: 700, color: '#202124', padding: '4px 0 24px' }}>
        <span>Totaal incl. btw</span>
        <span style={{ fontVariantNumeric: 'tabular-nums' }}>{eur.format(view.totalIncBtw)}</span>
      </div>

      {view.answer ? (
        <div style={{
          background: view.answer === 'accepted' ? '#E6F4EA' : '#F1F3F4',
          color: view.answer === 'accepted' ? '#137333' : '#3c4043',
          borderRadius: 12, padding: '14px 16px', fontSize: 14.5, lineHeight: 1.6,
        }}>
          <strong>{view.answer === 'accepted' ? 'Je bent akkoord gegaan.' : 'Je hebt laten weten niet akkoord te gaan.'}</strong>
          <br />
          {view.answeredBy ? `Doorgegeven door ${view.answeredBy}` : 'Doorgegeven'}
          {view.answeredAt ? ` op ${dateNL(view.answeredAt)}` : ''}.
          {' '}Wil je hier iets aan veranderen? Neem dan contact op met {view.senderName || 'de afzender'}.
        </div>
      ) : (
        <>
          <label htmlFor="offerte-naam" style={{ display: 'block', fontSize: 13.5, color: '#5f6368', marginBottom: 6 }}>
            Je naam (optioneel)
          </label>
          <input
            id="offerte-naam"
            type="text"
            value={naam}
            onChange={(e) => setNaam(e.target.value)}
            placeholder="Bijvoorbeeld: Jan de Vries"
            maxLength={120}
            style={{ width: '100%', minHeight: 46, border: '1px solid #dadce0', borderRadius: 10, padding: '0 12px', fontSize: 16, boxSizing: 'border-box', marginBottom: 16, fontFamily: 'inherit' }}
          />
          {antwoordFout && (
            <p role="alert" style={{ color: '#B3261E', fontSize: 13.5, lineHeight: 1.5, margin: '0 0 12px' }}>{antwoordFout}</p>
          )}
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <button
              onClick={() => antwoord('accepted')}
              disabled={versturen !== null}
              style={{ flex: '1 1 180px', minHeight: 48, borderRadius: 10, border: 'none', background: '#137333', color: 'white', fontSize: 15.5, fontWeight: 600, cursor: versturen ? 'default' : 'pointer', opacity: versturen ? 0.6 : 1 }}
            >
              {versturen === 'accepted' ? 'Bezig…' : 'Akkoord'}
            </button>
            <button
              onClick={() => antwoord('declined')}
              disabled={versturen !== null}
              style={{ flex: '1 1 180px', minHeight: 48, borderRadius: 10, border: '1px solid #dadce0', background: 'white', color: '#3c4043', fontSize: 15.5, fontWeight: 600, cursor: versturen ? 'default' : 'pointer', opacity: versturen ? 0.6 : 1 }}
            >
              {versturen === 'declined' ? 'Bezig…' : 'Niet akkoord'}
            </button>
          </div>
          {/* Eerlijk over wat er gebeurt. Er wordt niets afgeschreven en er komt geen factuur uit
              deze knop: de ondernemer factureert zelf, later, als het zover is. */}
          <p style={{ fontSize: 12.5, color: '#5f6368', lineHeight: 1.55, margin: '14px 0 0' }}>
            Je antwoord gaat rechtstreeks naar {view.senderName || 'de afzender'}. Er wordt niets
            betaald en er wordt geen factuur gemaakt — die stuurt {view.senderName || 'de afzender'}
            je apart, als jullie het eens zijn.
          </p>
        </>
      )}
    </Schil>
  )
}

function Schil({ children }: { children: React.ReactNode }) {
  return (
    <main style={{
      minHeight: '100vh', background: '#f8f9fa', padding: '32px 16px',
      fontFamily: 'Roboto, system-ui, -apple-system, sans-serif',
    }}>
      <div style={{ maxWidth: 560, margin: '0 auto', background: 'white', borderRadius: 16, padding: 24, boxShadow: '0 1px 4px rgba(0,0,0,0.08)' }}>
        {children}
      </div>
      <p style={{ maxWidth: 560, margin: '16px auto 0', textAlign: 'center', fontSize: 12, color: '#80868b' }}>
        Verstuurd met BoekBrug
      </p>
    </main>
  )
}
