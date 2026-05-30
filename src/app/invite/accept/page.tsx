'use client'

import { Suspense } from 'react'
import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase'
import { useRouter, useSearchParams } from 'next/navigation'

// المكون الداخلي الذي يستخدم useSearchParams
function AcceptInviteContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const token = searchParams.get('token')
  const supabase = createClient()

  const [status, setStatus] = useState<'loading' | 'ready' | 'accepted' | 'error'>('loading')
  const [invitation, setInvitation] = useState<any>(null)
  const [zzperName, setZzperName] = useState('')
  const [user, setUser] = useState<any>(null)

  useEffect(() => {
    async function load() {
      if (!token) { setStatus('error'); return }

      // Fetch invitation info via API — uses service role to bypass RLS
      // Direct Supabase call fails for unauthenticated users (RLS blocks profiles read)
      const infoRes = await fetch(`/api/invite/info?token=${token}`)
      if (!infoRes.ok) { setStatus('error'); return }

      const info = await infoRes.json()
      setZzperName(info.zzperName)

      // Also verify invitation exists (info route already checks pending status)
      setInvitation({ token })

      const { data: { user } } = await supabase.auth.getUser()
      setUser(user)
      setStatus('ready')
    }
    load()
  }, [token])

  async function handleAccept() {
    if (!invitation) return
    setStatus('loading')

    const res = await fetch('/api/invite/accept', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token })
    })

    if (res.ok) {
      setStatus('accepted')
      setTimeout(() => router.push('/dashboard'), 2000)
    } else {
      setStatus('error')
    }
  }

  if (status === 'loading') return (
    <div className="min-h-screen bg-[#f2f2f7] flex items-center justify-center">
      <p className="text-gray-400 text-sm">Laden...</p>
    </div>
  )

  if (status === 'error') return (
    <div className="min-h-screen bg-[#f2f2f7] flex items-center justify-center">
      <div className="bg-white rounded-2xl p-8 shadow-sm text-center max-w-sm">
        <p className="text-2xl mb-3">❌</p>
        <p className="font-semibold text-gray-900">Uitnodiging ongeldig</p>
        <p className="text-sm text-gray-500 mt-1">Deze uitnodiging is verlopen of al gebruikt.</p>
        <button onClick={() => router.push('/login')}
          className="mt-4 bg-blue-600 text-white px-6 py-2 rounded-xl text-sm font-semibold">
          Inloggen
        </button>
      </div>
    </div>
  )

  if (status === 'accepted') return (
    <div className="min-h-screen bg-[#f2f2f7] flex items-center justify-center">
      <div className="bg-white rounded-2xl p-8 shadow-sm text-center max-w-sm">
        <p className="text-2xl mb-3">✅</p>
        <p className="font-semibold text-gray-900">Uitnodiging geaccepteerd!</p>
        <p className="text-sm text-gray-500 mt-1">Je wordt doorgestuurd naar je dashboard...</p>
      </div>
    </div>
  )

  return (
    <div className="min-h-screen bg-[#f2f2f7] flex items-center justify-center">
      <div className="bg-white rounded-2xl p-8 shadow-sm text-center max-w-sm w-full">
        <p className="text-3xl mb-4">🤝</p>
        <h1 className="text-lg font-bold text-gray-900 mb-1">Je bent uitgenodigd</h1>
        <p className="text-sm text-gray-500 mb-6">
          <span className="font-medium text-gray-700">{zzperName}</span> wil je toevoegen als boekhouder via BoekBrug.
        </p>

        {user ? (
          <div className="space-y-3">
            <p className="text-xs text-gray-400">Ingelogd als {user.email}</p>
            <button onClick={handleAccept}
              className="w-full bg-blue-600 text-white py-3 rounded-xl text-sm font-semibold hover:bg-blue-700">
              Uitnodiging accepteren
            </button>
            <button onClick={() => router.push('/dashboard')}
              className="w-full border border-gray-200 text-gray-600 py-3 rounded-xl text-sm font-medium">
              Weigeren
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-sm text-gray-500">
              Log in of maak een account aan om de uitnodiging te accepteren.
            </p>
            <button
              onClick={() => router.push(`/login?redirect=${encodeURIComponent(`/invite/accept?token=${token}`)}`)}
              className="w-full bg-blue-600 text-white py-3 rounded-xl text-sm font-semibold hover:bg-blue-700">
              Inloggen
            </button>
            <button
              onClick={() => router.push(`/register?redirect=${encodeURIComponent(`/invite/accept?token=${token}`)}`)}
              className="w-full border border-gray-200 text-gray-600 py-3 rounded-xl text-sm font-medium">
              Nieuw account aanmaken
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

// الصفحة الرئيسية مع Suspense
export default function AcceptInvitePage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-[#f2f2f7] flex items-center justify-center">
        <p className="text-gray-400 text-sm">Laden...</p>
      </div>
    }>
      <AcceptInviteContent />
    </Suspense>
  )
}