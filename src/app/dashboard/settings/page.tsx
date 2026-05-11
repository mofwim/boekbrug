'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase'
import { useRouter } from 'next/navigation'

export default function SettingsPage() {
  const router = useRouter()
  const supabase = createClient()

  // حالة الملف الشخصي
  const [profile, setProfile] = useState<any>(null)

  // حقول تعديل الملف الشخصي
  const [fullName, setFullName] = useState('')
  const [companyName, setCompanyName] = useState('')
  const [kvk, setKvk] = useState('')
  const [btw, setBtw] = useState('')
  const [iban, setIban] = useState('')
  const [address, setAddress] = useState('')
  const [postalCode, setPostalCode] = useState('')
  const [city, setCity] = useState('')

  // حالة دعوة المحاسب
  const [accountantEmail, setAccountantEmail] = useState('')

  // حالات التحميل والنجاح والخطأ
  const [loadingProfile, setLoadingProfile] = useState(false)
  const [loadingInvite, setLoadingInvite] = useState(false)
  const [successProfile, setSuccessProfile] = useState('')
  const [successInvite, setSuccessInvite] = useState('')
  const [errorProfile, setErrorProfile] = useState('')
  const [errorInvite, setErrorInvite] = useState('')

  // تحميل بيانات الملف الشخصي عند فتح الصفحة
  useEffect(() => {
    async function load() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { router.push('/login'); return }

      const { data } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', user.id)
        .single()

      if (data) {
        setProfile(data)
        // تعبئة الحقول بالبيانات الموجودة
        setFullName(data.full_name || '')
        setCompanyName(data.company_name || '')
        setKvk(data.kvk_number || '')
        setBtw(data.btw_number || '')
        setIban(data.iban || '')
        setAddress(data.address || '')
        setPostalCode(data.postal_code || '')
        setCity(data.city || '')
      }
    }
    load()
  }, [])

  // حفظ تعديلات الملف الشخصي
  async function saveProfile() {
    setLoadingProfile(true)
    setErrorProfile('')
    setSuccessProfile('')

    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return

    const { error } = await supabase
      .from('profiles')
      .update({
        full_name: fullName,
        company_name: companyName,
        kvk_number: kvk,
        btw_number: btw,
        iban: iban,
        address: address,
        postal_code: postalCode,
        city: city
      })
      .eq('id', user.id)

    if (error) {
      setErrorProfile('Opslaan mislukt — probeer opnieuw')
    } else {
      setSuccessProfile('Profiel opgeslagen ✓')
    }

    setLoadingProfile(false)
  }

  // إرسال دعوة للمحاسب
  async function sendInvite() {
    if (!accountantEmail) { setErrorInvite('Vul een e-mailadres in'); return }
    setLoadingInvite(true)
    setErrorInvite('')
    setSuccessInvite('')

    const res = await fetch('/api/invite/accountant', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accountantEmail })
    })

    const data = await res.json()

    if (!res.ok) {
      setErrorInvite(data.error || 'Uitnodiging mislukt')
    } else {
      setSuccessInvite(`Uitnodiging verstuurd naar ${accountantEmail}`)
      setAccountantEmail('')
    }
    setLoadingInvite(false)
  }

  // انتظار تحميل البيانات
  if (!profile) return (
    <div className="min-h-screen bg-[#f2f2f7] flex items-center justify-center">
      <p className="text-gray-400 text-sm">Laden...</p>
    </div>
  )

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
          <h1 className="text-lg font-bold text-gray-900">Instellingen</h1>
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-6 py-6 space-y-4">

        {/* تعديل الملف الشخصي */}
        <div className="bg-white rounded-2xl p-5 shadow-sm space-y-4">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">
            Jouw profiel
          </p>

          <div className="grid grid-cols-2 gap-3">
            {/* الاسم الكامل */}
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Volledige naam</label>
              <input
                type="text"
                value={fullName}
                onChange={e => setFullName(e.target.value)}
                className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm"
                placeholder="Jan de Vries"
              />
            </div>

            {/* اسم الشركة */}
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Bedrijfsnaam</label>
              <input
                type="text"
                value={companyName}
                onChange={e => setCompanyName(e.target.value)}
                className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm"
                placeholder="Jouw Bedrijf BV"
              />
            </div>

            {/* رقم KVK */}
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">KVK-nummer</label>
              <input
                type="text"
                value={kvk}
                onChange={e => setKvk(e.target.value)}
                className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm"
                placeholder="12345678"
              />
            </div>

            {/* رقم BTW */}
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">BTW-nummer</label>
              <input
                type="text"
                value={btw}
                onChange={e => setBtw(e.target.value)}
                className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm"
                placeholder="NL123456789B01"
              />
            </div>

            {/* IBAN */}
            <div className="col-span-2">
              <label className="block text-xs font-medium text-gray-500 mb-1">IBAN</label>
              <input
                type="text"
                value={iban}
                onChange={e => setIban(e.target.value)}
                className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm"
                placeholder="NL12 ABNA 0123 4567 89"
              />
            </div>

            {/* العنوان */}
            <div className="col-span-2">
              <label className="block text-xs font-medium text-gray-500 mb-1">Adres</label>
              <input
                type="text"
                value={address}
                onChange={e => setAddress(e.target.value)}
                className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm"
                placeholder="Straatnaam 1"
              />
            </div>

            {/* الرمز البريدي */}
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Postcode</label>
              <input
                type="text"
                value={postalCode}
                onChange={e => setPostalCode(e.target.value)}
                className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm"
                placeholder="1234 AB"
              />
            </div>

            {/* المدينة */}
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Stad</label>
              <input
                type="text"
                value={city}
                onChange={e => setCity(e.target.value)}
                className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm"
                placeholder="Amsterdam"
              />
            </div>
          </div>

          {successProfile && <p className="text-sm text-green-600">{successProfile}</p>}
          {errorProfile && <p className="text-sm text-red-500">{errorProfile}</p>}

          {/* زر الحفظ */}
          <button
            onClick={saveProfile}
            disabled={loadingProfile}
            className="bg-blue-600 text-white px-6 py-2.5 rounded-xl text-sm font-semibold hover:bg-blue-700 disabled:opacity-50"
          >
            {loadingProfile ? 'Opslaan...' : 'Opslaan'}
          </button>
        </div>

        {/* دعوة المحاسب — للـ ZZP'er فقط */}
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
                disabled={loadingInvite}
                className="bg-blue-600 text-white px-4 py-2 rounded-xl text-sm font-semibold hover:bg-blue-700 disabled:opacity-50"
              >
                {loadingInvite ? '...' : 'Uitnodigen'}
              </button>
            </div>
            {successInvite && <p className="text-sm text-green-600">{successInvite}</p>}
            {errorInvite && <p className="text-sm text-red-500">{errorInvite}</p>}
          </div>
        )}

      </div>
    </div>
  )
}