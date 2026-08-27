'use client'

// src/components/invoice/SupplierPinModal.tsx
// [LEVERANCIER-VASTLEGGEN] Who this supplier is, written down once.
//
// ── WHY THIS SCREEN EXISTS ──
//
// Reported on an invoice whose leverancier field read "Silifke / Hocaoglu" — a PRODUCT LINE
// printed at the top of the page — while the company sending it is OZ&ER FOOD B.V., named further
// down beside its KVK, its btw number and its IBAN. Next month's paper looks exactly the same, so
// the reader makes exactly the same mistake and the owner corrects it again. Endlessly.
//
// Correcting the NAME on one invoice already taught the app something (supplier-alias.ts: "when a
// paper reads like this, it is that supplier"). What had no door anywhere is the rest of the
// identity — the account number, the KVK, the btw number. Those belong to the SUPPLIER, they are
// what next month's invoice is recognised on, and until now only the import could write them.
//
// ── WHAT THIS SCREEN DOES NOT DO ──
//
// It computes nothing and decides nothing. The server judges the same form again (supplier-pin.ts,
// shared), because a wrong IBAN here is not untidiness: it is exactly the number the app compares
// next month's invoice against, and a wrong one makes that check cry wolf on EVERY genuine invoice
// — after which the owner learns to click the warning away.
//
// [TAAL] The words arrive as props: this component holds no language of its own.

import { useState } from 'react'
import { M3, R } from '@/lib/design/tokens'
// [BACK-CLOSES] The system back button closes whatever is open.
import { useCloseOnBack } from '@/lib/use-close-on-back'
// [BLAD-ACHTERGROND] A sheet that takes over the back button freezes the page behind it.
import { useBodyScrollLock } from '@/lib/use-body-scroll-lock'
import { useLocale } from '@/lib/i18n/use-locale'
import { translator } from '@/lib/i18n/t'

const FONT = "'Roboto', -apple-system, sans-serif"

export interface SupplierPinInvoice {
  id: string
  client_name: string | null
  vendor_iban?: string | null
}

export default function SupplierPinModal({
  invoice,
  onClose,
  onSaved,
}: {
  invoice: SupplierPinInvoice
  onClose: () => void
  /** The name as it now stands, plus whatever sentence the server had to say about it. */
  onSaved: (result: { name: string; message: string | null }) => void
}) {
  const t = translator(useLocale())
  useCloseOnBack(true, onClose)
  useBodyScrollLock(true)

  const [name, setName] = useState(invoice.client_name ?? '')
  const [iban, setIban] = useState(invoice.vendor_iban ?? '')
  const [kvk, setKvk] = useState('')
  const [btw, setBtw] = useState('')
  const [saving, setSaving] = useState(false)
  // [NO-SILENT-EMPTY] The server says WHICH field was wrong; that field is coloured and the
  // sentence sits under it. A form that only says "ongeldig" leaves the owner hunting.
  const [error, setError] = useState<{ field: string | null; text: string } | null>(null)

  const save = async () => {
    if (saving) return
    setSaving(true)
    setError(null)
    try {
      const res = await fetch(`/api/invoice/${invoice.id}/supplier`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, iban, kvk, btw }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError({
          field: typeof json?.field === 'string' ? json.field : null,
          text: typeof json?.error === 'string' && json.error ? json.error : t('lev.fout.opslaan'),
        })
        setSaving(false)
        return
      }
      onSaved({
        name: typeof json?.name === 'string' ? json.name : name,
        message: typeof json?.message === 'string' ? json.message : null,
      })
    } catch {
      setError({ field: null, text: t('lev.fout.opslaan') })
      setSaving(false)
    }
  }

  const field = (
    key: string,
    label: string,
    value: string,
    set: (v: string) => void,
    hint: string,
    placeholder?: string,
  ) => (
    <label style={{ display: 'block', marginBottom: 12 }}>
      <span style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: '#3c4043', marginBottom: 5 }}>{label}</span>
      <input
        type="text"
        value={value}
        onChange={(e) => set(e.target.value)}
        placeholder={placeholder}
        style={{
          width: '100%', boxSizing: 'border-box', padding: '11px 12px', fontSize: 15,
          borderRadius: 10, border: `1px solid ${error?.field === key ? M3.error : '#d1d1d6'}`,
          outline: 'none', color: '#202124', fontFamily: FONT,
        }}
      />
      <span style={{ display: 'block', fontSize: 11.5, color: '#5F6368', marginTop: 4, lineHeight: 1.45 }}>{hint}</span>
    </label>
  )

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t('lev.titel')}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center', zIndex: 3000 }}
      onClick={() => !saving && onClose()}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ background: '#fff', borderRadius: '20px 20px 0 0', padding: '22px 20px', paddingBottom: 'calc(22px + var(--bottom-nav-h, 0px) + env(safe-area-inset-bottom))', width: '100%', maxWidth: 460, fontFamily: FONT, maxHeight: '88vh', overflowY: 'auto' }}
      >
        <p style={{ fontSize: 18, fontWeight: 700, color: '#202124', margin: 0 }}>{t('lev.titel')}</p>
        <p style={{ fontSize: 13, color: '#5F6368', margin: '4px 0 16px', lineHeight: 1.45 }}>{t('lev.uitleg')}</p>

        {field('name', t('lev.naam'), name, setName, t('lev.naam.hint'))}
        {field('iban', t('lev.iban'), iban, setIban, t('lev.iban.hint'), 'NL00BANK0000000000')}
        {field('kvk', t('lev.kvk'), kvk, setKvk, t('lev.kvk.hint'), '12345678')}
        {field('btw', t('lev.btw'), btw, setBtw, t('lev.btw.hint'), 'NL000000000B00')}

        {error && (
          <p style={{ fontSize: 13, color: M3.error, lineHeight: 1.5, margin: '4px 0 12px' }}>{error.text}</p>
        )}

        <button
          onClick={save}
          disabled={saving}
          style={{ width: '100%', padding: 15, borderRadius: 14, background: saving ? '#9AA0A6' : M3.primary, color: '#fff', border: 'none', fontWeight: 700, fontSize: 16, cursor: saving ? 'default' : 'pointer', marginBottom: 8, fontFamily: FONT }}
        >
          {saving ? t('lev.bezig') : t('lev.opslaan')}
        </button>
        <button
          onClick={() => !saving && onClose()}
          style={{ width: '100%', padding: 13, borderRadius: 12, background: '#f1f3f4', color: '#3c4043', border: 'none', fontWeight: 600, fontSize: 15, cursor: 'pointer', fontFamily: FONT }}
        >
          {t('lev.annuleren')}
        </button>
      </div>
    </div>
  )
}
