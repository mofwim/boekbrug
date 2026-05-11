'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

export default function InviteClientPage() {
  const router = useRouter()

  // حالة الإيميل والتحميل والنجاح والخطأ
  const [clientEmail, setClientEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [success, setSuccess] = useState('')
  const [error, setError] = useState('')

  // إرسال دعوة للعميل
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
    <div className="min-h-screen bg-[#f2f2f7]">

      {/* Header */}
      <div className="bg-white border-b border-gray-200 px-6 py-4 sticky top-0 z-10">
        <div className="max-w-2xl mx-auto flex items-center gap-3">
          <button
            onClick={() => router.push('/dashboard')}
            className="text-gray-400 hover:text-gray-600 text-sm"
          >
            ← Terug
          </button>
          <h1 className="text-lg font-bold text-gray-900">Klant toevoegen</h1>
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-6 py-6">
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
          {error && <p className="text-sm text-red-500">{error}</p>}
        </div>
      </div>
    </div>
  )
}