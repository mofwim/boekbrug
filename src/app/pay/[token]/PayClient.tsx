'use client'

// src/app/pay/[token]/PayClient.tsx
// [BETAALVERZOEK] The customer-facing payment view. Loads the allowlisted data from
// /api/pay/[token], renders a "Scan om te betalen" EPC/SEPA QR (from the owner's OWN
// IBAN) and the copy-able IBAN/amount/reference. HONEST by design: it states clearly
// that BoekBrug does not process the payment — the customer pays from their own bank.
// No money moves through us.

import { useEffect, useState } from 'react'
// [SERVER-ZIN] Een machinecode is geen zin — ook niet voor de betalende klant van de klant.
import { failureText } from '@/lib/server-message'

interface PayItem {
  invoiceNumber: string | null
  amount: number
  alreadyPaid: boolean
  dueDate: string | null
}

interface PayView {
  invoiceNumber: string | null
  clientName: string | null
  beneficiaryName: string
  iban: string
  amount: number
  reference: string
  status: string | null
  dueDate: string | null
  epcPayload: string
  alreadyPaid: boolean
  // [MOLLIE] De eigenaar koppelde zijn eigen Mollie-account — dan mag hier een iDEAL-knop staan.
  idealAvailable?: boolean
  // [BUNDEL-BETAALVERZOEK] present when the link covers several invoices —
  // one line per factuur, one sum, one QR.
  items?: PayItem[]
}

const eur = new Intl.NumberFormat('nl-NL', { style: 'currency', currency: 'EUR' })
const fmtIban = (s: string) => s.replace(/(.{4})/g, '$1 ').trim()
const dateNL = (iso: string | null) =>
  iso ? new Date(iso + 'T00:00:00').toLocaleDateString('nl-NL', { day: '2-digit', month: 'long', year: 'numeric' }) : null

export default function PayClient({ token }: { token: string }) {
  const [view, setView] = useState<PayView | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [qr, setQr] = useState('')
  const [copied, setCopied] = useState('')
  // [MOLLIE] De klant komt terug van iDEAL vóórdat de webhook verwerkt kan zijn — dan is
  // "betaal nu" tonen verwarrend. De ?ideal=terug-hint overbrugt die seconden eerlijk.
  const [idealBusy, setIdealBusy] = useState(false)
  const [idealError, setIdealError] = useState('')
  const [terugVanIdeal, setTerugVanIdeal] = useState(false)

  useEffect(() => {
    try {
      setTerugVanIdeal(new URLSearchParams(window.location.search).get('ideal') === 'terug')
    } catch { /* zonder window geen hint — de pagina blijft gewoon werken */ }
  }, [])

  async function startIdeal() {
    if (idealBusy) return
    setIdealBusy(true)
    setIdealError('')
    try {
      const res = await fetch(`/api/pay/${token}/ideal`, { method: 'POST' })
      const json = await res.json().catch(() => ({}))
      if (!res.ok || !json?.url) {
        setIdealError(failureText(res.status, json, 'Online betalen is nu niet beschikbaar. Gebruik de overschrijfgegevens hieronder.'))
        setIdealBusy(false)
        return
      }
      window.location.href = json.url
    } catch {
      setIdealError('Online betalen is nu niet beschikbaar. Gebruik de overschrijfgegevens hieronder.')
      setIdealBusy(false)
    }
  }

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch(`/api/pay/${token}`)
        if (!res.ok) {
          if (!cancelled) { setError('Deze betaallink is niet (meer) geldig.'); setLoading(false) }
          return
        }
        const data: PayView = await res.json()
        if (cancelled) return
        setView(data)
        setLoading(false)
        try {
          const QR = await import('qrcode')
          const url = await QR.toDataURL(data.epcPayload, { margin: 1, width: 240 })
          if (!cancelled) setQr(url)
        } catch { /* QR is a convenience; the manual details below always work */ }
      } catch {
        if (!cancelled) { setError('Kon de betaalgegevens niet laden.'); setLoading(false) }
      }
    })()
    return () => { cancelled = true }
  }, [token])

  async function copy(value: string, label: string) {
    try { await navigator.clipboard.writeText(value) } catch { /* clipboard may be blocked */ }
    setCopied(label)
    setTimeout(() => setCopied(''), 1500)
  }

  return (
    <div style={{ minHeight: '100vh', background: '#f8f9fa', fontFamily: 'var(--font-sans), system-ui, sans-serif', display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '32px 16px 64px' }}>
      <div style={{ width: '100%', maxWidth: 440 }}>
        <div style={{ textAlign: 'center', marginBottom: 20 }}>
          <div style={{ fontSize: 22, fontWeight: 800, color: '#202124', letterSpacing: -0.4 }}>Betaalverzoek</div>
        </div>

        {loading && <Card><div style={{ textAlign: 'center', color: '#5f6368', padding: '30px 0' }}>Laden…</div></Card>}

        {!loading && error && (
          <Card><div style={{ textAlign: 'center', color: '#b3261e', padding: '24px 8px', fontSize: 15, lineHeight: 1.5 }}>{error}</div></Card>
        )}

        {!loading && view && (
          <>
            {terugVanIdeal && !view.alreadyPaid && (
              <div style={{ background: '#e8f0fe', border: '1px solid #c6dafc', color: '#1a56b8', borderRadius: 14, padding: '12px 16px', marginBottom: 14, fontSize: 14, lineHeight: 1.5, textAlign: 'center' }}>
                Betaling gedaan via iDEAL? De verwerking kan een minuutje duren — deze pagina zegt daarna dat de factuur betaald is. Betaal in dat geval niet nogmaals.
              </div>
            )}

            {view.alreadyPaid && (
              <div style={{ background: '#e6f4ea', border: '1px solid #b7e0c3', color: '#137333', borderRadius: 14, padding: '12px 16px', marginBottom: 14, fontSize: 14.5, fontWeight: 600, textAlign: 'center' }}>
                {view.items && view.items.length > 1
                  ? '✓ Deze facturen zijn al als betaald gemarkeerd.'
                  : '✓ Deze factuur is al als betaald gemarkeerd.'}
              </div>
            )}

            <Card>
              <div style={{ textAlign: 'center', paddingBottom: 6 }}>
                <div style={{ fontSize: 13, color: '#5f6368' }}>Te betalen aan</div>
                <div style={{ fontSize: 18, fontWeight: 700, color: '#202124', margin: '2px 0 10px' }}>{view.beneficiaryName}</div>
                <div style={{ fontSize: 34, fontWeight: 800, color: '#202124', letterSpacing: -1 }}>{eur.format(view.amount)}</div>
                {view.items && view.items.length > 1
                  ? <div style={{ fontSize: 13.5, color: '#5f6368', marginTop: 4 }}>{view.items.length} facturen{view.clientName ? ` · ${view.clientName}` : ''}</div>
                  : view.invoiceNumber && <div style={{ fontSize: 13.5, color: '#5f6368', marginTop: 4 }}>Factuur {view.invoiceNumber}{view.clientName ? ` · ${view.clientName}` : ''}</div>}
                {dateNL(view.dueDate) && <div style={{ fontSize: 13, color: '#5f6368', marginTop: 2 }}>Vervaldatum {dateNL(view.dueDate)}</div>}
              </div>

              {/* [BUNDEL-BETAALVERZOEK] The invoices this one payment settles. A line
                  that was paid in the meantime shows settled and is NOT in the sum. */}
              {view.items && view.items.length > 1 && (
                <div style={{ margin: '14px 0 4px', borderTop: '1px solid #f1f3f4' }}>
                  {view.items.map((it, i) => (
                    <div key={`${it.invoiceNumber ?? 'f'}-${i}`} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '9px 2px', borderBottom: '1px solid #f8f9fa' }}>
                      <div style={{ fontSize: 13.5, color: it.alreadyPaid ? '#70757a' : '#202124', fontWeight: 600, textDecoration: it.alreadyPaid ? 'line-through' : 'none' }}>
                        Factuur {it.invoiceNumber ?? '—'}
                      </div>
                      <div style={{ fontSize: 13.5, fontWeight: 600, color: it.alreadyPaid ? '#137333' : '#202124', whiteSpace: 'nowrap' }}>
                        {it.alreadyPaid ? '✓ betaald' : eur.format(it.amount)}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {view.idealAvailable && !view.alreadyPaid && (
                <div style={{ textAlign: 'center', margin: '16px 0 2px' }}>
                  <button
                    onClick={startIdeal}
                    disabled={idealBusy}
                    style={{ width: '100%', background: '#1a73e8', color: '#fff', border: 'none', borderRadius: 12, padding: '13px 18px', fontSize: 15.5, fontWeight: 700, cursor: 'pointer', opacity: idealBusy ? 0.6 : 1 }}
                  >
                    {idealBusy ? 'Even geduld…' : 'Betaal met iDEAL'}
                  </button>
                  {idealError && <div style={{ fontSize: 12.5, color: '#b3261e', marginTop: 8, lineHeight: 1.5 }}>{idealError}</div>}
                  <div style={{ fontSize: 12, color: '#5f6368', marginTop: 8 }}>Je betaalt via het Mollie-account van {view.beneficiaryName} — niet aan BoekBrug.</div>
                </div>
              )}

              {qr && !view.alreadyPaid && (
                <div style={{ textAlign: 'center', margin: '18px 0 6px' }}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={qr} alt="Betaal-QR" width={200} height={200} style={{ borderRadius: 12 }} />
                  <div style={{ fontSize: 13, color: '#5f6368', marginTop: 6 }}>Scan met je bankapp om te betalen</div>
                </div>
              )}
            </Card>

            <div style={{ fontSize: 12.5, fontWeight: 700, letterSpacing: 0.4, color: '#5f6368', margin: '18px 4px 8px' }}>OF MAAK ZELF OVER</div>
            <Card>
              <CopyRow label="IBAN" value={fmtIban(view.iban)} raw={view.iban} onCopy={copy} copied={copied} />
              <CopyRow label="Bedrag" value={eur.format(view.amount)} raw={view.amount.toFixed(2)} onCopy={copy} copied={copied} />
              <CopyRow label="Naam" value={view.beneficiaryName} raw={view.beneficiaryName} onCopy={copy} copied={copied} />
              {view.reference && <CopyRow label="Kenmerk" value={view.reference} raw={view.reference} onCopy={copy} copied={copied} last />}
            </Card>

            <p style={{ fontSize: 12, color: '#5f6368', textAlign: 'center', lineHeight: 1.6, marginTop: 18, padding: '0 8px' }}>
              Vermeld het kenmerk bij je betaling, dan herkent de ontvanger de betaling meteen bij {view.items && view.items.length > 1 ? 'deze facturen' : 'deze factuur'}.
              BoekBrug verwerkt de betaling niet — je betaalt rechtstreeks vanuit je eigen bank.
            </p>
          </>
        )}

        <div style={{ textAlign: 'center', fontSize: 11, color: '#c4c4c9', marginTop: 28 }}>Mogelijk gemaakt door BoekBrug</div>
      </div>
    </div>
  )
}

function Card({ children }: { children: React.ReactNode }) {
  return <div style={{ background: '#fff', border: '1px solid #e0e0e0', borderRadius: 18, padding: 20, boxShadow: '0 2px 14px rgba(0,0,0,0.04)' }}>{children}</div>
}

function CopyRow({ label, value, raw, onCopy, copied, last }: {
  label: string; value: string; raw: string; onCopy: (v: string, l: string) => void; copied: string; last?: boolean
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '11px 0', borderBottom: last ? 'none' : '1px solid #f8f9fa' }}>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 12, color: '#5f6368' }}>{label}</div>
        <div style={{ fontSize: 15, fontWeight: 600, color: '#202124', wordBreak: 'break-all' }}>{value}</div>
      </div>
      <button onClick={() => onCopy(raw, label)} style={{ flexShrink: 0, background: '#f8f9fa', border: 'none', borderRadius: 999, padding: '7px 14px', fontSize: 12.5, fontWeight: 600, color: copied === label ? '#137333' : '#1a73e8', cursor: 'pointer' }}>
        {copied === label ? 'Gekopieerd' : 'Kopieer'}
      </button>
    </div>
  )
}
