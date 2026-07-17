'use client'

// src/app/dashboard/klanten/[id]/KlantDetailClient.tsx
// [KLANTEN] Customer detail UI (gateway #2): contact, editable notes, invoice history +
// running totals, and quick actions (new invoice pre-filled for this customer, edit).

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { BackLink } from '@/components/ui/BackLink'
import { createClient } from '@/lib/supabase'

const M3 = {
  primary: '#1A73E8', onSurface: '#202124', neutral: '#5F6368', surface: '#FFFFFF',
  outlineVariant: '#E0E0E0', success: '#137333', warning: '#7C5800', error: '#B3261E',
  primaryContainer: '#D3E3FD', onPrimaryContainer: '#041E49',
}
const FONT = "'Roboto', -apple-system, sans-serif"
const FONT_NUM = "'Roboto Mono', monospace"
const eur = new Intl.NumberFormat('nl-NL', { style: 'currency', currency: 'EUR' })

export interface KlantInvoice {
  id: string; invoice_number: string | null; invoice_date: string | null
  due_date: string | null; status: string | null; total_inc_btw: number | null
}
interface Client {
  id: string; name: string; email: string | null; kvk_number: string | null
  btw_number: string | null; iban: string | null; address: string | null
  postal_code: string | null; city: string | null; notes: string | null
}

const STATUS: Record<string, { label: string; color: string; bg: string }> = {
  paid: { label: 'Betaald', color: M3.success, bg: '#E6F4EA' },
  sent: { label: 'Verstuurd', color: M3.primary, bg: M3.primaryContainer },
  overdue: { label: 'Te laat', color: M3.error, bg: '#FCE8E6' },
  processing: { label: 'In behandeling', color: M3.warning, bg: '#FEF7E0' },
}

export default function KlantDetailClient({ client, invoices, totals }: {
  client: Client; invoices: KlantInvoice[]; totals: { billed: number; open: number; count: number }
}) {
  const router = useRouter()
  const [notes, setNotes] = useState(client.notes ?? '')
  const [savedNote, setSavedNote] = useState<string>(client.notes ?? '')
  const [savingNote, setSavingNote] = useState(false)
  const [noteError, setNoteError] = useState('')

  async function saveNotes() {
    setSavingNote(true)
    setNoteError('')
    const supabase = createClient()
    const { error } = await supabase.from('clients').update({ notes: notes.trim() || null }).eq('id', client.id)
    setSavingNote(false)
    // Never claim "saved" on failure — surface the error and keep the button so
    // the owner knows the note did NOT persist.
    if (error) setNoteError('Opslaan mislukt — probeer opnieuw.')
    else setSavedNote(notes.trim())
  }

  function newInvoice() {
    const p = new URLSearchParams()
    p.set('client_id', client.id)
    p.set('client_name', client.name)
    if (client.email) p.set('client_email', client.email)
    router.push(`/dashboard/invoice/new?${p.toString()}`)
  }

  const dateNL = (iso: string | null) => (iso ? new Date(iso + 'T00:00:00').toLocaleDateString('nl-NL', { day: '2-digit', month: 'short', year: 'numeric' }) : '—')
  const notesDirty = notes.trim() !== savedNote.trim()

  return (
    <div style={{ minHeight: '100vh', background: '#F8F9FA', fontFamily: FONT }}>
      <div style={{ maxWidth: 640, margin: '0 auto', padding: '20px 16px 80px' }}>
        <BackLink label="Klanten" style={{ color: M3.primary }} />

        <header style={{ margin: '16px 0 18px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          <div>
            <h1 style={{ fontSize: 26, fontWeight: 700, color: M3.onSurface, margin: '0 0 2px' }}>{client.name}</h1>
            <p style={{ fontSize: 14, color: M3.neutral, margin: 0 }}>{client.email || 'Geen e-mail'}</p>
          </div>
          <button onClick={newInvoice} style={{ background: M3.primary, color: '#fff', border: 'none', borderRadius: 999, padding: '10px 16px', cursor: 'pointer', fontSize: 13.5, fontWeight: 600, fontFamily: FONT, whiteSpace: 'nowrap' }}>+ Nieuwe factuur</button>
        </header>

        {/* Totals */}
        <div style={{ display: 'flex', gap: 10, marginBottom: 16 }}>
          <Stat label="Gefactureerd" value={eur.format(totals.billed)} />
          <Stat label="Openstaand" value={eur.format(totals.open)} accent={totals.open > 0 ? M3.warning : M3.success} />
          <Stat label="Facturen" value={String(totals.count)} />
        </div>

        {/* Contact */}
        <Card title="Gegevens">
          <Row k="Adres" v={[client.address, [client.postal_code, client.city].filter(Boolean).join(' ')].filter(Boolean).join(', ') || '—'} />
          <Row k="KVK" v={client.kvk_number || '—'} />
          <Row k="BTW" v={client.btw_number || '—'} />
          <Row k="IBAN" v={client.iban || '—'} />
        </Card>

        {/* Notes */}
        <Card title="Notities">
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Context over deze klant — afspraken, voorkeuren, betaalgedrag…"
            rows={3} style={{ width: '100%', boxSizing: 'border-box', border: `1px solid ${M3.outlineVariant}`, borderRadius: 10, padding: '10px 12px', fontSize: 14, fontFamily: FONT, resize: 'vertical', outline: 'none', color: M3.onSurface }} />
          {noteError && (
            <div style={{ marginTop: 8, fontSize: 12.5, color: M3.error }}>{noteError}</div>
          )}
          {notesDirty && (
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 8 }}>
              <button onClick={saveNotes} disabled={savingNote} style={{ background: M3.primary, color: '#fff', border: 'none', borderRadius: 999, padding: '7px 16px', cursor: 'pointer', fontSize: 13, fontWeight: 600, fontFamily: FONT }}>{savingNote ? 'Opslaan…' : 'Notitie opslaan'}</button>
            </div>
          )}
        </Card>

        {/* Invoice history */}
        <div style={{ margin: '20px 2px 10px', fontSize: 13, fontWeight: 700, letterSpacing: 0.5, color: M3.neutral }}>FACTUURGESCHIEDENIS</div>
        {invoices.length === 0 ? (
          <div style={{ textAlign: 'center', color: M3.neutral, fontSize: 14, padding: '28px 0' }}>Nog geen facturen voor deze klant.</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {invoices.map((iv) => {
              const st = STATUS[iv.status ?? ''] ?? { label: iv.status ?? '—', color: M3.neutral, bg: '#F1F3F4' }
              return (
                <Link key={iv.id} href={`/dashboard/facturen`} style={{ textDecoration: 'none' }}>
                  <div style={{ background: M3.surface, borderRadius: 12, border: `1px solid ${M3.outlineVariant}`, padding: '12px 14px', display: 'flex', alignItems: 'center', gap: 12 }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 14.5, fontWeight: 600, color: M3.onSurface }}>{iv.invoice_number || 'Concept'}</div>
                      <div style={{ fontSize: 12.5, color: M3.neutral }}>{dateNL(iv.invoice_date)}</div>
                    </div>
                    <span style={{ fontSize: 11.5, fontWeight: 700, color: st.color, background: st.bg, borderRadius: 999, padding: '3px 9px', whiteSpace: 'nowrap' }}>{st.label}</span>
                    <span style={{ fontFamily: FONT_NUM, fontSize: 14, fontWeight: 700, color: M3.onSurface, minWidth: 82, textAlign: 'right' }}>{eur.format(iv.total_inc_btw ?? 0)}</span>
                  </div>
                </Link>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div style={{ flex: 1, background: M3.surface, borderRadius: 14, border: `1px solid ${M3.outlineVariant}`, padding: '12px 14px' }}>
      <div style={{ fontSize: 11.5, color: M3.neutral, marginBottom: 3 }}>{label}</div>
      <div style={{ fontFamily: FONT_NUM, fontSize: 16, fontWeight: 700, color: accent ?? M3.onSurface }}>{value}</div>
    </div>
  )
}
function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ background: M3.surface, borderRadius: 16, border: `1px solid ${M3.outlineVariant}`, padding: 16, marginBottom: 12 }}>
      <div style={{ fontSize: 13, fontWeight: 700, letterSpacing: 0.4, color: M3.neutral, marginBottom: 10 }}>{title.toUpperCase()}</div>
      {children}
    </div>
  )
}
function Row({ k, v }: { k: string; v: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '5px 0', fontSize: 14 }}>
      <span style={{ color: M3.neutral }}>{k}</span>
      <span style={{ color: M3.onSurface, fontWeight: 500, textAlign: 'right' }}>{v}</span>
    </div>
  )
}
