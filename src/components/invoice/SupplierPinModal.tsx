'use client'

// src/components/invoice/SupplierPinModal.tsx
// [LEVERANCIER-VASTLEGGEN] Wie is deze leverancier, één keer opgeschreven.
//
// ── WAAROM DIT SCHERM BESTAAT ──
//
// GEMELD op een factuur waar het leverancierveld "Silifke / Hocaoglu" las — een PRODUCTLIJN
// bovenaan de pagina — terwijl het bedrijf dat hem stuurt OZ&ER FOOD B.V. is, verderop genoemd
// naast zijn KVK, zijn btw-nummer en zijn IBAN. Volgende maand ziet dat papier er precies zo uit,
// dus maakt de lezer precies dezelfde fout, en verbetert de eigenaar hem opnieuw. Eindeloos.
//
// De naam op één factuur corrigeren leerde de app al iets (supplier-alias.ts: "leest een papier
// zó, dan is het díe leverancier"). Wat nergens een deur had is de rest van de identiteit — het
// rekeningnummer, de KVK, het btw-nummer. Die horen bij de LEVERANCIER, ze zijn waar de volgende
// factuur op wordt herkend, en alleen de import kon ze tot nu toe schrijven.
//
// ── WAT DIT SCHERM NIET DOET ──
//
// Het rekent niets uit en het beslist niets. De server keurt hetzelfde formulier nog een keer
// (supplier-pin.ts, gedeeld), want een verkeerd IBAN hier is geen slordigheid: het is precies het
// nummer waartegen de app de factuur van volgende maand vergelijkt, en een fout nummer laat die
// controle bij élke echte factuur alarm slaan — waarna de eigenaar leert het weg te klikken.
//
// [TAAL] De woorden komen binnen als props: dit onderdeel heeft geen eigen taal.

import { useState } from 'react'
import { M3, R } from '@/lib/design/tokens'
// [BACK-CLOSES] De systeem-terugknop sluit wat er openstaat.
import { useCloseOnBack } from '@/lib/use-close-on-back'
// [BLAD-ACHTERGROND] Een blad dat de terugknop overneemt, zet de pagina erachter stil.
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
  /** De naam zoals hij nu vaststaat, plus de zin die de server erover te zeggen had. */
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
  // [NO-SILENT-EMPTY] De server zegt WELK veld niet klopte; dat veld kleurt, en de zin staat
  // eronder. Een formulier dat alleen "ongeldig" zegt, laat de eigenaar zoeken.
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
