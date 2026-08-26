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
// [KOMMA-INVOER] One tolerant reader for an amount a Dutch owner TYPES — see parse-nl.ts.
import { parseAmountNL } from '@/lib/parse-nl'
// [STATIEGELD-GAT] The deposit the reader dropped, found back on the paper — see statiegeld.ts.
import { depositGapText, type DepositGap } from '@/lib/statiegeld'
// [CENT] Cent rounding comes from invoice-totals.round2 — one definition for the whole app.
import { round2 } from '@/lib/invoice-totals'
// [SUPPLETIE] A duty with a legal clock on it is not a toast — see the block at the save below.
import { useDialog } from '@/components/ui/Dialog'
import { M3, R } from '@/lib/design/tokens'
// [BACK-CLOSES] Back closes what is open — see src/lib/use-close-on-back.ts.
import { useCloseOnBack } from '@/lib/use-close-on-back'
// [BLAD-ACHTERGROND] Een blad dat de systeem-terugknop overneemt, is modaal genoeg om ook
// de pagina erachter stil te zetten. `overscroll-behavior` dekt alleen een gebaar dat IN de
// scroller begon; een veeg op de kop, op de knoppen eronder of naast het paneel ging er
// langs — en dan schuift de lijst onder het blad door. Zie de kop van dat bestand.
import { useBodyScrollLock } from '@/lib/use-body-scroll-lock'
// [TAAL] A component holds no language of its own.
import { useLocale } from '@/lib/i18n/use-locale'
import { translator } from '@/lib/i18n/t'

const FONT = "'Roboto', -apple-system, sans-serif"

/** The fields this editor reads and writes. A subset of the invoices row. */
export interface CorrectableInvoice {
  id: string
  invoice_number: string | null
  client_name: string | null
  invoice_date: string | null
  /** [LEES-CORRECTIE] The three pipeline-written fields that had no edit surface anywhere. */
  due_date?: string | null
  vendor_iban?: string | null
  payment_reference?: string | null
  invoice_type?: string | null
  total_ex_btw: number | null
  btw_amount: number | null
  total_inc_btw: number | null
}

/** [SPLIT-CORRECTIE] One rate row of the paper's own BTW specification. */
export interface BtwSplitRow {
  rate: number
  base: number
  btw: number
}

/** What the server confirms it stored. The caller updates its own row from THIS, never optimistically. */
export interface CorrectionResult {
  /**
   * [SUPPLETIE] One Dutch sentence per already-filed quarter this correction moved, composed by the
   * server (describeFiledQuarterImpact) so the sentence and its amount cannot disagree. Absent or
   * empty on the ordinary correction, which is nearly all of them.
   *
   * [TAAL] Not translated, and that is the same rule the invoice PDF follows: this sentence is about
   * a document sent to the Belastingdienst, and the words the owner has to recognise on that form —
   * suppletie, aangifte, kwartaal — are the Dutch ones.
   */
  suppletie?: string[]
  /** [SPLIT-CORRECTIE] The split as now stored; null = untouched, [] = cleared. */
  btw_rows?: BtwSplitRow[] | null
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
 btwRows,
  depositGap,
}: {
  invoice: CorrectableInvoice
  /** [READING-MEMORY] What this owner keeps correcting at THIS supplier, or nothing. */
  readingHint?: string | null
  onClose: () => void
  onSaved: (result: CorrectionResult) => void
  /** Each screen has its own snackbar; the editor does not reach for one. */
  onMessage: (text: string) => void
  /** [SPLIT-CORRECTIE] The stored per-rate split, for prefill. Absent = geen specificatie. */
  btwRows?: BtwSplitRow[] | null
  /**
   * [STATIEGELD-GAT] The deposit line the import found back on the paper for a breakdown that
   * comes up short, when there is one.
   *
   * It exists here for the reason this whole component exists: the SAME invoice is corrected from
   * more than one screen, and a help that lives on only one of them is a screen telling the owner
   * the amounts are simply wrong while the other screen hands them the answer. The confirm queue
   * had this one tap; the pay screen and the bank screen — where the owner is looking at the
   * payment with the paper beside them — did not.
   */
  depositGap?: DepositGap | null
}) {
  const t = translator(useLocale())
  const dialog = useDialog()
  // [BACK-CLOSES] The system back button closes this, instead of leaving the page behind it.
  useCloseOnBack(true, onClose)
  useBodyScrollLock(true)
  const [amounts, setAmounts] = useState({
    ex: invoice.total_ex_btw ?? 0,
    btw: invoice.btw_amount ?? 0,
    incl: invoice.total_inc_btw ?? 0,
  })
  // [KOMMA-INVOER] Same pairing as the confirm modal (IncomingInvoicesClient): the field shows the
  // raw keystrokes while the numbers state holds the parse. These were <input type="number">, which
  // refuses the Dutch decimal comma — the amounts this modal exists to copy off the paper are
  // printed WITH one — and its parseFloat read a pasted "1.160,68" as 1.16.
  // Display rounds to the cent; the held value stays untouched (amount-triplet is deliberately
  // unrounded) — otherwise a derived field paints the float tail of ni − t.btw on screen.
  const [amountDraft, setAmountDraft] = useState<{ field: 'ex' | 'btw' | 'incl'; text: string } | null>(null)
  const amountShown = (field: 'ex' | 'btw' | 'incl', held: number) =>
    amountDraft?.field === field ? amountDraft.text : String(round2(held)).replace('.', ',')
  const [number, setNumber] = useState(invoice.invoice_number ?? '')
  const [vendor, setVendor] = useState(invoice.client_name ?? '')
  const [date, setDate] = useState(invoice.invoice_date ?? '')
  const [dueDate, setDueDate] = useState(invoice.due_date ?? '')
  const [iban, setIban] = useState(invoice.vendor_iban ?? '')
  const [kenmerk, setKenmerk] = useState(invoice.payment_reference ?? '')
  // [SPLIT-CORRECTIE] The paper's own specification: one row per rate, as TEXT (comma decimals
  // like every Dutch invoice). Prefilled from what stands; empty everywhere = clear it.
  const splitStart = (rate: number) => {
    const r = (btwRows ?? []).find((x) => x.rate === rate)
    return { base: r ? String(r.base).replace('.', ',') : '', btw: r ? String(r.btw).replace('.', ',') : '' }
  }
  const [split, setSplit] = useState<Record<number, { base: string; btw: string }>>({
    21: splitStart(21), 9: splitStart(9), 0: splitStart(0),
  })
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
    // [LEES-CORRECTIE] Empty string means "wis dit veld" — the route clears to NULL.
    if (dueDate !== (invoice.due_date ?? '')) body.due_date = dueDate
    if (iban.trim() !== (invoice.vendor_iban ?? '')) body.vendor_iban = iban.trim()
    if (kenmerk.trim() !== (invoice.payment_reference ?? '')) body.payment_reference = kenmerk.trim()
    // [SPLIT-CORRECTIE] Sent only when the typed rows differ from what stood. Rows with both
    // fields empty do not exist; everything empty = [] = wis de specificatie. Parsing is
    // comma-tolerant; the SERVER validates the arithmetic and refuses with the exact numbers.
    {
      const num = (v: string) => Number(v.trim().replace(/\./g, '').replace(',', '.'))
      const typed = [21, 9, 0]
        .map((rate) => ({ rate, b: split[rate].base.trim(), w: split[rate].btw.trim() }))
        .filter((r) => r.b !== '' || r.w !== '')
        .map((r) => ({ rate: r.rate, base: num(r.b || '0'), btw: num(r.w || '0') }))
      const stond = (btwRows ?? []).map((r) => ({ rate: r.rate, base: r.base, btw: r.btw }))
        .sort((a, b2) => b2.rate - a.rate)
      const nu = [...typed].sort((a, b2) => b2.rate - a.rate)
      if (JSON.stringify(nu) !== JSON.stringify(stond)) body.btw_rows = typed
    }
    if (credit) body.is_credit_note = true

    if (Object.keys(body).length === 0) {
      onMessage(t('corr.nietsGewijzigd'))
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
        onMessage(typeof data.error === 'string' ? data.error : t('corr.mislukt'))
        return
      }
      // Only now does the caller's list follow. Writing it optimistically would show a corrected
      // amount the server may have refused, on a screen the owner pays from.
      onSaved(data as CorrectionResult)
      onClose()

      // [SUPPLETIE] Handled HERE, and not left to each caller, because this modal is the one place
      // every correction of a booked purchase invoice passes through. A caller that forgets is not
      // a missing toast: it is an owner who never learns they owe the Belastingdienst a correction.
      //
      // A dialog rather than a toast, deliberately. The others on this screen report what the owner
      // just did; this one reports a duty they acquired by doing it, with a legal clock attached
      // (art. 10a AWR). Three seconds and a fade is the wrong shape for that — it has to be
      // acknowledged. The bell keeps a copy either way; the server writes a notification too, so
      // this sentence surviving the modal does not depend on the owner reading it now.
      const suppletie = Array.isArray((data as { suppletie?: unknown }).suppletie)
        ? ((data as { suppletie: unknown[] }).suppletie.filter((x): x is string => typeof x === 'string' && x.trim() !== ''))
        : []
      if (suppletie.length > 0) {
        // [TAAL-DB] Dutch, like the aangifte it is about — see CorrectionResult.suppletie.
        await dialog.alert({
          title: 'Let op: dit kwartaal is al ingediend',
          message: suppletie.join('\n\n'),
          // 'danger' rather than 'error': nothing failed. Something became DUE.
          tone: 'danger',
        })
      }
      // [SUPPLIER-ALIAS] When the server LEARNED something from this correction, say that instead
      // — it is the more useful of the two sentences. "Factuur gecorrigeerd" tells the owner what
      // they already know; naming the memory tells them they will not be typing this again next
      // month, which is the whole reason the lesson exists. Null when nothing was learned, and then
      // nothing is claimed.
      const memory = typeof (data as { supplier_memory?: unknown }).supplier_memory === 'string'
        ? (data as { supplier_memory: string }).supplier_memory
        : null
      onMessage(memory ?? t('corr.gecorrigeerd'))
    } catch {
      onMessage(t('corr.misluktVerbinding'))
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
      aria-label={t('corr.aria')}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center', zIndex: 3000 }}
      onClick={() => !saving && onClose()}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ background: '#fff', borderRadius: '20px 20px 0 0', padding: '22px 20px', paddingBottom: 'calc(22px + var(--bottom-nav-h, 0px) + env(safe-area-inset-bottom))', width: '100%', maxWidth: 460, fontFamily: FONT, maxHeight: '88vh', overflowY: 'auto' }}
      >
        <p style={{ fontSize: 18, fontWeight: 700, color: '#202124', margin: 0 }}>{t('corr.titel')}</p>
        <p style={{ fontSize: 13, color: '#5F6368', margin: '4px 0 16px', lineHeight: 1.45 }}>
          {t('corr.uitleg')}
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
        {field(t('corr.leverancier'), vendor, setVendor)}
        {field(t('corr.factuurnummer'), number, setNumber)}
        {field(t('corr.factuurdatum'), date, setDate, 'date')}
        {/* [LEES-CORRECTIE] due date schedules Vandaag + reminders; the IBAN feeds the
            fraud check and the bank-match tier; the kenmerk is what the owner types into
            their bank. All three were pipeline-written and uncorrectable. */}
        {field(t('corr.vervaldatum'), dueDate, setDueDate, 'date')}
        {field(t('corr.iban'), iban, setIban)}
        {field(t('corr.kenmerk'), kenmerk, setKenmerk)}

        {/* [SPLIT-CORRECTIE] De specificatie zoals die op het papier staat — één regel per tarief.
            De server rekent na en weigert met de exacte getallen wanneer het niet optelt; leeg
            overal betekent: wis de specificatie. */}
        <div style={{ height: 1, background: '#EEE', margin: '4px 0 16px' }} />
        <p style={{ fontSize: 13, color: '#5F6368', margin: '0 0 10px', lineHeight: 1.45 }}>
          {t('corr.splitUitleg')}
        </p>
        {[21, 9, 0].map((rate) => (
          <div key={rate} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <span style={{ width: 44, fontSize: 13.5, fontWeight: 600, color: '#3c4043', flexShrink: 0 }}>{rate}%</span>
            <input
              type="text" inputMode="decimal" placeholder={t('corr.grondslag')}
              value={split[rate].base}
              onChange={(e) => setSplit((p) => ({ ...p, [rate]: { ...p[rate], base: e.target.value } }))}
              style={{ flex: 1, minWidth: 0, padding: '9px 10px', fontSize: 14, borderRadius: 10, border: '1px solid #d1d1d6', outline: 'none', color: '#202124', fontFamily: FONT }}
            />
            <input
              type="text" inputMode="decimal" placeholder={t('corr.btwBedrag')}
              value={split[rate].btw}
              onChange={(e) => setSplit((p) => ({ ...p, [rate]: { ...p[rate], btw: e.target.value } }))}
              style={{ flex: 1, minWidth: 0, padding: '9px 10px', fontSize: 14, borderRadius: 10, border: '1px solid #d1d1d6', outline: 'none', color: '#202124', fontFamily: FONT }}
            />
          </div>
        ))}

        <div style={{ height: 1, background: '#EEE', margin: '4px 0 16px' }} />

        <p style={{ fontSize: 13, color: '#5F6368', margin: '0 0 12px', lineHeight: 1.45 }}>
          {t('corr.bedragUitleg')}
        </p>

        {[
          { key: 'incl' as const, label: t('corr.totaalIncl'), apply: setIncl, strong: true },
          { key: 'btw' as const, label: t('corr.btw'), apply: setBtw, strong: false },
          { key: 'ex' as const, label: t('corr.exclBtw'), apply: setExcl, strong: false },
        ].map((f) => (
          <div key={f.key} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10, gap: 12 }}>
            <span style={{ fontSize: 14, fontWeight: f.strong ? 700 : 500, color: '#202124' }}>{f.label}</span>
            <input
              type="text"
              inputMode="decimal"
              value={amountShown(f.key, amounts[f.key])}
              onChange={(e) => { setAmountDraft({ field: f.key, text: e.target.value }); setAmounts(f.apply(amounts, parseAmountNL(e.target.value))) }}
              onBlur={() => setAmountDraft(null)}
              aria-label={f.label}
              style={{ width: 140, padding: '9px 11px', fontSize: f.strong ? 17 : 15, fontWeight: f.strong ? 700 : 600, borderRadius: 10, border: '1.5px solid #1a73e8', textAlign: 'end', outline: 'none', color: '#202124' }}
            />
          </div>
        ))}

        {/* [STATIEGELD-GAT] One tap, because the arithmetic is already done. The difference is
            fixed by the identity and the word beside it was found on the document itself at import
            — so there is nothing left to work out, only to confirm. The btw does not move: no btw
            is charged over a deposit, which is exactly why this is safe to offer. Disappears the
            moment the amounts add up; the button exists only while there is a gap. */}
        {depositGap && Math.abs(round2(amounts.incl - amounts.ex - amounts.btw)) > 0.02 && (
          <>
            <button
              type="button"
              onClick={() => setAmounts(setExcl(amounts, round2(amounts.ex + depositGap.gap)))}
              style={{
                width: '100%', minHeight: 44, borderRadius: 12, border: '1px solid #1a73e8',
                background: '#e8f0fe', color: '#1a4fa0', fontSize: 13.5, fontWeight: 600,
                cursor: 'pointer', fontFamily: FONT, padding: '10px 12px', lineHeight: 1.4,
                marginBottom: 10,
              }}
            >
              {t('corr.statiegeld.meetellen')}
            </button>
            {/* The sentence the checklist row uses, from the same module — two spellings of one
                explanation drift, and this one names the figure the base becomes. */}
            <p style={{ fontSize: 12, color: '#5F6368', lineHeight: 1.45, margin: '0 0 12px' }}>
              {depositGapText(depositGap)}
            </p>
          </>
        )}

        {/* [KIND-CORRECTION] The one-way declaration. Without it a net-negative invoice cannot be
            entered at all, and a credit note keeps counting as a debt. */}
        {invoice.invoice_type !== 'creditnota' && (
          <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, margin: '14px 0 4px', cursor: 'pointer' }}>
            <input type="checkbox" checked={credit} onChange={(e) => setCredit(e.target.checked)} style={{ marginTop: 2, width: 16, height: 16, accentColor: '#0B8043' }} />
            <span style={{ fontSize: 12, color: '#3c4043', lineHeight: 1.45 }}>
              <strong>{t('corr.creditTitel')}</strong>{t('corr.creditUitleg')}
            </span>
          </label>
        )}

        <p style={{ fontSize: 12, color: '#5F6368', lineHeight: 1.45, margin: '12px 0 16px' }}>
          {t('corr.statiegeld')}
        </p>

        <button
          onClick={save}
          disabled={saving}
          style={{ width: '100%', padding: '15px', borderRadius: 14, background: saving ? '#9AA0A6' : M3.primary, color: '#fff', border: 'none', fontWeight: 700, fontSize: 16, cursor: saving ? 'default' : 'pointer', marginBottom: 8, fontFamily: FONT }}
        >
          {saving ? t('corr.opslaanBezig') : t('corr.opslaan')}
        </button>
        <button
          onClick={onClose}
          disabled={saving}
          style={{ width: '100%', padding: '13px', borderRadius: R.md, background: M3.surfaceVariant, color: '#3c4043', border: 'none', fontWeight: 600, fontSize: 15, cursor: 'pointer', fontFamily: FONT }}
        >
          {t('corr.annuleren')}
        </button>
      </div>
    </div>
  )
}
