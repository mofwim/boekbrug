'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase'
import { useRouter } from 'next/navigation'

export default function SettingsPage() {
  const router = useRouter()
  const supabase = createClient()

  const [profile, setProfile] = useState<any>(null)
  const [accountantEmail, setAccountantEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [success, setSuccess] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    async function load() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { router.push('/login'); return }
      const { data } = await supabase.from('profiles').select('*').eq('id', user.id).single()
      if (data) setProfile(data)
    }
    load()
  }, [])

  async function sendInvite() {
    if (!accountantEmail) { setError('Vul een e-mailadres in'); return }
    setLoading(true)
    setError('')
    setSuccess('')

    const res = await fetch('/api/invite/accountant', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accountantEmail })
    })

    const data = await res.json()

    if (!res.ok) {
      setError(data.error || 'Uitnodiging mislukt')
    } else {
      setSuccess(`Uitnodiging verstuurd naar ${accountantEmail}`)
      setAccountantEmail('')
    }
    setLoading(false)
  }

  if (!profile) return null

  return (
    <div className="min-h-screen bg-[#f2f2f7]">

      {/* Header */}
      <div className="bg-white border-b border-gray-200 px-6 py-4 sticky top-0 z-10">
        <div className="max-w-2xl mx-auto flex items-center gap-3">
          <button onClick={() => router.push('/dashboard')} className="text-gray-400 hover:text-gray-600 text-sm">
            ← Terug
          </button>
          <h1 className="text-lg font-bold text-gray-900">Instellingen</h1>
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-6 py-6 space-y-4">

        {/* Profiel info */}
        <div className="bg-white rounded-2xl p-5 shadow-sm">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">Jouw profiel</p>
          <div className="space-y-1 text-sm text-gray-600">
            <p><span className="text-gray-400">Naam:</span> {profile.full_name}</p>
            <p><span className="text-gray-400">Bedrijf:</span> {profile.company_name || '—'}</p>
            <p><span className="text-gray-400">KVK:</span> {profile.kvk_number || '—'}</p>
            <p><span className="text-gray-400">BTW:</span> {profile.btw_number || '—'}</p>
            <p><span className="text-gray-400">IBAN:</span> {profile.iban || '—'}</p>
          </div>
        </div>

        {/* Boekhouder koppelen */}
        {profile.role === 'zzper' && (
          <div className="bg-white rounded-2xl p-5 shadow-sm space-y-3">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">
              Boekhouder koppelen
            </p>
            <p className="text-sm text-gray-500">
              Vul het e-mailadres van je boekhouder in. Hij ontvangt een uitnodiging om je facturen te beheren.
            </p>
            <div className="flex gap-2">
              <input
                type="email"
                value={accountantEmail}
                onChange={e => setAccountantEmail(e.target.value)}
                className="flex-1 border border-gray-300 rounded-xl px-3 py-2 text-sm"
                placeholder="boekhouder@kantoor.nl"
              />
              <button
                onClick={sendInvite}
                disabled={loading}
                className="bg-blue-600 text-white px-4 py-2 rounded-xl text-sm font-semibold hover:bg-blue-700 disabled:opacity-50"
              >
                {loading ? '...' : 'Uitnodigen'}
              </button>
            </div>
            {success && <p className="text-sm text-green-600">{success}</p>}
            {error && <p className="text-sm text-red-500">{error}</p>}
          </div>
        )}

      </div>
    </div>
  )
}