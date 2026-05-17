'use client'

// src/app/dashboard/invoice/new/page.tsx
// [BOEK-031] Complete rebuild — Factuur / Offerte / Credit — May 2026
// Mobile-first, iOS-style design
// Supports: autocomplete clients, AI translation, offerte→factuur conversion

import { useState, useEffect, useRef, Suspense } from 'react'
import { createClient } from '@/lib/supabase'
import { useRouter, useSearchParams } from 'next/navigation'
import { translateToNL } from '@/lib/ai'

// ─── Fixed Dutch formatting — never changes ────────────────────────────────────
const NL_NUMBER = new Intl.NumberFormat('nl-NL', { style: 'currency', currency: 'EUR' })

// ─── Types ─────────────────────────────────────────────────────────────────────

// [BOEK-031] fix type — creditnota replaces credit — May 2026
type InvoiceType = 'factuur' | 'offerte' | 'creditnota'

type Profile = {
  id: string
  full_name: string
  company_name: string
  kvk_number: string
  btw_number: string
  iban: string
  address: string
  postal_code: string
  city: string
  email: string
}

type Client = {
  id: string
  name: string
  email: string
  address: string
  postal_code: string
  city: string
  btw_number: string
  kvk_number: string
}

type InvoiceLine = {
  description: string
  quantity: number
  unit_price: number
  btw_rate: number
  // [BOEK-031] AI translation support per line
  translating?: boolean
  rawInput?: string
}

type SentInvoice = {
  id: string
  invoice_number: string
  client_name: string
  total_inc_btw: number
}

// ─── Config ────────────────────────────────────────────────────────────────────

const TYPE_CONFIG: Record<InvoiceType, {
  label: string; icon: string; color: string; borderColor: string; textColor: string
}> = {
  factuur: {
    label: 'Factuur', icon: '📄',
    color: '#eff6ff', borderColor: '#3b82f6', textColor: '#1d4ed8',
  },
  offerte: {
    label: 'Offerte', icon: '📋',
    color: '#fffbeb', borderColor: '#f59e0b', textColor: '#92400e',
  },
  // [BOEK-031] key = creditnota — matches InvoiceType
  creditnota: {
    label: 'Credit', icon: '↩',
    color: '#fef2f2', borderColor: '#ef4444', textColor: '#b91c1c',
  },
}

// ─── Component ─────────────────────────────────────────────────────────────────

function NewInvoicePageContent() {
  const router       = useRouter()
  const searchParams = useSearchParams()
  const supabase     = createClient()

  // Read query params at component level so useEffect doesn't depend on searchParams
  const typeParam           = searchParams.get('type') as InvoiceType | null
  const originalParam       = searchParams.get('original') ?? ''
  const offerteParam        = searchParams.get('from_offerte') ?? ''
  const replacesParam       = searchParams.get('replaces') ?? ''
  const replacesNumberParam = searchParams.get('replacesNumber') ?? ''
  // AI-generated params from ZzpDashboard
  const aiClientName    = searchParams.get('client_name') ?? ''
  const aiDescription   = searchParams.get('description') ?? ''
  const aiAmount        = parseFloat(searchParams.get('amount') ?? '0') || 0
  const aiBtwRate       = parseFloat(searchParams.get('btw_rate') ?? '21') || 21

  // ── Core state ──────────────────────────────────────────────────────────────
  const [profile, setProfile]         = useState<Profile | null>(null)
  const [invoiceNumber, setInvoiceNumber] = useState('')
  const [loading, setLoading]         = useState(false)
  const [error, setError]             = useState('')

  // [BOEK-031] Invoice type — factuur / offerte / credit — initialised from URL
  const [invoiceType, setInvoiceType] = useState<InvoiceType>(
    typeParam && ['factuur', 'offerte', 'creditnota'].includes(typeParam) ? typeParam : 'factuur'
  )

  // ── Client autocomplete ──────────────────────────────────────────────────────
  const [clients, setClients]               = useState<Client[]>([])
  const [clientSearch, setClientSearch]     = useState(aiClientName)
  const [showDropdown, setShowDropdown]     = useState(false)
  const [selectedClientId, setSelectedClientId] = useState<string | null>(null)
  const autocompleteRef                     = useRef<HTMLDivElement>(null)

  // ── Client fields ────────────────────────────────────────────────────────────
  const [clientName, setClientName]     = useState(aiClientName)
  const [clientEmail, setClientEmail]   = useState('')
  const [clientAddress, setClientAddress] = useState('')
  const [clientPostal, setClientPostal] = useState('')
  const [clientCity, setClientCity]     = useState('')
  const [clientBtw, setClientBtw]       = useState('')

  // ── Dates ────────────────────────────────────────────────────────────────────
  const today = new Date().toISOString().split('T')[0]
  const [invoiceDate, setInvoiceDate] = useState(today)
  const [dueDate, setDueDate]         = useState('')

  // ── Lines — pre-filled from replace flow or AI generation ────────────────────
  const [lines, setLines] = useState<InvoiceLine[]>(
    replacesNumberParam
      ? [{ description: `Vervangt factuur ${replacesNumberParam}`, quantity: 1, unit_price: 0, btw_rate: 21 }]
      : [{ description: aiDescription, quantity: 1, unit_price: aiAmount, btw_rate: aiBtwRate }]
  )

  // ── Credit flow ──────────────────────────────────────────────────────────────
  const [sentInvoices, setSentInvoices]       = useState<SentInvoice[]>([])
  const [originalInvoiceId, setOriginalInvoiceId] = useState(originalParam)
  const [creditReason, setCreditReason]       = useState('')
  const [loadingCredit, setLoadingCredit]     = useState(false)

  // ── Replace flow — read-only from URL, never mutated ─────────────────────────
  const replacesId     = replacesParam
  const replacesNumber = replacesNumberParam

  // ── Offerte convert confirm ───────────────────────────────────────────────────
  const [showConvertDialog, setShowConvertDialog] = useState(false)
  const [convertingOfferte, setConvertingOfferte] = useState(false)
  // offerte_id if we're converting an existing offerte — read-only from URL
  const offerteId = offerteParam

  // ─── Load ──────────────────────────────────────────────────────────────────

  useEffect(() => {
    async function load() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { router.push('/login'); return }

      // Profile
      const { data: p } = await supabase.from('profiles').select('*').eq('id', user.id).single()
      if (p) setProfile(p)

      // Due date default +30 days
      const due = new Date(); due.setDate(due.getDate() + 30)
      setDueDate(due.toISOString().split('T')[0])

      // Invoice number — only for factuur/credit
      const { data: num } = await supabase.rpc('generate_invoice_number', { user_id: user.id })
      if (num) setInvoiceNumber(num)

      // Clients autocomplete
      const { data: cl } = await supabase
        .from('clients').select('*').eq('user_id', user.id).order('name')
      if (cl) setClients(cl)

      // Sent invoices for credit flow
      const { data: sent } = await supabase
        .from('invoices')
        .select('id, invoice_number, client_name, total_inc_btw')
        .eq('sender_id', user.id)
        .in('status', ['sent', 'paid', 'overdue'])
        .eq('invoice_type', 'factuur')
        .order('created_at', { ascending: false })
        .limit(50)
      if (sent) setSentInvoices(sent)
    }
    load()
  }, [router, supabase])

  // Close autocomplete on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (autocompleteRef.current && !autocompleteRef.current.contains(e.target as Node)) {
        setShowDropdown(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  // ─── Client autocomplete ───────────────────────────────────────────────────

  const filteredClients = clients.filter(c =>
    c.name.toLowerCase().includes(clientSearch.toLowerCase()) ||
    (c.email ?? '').toLowerCase().includes(clientSearch.toLowerCase())
  ).slice(0, 6)

  function selectClient(c: Client) {
    setSelectedClientId(c.id)
    setClientName(c.name)
    setClientEmail(c.email ?? '')
    setClientAddress(c.address ?? '')
    setClientPostal(c.postal_code ?? '')
    setClientCity(c.city ?? '')
    setClientBtw(c.btw_number ?? '')
    setClientSearch(c.name)
    setShowDropdown(false)
  }

  async function saveNewClient(userId: string) {
    if (!clientName || selectedClientId) return
    const { data } = await supabase.from('clients').insert({
      user_id: userId,
      name: clientName,
      email: clientEmail,
      address: clientAddress,
      postal_code: clientPostal,
      city: clientCity,
      btw_number: clientBtw,
    }).select().single()
    if (data) setSelectedClientId(data.id)
  }

  // ─── Lines ─────────────────────────────────────────────────────────────────

  function addLine() {
    setLines(prev => [...prev, { description: '', quantity: 1, unit_price: 0, btw_rate: 21 }])
  }

  function removeLine(i: number) {
    if (lines.length === 1) return
    setLines(prev => prev.filter((_, idx) => idx !== i))
  }

  function updateLine(i: number, field: keyof InvoiceLine, value: string | number | boolean) {
    setLines(prev => prev.map((l, idx) => idx === i ? { ...l, [field]: value } : l))
  }

  // [BOEK-031] AI translation per line
  async function translateLine(i: number) {
    const line = lines[i]
    if (!line.description.trim()) return
    updateLine(i, 'translating', true)
    try {
      const result = await translateToNL(line.description, 'auto')
      updateLine(i, 'description', result.translation)
    } catch {
      // safe fallback — keep original
    } finally {
      updateLine(i, 'translating', false)
    }
  }

  // ─── Totals ────────────────────────────────────────────────────────────────

  // [BOEK-031] Credit: user enters positive — system saves negative
  const sign      = invoiceType === 'creditnota' ? -1 : 1
  const totalEx   = lines.reduce((s, l) => s + l.quantity * l.unit_price, 0)
  const btwAmount = lines.reduce((s, l) => s + l.quantity * l.unit_price * (l.btw_rate / 100), 0)
  const totalInc  = totalEx + btwAmount

  // BTW breakdown per rate
  const btwByRate: Record<number, number> = {}
  lines.forEach(l => {
    const rate = l.btw_rate
    btwByRate[rate] = (btwByRate[rate] ?? 0) + l.quantity * l.unit_price * (rate / 100)
  })

  // ─── Credit submit ─────────────────────────────────────────────────────────

  async function handleCredit() {
    if (!originalInvoiceId) { setError('Selecteer de originele factuur'); return }
    setLoadingCredit(true); setError('')
    try {
      const res = await fetch('/api/invoice/creditnota', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ original_invoice_id: originalInvoiceId, reason: creditReason }),
      })
      const result = await res.json()
      if (!res.ok) { setError(result.error || 'Mislukt'); return }
      router.push('/dashboard')
    } catch { setError('Onbekende fout') }
    finally { setLoadingCredit(false) }
  }

  // ─── Offerte → Factuur convert ─────────────────────────────────────────────

  async function handleConvertOfferte() {
    setConvertingOfferte(true); setError('')
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { router.push('/login'); return }

    const { data: newNum } = await supabase.rpc('generate_invoice_number', { user_id: user.id })

    const { data: factuur, error: err } = await supabase.from('invoices').insert({
      sender_id: user.id,
      invoice_number: newNum,
      invoice_date: invoiceDate,
      due_date: dueDate,
      status: 'sent',
      invoice_type: 'factuur',
      direction: 'outgoing',
      total_ex_btw: totalEx,
      btw_amount: btwAmount,
      total_inc_btw: totalInc,
      sent_to_accountant: false,
      source: 'created',
      client_name: clientName,
      client_email: clientEmail,
      client_address: clientAddress,
      client_postal_code: clientPostal,
      client_city: clientCity,
      client_btw_number: clientBtw,
    }).select().single()

    if (err || !factuur) { setError('Omzetten mislukt'); setConvertingOfferte(false); return }

    await supabase.from('invoice_lines').insert(
      lines.map(l => ({
        invoice_id: factuur.id,
        description: l.description,
        quantity: l.quantity,
        unit_price: l.unit_price,
        btw_rate: l.btw_rate,
        line_total: l.quantity * l.unit_price,
      }))
    )

    // Mark offerte as converted
    if (offerteId) {
      await supabase.from('invoices')
        .update({ status: 'archived', offerte_converted_to: factuur.id })
        .eq('id', offerteId)
    }

    setShowConvertDialog(false)
    router.push(`/dashboard/invoice/${factuur.id}`)
  }

  // ─── Main submit ───────────────────────────────────────────────────────────

  async function handleSubmit(mode: 'draft' | 'sent') {
    if (!clientName || !clientEmail) { setError('Vul naam en e-mail van de klant in'); return }
    if (!invoiceDate || !dueDate) { setError('Vul de datums in'); return }
    if (lines.some(l => !l.description.trim() || l.unit_price <= 0)) {
      setError('Vul alle factuurregels correct in'); return
    }

    setLoading(true); setError('')
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { router.push('/login'); return }

    await saveNewClient(user.id)

    // [BOEK-031] offerte has no number
    let finalNumber = invoiceNumber
    if (invoiceType === 'offerte') finalNumber = ''
    if (mode === 'sent' && invoiceType !== 'offerte') {
      const { data: n } = await supabase.rpc('generate_invoice_number', { user_id: user.id })
      if (n) finalNumber = n
    }

    // DB invoice_type mapping
    const dbType = invoiceType === 'creditnota' ? 'creditnota'
                 : invoiceType === 'offerte' ? 'pro_forma'
                 : 'factuur'

    const { data: invoice, error: insertErr } = await supabase.from('invoices').insert({
      sender_id: user.id,
      invoice_number: finalNumber || null,
      invoice_date: invoiceDate,
      due_date: dueDate,
      status: mode === 'sent' ? 'sent' : 'draft',
      invoice_type: dbType,
      direction: 'outgoing',
      // [BOEK-031] credit: bedragen zijn negatief
      total_ex_btw: sign * totalEx,
      btw_amount: sign * btwAmount,
      total_inc_btw: sign * totalInc,
      sent_to_accountant: false,
      source: 'created',
      client_name: clientName,
      client_email: clientEmail,
      client_address: clientAddress,
      client_postal_code: clientPostal,
      client_city: clientCity,
      client_btw_number: clientBtw,
      // [BOEK-031] creditnota is standalone — original_invoice_id = null always — May 2026
      original_invoice_id: invoiceType === 'creditnota' ? null : (replacesId || null),
    }).select().single()

    if (insertErr || !invoice) {
      setError('Aanmaken mislukt — probeer opnieuw')
      setLoading(false); return
    }

    await supabase.from('invoice_lines').insert(
      lines.map(l => ({
        invoice_id: invoice.id,
        description: l.description,
        quantity: sign * l.quantity,
        unit_price: l.unit_price,
        btw_rate: l.btw_rate,
        line_total: sign * l.quantity * l.unit_price,
      }))
    )

    // [BOEK-031] Replace flow — markeer de oude factuur
    if (replacesId && finalNumber) {
      await supabase.from('invoices')
        .update({ replaced_by_number: finalNumber, status: 'archived' })
        .eq('id', replacesId)
    }

    if (mode === 'sent') {
      await fetch('/api/invoice/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientEmail, clientName, invoiceNumber: finalNumber, totalInc: sign * totalInc, dueDate }),
      }).catch(() => {}) // non-blocking
    }

    router.push('/dashboard')
  }

  // ─── Derived ───────────────────────────────────────────────────────────────

  const cfg = TYPE_CONFIG[invoiceType]
  const pageTitle =
    invoiceType === 'offerte' ? 'Nieuwe offerte' :
    invoiceType === 'creditnota'  ? 'Creditnota'     : 'Nieuwe factuur'

  const displayNumber =
    invoiceType === 'offerte' ? '—' :
    invoiceType === 'creditnota'
      // [BOEK-031] format: CR-001-2026 — jaar volgt uit het gegenereerde nummer — May 2026
      ? `CR-${invoiceNumber.split('-').reverse().join('-')}` :
    invoiceNumber || 'Concept'

  // ─── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen" style={{ backgroundColor: '#f2f2f7' }}>

      {/* ── Sticky header ── */}
      <div className="sticky top-0 z-10 bg-white border-b border-gray-200 px-4 py-3">
        <div className="max-w-2xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button
              onClick={() => router.push('/dashboard')}
              className="w-8 h-8 flex items-center justify-center rounded-full text-gray-400 hover:bg-gray-100 active:bg-gray-200 transition-colors text-lg"
            >←</button>
            <div>
              <h1 className="text-base font-bold text-gray-900 leading-tight">{pageTitle}</h1>
              {invoiceType !== 'offerte' && (
                <p className="text-[11px] text-gray-400 font-mono leading-none mt-0.5">{displayNumber}</p>
              )}
            </div>
          </div>

          {/* Offerte convert button */}
          {invoiceType === 'offerte' && offerteId && (
            <button
              onClick={() => setShowConvertDialog(true)}
              className="text-xs font-semibold px-3 py-2 rounded-xl text-white"
              style={{ backgroundColor: '#3b82f6' }}
            >
              Omzetten naar factuur →
            </button>
          )}
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-4 py-4 space-y-3 pb-12">

        {/* ── [BOEK-031] Type selector ── */}
        <div className="bg-white rounded-2xl p-4 shadow-sm">
          <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider mb-3">Type</p>
          <div className="grid grid-cols-3 gap-2">
            {(Object.keys(TYPE_CONFIG) as InvoiceType[]).map(t => {
              const c = TYPE_CONFIG[t]
              const active = invoiceType === t
              return (
                <button key={t} onClick={() => setInvoiceType(t)}
                  className="flex flex-col items-center gap-1.5 py-3 px-2 rounded-xl border-2 transition-all"
                  style={{
                    backgroundColor: active ? c.color : '#f9f9f9',
                    borderColor: active ? c.borderColor : '#e5e5ea',
                    color: active ? c.textColor : '#8e8e93',
                  }}
                >
                  <span className="text-xl leading-none">{c.icon}</span>
                  <span className="text-xs font-semibold">{c.label}</span>
                </button>
              )
            })}
          </div>
        </div>

        {/* ── [BOEK-031] Credit banner — alleen informatief — May 2026 ── */}
        {invoiceType === 'creditnota' && (
          <div className="rounded-xl px-4 py-3 flex gap-2 items-center"
            style={{ backgroundColor: '#fef2f2', border: '1px solid #fecaca' }}>
            <span className="text-red-400 shrink-0">↩</span>
            <p className="text-xs text-red-700">
              <strong>Creditnota</strong> — bedragen worden automatisch negatief weergegeven.
              Vul het formulier in zoals een gewone factuur.
            </p>
          </div>
        )}

        {/* ── Factuur / Offerte / Creditnota form — نفس الفورم للأنواع الثلاثة ── */}
        <>
            {/* Replace flow banner */}
            {replacesNumber && (
              <div className="bg-blue-50 border border-blue-200 rounded-xl px-4 py-3 flex gap-2 items-center">
                <span className="text-blue-500 shrink-0">🔄</span>
                <p className="text-xs text-blue-700">
                  <strong>Vervangende factuur</strong> voor{' '}
                  <span className="font-mono font-semibold">{replacesNumber}</span>.
                  De oude factuur wordt automatisch gearchiveerd na opslaan.
                </p>
              </div>
            )}

            {/* Offerte banner */}
            {invoiceType === 'offerte' && (
              <div className="rounded-xl px-4 py-3 flex gap-2 items-center"
                style={{ backgroundColor: '#fffbeb', border: '1px solid #fde68a' }}>
                <span className="text-amber-500 shrink-0">📋</span>
                <p className="text-xs text-amber-700">
                  <strong>Offerte</strong> — geen factuurnummer, geen boekhoudkundige waarde.
                  Gebruik "Omzetten naar factuur" als de klant akkoord gaat.
                </p>
              </div>
            )}

            {/* ── Jouw gegevens ── */}
            {profile && (
              <div className="bg-white rounded-2xl p-4 shadow-sm">
                <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider mb-2">Van</p>
                <p className="text-sm font-semibold text-gray-900">{profile.company_name || profile.full_name}</p>
                {profile.address && <p className="text-xs text-gray-500">{profile.address}</p>}
                {(profile.postal_code || profile.city) && (
                  <p className="text-xs text-gray-500">{[profile.postal_code, profile.city].filter(Boolean).join(' ')}</p>
                )}
                <div className="flex gap-4 mt-1">
                  {profile.kvk_number && <p className="text-xs text-gray-400">KVK: {profile.kvk_number}</p>}
                  {profile.btw_number && <p className="text-xs text-gray-400">BTW: {profile.btw_number}</p>}
                </div>
              </div>
            )}

            {/* ── Klant autocomplete ── */}
            <div className="bg-white rounded-2xl p-4 shadow-sm space-y-3">
              <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider">Aan</p>

              {/* Autocomplete input */}
              <div ref={autocompleteRef} className="relative">
                <input
                  type="text"
                  value={clientSearch}
                  onChange={e => {
                    setClientSearch(e.target.value)
                    setClientName(e.target.value)
                    setSelectedClientId(null)
                    setShowDropdown(true)
                  }}
                  onFocus={() => setShowDropdown(true)}
                  className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200"
                  placeholder="Zoek of typ klantnaam..."
                />
                {showDropdown && filteredClients.length > 0 && (
                  <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-gray-200 rounded-xl shadow-lg z-20 overflow-hidden">
                    {filteredClients.map(c => (
                      <button key={c.id} onClick={() => selectClient(c)}
                        className="w-full text-left px-4 py-2.5 hover:bg-gray-50 active:bg-gray-100 transition-colors border-b border-gray-50 last:border-0">
                        <p className="text-sm font-medium text-gray-900">{c.name}</p>
                        {c.email && <p className="text-xs text-gray-400">{c.email}</p>}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Client fields */}
              <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2">
                  <label className="block text-xs font-medium text-gray-500 mb-1">E-mailadres <span className="text-red-400">*</span></label>
                  <input type="email" value={clientEmail} onChange={e => setClientEmail(e.target.value)}
                    className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200"
                    placeholder="klant@bedrijf.nl" />
                </div>
                <div className="col-span-2">
                  <label className="block text-xs font-medium text-gray-500 mb-1">Adres</label>
                  <input type="text" value={clientAddress} onChange={e => setClientAddress(e.target.value)}
                    className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200"
                    placeholder="Straatnaam 1" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Postcode</label>
                  <input type="text" value={clientPostal} onChange={e => setClientPostal(e.target.value)}
                    className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200"
                    placeholder="1234 AB" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Stad</label>
                  <input type="text" value={clientCity} onChange={e => setClientCity(e.target.value)}
                    className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200"
                    placeholder="Amsterdam" />
                </div>
                <div className="col-span-2">
                  <label className="block text-xs font-medium text-gray-500 mb-1">BTW-nummer klant</label>
                  <input type="text" value={clientBtw} onChange={e => setClientBtw(e.target.value)}
                    className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200"
                    placeholder="NL123456789B01" />
                </div>
              </div>
            </div>

            {/* ── Datums ── */}
            <div className="bg-white rounded-2xl p-4 shadow-sm">
              <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider mb-3">Datums</p>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">
                    {invoiceType === 'offerte' ? 'Offertedatum' : 'Factuurdatum'} <span className="text-red-400">*</span>
                  </label>
                  <input type="date" value={invoiceDate} onChange={e => setInvoiceDate(e.target.value)}
                    className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">
                    {invoiceType === 'offerte' ? 'Geldig tot' : 'Vervaldatum'} <span className="text-red-400">*</span>
                  </label>
                  <input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)}
                    className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200" />
                </div>
              </div>
            </div>

            {/* ── Factuurregels ── */}
            <div className="bg-white rounded-2xl p-4 shadow-sm space-y-3">
              <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider">
                {invoiceType === 'offerte' ? 'Offerteregels' : 'Factuurregels'}
              </p>

              {/* [BOEK-031] AI translation hint */}
              <p className="text-[11px] text-gray-400">
                Schrijf in uw eigen taal — druk op <strong>Vertaal</strong> voor professioneel Nederlands
              </p>

              {lines.map((line, i) => (
                <div key={i} className="space-y-2">
                  {/* Mobile */}
                  <div className="sm:hidden bg-gray-50 rounded-xl p-3 space-y-2 relative">
                    <button onClick={() => removeLine(i)}
                      className="absolute top-2 right-2 w-6 h-6 flex items-center justify-center text-gray-300 hover:text-red-400 text-lg">×</button>

                    <div className="flex gap-2">
                      <input type="text" value={line.description}
                        onChange={e => updateLine(i, 'description', e.target.value)}
                        className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white"
                        placeholder="Omschrijving dienst" />
                      <button onClick={() => translateLine(i)} disabled={line.translating}
                        className="shrink-0 text-xs font-semibold px-2.5 py-2 rounded-lg bg-blue-50 text-blue-600 border border-blue-200 disabled:opacity-40">
                        {line.translating ? '...' : 'Vertaal'}
                      </button>
                    </div>

                    <div className="grid grid-cols-3 gap-2">
                      <div>
                        <label className="block text-[10px] text-gray-400 mb-1">Aantal</label>
                        <input type="number" value={line.quantity} min="0.01" step="0.01"
                          onChange={e => updateLine(i, 'quantity', parseFloat(e.target.value) || 0)}
                          className="w-full border border-gray-200 rounded-lg px-2 py-2 text-sm bg-white" />
                      </div>
                      <div>
                        <label className="block text-[10px] text-gray-400 mb-1">Prijs (€)</label>
                        <input type="number" value={line.unit_price} min="0" step="0.01"
                          onChange={e => updateLine(i, 'unit_price', parseFloat(e.target.value) || 0)}
                          className="w-full border border-gray-200 rounded-lg px-2 py-2 text-sm bg-white" />
                      </div>
                      <div>
                        <label className="block text-[10px] text-gray-400 mb-1">BTW %</label>
                        <select value={line.btw_rate}
                          onChange={e => updateLine(i, 'btw_rate', parseFloat(e.target.value))}
                          className="w-full border border-gray-200 rounded-lg px-2 py-2 text-sm bg-white">
                          <option value={21}>21%</option>
                          <option value={9}>9%</option>
                          <option value={0}>0%</option>
                        </select>
                      </div>
                    </div>

                    <div className="flex justify-between items-center text-xs text-gray-400 pt-1">
                      <span>Totaal</span>
                      <span className="font-semibold text-gray-700">
                        {NL_NUMBER.format(line.quantity * line.unit_price)}
                      </span>
                    </div>
                  </div>

                  {/* Desktop */}
                  <div className="hidden sm:grid grid-cols-12 gap-2 items-center">
                    <div className="col-span-5 flex gap-1.5">
                      <input type="text" value={line.description}
                        onChange={e => updateLine(i, 'description', e.target.value)}
                        className="flex-1 border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200"
                        placeholder="Omschrijving" />
                      <button onClick={() => translateLine(i)} disabled={line.translating}
                        className="shrink-0 text-xs font-semibold px-2 py-1 rounded-lg bg-blue-50 text-blue-600 border border-blue-200 disabled:opacity-40">
                        {line.translating ? '…' : 'NL'}
                      </button>
                    </div>
                    <div className="col-span-2">
                      <input type="number" value={line.quantity} min="0.01" step="0.01"
                        onChange={e => updateLine(i, 'quantity', parseFloat(e.target.value) || 0)}
                        className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200" />
                    </div>
                    <div className="col-span-2">
                      <input type="number" value={line.unit_price} min="0" step="0.01"
                        onChange={e => updateLine(i, 'unit_price', parseFloat(e.target.value) || 0)}
                        className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200"
                        placeholder="0.00" />
                    </div>
                    <div className="col-span-2">
                      <select value={line.btw_rate}
                        onChange={e => updateLine(i, 'btw_rate', parseFloat(e.target.value))}
                        className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200">
                        <option value={21}>21%</option>
                        <option value={9}>9%</option>
                        <option value={0}>0%</option>
                      </select>
                    </div>
                    <div className="col-span-1 flex justify-center">
                      {lines.length > 1 && (
                        <button onClick={() => removeLine(i)} className="text-gray-300 hover:text-red-400 text-xl">×</button>
                      )}
                    </div>
                  </div>
                </div>
              ))}

              <button onClick={addLine}
                className="text-sm font-medium transition-colors"
                style={{ color: '#3b82f6' }}>
                + Regel toevoegen
              </button>
            </div>

            {/* ── Totalen ── */}
            <div className="bg-white rounded-2xl p-4 shadow-sm">
              <div className="space-y-2 text-sm max-w-xs ml-auto">
                <div className="flex justify-between text-gray-500">
                  <span>Subtotaal excl. BTW</span>
                  <span>{NL_NUMBER.format(sign * totalEx)}</span>
                </div>
                {Object.entries(btwByRate).filter(([, v]) => v > 0).map(([rate, val]) => (
                  <div key={rate} className="flex justify-between text-gray-500">
                    <span>BTW {rate}%</span>
                    <span>{NL_NUMBER.format(sign * val)}</span>
                  </div>
                ))}
                <div className="flex justify-between font-bold text-gray-900 text-base pt-2 border-t border-gray-100">
                  <span>Totaal incl. BTW</span>
                  <span style={{ color: sign === -1 ? '#ef4444' : '#1c1c1e' }}>
                    {NL_NUMBER.format(sign * totalInc)}
                  </span>
                </div>
              </div>
            </div>

            {/* ── Betalingsinformatie ── */}
            {profile?.iban && invoiceType !== ('creditnota' as InvoiceType) && (
              <div className="bg-white rounded-2xl p-4 shadow-sm">
                <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider mb-2">Betalingsinformatie</p>
                <div className="space-y-1 text-sm text-gray-600">
                  <div className="flex justify-between">
                    <span className="text-gray-400">Op naam van</span>
                    <span className="font-medium text-gray-900">{profile.company_name || profile.full_name}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-400">IBAN</span>
                    <span className="font-medium text-gray-900 font-mono text-xs">{profile.iban}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-400">Vervaldatum</span>
                    <span className="font-medium text-gray-900">{new Intl.DateTimeFormat('nl-NL').format(new Date(dueDate || today))}</span>
                  </div>
                  {invoiceNumber && (
                    <div className="flex justify-between">
                      <span className="text-gray-400">Betalingskenmerk</span>
                      <span className="font-medium text-gray-900">{invoiceNumber}</span>
                    </div>
                  )}
                </div>
              </div>
            )}

            {error && (
              <p className="text-sm text-red-500 bg-red-50 rounded-xl px-4 py-2.5">{error}</p>
            )}

            {/* ── Actieknoppen ── */}
            <div className="flex gap-2 pb-8 pt-1">
              {/* Factuur */}
              {invoiceType === 'factuur' && (
                <>
                  <button onClick={() => handleSubmit('sent')} disabled={loading}
                    className="flex-1 py-3.5 rounded-xl text-sm font-semibold text-white transition-all active:scale-[0.98] disabled:opacity-50 shadow-sm"
                    style={{ backgroundColor: '#3b82f6' }}>
                    {loading ? 'Bezig...' : '✉ Opslaan en versturen'}
                  </button>
                  <button onClick={() => handleSubmit('draft')} disabled={loading}
                    className="flex-1 py-3.5 rounded-xl text-sm font-medium border border-gray-200 text-gray-700 hover:bg-gray-50 transition-all active:scale-[0.98] disabled:opacity-50">
                    Opslaan als concept
                  </button>
                </>
              )}

              {/* Offerte */}
              {invoiceType === 'offerte' && (
                <>
                  <button onClick={() => handleSubmit('sent')} disabled={loading}
                    className="flex-1 py-3.5 rounded-xl text-sm font-semibold text-white transition-all active:scale-[0.98] disabled:opacity-50"
                    style={{ backgroundColor: '#f59e0b' }}>
                    {loading ? 'Bezig...' : '📋 Versturen naar klant'}
                  </button>
                  <button onClick={() => handleSubmit('draft')} disabled={loading}
                    className="flex-1 py-3.5 rounded-xl text-sm font-medium border border-gray-200 text-gray-700 hover:bg-gray-50 transition-all active:scale-[0.98] disabled:opacity-50">
                    Opslaan
                  </button>
                </>
              )}

              {/* [BOEK-031] Creditnota — Opslaan + Versturen — geen Betaald knop — May 2026 */}
              {invoiceType === 'creditnota' && (
                <>
                  <button onClick={() => handleSubmit('sent')} disabled={loading}
                    className="flex-1 py-3.5 rounded-xl text-sm font-semibold text-white transition-all active:scale-[0.98] disabled:opacity-50"
                    style={{ backgroundColor: '#ef4444' }}>
                    {loading ? 'Bezig...' : '↩ Versturen'}
                  </button>
                  <button onClick={() => handleSubmit('draft')} disabled={loading}
                    className="flex-1 py-3.5 rounded-xl text-sm font-medium border border-gray-200 text-gray-700 hover:bg-gray-50 transition-all active:scale-[0.98] disabled:opacity-50">
                    Opslaan
                  </button>
                </>
              )}

              <button onClick={() => router.push('/dashboard')}
                className="px-4 py-3.5 rounded-xl text-sm font-medium text-gray-400 hover:bg-gray-100 transition-colors">
                ✕
              </button>
            </div>
          </>
      </div>

      {/* ── [BOEK-031] Offerte → Factuur convert dialog ── */}
      {showConvertDialog && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center px-4 pb-6 sm:pb-0"
          style={{ backgroundColor: 'rgba(0,0,0,0.4)' }}>
          <div className="bg-white rounded-2xl p-6 w-full max-w-sm shadow-xl space-y-4">
            <h2 className="text-base font-bold text-gray-900">Omzetten naar factuur</h2>
            <p className="text-sm text-gray-600 leading-relaxed">
              Controleer de gegevens voor het aanmaken van de factuur.
              Een nieuw factuurnummer wordt automatisch toegewezen.
              De offerte wordt gearchiveerd.
            </p>
            <p className="text-sm font-semibold text-gray-900">Weet u het zeker?</p>
            <div className="flex gap-2">
              <button onClick={handleConvertOfferte} disabled={convertingOfferte}
                className="flex-1 py-3 rounded-xl text-sm font-semibold text-white transition-all active:scale-[0.98] disabled:opacity-50"
                style={{ backgroundColor: '#3b82f6' }}>
                {convertingOfferte ? 'Bezig...' : 'Ja, maak factuur aan'}
              </button>
              <button onClick={() => setShowConvertDialog(false)}
                className="flex-1 py-3 rounded-xl text-sm font-medium border border-gray-200 text-gray-700 hover:bg-gray-50 transition-colors">
                Annuleren
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  )
}

export default function NewInvoicePage() {
  return (
    <Suspense>
      <NewInvoicePageContent />
    </Suspense>
  )
}