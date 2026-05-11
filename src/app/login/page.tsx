'use client'

import { Suspense } from 'react'
import { useState } from 'react'
import { createClient } from '@/lib/supabase'
import { useRouter, useSearchParams } from 'next/navigation'

// المكون الداخلي
function LoginContent() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const router = useRouter()
  const searchParams = useSearchParams()
  const supabase = createClient()

  // تسجيل الدخول
  async function handleLogin() {
    setLoading(true)
    setError('')

    const { error } = await supabase.auth.signInWithPassword({ email, password })

    if (error) {
      setError('Email of wachtwoord is onjuist')
      setLoading(false)
      return
    }

    const redirectUrl = searchParams.get('redirect')
    router.push(redirectUrl ? decodeURIComponent(redirectUrl) : '/dashboard')
  }

  // الذهاب لصفحة التسجيل مع الحفاظ على redirect
  function goToRegister() {
    const redirectUrl = searchParams.get('redirect')
    router.push(redirectUrl
      ? `/register?redirect=${encodeURIComponent(redirectUrl)}`
      : '/register'
    )
  }

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center">
      <div className="bg-white p-8 rounded-2xl shadow-sm w-full max-w-md">

        <div className="text-center mb-8">
          <h1 className="text-2xl font-bold text-gray-900">BoekBrug</h1>
          <p className="text-gray-500 text-sm mt-1">De brug tussen jou en je boekhouder</p>
        </div>

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">E-mailadres</label>
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              className="w-full border border-gray-300 rounded-xl px-4 py-2.5 text-sm"
              placeholder="jouw@email.nl"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Wachtwoord</label>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              className="w-full border border-gray-300 rounded-xl px-4 py-2.5 text-sm"
              placeholder="••••••••"
            />
          </div>

          {error && <p className="text-sm text-red-500">{error}</p>}

          <button
            onClick={handleLogin}
            disabled={loading}
            className="w-full bg-blue-600 text-white rounded-xl py-2.5 text-sm font-semibold hover:bg-blue-700 disabled:opacity-50"
          >
            {loading ? 'Bezig...' : 'Inloggen'}
          </button>

          <button
            onClick={goToRegister}
            disabled={loading}
            className="w-full border border-gray-200 text-gray-700 rounded-xl py-2.5 text-sm font-medium hover:bg-gray-50 disabled:opacity-50"
          >
            Nieuw account aanmaken
          </button>
        </div>

      </div>
    </div>
  )
}

// الصفحة الرئيسية مع Suspense
export default function LoginPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <p className="text-gray-400 text-sm">Laden...</p>
      </div>
    }>
      <LoginContent />
    </Suspense>
  )
}