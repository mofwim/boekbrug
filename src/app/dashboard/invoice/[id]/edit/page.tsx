'use client'

// src/app/dashboard/invoice/[id]/edit/page.tsx
// BOEK-001: Invoice Edit
// نفس شكل ومنطق new/page.tsx — لكن يحمّل البيانات الموجودة ويرسل PUT

import { useState, useEffect } from 'react'
import { isInvoiceEditable, isQuote } from '@/lib/invoice-editable'
import { createClient } from '@/lib/supabase'
import { useRouter, useParams } from 'next/navigation'
import Link from 'next/link'
import { useSubPageHeader } from '@/components/nav/SubPageHeaderContext'
// [BOEK-031] Navigation Strategy — May 2026
import { useParentPath } from '@/lib/navigation-hooks'
import type { Role } from '@/lib/navigation'
import type { ProfileRow } from '@/types/rows'
import { COLUMN } from '@/lib/design/tokens';
// [PRIJS-MODUS] Dezelfde omrekening als het aanmaakscherm — één definitie, twee schermen.
import { priceFieldValue, priceFieldToStored, repriceForRateChange, type PriceMode } from '@/lib/price-mode'
// [BACK-CLOSES] Back closes what is open — see src/lib/use-close-on-back.ts.
import { useCloseOnBack } from '@/lib/use-close-on-back'
// [DATE-NL] The typing surface, in Dutch order — see date-field-nl.ts.
import DateFieldNL from '@/components/ui/DateFieldNL'

type InvoiceLine = {
  description: string
  quantity: number
  unit_price: number
  btw_rate: number
  // [VRIJGESTELD-ROUNDTRIP] Niet bewerkbaar op dit scherm, wél meegedragen. De PUT vervangt alle
  // regels door wat hier wordt teruggestuurd, dus een veld dat deze twee regels niet noemt bestaat
  // na het opslaan niet meer. vat_treatment is de vlag waaraan de aangifte vrijgestelde omzet
  // herkent; een vervaldatum wijzigen mag geen omzet naar een andere rubriek verhuizen.
  unit?: string | null
  vat_treatment?: string | null
}

export default function InvoiceEditPage() {
  const router = useRouter()
  const params = useParams()
  const invoiceId = params.id as string
  const supabase = createClient()

  const [profile, setProfile] = useState<ProfileRow | null>(null)
  const [invoiceNumber, setInvoiceNumber] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  // [BOEK-031] Send flow state — May 2026
  const [invoiceStatus, setInvoiceStatus] = useState<string>('draft')
  // [OFFERTE-BEWERKBAAR] Dit scherm wist niet WAT het bewerkte. Het heette "Factuur bewerken" boven
  // een offerte, en zijn bevestiging beloofde "de factuur" te versturen — terwijl versturen een
  // offerte OMZET in een genummerde factuur (send-route, isConversion). Eén tik, onomkeerbaar
  // (Art. 35), en het woord offerte kwam nergens voor.
  const [invoiceType, setInvoiceType] = useState<string>('factuur')
  const quote = isQuote(invoiceType)
  const [showSendModal, setShowSendModal] = useState(false)
  useCloseOnBack(!!showSendModal, () => setShowSendModal(false))
  const [sending, setSending] = useState(false)

  // [BOEK-031] Navigation Strategy — parent + home via helper — May 2026
  const role: Role = (profile?.role === 'accountant' ? 'accountant' : 'zzper')
  const parentHref = useParentPath(role)

  // بيانات العميل
  const [clientName, setClientName] = useState('')
  const [clientAddress, setClientAddress] = useState('')
  const [clientPostal, setClientPostal] = useState('')
  const [clientCity, setClientCity] = useState('')
  const [clientEmail, setClientEmail] = useState('')
  const [clientBtw, setClientBtw] = useState('')

  // التواريخ
  const [invoiceDate, setInvoiceDate] = useState('')
  const [dueDate, setDueDate] = useState('')

  // البنود
  const [lines, setLines] = useState<InvoiceLine[]>([
    { description: '', quantity: 1, unit_price: 0, btw_rate: 21 }
  ])

  useEffect(() => {
    async function load() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { router.push('/login'); return }

      // جلب الفاتورة مع التحقق من الملكية في نفس الـ query
      const { data: invoice } = await supabase
        .from('invoices')
        .select('*')
        .eq('id', invoiceId)
        .eq('sender_id', user.id)
        .single()

      if (!invoice) { router.push('/dashboard'); return }

      // جلب profile المستخدم الحالي (للـ header)
      const { data: profileData } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', user.id)
        .single()

      if (profileData) setProfile(profileData)

      // جلب الـ lines
      const { data: linesData } = await supabase
        .from('invoice_lines')
        // [VRIJGESTELD-ROUNDTRIP] unit en vat_treatment horen erbij, want dit scherm PUT terug wat het
        // leest en de PUT vervangt alle regels. Wat hier niet wordt gelezen, bestaat na het opslaan
        // niet meer — en vat_treatment is de vlag waaraan de aangifte vrijgestelde omzet herkent.
        .select('description, quantity, unit_price, btw_rate, unit, vat_treatment')
        .eq('invoice_id', invoiceId)

      // تعبئة الـ state بالبيانات الموجودة
      setInvoiceNumber(invoice.invoice_number)
      // [BOEK-031] Track current status for button visibility — May 2026
      setInvoiceStatus(invoice.status || 'draft')
      setInvoiceType(invoice.invoice_type || 'factuur')
      setClientName(invoice.client_name || '')
      setClientEmail(invoice.client_email || '')
      setClientAddress(invoice.client_address || '')
      setClientPostal(invoice.client_postal_code || '')
      setClientCity(invoice.client_city || '')
      setClientBtw(invoice.client_btw_number || '')
      setInvoiceDate(invoice.invoice_date || '')
      setDueDate(invoice.due_date || '')

      if (linesData && linesData.length > 0) setLines(linesData)

      setLoading(false)
    }
    load()
  }, [invoiceId])

  // ── [PRIJS-MODUS] Met of zonder btw typen ──────────────────────────────────
  // Dezelfde stand als op het aanmaakscherm, uit dezelfde localStorage-sleutel: wie zijn factuur
  // all-in heeft opgesteld, opent hem hier ook all-in. Zonder dit zou hij bij het bewerken ineens
  // ex-btw prijzen zien en die "corrigeren" naar zijn all-in bedrag — en dan klopt de factuur niet
  // meer met wat hij zijn klant beloofde. Wat er wordt opgeslagen blijft ex-btw.
  const [priceMode, setPriceMode] = useState<PriceMode>('excl')
  useEffect(() => {
    try {
      const saved = localStorage.getItem('boekbrug.priceMode')
      // Externe opslag één keer inlezen bij het monteren — zie dezelfde uitzondering op het
      // aanmaakscherm; dit veroorzaakt geen cascade, het gebeurt eenmalig.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (saved === 'incl' || saved === 'excl') setPriceMode(saved)
    } catch { /* geblokkeerde opslag: dan gewoon de standaard */ }
  }, [])
  function choosePriceMode(mode: PriceMode) {
    setPriceMode(mode)
    try { localStorage.setItem('boekbrug.priceMode', mode) } catch { /* niet erg */ }
  }
  /** Het prijsveld schrijft de prijs EX-btw weg, ook als er een incl-bedrag in staat. */
  function updateLinePrice(index: number, typed: number) {
    setLines(lines.map((l, i) => i === index
      ? { ...l, unit_price: priceFieldToStored(typed, l.btw_rate, priceMode) } : l))
  }
  /** [TARIEF] In incl-modus blijft de prijs voor de klant staan; in excl-modus de ingetypte prijs. */
  function updateLineRate(index: number, newRate: number) {
    setLines(lines.map((l, i) => i === index
      ? { ...l, btw_rate: newRate, unit_price: repriceForRateChange(l.unit_price, l.btw_rate, newRate, priceMode) }
      : l))
  }

  // ── Line helpers ──────────────────────────────────────────────────────────
  function addLine() {
    setLines([...lines, { description: '', quantity: 1, unit_price: 0, btw_rate: 21 }])
  }

  function removeLine(index: number) {
    if (lines.length === 1) return
    setLines(lines.filter((_, i) => i !== index))
  }

  function updateLine(index: number, field: keyof InvoiceLine, value: string | number) {
    const updated = [...lines]
    updated[index] = { ...updated[index], [field]: value }
    setLines(updated)
  }

  // ── Totalen — realtime ────────────────────────────────────────────────────
  const totalEx = lines.reduce((sum, l) => sum + l.quantity * l.unit_price, 0)
  const btwAmount = lines.reduce((sum, l) => sum + l.quantity * l.unit_price * (l.btw_rate / 100), 0)
  const totalInc = totalEx + btwAmount

  // ── Opslaan — PUT ─────────────────────────────────────────────────────────
  async function handleSave() {
    if (!clientName || !clientEmail || !invoiceDate || !dueDate) {
      setError('Vul alle verplichte velden in (*)')
      return
    }
    if (lines.some(l => !l.description || l.unit_price <= 0)) {
      setError('Vul alle factuurregels correct in')
      return
    }

    setSaving(true)
    setError('')

    const res = await fetch(`/api/invoice/${invoiceId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_name: clientName,
        client_email: clientEmail,
        client_address: clientAddress,
        client_postal_code: clientPostal,
        client_city: clientCity,
        client_btw_number: clientBtw,
        invoice_date: invoiceDate,
        due_date: dueDate,
        lines
      })
    })

    const data = await res.json()

    if (!res.ok) {
      setError(data.error || 'Opslaan mislukt')
      setSaving(false)
      return
    }

    // [BOEK-031] replace ipv push — voorkomt back loop naar edit pagina — May 2026
    router.replace(`/dashboard/invoice/${invoiceId}`)
  }

  // [BOEK-031] Send invoice — saves first, then triggers /api/invoice/send — May 2026
  async function handleSendInvoice() {
    if (!clientName || !clientEmail || !invoiceDate || !dueDate) {
      setError('Vul alle verplichte velden in (*)')
      return
    }
    if (lines.some(l => !l.description || l.unit_price <= 0)) {
      setError('Vul alle factuurregels correct in')
      return
    }

    setSending(true)
    setError('')

    // 1. Save changes first (PUT)
    const saveRes = await fetch(`/api/invoice/${invoiceId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_name: clientName,
        client_email: clientEmail,
        client_address: clientAddress,
        client_postal_code: clientPostal,
        client_city: clientCity,
        client_btw_number: clientBtw,
        invoice_date: invoiceDate,
        due_date: dueDate,
        lines,
      }),
    })

    if (!saveRes.ok) {
      const data = await saveRes.json().catch(() => ({}))
      setError(data.error || 'Opslaan mislukt')
      setSending(false)
      return
    }

    // 2. Call send endpoint (generates number, updates status, emails)
    const sendRes = await fetch('/api/invoice/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ invoiceId }),
    })

    if (!sendRes.ok) {
      const data = await sendRes.json().catch(() => ({}))
      setError(data.error || 'Verzenden mislukt')
      setSending(false)
      return
    }

    // 3. Success — refresh server data + navigate to detail
    router.refresh()
    router.replace(`/dashboard/invoice/${invoiceId}`)
  }

  // [SUBNAV] Title (+ invoice number) in the shared header; called before the
  // loading return so hook order stays stable.
  useSubPageHeader(
    { title: quote ? 'Offerte bewerken' : invoiceNumber ? `Factuur bewerken · ${invoiceNumber}` : 'Factuur bewerken' },
    [invoiceNumber, quote]
  )

  // ── Loading ───────────────────────────────────────────────────────────────
  if (loading) return (
    <div className="min-h-screen bg-[#f8f9fa] flex items-center justify-center">
      <p className="text-gray-400 text-sm">Laden...</p>
    </div>
  )

  return (
    <div className="min-h-screen bg-[#f8f9fa]">

      <div className="mx-auto px-6 py-6 space-y-4" style={{ maxWidth: COLUMN.work }}>

        {/* Jouw gegevens — alleen-lezen */}
        {profile && (
          <div className="bg-white rounded-2xl p-5 shadow-sm">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">
              Jouw gegevens
            </p>
            <div className="grid grid-cols-2 gap-1 text-sm">
              <p className="font-medium text-gray-900 col-span-2">{profile.company_name || profile.full_name}</p>
              <p className="text-gray-500">{profile.address}</p>
              <p className="text-gray-500">{profile.postal_code} {profile.city}</p>
              <p className="text-gray-500">KVK: {profile.kvk_number || '—'}</p>
              <p className="text-gray-500">BTW: {profile.btw_number || '—'}</p>
            </div>
            {(!profile.kvk_number || !profile.btw_number || !profile.iban) && (
              <p className="text-xs text-amber-500 mt-3">
                ⚠️ KVK, BTW of IBAN ontbreekt — vul dit aan in je profiel voor een geldige factuur
              </p>
            )}
          </div>
        )}

        {/* Klantgegevens */}
        <div className="bg-white rounded-2xl p-5 shadow-sm space-y-3">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Klantgegevens</p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">
                Bedrijfsnaam <span className="text-red-400">*</span>
              </label>
              <input
                type="text" value={clientName}
                onChange={e => setClientName(e.target.value)}
                className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm"
                placeholder="Klant BV"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">
                E-mailadres <span className="text-red-400">*</span>
              </label>
              <input
                type="email" value={clientEmail}
                onChange={e => setClientEmail(e.target.value)}
                className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm"
                placeholder="klant@bedrijf.nl"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Adres</label>
              <input
                type="text" value={clientAddress}
                onChange={e => setClientAddress(e.target.value)}
                className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm"
                placeholder="Straat 1"
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Postcode</label>
                <input
                  type="text" value={clientPostal}
                  onChange={e => setClientPostal(e.target.value)}
                  className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm"
                  placeholder="1234 AB"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Stad</label>
                <input
                  type="text" value={clientCity}
                  onChange={e => setClientCity(e.target.value)}
                  className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm"
                  placeholder="Amsterdam"
                />
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">BTW-nummer klant</label>
              <input
                type="text" value={clientBtw}
                onChange={e => setClientBtw(e.target.value)}
                className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm"
                placeholder="NL123456789B01"
              />
            </div>
          </div>
        </div>

        {/* Datums */}
        <div className="bg-white rounded-2xl p-5 shadow-sm">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">Datums</p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">
                Factuurdatum <span className="text-red-400">*</span>
              </label>
              {/* [DATE-NL] The browser's locale decides a native date input's segment order, and
                  this date picks the quarter this sale is declared in. */}
              <DateFieldNL value={invoiceDate} onChange={setInvoiceDate} aria-label="Factuurdatum" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">
                Vervaldatum <span className="text-red-400">*</span>
              </label>
              <DateFieldNL value={dueDate} onChange={setDueDate} aria-label="Vervaldatum" />
            </div>
          </div>
        </div>

        {/* Factuurregels */}
        <div className="bg-white rounded-2xl p-5 shadow-sm space-y-3">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Factuurregels</p>

          {/* [PRIJS-MODUS] Dezelfde keuze als op het aanmaakscherm, boven de kolomkoppen — want hij
              bepaalt wat de kolom "Prijs" betekent. De koppen hieronder zeggen het daarna zelf, zodat
              niemand een all-in bedrag voor een ex-btw prijs aanziet (of andersom). */}
          <div className="flex items-center gap-3 flex-wrap bg-gray-50 rounded-xl px-3 py-2">
            <span className="text-xs font-medium text-gray-500">Prijzen invoeren</span>
            <div role="group" aria-label="Prijzen invoeren inclusief of exclusief btw" className="flex gap-1 bg-gray-200 rounded-full p-0.5">
              {(['excl', 'incl'] as PriceMode[]).map(m => (
                <button
                  key={m}
                  type="button"
                  aria-pressed={priceMode === m}
                  onClick={() => choosePriceMode(m)}
                  className={`rounded-full px-3 py-1 text-xs font-semibold ${priceMode === m ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500'}`}
                >
                  {m === 'incl' ? 'incl. btw' : 'excl. btw'}
                </button>
              ))}
            </div>
            <span className="text-xs text-gray-400">
              {priceMode === 'incl' ? 'Je typt wat je klant betaalt.' : 'Je typt de prijs zonder btw.'}
            </span>
          </div>

          <div className="grid grid-cols-12 gap-2 text-xs font-medium text-gray-400 px-1">
            <div className="col-span-5">Omschrijving</div>
            <div className="col-span-2">Aantal</div>
            <div className="col-span-2">{priceMode === 'incl' ? 'Prijs incl. (€)' : 'Prijs excl. (€)'}</div>
            <div className="col-span-2">BTW</div>
            <div className="col-span-1"></div>
          </div>

          {lines.map((line, index) => (
            <div key={index} className="grid grid-cols-12 gap-2 items-center">
              <div className="col-span-5">
                <input
                  type="text" value={line.description}
                  onChange={e => updateLine(index, 'description', e.target.value)}
                  className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm"
                  placeholder="Omschrijving dienst"
                />
              </div>
              <div className="col-span-2">
                <input
                  type="number" value={line.quantity} min="1"
                  onChange={e => updateLine(index, 'quantity', parseFloat(e.target.value) || 0)}
                  className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm"
                />
              </div>
              <div className="col-span-2">
                {/* [PRIJS-MODUS] Toont en accepteert de prijs in de gekozen stand; de regel
                    bewaart altijd ex-btw. */}
                <input
                  type="number" value={priceFieldValue(line.unit_price, line.btw_rate, priceMode)} min="0" step="0.01"
                  onChange={e => updateLinePrice(index, parseFloat(e.target.value) || 0)}
                  className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm"
                  placeholder="0.00"
                />
              </div>
              <div className="col-span-2">
                <select
                  value={line.btw_rate}
                  onChange={e => updateLineRate(index, parseFloat(e.target.value))}
                  className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm"
                >
                  <option value={21}>21%</option>
                  <option value={9}>9%</option>
                  <option value={0}>0%</option>
                </select>
              </div>
              <div className="col-span-1 flex justify-center">
                {lines.length > 1 && (
                  <button
                    onClick={() => removeLine(index)}
                    className="text-gray-300 hover:text-red-400 text-xl leading-none"
                  >
                    ×
                  </button>
                )}
              </div>
            </div>
          ))}

          <button
            onClick={addLine}
            className="text-blue-600 text-sm font-medium hover:text-blue-700"
          >
            + Regel toevoegen
          </button>
        </div>

        {/* Totalen */}
        <div className="bg-white rounded-2xl p-5 shadow-sm">
          <div className="space-y-2 text-sm max-w-xs ml-auto">
            <div className="flex justify-between text-gray-500">
              <span>Subtotaal excl. BTW</span>
              <span>€{totalEx.toFixed(2)}</span>
            </div>
            <div className="flex justify-between text-gray-500">
              <span>BTW</span>
              <span>€{btwAmount.toFixed(2)}</span>
            </div>
            <div className="flex justify-between font-bold text-gray-900 text-base pt-2 border-t border-gray-100">
              <span>Totaal incl. BTW</span>
              <span>€{totalInc.toFixed(2)}</span>
            </div>
          </div>
        </div>

        {/* Betalingsinformatie */}
        {profile?.iban && (
          <div className="bg-white rounded-2xl p-5 shadow-sm">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">
              Betalingsinformatie
            </p>
            <p className="text-sm text-gray-600">
              Gelieve te betalen binnen 30 dagen op{' '}
              <span className="font-medium text-gray-900">{profile.iban}</span>{' '}
              o.v.v.{' '}
              <span className="font-medium text-gray-900">{invoiceNumber}</span>
            </p>
          </div>
        )}

        {error && (
          <p className="text-sm text-red-500 px-1">{error}</p>
        )}

        {/* Acties */}
        <div className="flex gap-3 pb-8 flex-wrap">
          {isInvoiceEditable({ status: invoiceStatus, invoiceType, invoiceNumber }) ? (
            <>
              {/* [BOEK-031] Draft: 2 buttons — Save (keeps draft) + Send (triggers full flow) — May 2026 */}
              <button
                onClick={handleSave}
                disabled={saving || sending}
                className="bg-gray-100 text-gray-700 px-6 py-3 rounded-xl text-sm font-semibold hover:bg-gray-200 disabled:opacity-50"
              >
                {saving ? 'Opslaan...' : 'Wijzigingen opslaan'}
              </button>
              <button
                onClick={() => setShowSendModal(true)}
                disabled={saving || sending}
                className="bg-blue-600 text-white px-6 py-3 rounded-xl text-sm font-semibold hover:bg-blue-700 disabled:opacity-50"
              >
                {sending ? 'Verzenden...' : quote ? '✉ Omzetten naar factuur en versturen' : '✉ Verstuur factuur'}
              </button>
            </>
          ) : (
            // [ART-35] A verstuurde/uitgegeven factuur is wettelijk vastgelegd en kan NIET
            // meer worden gewijzigd — de server-PUT weigert elke niet-draft met 409. Toon
            // dat eerlijk in plaats van een "Wijzigingen opslaan"-knop die altijd faalt; een
            // correctie loopt via een creditnota (op de factuurpagina).
            <p className="text-sm text-gray-600 bg-gray-50 border border-gray-200 rounded-xl px-4 py-3">
              Deze factuur is verstuurd en wettelijk vastgelegd — wijzigen kan niet meer.
              Maak een <strong>creditnota</strong> aan om te corrigeren.
            </p>
          )}
          {/* [BOEK-031] Annuleren — Link to parent — Navigation Strategy — May 2026 */}
          <Link
            href={parentHref}
            className="border border-gray-200 text-gray-600 px-6 py-3 rounded-xl text-sm font-medium hover:bg-gray-50 no-underline inline-block"
          >
            Annuleren
          </Link>
        </div>

      </div>

      {/* [BOEK-031] Send confirmation modal — TODO: extract to shared CenteredModal component — May 2026 */}
      {showSendModal && (
        <div onClick={() => setShowSendModal(false)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 16 }}>
          <div onClick={e => e.stopPropagation()}
            style={{ background: 'white', borderRadius: 16, padding: 24, maxWidth: 420, width: '100%', boxShadow: '0 4px 24px rgba(0,0,0,0.16)' }}>
            <h3 style={{ fontSize: 18, fontWeight: 700, marginBottom: 4, color: '#202124' }}>
              Versturen naar {clientName}?
            </h3>
            <p style={{ fontSize: 14, color: '#5F6368', marginBottom: 16, lineHeight: 1.5 }}>
              {quote
                ? 'Let op: hiermee wordt deze offerte een OFFICIËLE FACTUUR. Hij krijgt een factuurnummer uit je reeks, en dat is niet terug te draaien — een factuur corrigeer je met een creditnota. Wil je alleen de offerte bijwerken, gebruik dan "Wijzigingen opslaan".'
                : 'Bevestig de gegevens voordat je de factuur verstuurt.'}
            </p>
            <dl style={{ fontSize: 13, marginBottom: 16, display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '8px 16px' }}>
              <dt style={{ color: '#5F6368', margin: 0 }}>Factuurnummer:</dt>
              <dd style={{ color: '#202124', fontWeight: 500, margin: 0 }}>
                {invoiceNumber || 'Wordt toegekend bij verzending'}
              </dd>
              <dt style={{ color: '#5F6368', margin: 0 }}>E-mail:</dt>
              <dd style={{ color: '#202124', fontWeight: 500, margin: 0 }}>{clientEmail}</dd>
              <dt style={{ color: '#5F6368', margin: 0 }}>Bedrag:</dt>
              <dd style={{ color: '#202124', fontWeight: 500, margin: 0 }}>€{totalInc.toFixed(2)}</dd>
            </dl>
            <p style={{ fontSize: 12, color: '#B3261E', backgroundColor: '#FCE8E6', padding: 10, borderRadius: 8, marginBottom: 16, lineHeight: 1.5 }}>
              ⚠ Na verzending kun je deze factuur niet meer wijzigen. Voor correcties maak je een creditnota.
            </p>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button onClick={() => setShowSendModal(false)}
                style={{ padding: '10px 20px', borderRadius: 8, border: '1px solid #E0E0E0', background: 'white', color: '#5F6368', fontSize: 14, fontWeight: 500, cursor: 'pointer' }}>
                Annuleren
              </button>
              <button onClick={() => { setShowSendModal(false); handleSendInvoice() }}
                style={{ padding: '10px 20px', borderRadius: 8, border: 'none', background: '#1A73E8', color: 'white', fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>
                Versturen
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}