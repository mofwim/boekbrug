'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase'
import { useRouter } from 'next/navigation'

type Profile = {
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

type InvoiceLine = {
  description: string
  quantity: number
  unit_price: number
  btw_rate: number
}

function generateInvoiceNumber(): string {
  const year = new Date().getFullYear()
  const random = Math.floor(Math.random() * 900) + 100
  return `${year}-${random}`
}

export default function NewInvoicePage() {
  const router = useRouter()
  const supabase = createClient()

  const [profile, setProfile] = useState<Profile | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const invoiceNumber = generateInvoiceNumber()

  // Klantgegevens
  const [clientName, setClientName] = useState('')
  const [clientAddress, setClientAddress] = useState('')
  const [clientPostal, setClientPostal] = useState('')
  const [clientCity, setClientCity] = useState('')
  const [clientEmail, setClientEmail] = useState('')
  const [clientBtw, setClientBtw] = useState('')

  // Datums
  const today = new Date().toISOString().split('T')[0]
  const [invoiceDate, setInvoiceDate] = useState(today)
  const [deliveryDate, setDeliveryDate] = useState(today)
  const [dueDate, setDueDate] = useState('')

  // Regels
  const [lines, setLines] = useState<InvoiceLine[]>([
    { description: '', quantity: 1, unit_price: 0, btw_rate: 21 }
  ])

  useEffect(() => {
    async function loadProfile() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { router.push('/login'); return }

      const { data } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', user.id)
        .single()

      if (data) setProfile(data)
    }
    loadProfile()

    // Standaard vervaldatum = 30 dagen
    const due = new Date()
    due.setDate(due.getDate() + 30)
    setDueDate(due.toISOString().split('T')[0])
  }, [])

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

  const totalEx = lines.reduce((sum, l) => sum + l.quantity * l.unit_price, 0)
  const btwAmount = lines.reduce((sum, l) => sum + l.quantity * l.unit_price * (l.btw_rate / 100), 0)
  const totalInc = totalEx + btwAmount

  async function handleSubmit() {
    if (!clientName || !clientEmail || !invoiceDate || !dueDate) {
      setError('Vul alle verplichte velden in (*)')
      return
    }
    if (lines.some(l => !l.description || l.unit_price <= 0)) {
      setError('Vul alle factuurregels correct in')
      return
    }

    setLoading(true)
    setError('')

    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { router.push('/login'); return }

    const { data: invoice, error: invoiceError } = await supabase
      .from('invoices')
      .insert({
        sender_id: user.id,
        invoice_number: invoiceNumber,
        invoice_date: invoiceDate,
        due_date: dueDate,
        status: 'draft',
        direction: 'outgoing',
        total_ex_btw: totalEx,
        btw_amount: btwAmount,
        total_inc_btw: totalInc,
        sent_to_accountant: false
      })
      .select()
      .single()

    if (invoiceError || !invoice) {
      setError('Factuur aanmaken mislukt — probeer opnieuw')
      setLoading(false)
      return
    }

    await supabase.from('invoice_lines').insert(
      lines.map(l => ({
        invoice_id: invoice.id,
        description: l.description,
        quantity: l.quantity,
        unit_price: l.unit_price,
        btw_rate: l.btw_rate,
        line_total: l.quantity * l.unit_price
      }))
    )

    router.push('/dashboard')
  }

  return (
    <div className="min-h-screen bg-[#f2f2f7]">

      {/* Header */}
      <div className="bg-white border-b border-gray-200 px-6 py-4 sticky top-0 z-10">
        <div className="max-w-3xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button onClick={() => router.push('/dashboard')} className="text-gray-400 hover:text-gray-600 text-sm">
              ← Terug
            </button>
            <h1 className="text-lg font-bold text-gray-900">Nieuwe factuur</h1>
          </div>
          <span className="text-sm text-gray-400 font-mono">{invoiceNumber}</span>
        </div>
      </div>

      <div className="max-w-3xl mx-auto px-6 py-6 space-y-4">

        {/* Jouw gegevens — automatisch */}
        {profile && (
          <div className="bg-white rounded-2xl p-5 shadow-sm">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">
              Jouw gegevens
            </p>
            <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm">
              <div>
                <p className="font-semibold text-gray-900">{profile.company_name || profile.full_name}</p>
                <p className="text-gray-500">{profile.address}</p>
                <p className="text-gray-500">{profile.postal_code} {profile.city}</p>
                <p className="text-gray-500">{profile.email}</p>
              </div>
              <div className="text-gray-500 space-y-1">
                <p><span className="text-gray-400">KVK:</span> {profile.kvk_number || '—'}</p>
                <p><span className="text-gray-400">BTW:</span> {profile.btw_number || '—'}</p>
                <p><span className="text-gray-400">IBAN:</span> {profile.iban || '—'}</p>
              </div>
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
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">
            Klantgegevens
          </p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">
                Bedrijfsnaam <span className="text-red-400">*</span>
              </label>
              <input type="text" value={clientName} onChange={e => setClientName(e.target.value)}
                className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm"
                placeholder="Klant BV" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">
                E-mailadres <span className="text-red-400">*</span>
              </label>
              <input type="email" value={clientEmail} onChange={e => setClientEmail(e.target.value)}
                className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm"
                placeholder="klant@bedrijf.nl" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Adres</label>
              <input type="text" value={clientAddress} onChange={e => setClientAddress(e.target.value)}
                className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm"
                placeholder="Straat 1" />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Postcode</label>
                <input type="text" value={clientPostal} onChange={e => setClientPostal(e.target.value)}
                  className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm"
                  placeholder="1234 AB" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Stad</label>
                <input type="text" value={clientCity} onChange={e => setClientCity(e.target.value)}
                  className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm"
                  placeholder="Amsterdam" />
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">BTW-nummer klant</label>
              <input type="text" value={clientBtw} onChange={e => setClientBtw(e.target.value)}
                className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm"
                placeholder="NL123456789B01" />
            </div>
          </div>
        </div>

        {/* Datums */}
        <div className="bg-white rounded-2xl p-5 shadow-sm">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">
            Datums
          </p>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">
                Factuurdatum <span className="text-red-400">*</span>
              </label>
              <input type="date" value={invoiceDate} onChange={e => setInvoiceDate(e.target.value)}
                className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Leverdatum</label>
              <input type="date" value={deliveryDate} onChange={e => setDeliveryDate(e.target.value)}
                className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">
                Vervaldatum <span className="text-red-400">*</span>
              </label>
              <input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)}
                className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm" />
            </div>
          </div>
        </div>

        {/* Factuurregels */}
        <div className="bg-white rounded-2xl p-5 shadow-sm space-y-3">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">
            Factuurregels
          </p>

          {/* Headers */}
          <div className="grid grid-cols-12 gap-2 text-xs font-medium text-gray-400 px-1">
            <div className="col-span-5">Omschrijving</div>
            <div className="col-span-2">Aantal</div>
            <div className="col-span-2">Prijs (€)</div>
            <div className="col-span-2">BTW</div>
            <div className="col-span-1"></div>
          </div>

          {lines.map((line, index) => (
            <div key={index} className="grid grid-cols-12 gap-2 items-center">
              <div className="col-span-5">
                <input type="text" value={line.description}
                  onChange={e => updateLine(index, 'description', e.target.value)}
                  className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm"
                  placeholder="Omschrijving dienst" />
              </div>
              <div className="col-span-2">
                <input type="number" value={line.quantity} min="1"
                  onChange={e => updateLine(index, 'quantity', parseFloat(e.target.value) || 0)}
                  className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm" />
              </div>
              <div className="col-span-2">
                <input type="number" value={line.unit_price} min="0" step="0.01"
                  onChange={e => updateLine(index, 'unit_price', parseFloat(e.target.value) || 0)}
                  className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm"
                  placeholder="0.00" />
              </div>
              <div className="col-span-2">
                <select value={line.btw_rate}
                  onChange={e => updateLine(index, 'btw_rate', parseFloat(e.target.value))}
                  className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm">
                  <option value={21}>21%</option>
                  <option value={9}>9%</option>
                  <option value={0}>0%</option>
                </select>
              </div>
              <div className="col-span-1 flex justify-center">
                {lines.length > 1 && (
                  <button onClick={() => removeLine(index)}
                    className="text-gray-300 hover:text-red-400 text-xl leading-none">
                    ×
                  </button>
                )}
              </div>
            </div>
          ))}

          <button onClick={addLine}
            className="text-blue-600 text-sm font-medium hover:text-blue-700">
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
              o.v.v. factuurnummer{' '}
              <span className="font-medium text-gray-900">{invoiceNumber}</span>
            </p>
          </div>
        )}

        {error && (
          <p className="text-sm text-red-500 px-1">{error}</p>
        )}

        {/* Acties */}
        <div className="flex gap-3 pb-8">
          <button onClick={handleSubmit} disabled={loading}
            className="bg-blue-600 text-white px-6 py-3 rounded-xl text-sm font-semibold hover:bg-blue-700 disabled:opacity-50">
            {loading ? 'Opslaan...' : 'Factuur opslaan'}
          </button>
          <button onClick={() => router.push('/dashboard')}
            className="border border-gray-200 text-gray-600 px-6 py-3 rounded-xl text-sm font-medium hover:bg-gray-50">
            Annuleren
          </button>
        </div>

      </div>
    </div>
  )
}