'use client'

// src/app/dashboard/invoice/[id]/edit/page.tsx
// BOEK-001: Invoice Edit
// نفس شكل ومنطق new/page.tsx — لكن يحمّل البيانات الموجودة ويرسل PUT

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase'
import { useRouter, useParams } from 'next/navigation'
import Link from 'next/link'
// [BOEK-031] Navigation Strategy — May 2026
import { useParentPath, useHomePath } from '@/lib/navigation-hooks'
import type { Role } from '@/lib/navigation'

type InvoiceLine = {
  description: string
  quantity: number
  unit_price: number
  btw_rate: number
}

export default function InvoiceEditPage() {
  const router = useRouter()
  const params = useParams()
  const invoiceId = params.id as string
  const supabase = createClient()

  const [profile, setProfile] = useState<any>(null)
  const [invoiceNumber, setInvoiceNumber] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  // [BOEK-031] Navigation Strategy — parent + home via helper — May 2026
  const role: Role = (profile?.role === 'accountant' ? 'accountant' : 'zzper')
  const parentHref = useParentPath(role)
  const homeHref = useHomePath(role)

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
        .select('description, quantity, unit_price, btw_rate')
        .eq('invoice_id', invoiceId)

      // تعبئة الـ state بالبيانات الموجودة
      setInvoiceNumber(invoice.invoice_number)
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

  // ── Loading ───────────────────────────────────────────────────────────────
  if (loading) return (
    <div className="min-h-screen bg-[#f2f2f7] flex items-center justify-center">
      <p className="text-gray-400 text-sm">Laden...</p>
    </div>
  )

  return (
    <div className="min-h-screen bg-[#f2f2f7]">

      {/* Header */}
      <div className="bg-white border-b border-gray-200 px-6 py-4 sticky top-0 z-10">
        <div className="max-w-3xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            {/* [BOEK-031] Back — Link to parent /invoice/[id] — Navigation Strategy — May 2026 */}
            <Link
              href={parentHref}
              className="text-gray-400 hover:text-gray-600 text-sm no-underline"
            >
              ← Terug
            </Link>
            {/* [BOEK-031] Logo — always /dashboard for ZZP — Navigation Strategy — May 2026 */}
            <Link href={homeHref} className="no-underline">
              <span className="text-base font-bold text-blue-600">BoekBrug</span>
            </Link>
            <h1 className="text-lg font-bold text-gray-900">Factuur bewerken</h1>
          </div>
          <span className="text-sm text-gray-400 font-mono">{invoiceNumber}</span>
        </div>
      </div>

      <div className="max-w-3xl mx-auto px-6 py-6 space-y-4">

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
              <input
                type="date" value={invoiceDate}
                onChange={e => setInvoiceDate(e.target.value)}
                className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">
                Vervaldatum <span className="text-red-400">*</span>
              </label>
              <input
                type="date" value={dueDate}
                onChange={e => setDueDate(e.target.value)}
                className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm"
              />
            </div>
          </div>
        </div>

        {/* Factuurregels */}
        <div className="bg-white rounded-2xl p-5 shadow-sm space-y-3">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Factuurregels</p>

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
                <input
                  type="number" value={line.unit_price} min="0" step="0.01"
                  onChange={e => updateLine(index, 'unit_price', parseFloat(e.target.value) || 0)}
                  className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm"
                  placeholder="0.00"
                />
              </div>
              <div className="col-span-2">
                <select
                  value={line.btw_rate}
                  onChange={e => updateLine(index, 'btw_rate', parseFloat(e.target.value))}
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
        <div className="flex gap-3 pb-8">
          <button
            onClick={handleSave}
            disabled={saving}
            className="bg-blue-600 text-white px-6 py-3 rounded-xl text-sm font-semibold hover:bg-blue-700 disabled:opacity-50"
          >
            {saving ? 'Opslaan...' : 'Wijzigingen opslaan'}
          </button>
          {/* [BOEK-031] Annuleren — Link to parent — Navigation Strategy — May 2026 */}
          <Link
            href={parentHref}
            className="border border-gray-200 text-gray-600 px-6 py-3 rounded-xl text-sm font-medium hover:bg-gray-50 no-underline inline-block"
          >
            Annuleren
          </Link>
        </div>

      </div>
    </div>
  )
}