'use client'

// src/components/invoice/InvoiceCorrectionModal.tsx
// [FULL-CORRECTION] ONE editor for a booked purchase invoice, opened from more than one screen.
//
// ── WHY IT IS SHARED, NOT COPIED ──
// The pay screen could already correct a misread invoice. The bank screen — where the owner is
// looking at the payment and can see the paper next to it — could not, and that is the moment a
// wrong figure is most likely to be noticed. The obvious fix is a second editor on /bank, and it is
// the wrong one: two editors for the same numbers drift, and this is the money line. So the editor
// moved out here and both screens open it.
//
// It writes through PATCH /api/invoice/[id]/amounts — the same route, with the same six fail-closed
// guards, the same audit trail, the same credit-note sign rule, and the same feed into the supplier
// memory. This component decides nothing about money; it collects and shows.
//
// ── IT SENDS ONLY WHAT CHANGED ──
// Not the whole form. The route applies each field only where it differs anyway, but the reason is
// worth honouring on this side too: [READING-MEMORY] learns which fields a human keeps correcting
// at each supplier, and a screen that posts every field on every save would teach it that
// everything is always wrong — which points at every field and therefore at none.

import { useState } from 'react'
import { setExcl, setBtw, setIncl } from '@/lib/amount-triplet'
import { M3, R } from '@/lib/design/tokens'
// [BACK-CLOSES] Back closes what is open — see src/lib/use-close-on-back.ts.
import { useCloseOnBack } from '@/lib/use-close-on-back'

const FONT = "'Roboto', -apple-system, sans-serif"

/** The fields this editor reads and writes. A subset of the invoices row. */
export interface CorrectableInvoice {
  id: string
  invoice_number: string | null
  client_name: string | null
  invoice_date: string | null
  invoice_type?: string | null
  total_ex_btw: number | null
  btw_amount: number | null
  total_inc_btw: number | null
}

/** What the server confirms it stored. The caller updates its own row from THIS, never optimistically. */
export interface CorrectionResult {
  total_ex_btw: number
  btw_amount: number
  total_inc_btw: number
  invoice_type: string | null
  invoice_number?: string | null
  client_name?: string | null
  invoice_date?: string | null
}

export default function InvoiceCorrectionModal({
  invoice,
  readingHint,
  onClose,
  onSaved,
  onMessage,
}: {
  invoice: CorrectableInvoice
  /** [READING-MEMORY] What this owner keeps correcting at THIS supplier, or nothing. */
  readingHint?: string | null
  onClose: () => void
  onSaved: (result: CorrectionResult) => void
  /** Each screen has its own snackbar; the editor does not reach for one. */
  onMessage: (text: string) => void
}) {
  // [BACK-CLOSES] The system back button closes this, instead of leaving the page behind it.
  useCloseOnBack(true, onClose)
  const [amounts, setAmounts] = useState({
    ex: invoice.total_ex_btw ?? 0,
    btw: invoice.btw_amount ?? 0,
    incl: invoice.total_inc_btw ?? 0,
  })
  const [number, setNumber] = useState(invoice.invoice_number ?? '')
  const [vendor, setVendor] = useState(invoice.client_name ?? '')
  const [date, setDate] = useState(invoice.invoice_date ?? '')
  // Never pre-ticked: the app has an opinion (the ⚠ badge) but the declaration is the owner's.
  const [credit, setCredit] = useState(false)
  const [saving, setSaving] = useState(false)

  const amountsTouched =
    amounts.ex !== (invoice.total_ex_btw ?? 0) ||
    amounts.btw !== (invoice.btw_amount ?? 0) ||
    amounts.incl !== (invoice.total_inc_btw ?? 0)

  const save = async () => {
    if (saving) return
    // Only the fields the owner actually moved — see the header.
    const body: Record<string, unknown> = {}
    if (amountsTouched) {
      body.total_ex_btw = amounts.ex
      body.btw_amount = amounts.btw
      body.total_inc_btw = amounts.incl
    }
    if (number.trim() !== (invoice.invoice_number ?? '').trim()) body.invoice_number = number.trim()
    if (vendor.trim() !== (invoice.client_name ?? '').trim()) body.client_name = vendor.trim()
    if (date !== (invoice.invoice_date ?? '')) body.invoice_date = date
    if (credit) body.is_credit_note = true

    if (Object.keys(body).length === 0) {
      onMessage('Er is niets gewijzigd.')
      return
    }

    setSaving(true)
    try {
      const res = await fetch(`/api/invoice/${invoice.id}/amounts`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data.ok) {
        // [UI-HONESTY] Say what the server said. Its refusals are permanent states with a way out
        // named in them ("reverse the payment first", "ask your accountant", "that number already
        // exists") — a generic "try again" would send the owner at a button that cannot work.
        onMessage(typeof data.error === 'string' ? data.error : 'Corrigeren mislukt — er is niets gewijzigd')
        return
      }
      // Only now does the caller's list follow. Writing it optimistically would show a corrected
      // amount the server may have refused, on a screen the owner pays from.
      onSaved(data as CorrectionResult)
      onClose()
      // [SUPPLIER-ALIAS] When the server LEARNED something from this correction, say that instead
      // — it is the more useful of the two sentences. "Factuur gecorrigeerd" tells the owner what
      // they already know; naming the memory tells them they will not be typing this again next
      // month, which is the whole reason the lesson exists. Null when nothing was learned, and then
      // nothing is claimed.
      const memory = typeof (data as { supplier_memory?: unknown }).supplier_memory === 'string'
        ? (data as { supplier_memory: string }).supplier_memory
        : null
      onMessage(memory ?? 'Factuur gecorrigeerd')
    } catch {
      onMessage('Corrigeren mislukt — controleer je verbinding')
    } finally {
      setSaving(false)
    }
  }

  const field = (label: string, value: string, set: (v: string) => void, type = 'text') => (
    <label style={{ display: 'block', marginBottom: 12 }}>
      <span style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: '#3c4043', marginBottom: 5 }}>{label}</span>
      <input
        type={type}
        value={value}
        onChange={(e) => set(e.target.value)}
        style={{ width: '100%', boxSizing: 'border-box', padding: '11px 12px', fontSize: 15, borderRadius: 10, border: '1px solid #d1d1d6', outline: 'none', color: '#202124', fontFamily: FONT }}
      />
    </label>
  )

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Factuur corrigeren"
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center', zIndex: 3000 }}
      onClick={() => !saving && onClose()}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ background: '#fff', borderRadius: '20px 20px 0 0', padding: '22px 20px', paddingBottom: 'calc(22px + var(--bottom-nav-h, 0px) + env(safe-area-inset-bottom))', width: '100%', maxWidth: 460, fontFamily: FONT, maxHeight: '88vh', overflowY: 'auto' }}
      >
        <p style={{ fontSize: 18, fontWeight: 700, color: '#202124', margin: 0 }}>Factuur corrigeren</p>
        <p style={{ fontSize: 13, color: '#5F6368', margin: '4px 0 16px', lineHeight: 1.45 }}>
          Neem over wat er op de factuur staat. Wat je hier verbetert, is wat je boekhouder straks ziet.
        </p>

        {/* [READING-MEMORY] What this owner keeps fixing at this supplier. Names a field, never an
            amount: a remembered number belongs to a different invoice. */}
        {readingHint && (
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, padding: '11px 13px', marginBottom: 16, background: '#eef4ff', border: '1px solid #cddcff', borderRadius: 12 }}>
            <span style={{ fontSize: 14, lineHeight: 1.3 }}>🧠</span>
            <p style={{ fontSize: 12.5, color: '#274690', margin: 0, lineHeight: 1.5 }}>{readingHint}</p>
          </div>
        )}

        {/* The fields that carry no money and still decide where the invoice lands: the number the
            duplicate gate and the bank matcher key on, and the date that picks the BTW quarter. */}
        {field('Leverancier', vendor, setVendor)}
        {field('Factuurnummer', number, setNumber)}
        {field('Factuurdatum', date, setDate, 'date')}

        <div style={{ height: 1, background: '#EEE', margin: '4px 0 16px' }} />

        <p style={{ fontSize: 13, color: '#5F6368', margin: '0 0 12px', lineHeight: 1.45 }}>
          Neem het totaal en de BTW over zoals ze onderaan de factuur staan — het bedrag exclusief
          rekent zichzelf uit.
        </p>

        {[
          { key: 'incl' as const, label: 'Totaal (incl. BTW)', apply: setIncl, strong: true },
          { key: 'btw' as const, label: 'BTW', apply: setBtw, strong: false },
          { key: 'ex' as const, label: 'Bedrag excl. BTW', apply: setExcl, strong: false },
        ].map((f) => (
          <div key={f.key} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10, gap: 12 }}>
            <span style={{ fontSize: 14, fontWeight: f.strong ? 700 : 500, color: '#202124' }}>{f.label}</span>
            <input
              type="number"
              inputMode="decimal"
              step="0.01"
              value={amounts[f.key]}
              onChange={(e) => setAmounts(f.apply(amounts, parseFloat(e.target.value) || 0))}
              aria-label={f.label}
              style={{ width: 140, padding: '9px 11px', fontSize: f.strong ? 17 : 15, fontWeight: f.strong ? 700 : 600, borderRadius: 10, border: '1.5px solid #1a73e8', textAlign: 'right', outline: 'none', color: '#202124' }}
            />
          </div>
        ))}

        {/* [KIND-CORRECTION] The one-way declaration. Without it a net-negative invoice cannot be
            entered at all, and a credit note keeps counting as a debt. */}
        {invoice.invoice_type !== 'creditnota' && (
          <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, margin: '14px 0 4px', cursor: 'pointer' }}>
            <input type="checkbox" checked={credit} onChange={(e) => setCredit(e.target.checked)} style={{ marginTop: 2, width: 16, height: 16, accentColor: '#0B8043' }} />
            <span style={{ fontSize: 12, color: '#3c4043', lineHeight: 1.45 }}>
              <strong>Dit is een creditnota</strong> — geld dat jou toekomt. Vink dit aan als er
              “Creditnota” op staat of als het totaal onderaan negatief is. De bedragen worden dan
              als minbedrag opgeslagen: hij gaat van je openstaande saldo af en zijn btw wordt
              afgetrokken in plaats van opgeteld. Je hoeft zelf geen minteken te typen — staat er al
              een, dan blijft die staan.
            </span>
          </label>
        )}

        <p style={{ fontSize: 12, color: '#5F6368', lineHeight: 1.45, margin: '12px 0 16px' }}>
          Staat er statiegeld, emballage of een retour op de factuur? Dat hoort in het bedrag
          exclusief mee te tellen, mét zijn teken.
        </p>

        <button
          onClick={save}
          disabled={saving}
          style={{ width: '100%', padding: '15px', borderRadius: 14, background: saving ? '#9AA0A6' : M3.primary, color: '#fff', border: 'none', fontWeight: 700, fontSize: 16, cursor: saving ? 'default' : 'pointer', marginBottom: 8, fontFamily: FONT }}
        >
          {saving ? 'Opslaan…' : 'Correctie opslaan'}
        </button>
        <button
          onClick={onClose}
          disabled={saving}
          style={{ width: '100%', padding: '13px', borderRadius: R.md, background: M3.surfaceVariant, color: '#3c4043', border: 'none', fontWeight: 600, fontSize: 15, cursor: 'pointer', fontFamily: FONT }}
        >
          Annuleren
        </button>
      </div>
    </div>
  )
}
