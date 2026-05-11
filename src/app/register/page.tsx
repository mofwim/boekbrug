'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase'
import { useRouter } from 'next/navigation'
import { useSearchParams } from 'next/navigation'
export default function RegisterPage() {
  const searchParams = useSearchParams()
  const [step, setStep] = useState(1)
  const [role, setRole] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [fullName, setFullName] = useState('')
  const [companyName, setCompanyName] = useState('')
  const [kvk, setKvk] = useState('')
  const [btw, setBtw] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const router = useRouter()
  const supabase = createClient()

  async function handleRegister() {
    if (password.length < 6) {
      setError('Wachtwoord moet minimaal 6 tekens zijn')
      return
    }

    setLoading(true)
    setError('')

    const { data, error: signUpError } = await supabase.auth.signUp({ email, password })

    if (signUpError) {
      if (signUpError.status === 422) {
        setError('Dit e-mailadres is al geregistreerd — log in in plaats daarvan')
      } else {
        setError('Registratie mislukt — probeer opnieuw')
      }
      setLoading(false)
      return
    }

    if (!data.user) {
      setError('Registratie mislukt — probeer opnieuw')
      setLoading(false)
      return
    }

    const { error: profileError } = await supabase
      .from('profiles')
      .insert({
        id: data.user.id,
        role,
        full_name: fullName,
        company_name: companyName,
        kvk_number: kvk,
        btw_number: btw,
        email
      })

    if (profileError) {
      setError('Profiel aanmaken mislukt')
      setLoading(false)
      return
    }

    //const redirectUrl = new URLSearchParams(window.location.search).get('redirect')
//router.push(redirectUrl || '/dashboard')
const params = new URLSearchParams(window.location.search)
//const redirectUrl = params.get('redirect')
const redirectUrl = searchParams.get('redirect')
//router.push(redirectUrl || '/dashboard')

console.log('redirect:', redirectUrl) // مؤقت للتحقق
router.push(redirectUrl || '/dashboard')
  }

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center">
      <div className="bg-white p-8 rounded-2xl shadow-sm w-full max-w-md">

        <div className="text-center mb-8">
          <h1 className="text-2xl font-bold text-gray-900">BoekBrug</h1>
          <p className="text-gray-500 text-sm mt-1">Account aanmaken</p>
        </div>

        {step === 1 && (
          <div className="space-y-4">
            <p className="text-sm font-medium text-gray-700 text-center">Wie ben jij?</p>
            <button
              onClick={() => { setRole('zzper'); setStep(2) }}
              className="w-full border-2 border-gray-200 rounded-xl p-4 text-left hover:border-blue-500 transition-colors"
            >
              <p className="font-medium text-gray-900">ZZP'er</p>
              <p className="text-sm text-gray-500">Ik stuur en ontvang facturen</p>
            </button>
            <button
              onClick={() => { setRole('accountant'); setStep(2) }}
              className="w-full border-2 border-gray-200 rounded-xl p-4 text-left hover:border-blue-500 transition-colors"
            >
              <p className="font-medium text-gray-900">Boekhouder</p>
              <p className="text-sm text-gray-500">Ik beheer facturen van mijn klanten</p>
            </button>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Volledige naam</label>
              <input type="text" value={fullName} onChange={e => setFullName(e.target.value)}
                className="w-full border border-gray-300 rounded-xl px-4 py-2.5 text-sm"
                placeholder="Jan de Vries" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Bedrijfsnaam</label>
              <input type="text" value={companyName} onChange={e => setCompanyName(e.target.value)}
                className="w-full border border-gray-300 rounded-xl px-4 py-2.5 text-sm"
                placeholder="Jouw Bedrijf BV" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">KVK-nummer</label>
              <input type="text" value={kvk} onChange={e => setKvk(e.target.value)}
                className="w-full border border-gray-300 rounded-xl px-4 py-2.5 text-sm"
                placeholder="12345678" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">BTW-nummer</label>
              <input type="text" value={btw} onChange={e => setBtw(e.target.value)}
                className="w-full border border-gray-300 rounded-xl px-4 py-2.5 text-sm"
                placeholder="NL123456789B01" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">E-mailadres</label>
              <input type="email" value={email} onChange={e => setEmail(e.target.value)}
                className="w-full border border-gray-300 rounded-xl px-4 py-2.5 text-sm"
                placeholder="jouw@email.nl" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Wachtwoord</label>
              <input type="password" value={password} onChange={e => setPassword(e.target.value)}
                className="w-full border border-gray-300 rounded-xl px-4 py-2.5 text-sm"
                placeholder="••••••••" />
            </div>

            {error && <p className="text-sm text-red-500">{error}</p>}

            <button onClick={handleRegister} disabled={loading}
              className="w-full bg-blue-600 text-white rounded-xl py-2.5 text-sm font-semibold hover:bg-blue-700 disabled:opacity-50">
              {loading ? 'Bezig...' : 'Account aanmaken'}
            </button>

            <button onClick={() => setStep(1)}
              className="w-full text-gray-500 text-sm hover:text-gray-700">
              ← Terug
            </button>
          </div>
        )}

      </div>
    </div>
  )
}