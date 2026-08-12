'use client'

// src/app/dashboard/invoice/[id]/edit/page.tsx
// BOEK-001: Invoice Edit
// نفس شكل ومنطق new/page.tsx — لكن يحمّل البيانات الموجودة ويرسل PUT

import { useState, useEffect } from 'react'
import { isInvoiceEditable, isQuote } from '@/lib/invoice-editable'
import { paymentTermText, parsePaymentTerm, dueDateFromTerm, termFromDates, COMMON_PAYMENT_TERMS, MAX_PAYMENT_TERM_DAYS, longPaymentTermNotice } from '@/lib/payment-term'
import { applyDiscount, parseDiscount, discountLabel } from '@/lib/invoice-discount'
import { round2 } from '@/lib/invoice-totals'
import { createClient } from '@/lib/supabase'
import { useRouter, useParams } from 'next/navigation'
import Link from 'next/link'
import { useSubPageHeader } from '@/components/nav/SubPageHeaderContext'
// [BOEK-031] Navigation Strategy — May 2026
import { useParentPath } from '@/lib/navigation-hooks'
import type { Role } from '@/lib/navigation'
import type { ProfileRow } from '@/types/rows'
import { COLUMN } from '@/lib/design/tokens';
import { formatDateNL } from '@/lib/format-nl'
// [PRIJS-MODUS] Dezelfde omrekening als het aanmaakscherm — één definitie, twee schermen.
import { priceFieldValue, priceFieldToStored, repriceForRateChange, type PriceMode } from '@/lib/price-mode'
// [BACK-CLOSES] Back closes what is open — see src/lib/use-close-on-back.ts.
import { useCloseOnBack } from '@/lib/use-close-on-back'
// [DATE-NL] The typing surface, in Dutch order — see date-field-nl.ts.
import DateFieldNL from '@/components/ui/DateFieldNL'
// [KLANT-EXTRA] Zelfde bovengrens als het document en de schrijfroute — zie de kop daarvan.
import { MAX_EXTRA_LINE_LENGTH } from '@/lib/client-extra-lines'
import { useLocale } from '@/lib/i18n/use-locale'
import { translator } from '@/lib/i18n/t'

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
  const t = translator(useLocale())
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
  // [KORTING] Ook hier te wijzigen, niet alleen bij het aanmaken. Een korting die je alleen kunt
  // instellen door de factuur opnieuw te maken, is een korting die je bij de eerste onderhandeling
  // met de klant kwijt bent.
  const [discountType, setDiscountType] = useState<'percent' | 'amount'>('percent')
  const [discountValue, setDiscountValue] = useState('')
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
  // [KLANT-EXTRA] Twee vrije regels direct onder de klantnaam op het document — "t.a.v. …", een
  // afdeling of het inkoopordernummer dat de klant op de factuur wil zien. Leeg is de normale
  // toestand en levert precies het documentblok op dat er altijd al stond.
  const [clientExtra1, setClientExtra1] = useState('')
  const [clientExtra2, setClientExtra2] = useState('')
  const [clientExtra3, setClientExtra3] = useState('')

  // التواريخ
  const [invoiceDate, setInvoiceDate] = useState('')
  const [dueDate, setDueDate] = useState('')
  // [LEVERDATUM] Art. 35a lid 1 sub f Wet OB — de datum waarop de prestatie is verricht, en een
  // ander gegeven dan de factuurdatum. Het aanmaakscherm vroeg hem al; dit scherm niet, dus een
  // verkeerd ingevulde leverdatum was onherstelbaar behalve door het concept weg te gooien.
  const [deliveryDate, setDeliveryDate] = useState('')

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
        .select('description, quantity, unit_price, btw_rate, unit, vat_treatment, line_total')
        .eq('invoice_id', invoiceId)

      // تعبئة الـ state بالبيانات الموجودة
      setInvoiceNumber(invoice.invoice_number)
      // [BOEK-031] Track current status for button visibility — May 2026
      setInvoiceStatus(invoice.status || 'draft')
      setInvoiceType(invoice.invoice_type || 'factuur')
      // [KORTING] Wat er staat, zoals het is opgeslagen. Zonder deze twee regels opende het scherm
      // met een leeg kortingsveld boven een verlaagd totaal, en de eerste "Wijzigingen opslaan"
      // haalde de korting er stilletjes af.
      const dt = (invoice as { discount_type?: string | null }).discount_type
      const dv = (invoice as { discount_value?: number | null }).discount_value
      if (dt === 'percent' || dt === 'amount') setDiscountType(dt)
      setDiscountValue(dv == null ? '' : String(dv))
      setClientName(invoice.client_name || '')
      setClientEmail(invoice.client_email || '')
      setClientAddress(invoice.client_address || '')
      setClientPostal(invoice.client_postal_code || '')
      setClientCity(invoice.client_city || '')
      setClientBtw(invoice.client_btw_number || '')
      setClientExtra1(invoice.client_extra_line1 || '')
      setClientExtra2(invoice.client_extra_line2 || '')
      setClientExtra3(invoice.client_extra_line3 || '')
      setInvoiceDate(invoice.invoice_date || '')
      setDueDate(invoice.due_date || '')
      // [LEVERDATUM] Terugvallen op de factuurdatum, precies zoals /api/invoice/draft hem zet.
      // Een oude factuur zonder leverdatum opent dan met een ingevuld veld in plaats van een leeg
      // veld dat bij het opslaan een verplicht gegeven zou wissen.
      setDeliveryDate(
        (invoice as { delivery_date?: string | null }).delivery_date || invoice.invoice_date || ''
      )

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
  // [KORTING] Dezelfde module als de server, de PDF en de UBL-export. Zonder korting geeft
  // applyDiscount exact dezelfde drie getallen als de handmatige sommen die hier stonden.
  // [BETAALTERMIJN-LANG] Uit de twee datums, want op dit scherm is de vervaldatum het veld dat
  // wordt getypt en de termijn de afgeleide.
  const langeTermijn = longPaymentTermNotice(invoiceDate ? termFromDates(invoiceDate, dueDate) : null)
  const korting = parseDiscount(discountType, discountValue)
  // [REGEL-AFRONDING] Afgerond per regel — dezelfde waarde die de PUT-route opslaat (line_total:
  // round2(quantity * unit_price)). Zonder dit toont dit scherm een ander totaal dan het bedrag
  // dat je met Opslaan wegschrijft.
  const kortingTotalen = applyDiscount(
    lines.map(l => ({ line_total: round2(l.quantity * l.unit_price), btw_rate: l.btw_rate })),
    korting,
  )
  const subtotalEx = kortingTotalen.subtotal_ex_btw
  const totalEx = kortingTotalen.total_ex_btw
  const btwAmount = kortingTotalen.btw_amount
  const totalInc = kortingTotalen.total_inc_btw

  // ── Opslaan — PUT ─────────────────────────────────────────────────────────
  async function handleSave() {
    if (!clientName || !clientEmail || !invoiceDate || !dueDate) {
      setError(t('bewerk.vulVerplicht'))
      return
    }
    if (lines.some(l => !l.description || l.unit_price <= 0)) {
      setError(t('bewerk.vulRegels'))
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
        client_extra_line1: clientExtra1,
        client_extra_line2: clientExtra2,
        client_extra_line3: clientExtra3,
        invoice_date: invoiceDate,
        due_date: dueDate,
        // [LEVERDATUM] Alleen op een factuur. Een offerte levert niets en een creditnota erft de
        // leverdatum van de factuur die zij corrigeert — die sleutel weglaten laat de opgeslagen
        // waarde staan, want de route patcht alleen wat het scherm meestuurt.
        ...(invoiceType === 'factuur' ? { delivery_date: deliveryDate || invoiceDate } : {}),
        // [KORTING] Altijd meesturen, ook leeg: dat is hoe de route "korting eraf halen"
        // onderscheidt van "een oudere pagina die het veld niet kent".
        discount_type: invoiceType === 'creditnota' ? null : discountType,
        discount_value: invoiceType === 'creditnota' ? null : discountValue,
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
      setError(t('bewerk.vulVerplicht'))
      return
    }
    if (lines.some(l => !l.description || l.unit_price <= 0)) {
      setError(t('bewerk.vulRegels'))
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
        client_extra_line1: clientExtra1,
        client_extra_line2: clientExtra2,
        client_extra_line3: clientExtra3,
        invoice_date: invoiceDate,
        due_date: dueDate,
        // [LEVERDATUM] Alleen op een factuur. Een offerte levert niets en een creditnota erft de
        // leverdatum van de factuur die zij corrigeert — die sleutel weglaten laat de opgeslagen
        // waarde staan, want de route patcht alleen wat het scherm meestuurt.
        ...(invoiceType === 'factuur' ? { delivery_date: deliveryDate || invoiceDate } : {}),
        // [KORTING] Ook op de opslaan-en-versturen weg. Dit is de gevaarlijkste van de twee: hier
        // wordt het document een genummerde factuur, en een korting die op dit pad wegvalt gaat
        // onherroepelijk mee de deur uit tegen de volle prijs.
        discount_type: invoiceType === 'creditnota' ? null : discountType,
        discount_value: invoiceType === 'creditnota' ? null : discountValue,
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
              {t('bewerk.jouwGegevens')}
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
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">{t('bewerk.klantgegevens')}</p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">
                {t('nieuw.klant.bedrijf')} <span className="text-red-400">*</span>
              </label>
              <input
                type="text" value={clientName}
                onChange={e => setClientName(e.target.value)}
                className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm"
                placeholder="Klant BV"
              />
            </div>
            {/* [KLANT-EXTRA] Direct onder de naam, want dat is ook waar ze op het document staan.
                col-span-2 zodat een regel als "t.a.v. mevrouw Jansen · afdeling Inkoop" leesbaar
                blijft in een raster dat verder uit halve kolommen bestaat. */}
            <div className="col-span-2 grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">{t('nieuw.klant.extra1')}</label>
                <input
                  type="text" value={clientExtra1} maxLength={MAX_EXTRA_LINE_LENGTH}
                  onChange={e => setClientExtra1(e.target.value)}
                  className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm"
                  placeholder="t.a.v. mevrouw Jansen"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">{t('nieuw.klant.extra2')}</label>
                <input
                  type="text" value={clientExtra2} maxLength={MAX_EXTRA_LINE_LENGTH}
                  onChange={e => setClientExtra2(e.target.value)}
                  className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm"
                  placeholder={t('nieuw.klant.extraHint')}
                />
              </div>
              <div className="col-span-2">
                <label className="block text-xs font-medium text-gray-500 mb-1">{t('nieuw.klant.extra3')}</label>
                <input
                  type="text" value={clientExtra3} maxLength={MAX_EXTRA_LINE_LENGTH}
                  onChange={e => setClientExtra3(e.target.value)}
                  className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm"
                  placeholder={t('nieuw.betaalkenmerk.hint')}
                />
              </div>
              <p className="col-span-2 text-xs text-gray-500 -mt-1">
                Deze drie regels komen op het document direct onder de klantnaam te staan. Laat ze
                leeg als je ze niet nodig hebt.
              </p>
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
              <label className="block text-xs font-medium text-gray-500 mb-1">{t('nieuw.klant.adres')}</label>
              <input
                type="text" value={clientAddress}
                onChange={e => setClientAddress(e.target.value)}
                className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm"
                placeholder="Straat 1"
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">{t('nieuw.klant.postcode')}</label>
                <input
                  type="text" value={clientPostal}
                  onChange={e => setClientPostal(e.target.value)}
                  className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm"
                  placeholder="1234 AB"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">{t('nieuw.klant.stad')}</label>
                <input
                  type="text" value={clientCity}
                  onChange={e => setClientCity(e.target.value)}
                  className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm"
                  placeholder="Amsterdam"
                />
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">{t('nieuw.klant.btw')}</label>
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
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">{t('nieuw.datums')}</p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">
                {t('nieuw.datum.factuur')} <span className="text-red-400">*</span>
              </label>
              {/* [DATE-NL] The browser's locale decides a native date input's segment order, and
                  this date picks the quarter this sale is declared in. */}
              <DateFieldNL value={invoiceDate} onChange={setInvoiceDate} aria-label={t('nieuw.datum.factuur')} />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">
                {quote ? 'Geldig tot' : 'Vervaldatum'} <span className="text-red-400">*</span>
              </label>
              <DateFieldNL value={dueDate} onChange={setDueDate} aria-label={quote ? 'Geldig tot' : 'Vervaldatum'} />
            </div>
          </div>

          {/* [LEVERDATUM] Art. 35a lid 1 sub f Wet OB. Alleen op een factuur: een offerte levert
              niets, en een creditnota houdt de leverdatum van de factuur die zij corrigeert.
              Het aanmaakscherm vroeg hem al en de PDF drukt hem af — dit veld ontbrak, dus was
              een verkeerde leverdatum alleen te herstellen door het concept weg te gooien. */}
          {invoiceType === 'factuur' && (
            <div className="mt-3">
              <label className="block text-xs font-medium text-gray-500 mb-1">{t('nieuw.datum.lever')}</label>
              <DateFieldNL value={deliveryDate} onChange={setDeliveryDate} aria-label={t('nieuw.datum.lever')} />
              <p className="text-[11px] text-gray-500 mt-1">
                De datum waarop de levering of dienst is verricht. Vaak dezelfde als de factuurdatum,
                maar niet altijd — en hij is wettelijk verplicht op de factuur.
              </p>
            </div>
          )}

          {/* [BETAALTERMIJN] De termijn zelf, vrij in te vullen.
              Op het nieuwe-factuurscherm stonden drie chips: 14, 30 en 60. Een termijn is iets wat
              je per klant afspreekt ("jij krijgt 45 dagen"), dus elk heel getal mag — de grens in
              payment-term.ts is een tikfoutgrens, geen beleid.
              Dit blok bestaat niet op een offerte: haar datum betekent "Geldig tot", niet een
              betaaltermijn, en één veld twee dingen laten betekenen is hoe een document iets anders
              gaat zeggen dan het scherm. */}
          {!quote && (
            <div className="flex items-center gap-2 flex-wrap mt-3">
              <span className="text-xs text-gray-500">{t('nieuw.termijn.kort')}</span>
              {COMMON_PAYMENT_TERMS.map(days => {
                const active = invoiceDate !== '' && termFromDates(invoiceDate, dueDate) === days
                return (
                  <button
                    key={days}
                    type="button"
                    onClick={() => { if (invoiceDate) setDueDate(dueDateFromTerm(invoiceDate, days)) }}
                    className={`text-sm px-3.5 py-1.5 rounded-full border ${active ? 'border-blue-600 bg-blue-50 text-blue-700' : 'border-gray-200 bg-white text-gray-600'}`}
                  >
                    {days} dagen
                  </button>
                )
              })}
              <label className="flex items-center gap-1.5 text-sm text-gray-600">
                <span className="text-xs text-gray-500">of</span>
                <input
                  type="number"
                  min={0}
                  max={MAX_PAYMENT_TERM_DAYS}
                  inputMode="numeric"
                  placeholder="dagen"
                  value={invoiceDate ? (termFromDates(invoiceDate, dueDate) ?? '') : ''}
                  onChange={e => {
                    const days = parsePaymentTerm(e.target.value)
                    if (days != null && invoiceDate) setDueDate(dueDateFromTerm(invoiceDate, days))
                  }}
                  className="w-20 border border-gray-200 rounded-lg px-2 py-1.5 text-sm"
                  aria-label={t('nieuw.termijn')}
                />
              </label>
              {/* [BETAALTERMIJN-LANG] Zelfde woord als op het aanmaakscherm, en op dit scherm des
                  te nodiger: hier wordt de vervaldatum met de hand getypt, dus hier ontstaat een
                  termijn van een half jaar zonder dat iemand een knop met "180 dagen" aanklikte. */}
              {langeTermijn && (
                <p className="w-full text-xs text-amber-900 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-2 leading-relaxed">
                  {langeTermijn}
                </p>
              )}
            </div>
          )}
        </div>

        {/* Factuurregels */}
        <div className="bg-white rounded-2xl p-5 shadow-sm space-y-3">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">{t('nieuw.regels.factuur')}</p>

          {/* [PRIJS-MODUS] Dezelfde keuze als op het aanmaakscherm, boven de kolomkoppen — want hij
              bepaalt wat de kolom "Prijs" betekent. De koppen hieronder zeggen het daarna zelf, zodat
              niemand een all-in bedrag voor een ex-btw prijs aanziet (of andersom). */}
          <div className="flex items-center gap-3 flex-wrap bg-gray-50 rounded-xl px-3 py-2">
            <span className="text-xs font-medium text-gray-500">{t('nieuw.prijsmodus')}</span>
            <div role="group" aria-label={t('nieuw.prijsmodus.aria')} className="flex gap-1 bg-gray-200 rounded-full p-0.5">
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
            <div className="col-span-5">{t('nieuw.regel.omschrijving')}</div>
            <div className="col-span-2">{t('nieuw.regel.aantal')}</div>
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
                  placeholder={t('bewerk.omschrijvingDienst')}
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
                  /* [PRIJSVELD-CENT] Aantal en regeltotaal mee, zodat het veld net zoveel
                     decimalen toont als de regel nodig heeft. Op centen afgerond toonde het een
                     prijs die niet met zijn eigen regeltotaal vermenigvuldigt — en verving die
                     afgeronde prijs de opgeslagen breuk zodra er iets in het veld terechtkwam.
                     step="any": met step="0.01" weigert de browser zelf al een derde decimaal. */
                  type="number" value={priceFieldValue(line.unit_price, line.btw_rate, priceMode, line.quantity, (line as { line_total?: number | null }).line_total)} min="0" step="any"
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

        {/* [KORTING] Op de factuur én de offerte, niet op een creditnota — dat document is al een
            correctie. Zelfde regels als het aanmaakscherm; de server valideert opnieuw. */}
        {invoiceType !== 'creditnota' && (
          <div className="bg-white rounded-2xl p-5 shadow-sm flex items-center gap-3 flex-wrap">
            <span className="text-sm font-medium text-gray-900">{t('nieuw.korting')}</span>
            <div className="inline-flex rounded-full border border-gray-200 overflow-hidden">
              {(['percent', 'amount'] as const).map(t => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setDiscountType(t)}
                  className={`text-sm px-3.5 py-1.5 ${discountType === t ? 'bg-blue-50 text-blue-700' : 'bg-white text-gray-600'}`}
                >
                  {t === 'percent' ? '%' : '€'}
                </button>
              ))}
            </div>
            <input
              type="number"
              min={0}
              step="0.01"
              inputMode="decimal"
              placeholder={discountType === 'percent' ? 'bijv. 10' : 'bijv. 50,00'}
              value={discountValue}
              onChange={e => setDiscountValue(e.target.value)}
              aria-label={discountType === 'percent' ? t('nieuw.korting.percentage') : t('nieuw.korting.bedrag')}
              className="w-28 border border-gray-200 rounded-lg px-2.5 py-2 text-sm"
            />
            {discountValue.trim() !== '' && !korting && (
              <span className="text-xs text-red-600">
                {discountType === 'percent' ? 'Vul een percentage tussen 0 en 100 in.' : 'Vul een bedrag boven 0 in.'}
              </span>
            )}
          </div>
        )}

        {/* Totalen */}
        <div className="bg-white rounded-2xl p-5 shadow-sm">
          <div className="space-y-2 text-sm max-w-xs ms-auto">
            <div className="flex justify-between text-gray-500">
              <span>{t('nieuw.totaal.subtotaal')}</span>
              <span>€{subtotalEx.toFixed(2)}</span>
            </div>
            {kortingTotalen.discount_ex_btw > 0 && (
              <>
                <div className="flex justify-between text-green-700">
                  <span>{discountLabel(korting)}</span>
                  <span>−€{kortingTotalen.discount_ex_btw.toFixed(2)}</span>
                </div>
                <div className="flex justify-between text-gray-500">
                  <span>{t('nieuw.totaal.naKorting')}</span>
                  <span>€{totalEx.toFixed(2)}</span>
                </div>
              </>
            )}
            <div className="flex justify-between text-gray-500">
              <span>BTW</span>
              <span>€{btwAmount.toFixed(2)}</span>
            </div>
            <div className="flex justify-between font-bold text-gray-900 text-base pt-2 border-t border-gray-100">
              <span>{t('nieuw.totaal.incl')}</span>
              <span>€{totalInc.toFixed(2)}</span>
            </div>
          </div>
        </div>

        {/* Betalingsinformatie */}
        {profile?.iban && (
          <div className="bg-white rounded-2xl p-5 shadow-sm">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">
              {t('nieuw.betaalinfo')}
            </p>
            {/* [BETAALTERMIJN] De zin komt uit de DATA, niet uit een literal. Hier stond
                "binnen 30 dagen" als vaste tekst: wie een vervaldatum van veertien dagen had
                ingevuld, kreeg op het scherm waar hij zijn factuur nakijkt de belofte van dertig
                te zien. Het getal sloeg nergens op — en het stond op een document over geld.

                Is er niets eerlijks te zeggen (geen vervaldatum, of een datum vóór de
                factuurdatum), dan staat er niets. Zwijgen is beter dan een getal verzinnen. */}
            {quote ? (
              // Een offerte KENT geen betaaltermijn: haar due_date is "Geldig tot" — dat is wat de
              // PDF ervan drukt. Hier een betaalzin tonen zou het document tegenspreken.
              <p className="text-sm text-gray-600">
                {dueDate ? <>{t('bewerk.geldigTot')} <span className="font-medium text-gray-900">{formatDateNL(dueDate)}</span>. </> : null}
                Bij akkoord betaal je op{' '}
                <span className="font-medium text-gray-900">{profile.iban}</span>
              </p>
            ) : (
              <p className="text-sm text-gray-600">
                {paymentTermText({ invoiceDateIso: invoiceDate, dueDateIso: dueDate, iban: profile.iban })
                  ?? 'Betalen op'}{' '}
                <span className="font-medium text-gray-900">{profile.iban}</span>{' '}
                o.v.v.{' '}
                <span className="font-medium text-gray-900">{invoiceNumber}</span>
              </p>
            )}
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
            {t('nieuw.actie.annuleren')}
          </Link>
        </div>

      </div>

      {/* [BOEK-031] Send confirmation modal — TODO: extract to shared CenteredModal component — May 2026 */}
      {showSendModal && (
        <div onClick={() => setShowSendModal(false)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 16 }}>
          <div className="sheet-scroll" onClick={e => e.stopPropagation()}
            style={{ background: 'white', borderRadius: 16, padding: 24, maxWidth: 420, width: '100%', boxShadow: '0 4px 24px rgba(0,0,0,0.16)' }}>
            <h3 style={{ fontSize: 18, fontWeight: 700, marginBottom: 4, color: '#202124' }}>
              {t('bewerk.versturenNaar', { name: clientName })}
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
                {t('nieuw.actie.annuleren')}
              </button>
              <button onClick={() => { setShowSendModal(false); handleSendInvoice() }}
                style={{ padding: '10px 20px', borderRadius: 8, border: 'none', background: '#1A73E8', color: 'white', fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>
                {t('lijst.versturen')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}