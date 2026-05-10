'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase'
import { useRouter } from 'next/navigation'

type InvoiceLine = {
  description: string
  quantity: number
  unit_price: number
  btw_rate: number
}

export default function NewInvoicePage() {
  const router = useRouter()
  const supabase = createClient()

  const [clientName, setClientName] = useState('')
  const [clientEmail, setClientEmail] = useState('')
  const [invoiceDate, setInvoiceDate] = useState('')
  const [dueDate, setDueDate] = useState('')
  const [lines, setLines] = useState<InvoiceLine[]>([
    { description: '', quantity: 1, unit_price: 0, btw_rate: 21 }
  ])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  function addLine() {
    setLines([...lines, { description: '', quantity: 1, unit_price: 0, btw_rate: 21 }])
  }

  function removeLine(index: number) {
    setLines(lines.filter((_, i) => i !== index))
  }

  function updateLine(index: number, field: keyof InvoiceLine, value: string | number) {
    const updated = [...lines]
    updated[index] = { ...updated[index], [field]: value }
    setLines(updated)
  }

  function calcTotals() {
    const totalEx = lines.reduce((sum, l) => sum + l.quantity * l.unit_price, 0)
    const btwAmount = lines.reduce((sum, l) => sum + l.quantity * l.unit_price * (l.btw_rate / 100), 0)
    return {
      totalEx,
      btwAmount,
      totalInc: totalEx + btwAmount
    }
  }

  const { totalEx, btwAmount, totalInc } = calcTotals()

  async function handleSubmit() {
    if (!clientName || !clientEmail || !invoiceDate || !dueDate) {
      setError('Vul alle verplichte velden in')
      return
    }

    if (lines.some(l => !l.description || l.unit_price <= 0)) {
      setError('Vul alle regelomschrijvingen en prijzen in')
      return
    }

    setLoading(true)
    setError('')

    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { router.push('/login'); return }

    // Genereer factuurnummer
    const invoiceNumber = `INV-${Date.now()}`

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
      setError('Factuur aanmaken mislukt')
      setLoading(false)
      return
    }

    // Sla regels op
    const { error: linesError } = await supabase
      .from('invoice_lines')
      .insert(
        lines.map(l => ({
          invoice_id: invoice.id,
          description: l.description,
          quantity: l.quantity,
          unit_price: l.unit_price,
          btw_rate: l.btw_rate,
          line_total: l.quantity * l.unit_price
        }))
      )

    if (linesError) {
      setError('Regels opslaan mislukt')
      setLoading(false)
      return
    }

    router.push('/dashboard')
  }

  return (
    <div className="min-h-screen bg-gray-50">

      {/* Header */}
      <div className="bg-white border-b border-gray-200 px-6 py-4">
        <div className="max-w-3xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button
              onClick={() => router.push('/dashboard')}
              className="text-gray-400 hover:text-gray-600 text-sm"
            >
              ← Terug
            </button>
            <h1 className="text-lg font-bold text-gray-900">Nieuwe factuur</h1>
          </div>
        </div>
      </div>

      <div className="max-w-3xl mx-auto px-6 py-8 space-y-6">

        {/* Klantgegevens */}
        <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-4">
          <h2 className="font-medium text-gray-900">Klantgegevens</h2>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Naam klant <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={clientName}
                onChange={e => setClientName(e.target.value)}
                className="w-full border border-gray-200 rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="Bedrijfsnaam BV"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                E-mail klant <span className="text-red-500">*</span>
              </label>
              <input
                type="email"
                value={clientEmail}
                onChange={e => setClientEmail(e.target.value)}
                className="w-full border border-gray-200 rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="klant@bedrijf.nl"
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Factuurdatum <span className="text-red-500">*</span>
              </label>
              <input
                type="date"
                value={invoiceDate}
                onChange={e => setInvoiceDate(e.target.value)}
                className="w-full border border-gray-200 rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Vervaldatum <span className="text-red-500">*</span>
              </label>
              <input
                type="date"
                value={dueDate}
                onChange={e => setDueDate(e.target.value)}
                className="w-full border border-gray-200 rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>
        </div>

        {/* Factuurregels */}
        <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-4">
          <h2 className="font-medium text-gray-900">Factuurregels</h2>

          <div className="space-y-3">
            {lines.map((line, index) => (
              <div key={index} className="grid grid-cols-12 gap-2 items-center">
                <div className="col-span-5">
                  <input
                    type="text"
                    value={line.description}
                    onChange={e => updateLine(index, 'description', e.target.value)}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="Omschrijving"
                  />
                </div>
                <div className="col-span-2">
                  <input
                    type="number"
                    value={line.quantity}
                    onChange={e => updateLine(index, 'quantity', parseFloat(e.target.value))}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="Aantal"
                    min="1"
                  />
                </div>
                <div className="col-span-2">
                  <input
                    type="number"
                    value={line.unit_price}
                    onChange={e => updateLine(index, 'unit_price', parseFloat(e.target.value))}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="Prijs"
                    min="0"
                  />
                </div>
                <div className="col-span-2">
                  <select
                    value={line.btw_rate}
                    onChange={e => updateLine(index, 'btw_rate', parseFloat(e.target.value))}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
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
                      className="text-red-400 hover:text-red-600 text-lg"
                    >
                      ×
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>

          <button
            onClick={addLine}
            className="text-blue-600 text-sm hover:text-blue-700 font-medium"
          >
            + Regel toevoegen
          </button>
        </div>

        {/* Totalen */}
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <div className="space-y-2 text-sm">
            <div className="flex justify-between text-gray-600">
              <span>Subtotaal excl. BTW</span>
              <span>€{totalEx.toFixed(2)}</span>
            </div>
            <div className="flex justify-between text-gray-600">
              <span>BTW</span>
              <span>€{btwAmount.toFixed(2)}</span>
            </div>
            <div className="flex justify-between font-bold text-gray-900 text-base pt-2 border-t border-gray-200">
              <span>Totaal incl. BTW</span>
              <span>€{totalInc.toFixed(2)}</span>
            </div>
          </div>
        </div>

        {error && (
          <p className="text-sm text-red-500">{error}</p>
        )}

        {/* Acties */}
        <div className="flex gap-3">
          <button
            onClick={handleSubmit}
            disabled={loading}
            className="bg-blue-600 text-white px-6 py-2.5 rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
          >
            {loading ? 'Bezig...' : 'Factuur opslaan'}
          </button>
          <button
            onClick={() => router.push('/dashboard')}
            className="border border-gray-200 text-gray-700 px-6 py-2.5 rounded-lg text-sm font-medium hover:bg-gray-50"
          >
            Annuleren
          </button>
        </div>

      </div>
    </div>
  )
}