'use client'

// src/components/supplier/SupplierEditSheet.tsx
// [LEVERANCIER-BEWERKEN] The supplier's master record, edited from /dashboard/leveranciers.
//
// ── WHAT THIS SHEET IS ──
//
// The pin modal on an invoice answers "who sent THIS paper?". This sheet answers "what is true of
// this supplier from now on?" — the wholesaler moved to a new bank, the KVK was never filled in,
// the name is spelled the way the owner says it. Every field is pre-filled from the ROW, not from
// an invoice, so what the owner sees is what the app currently believes.
//
// ── WHAT IT DECIDES: NOTHING ──
//
// The server judges the same form again (supplier-edit.ts, shared), keeps the old IBAN, writes the
// trail and renames the linked invoices. This sheet only shows, and warns: a replaced account
// number is the signature of invoice fraud, so the moment the IBAN differs from the one on file
// the sentence appears that names the old number and says to call the supplier on a number the
// owner looks up themselves. That sentence is on the screen BEFORE the save, because after it the
// money is already on its way.
//
// [TAAL] The words come from the catalogue; this component holds no language of its own.

import { useState } from 'react'
import { M3, R } from '@/lib/design/tokens'
// [BACK-CLOSES] The system back button closes whatever is open.
import { useCloseOnBack } from '@/lib/use-close-on-back'
// [BLAD-ACHTERGROND] A sheet that takes over the back button freezes the page behind it.
import { useBodyScrollLock } from '@/lib/use-body-scroll-lock'
import { useLocale } from '@/lib/i18n/use-locale'
import { translator } from '@/lib/i18n/t'
import { localeDir } from '@/lib/i18n/locale'
import { failureText } from '@/lib/server-message'

const FONT = "'Roboto', -apple-system, sans-serif"

/** A supplier row, in the shape the sheet edits. */
export interface SupplierEditCard {
  id: string
  name: string
  iban: string | null
  kvk: string | null
  btw: string | null
  autoIncasso: boolean
}

export interface SupplierEditResult {
  name: string
  ibanReplaced: boolean
  invoicesRenamed: number
}

/** The normalised form of an account number, for "did it change?" — the server normalises the same way. */
const flat = (v: string) => v.replace(/\s+/g, '').toUpperCase()

export default function SupplierEditSheet({
  supplier,
  onClose,
  onSaved,
}: {
  supplier: SupplierEditCard
  onClose: () => void
  onSaved: (result: SupplierEditResult) => void
}) {
  const locale = useLocale()
  const t = translator(locale)
  const dir = localeDir(locale)
  useCloseOnBack(true, onClose)
  useBodyScrollLock(true)

  const [name, setName] = useState(supplier.name)
  const [iban, setIban] = useState(supplier.iban ?? '')
  const [kvk, setKvk] = useState(supplier.kvk ?? '')
  const [btw, setBtw] = useState(supplier.btw ?? '')
  const [incasso, setIncasso] = useState(supplier.autoIncasso)
  const [saving, setSaving] = useState(false)
  // [NO-SILENT-EMPTY] The server says WHICH field was wrong; that field is coloured and the
  // sentence sits under the form. "Ongeldig" alone leaves the owner hunting.
  const [error, setError] = useState<{ field: string | null; text: string } | null>(null)

  // The fraud sentence, live: shown as soon as the typed number differs from a number on file.
  const storedIban = (supplier.iban ?? '').trim()
  const ibanReplacing = storedIban !== '' && flat(iban) !== flat(storedIban)

  const save = async () => {
    if (saving) return
    setSaving(true)
    setError(null)
    try {
      const res = await fetch(`/api/supplier/${encodeURIComponent(supplier.id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, iban, kvk, btw }),
      })
      const json = (await res.json().catch(() => ({}))) as {
        field?: unknown; name?: unknown; ibanReplaced?: unknown; invoicesRenamed?: unknown
      }
      if (!res.ok) {
        setError({
          field: typeof json.field === 'string' ? json.field : null,
          text: failureText(res.status, json as Parameters<typeof failureText>[1], t('lev.fout.bijwerken')),
        })
        setSaving(false)
        return
      }
      // The mandate is a separate decision with its own door and its own audit line. Only when it
      // was actually flipped: an unchanged switch is not re-confirmed.
      if (incasso !== supplier.autoIncasso) {
        const inc = await fetch('/api/supplier/incasso', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ supplierId: supplier.id, on: incasso }),
        })
        if (!inc.ok) {
          const incJson = await inc.json().catch(() => ({}))
          setError({ field: 'incasso', text: failureText(inc.status, incJson, t('lev.fout.bijwerken')) })
          setSaving(false)
          return
        }
      }
      onSaved({
        name: typeof json.name === 'string' ? json.name : name,
        ibanReplaced: json.ibanReplaced === true,
        invoicesRenamed: typeof json.invoicesRenamed === 'number' ? json.invoicesRenamed : 0,
      })
    } catch {
      setError({ field: null, text: t('lev.fout.bijwerken') })
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
    <label style={{ display: 'block', marginBottom: 12, textAlign: 'start' }}>
      <span style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: '#3c4043', marginBottom: 5 }}>{label}</span>
      <input
        type="text"
        value={value}
        onChange={(e) => set(e.target.value)}
        placeholder={placeholder}
        // An IBAN, a KVK and a btw number are Latin strings whatever the interface language.
        dir={key === 'name' ? undefined : 'ltr'}
        style={{
          width: '100%', boxSizing: 'border-box', padding: '11px 12px', fontSize: 15,
          borderRadius: 10, border: `1px solid ${error?.field === key ? M3.error : '#d1d1d6'}`,
          outline: 'none', color: '#202124', fontFamily: FONT, textAlign: 'start',
        }}
      />
      <span style={{ display: 'block', fontSize: 11.5, color: '#5F6368', marginTop: 4, lineHeight: 1.45 }}>{hint}</span>
    </label>
  )

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t('lev.bewerk.titel')}
      dir={dir}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center', zIndex: 3000 }}
      onClick={() => !saving && onClose()}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ background: '#fff', borderRadius: '20px 20px 0 0', padding: '22px 20px', paddingBottom: 'calc(22px + var(--bottom-nav-h, 0px) + env(safe-area-inset-bottom))', width: '100%', maxWidth: 460, fontFamily: FONT, maxHeight: '88vh', overflowY: 'auto' }}
      >
        <p style={{ fontSize: 18, fontWeight: 700, color: '#202124', margin: 0, textAlign: 'start' }}>{t('lev.bewerk.titel')}</p>
        <p style={{ fontSize: 13, color: '#5F6368', margin: '4px 0 16px', lineHeight: 1.45, textAlign: 'start' }}>{t('lev.bewerk.uitleg')}</p>

        {field('name', t('lev.naam'), name, setName, t('lev.naam.hint'))}
        {field('iban', t('lev.iban'), iban, setIban, t('lev.iban.hint'), 'NL00BANK0000000000')}
        {/* [IBAN-WISSEL] Before the save, in the owner's language, naming the number that stood. */}
        {ibanReplacing && (
          <p role="alert" style={{
            background: '#FEF7E0', border: '1px solid #FDE293', borderRadius: R.md, padding: 12,
            fontSize: 13, color: '#7C5800', lineHeight: 1.55, margin: '0 0 12px', textAlign: 'start',
          }}>
            {t('lev.bewerk.ibanGewijzigd', { oud: storedIban })}
          </p>
        )}
        {field('kvk', t('lev.kvk'), kvk, setKvk, t('lev.kvk.hint'), '12345678')}
        {field('btw', t('lev.btw'), btw, setBtw, t('lev.btw.hint'), 'NL000000000B00')}

        <label style={{ display: 'flex', gap: 10, alignItems: 'flex-start', marginBottom: 14, textAlign: 'start', cursor: 'pointer' }}>
          <input type="checkbox" checked={incasso} onChange={(e) => setIncasso(e.target.checked)} style={{ marginTop: 3 }} />
          <span>
            <span style={{ display: 'block', fontSize: 13.5, fontWeight: 600, color: '#3c4043' }}>{t('lev.bewerk.incasso')}</span>
            <span style={{ display: 'block', fontSize: 11.5, color: '#5F6368', marginTop: 2, lineHeight: 1.45 }}>{t('lev.bewerk.incasso.hint')}</span>
          </span>
        </label>

        {error && (
          <p style={{ fontSize: 13, color: M3.error, lineHeight: 1.5, margin: '4px 0 12px', textAlign: 'start' }}>{error.text}</p>
        )}

        <button
          type="button"
          onClick={save}
          disabled={saving}
          style={{ width: '100%', padding: 15, borderRadius: 14, background: saving ? '#9AA0A6' : M3.primary, color: '#fff', border: 'none', fontWeight: 700, fontSize: 16, cursor: saving ? 'default' : 'pointer', marginBottom: 8, fontFamily: FONT }}
        >
          {saving ? t('lev.bezig') : t('lev.bewerk.opslaan')}
        </button>
        <button
          type="button"
          onClick={() => !saving && onClose()}
          style={{ width: '100%', padding: 13, borderRadius: 12, background: '#f1f3f4', color: '#3c4043', border: 'none', fontWeight: 600, fontSize: 15, cursor: 'pointer', fontFamily: FONT }}
        >
          {t('lev.annuleren')}
        </button>
      </div>
    </div>
  )
}
