'use client'

// src/app/dashboard/clients/invite/InviteClient.tsx
// [COHERENCE-INVITE] UI extracted from page.tsx so page.tsx can server-guard the
// accountant role (a shop owner must not be able to create an accountant→client
// invitation with themselves as the accountant).

import { useState } from 'react'
import { ErrorMessage } from '@/components/ui/Feedback'
import { COLUMN } from '@/lib/design/tokens';

export default function InviteClient() {
  const [clientEmail, setClientEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [success, setSuccess] = useState('')
  const [error, setError] = useState('')

  async function sendInvite() {
    if (!clientEmail) { setError('Vul een e-mailadres in'); return }
    setLoading(true)
    setError('')
    setSuccess('')

    const res = await fetch('/api/invite/client', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientEmail })
    })

    const data = await res.json()

    if (!res.ok) {
      setError(data.error || 'Uitnodiging mislukt')
    } else {
      setSuccess(`Uitnodiging verstuurd naar ${clientEmail}`)
      setClientEmail('')
    }
    setLoading(false)
  }

  return (
    <div className="min-h-screen bg-[#f8f9fa]">

      <div className="mx-auto px-6 py-6" style={{ maxWidth: COLUMN.work }}>
        <div className="bg-white rounded-2xl p-5 shadow-sm space-y-4">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">
            Klant uitnodigen
          </p>
          <p className="text-sm text-gray-500">
            Vul het e-mailadres van je klant in. Hij ontvangt een uitnodiging om jou toe te voegen als boekhouder.
          </p>
          <div className="flex gap-2">
            <input
              type="email"
              value={clientEmail}
              onChange={e => setClientEmail(e.target.value)}
              className="flex-1 border border-gray-300 rounded-xl px-3 py-2 text-sm"
              placeholder="klant@bedrijf.nl"
            />
            <button
              onClick={sendInvite}
              disabled={loading}
              className="bg-purple-600 text-white px-4 py-2 rounded-xl text-sm font-semibold hover:bg-purple-700 disabled:opacity-50"
            >
              {loading ? '...' : 'Uitnodigen'}
            </button>
          </div>
          {success && <p className="text-sm text-green-600">{success}</p>}
          <ErrorMessage message={error} />
        </div>
      </div>
    </div>
  )
}
