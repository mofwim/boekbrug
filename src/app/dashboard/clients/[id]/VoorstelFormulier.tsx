// src/app/dashboard/clients/[id]/VoorstelFormulier.tsx
// [VOORSTEL] The accountant's proposal form: five fields prefilled from the invoice, a reason.
//
// Pure in the [RENDER-GATE] sense: it receives the invoice, the translator and the date field
// as props, and posts to /api/accountant/invoice-correction. It changes nothing itself — the
// route validates, stores and notifies; the client decides; the client's own door applies.

'use client'

import { useState, type ComponentType } from 'react'
import { failureText } from '@/lib/server-message'

export type VoorstelStatus = 'open' | 'accepted' | 'declined' | 'stale'

type InvoiceLike = {
  id: string
  total_ex_btw: number | null
  btw_amount: number | null
  total_inc_btw: number | null
  invoice_date: string | null
  due_date: string | null
}

type DateFieldProps = { value: string; onChange: (iso: string) => void; style?: React.CSSProperties }

const FIELD: React.CSSProperties = {
  width: '100%', boxSizing: 'border-box', fontSize: 13, padding: '7px 9px',
  border: '1px solid #E0E0E0', borderRadius: 6, background: '#fff', color: '#202124',
}

function num(v: number | null): string {
  return v === null || v === undefined ? '' : String(v)
}

export function VoorstelFormulier({
  clientId, invoice, t, DateField, onClose, onSent, onError,
}: {
  clientId: string
  invoice: InvoiceLike
  t: (key: never, params?: Record<string, string | number>) => string
  DateField: ComponentType<DateFieldProps>
  onClose: () => void
  onSent: () => void
  onError: (message: string | null) => void
}) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tt = t as (key: any, params?: Record<string, string | number>) => string
  const [ex, setEx] = useState(num(invoice.total_ex_btw))
  const [btw, setBtw] = useState(num(invoice.btw_amount))
  const [inc, setInc] = useState(num(invoice.total_inc_btw))
  const [datum, setDatum] = useState(invoice.invoice_date ?? '')
  const [vervalt, setVervalt] = useState(invoice.due_date ?? '')
  const [reden, setReden] = useState('')
  const [bezig, setBezig] = useState(false)
  const [fout, setFout] = useState<string | null>(null)

  const parse = (s: string): number | undefined => {
    const n = Number(String(s).replace(',', '.'))
    return s.trim() === '' || !Number.isFinite(n) ? undefined : n
  }

  async function verstuur() {
    setBezig(true); setFout(null)
    try {
      const res = await fetch('/api/accountant/invoice-correction', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clientId, invoiceId: invoice.id,
          total_ex_btw: parse(ex), btw_amount: parse(btw), total_inc_btw: parse(inc),
          invoice_date: datum || undefined,
          due_date: vervalt === (invoice.due_date ?? '') ? undefined : vervalt,
          reason: reden,
        }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        // [SERVER-ZIN] The route's sentence when it is one, the screen's own when it is not.
        const zin = failureText(res.status, json, tt('bh.kwt.voorstel.fout'))
        setFout(zin); onError(zin); return
      }
      onSent()
    } catch {
      onError(null)
    } finally {
      setBezig(false)
    }
  }

  return (
    <div style={{ border: '1px solid #1A73E8', borderRadius: 8, padding: 12, background: '#F8FAFF', display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ fontSize: 12.5, color: '#5F6368', lineHeight: 1.5 }}>{tt('bh.kwt.voorstel.uitleg')}</div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 6 }}>
        <label style={{ fontSize: 12, color: '#5F6368' }}>{tt('vr.voorstel.veld.exBtw')}
          <input inputMode="decimal" value={ex} onChange={(e) => setEx(e.target.value)} style={FIELD} />
        </label>
        <label style={{ fontSize: 12, color: '#5F6368' }}>{tt('vr.voorstel.veld.btw')}
          <input inputMode="decimal" value={btw} onChange={(e) => setBtw(e.target.value)} style={FIELD} />
        </label>
        <label style={{ fontSize: 12, color: '#5F6368' }}>{tt('vr.voorstel.veld.inc')}
          <input inputMode="decimal" value={inc} onChange={(e) => setInc(e.target.value)} style={FIELD} />
        </label>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
        <label style={{ fontSize: 12, color: '#5F6368' }}>{tt('vr.voorstel.veld.datum')}
          <DateField value={datum} onChange={setDatum} style={FIELD} />
        </label>
        <label style={{ fontSize: 12, color: '#5F6368' }}>{tt('vr.voorstel.veld.vervalt')}
          <DateField value={vervalt} onChange={setVervalt} style={FIELD} />
        </label>
      </div>
      <label style={{ fontSize: 12, color: '#5F6368' }}>{tt('bh.kwt.voorstel.reden')}
        <textarea value={reden} onChange={(e) => setReden(e.target.value)} rows={2} maxLength={500} style={{ ...FIELD, resize: 'vertical', fontFamily: 'inherit' }} />
      </label>
      {fout && <p role="alert" style={{ margin: 0, fontSize: 12.5, color: '#B3261E' }}>{fout}</p>}
      <div style={{ display: 'flex', gap: 6 }}>
        <button onClick={verstuur} disabled={bezig}
          style={{ flex: 1, padding: '8px 12px', borderRadius: 8, backgroundColor: '#1A73E8', color: '#fff', fontSize: 13, fontWeight: 500, border: 'none', cursor: bezig ? 'default' : 'pointer' }}>
          {tt('bh.kwt.voorstel.versturen')}
        </button>
        <button onClick={onClose} disabled={bezig}
          style={{ padding: '8px 12px', borderRadius: 8, backgroundColor: '#fff', color: '#5F6368', fontSize: 13, fontWeight: 500, border: '1px solid #E0E0E0', cursor: 'pointer' }}>
          {tt('bh.kwt.voorstel.annuleren')}
        </button>
      </div>
    </div>
  )
}
