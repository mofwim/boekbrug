//src/app/dashboard/settings/page.tsx
'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase'
import { useRouter } from 'next/navigation'

export default function SettingsPage() {
  const router = useRouter()
  const supabase = createClient()
  const [accountant, setAccountant] = useState<any>(null)
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

  // [BOEK-032] حالة تصدير البيانات + حذف الحساب
  const [exportConfirmed, setExportConfirmed] = useState(false)
  const [exportLoading, setExportLoading] = useState(false)
  const [deleteModalOpen, setDeleteModalOpen] = useState(false)
  const [delEmail, setDelEmail] = useState('')
  const [delPassword, setDelPassword] = useState('')
  const [delLoading, setDelLoading] = useState(false)
  const [delError, setDelError] = useState('')

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
      // جلب محاسب الـ ZZP'er إذا كان مرتبطاً — via API (service role bypasses RLS)
      if (data?.role === 'zzper') {
        const res = await fetch('/api/settings/accountant')
        if (res.ok) {
          const json = await res.json()
          if (json.accountant) setAccountant(json.accountant)
        }
      }

      // [BOEK-032] هل سبق تأكيد تصدير البيانات؟ (يُبقي زر الحذف مُفعّلاً لو غادر وعاد)
      const { data: dr } = await supabase
        .from('deletion_requests')
        .select('export_confirmed')
        .eq('user_id', user.id)
        .maybeSingle()
      if (dr?.export_confirmed) setExportConfirmed(true)
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
  // إزالة ربط المحاسب مع تأكيد
  async function unlinkAccountant() {
    const confirmed = window.confirm(
      'Weet je zeker dat je de koppeling met je boekhouder wilt verwijderen?'
    )
    if (!confirmed) return

    // Call API — handles email notification + audit log server-side
    const res = await fetch('/api/accountant/unlink-by-client', { method: 'POST' })
    if (res.ok) {
      setAccountant(null)
    } else {
      const data = await res.json().catch(() => ({}))
      alert(data.error || 'Ontkoppelen mislukt')
    }
  }

  // [BOEK-032] تصدير كل بيانات الحساb (ZIP) ثم تفعيل زر الحذف
  async function exportData() {
    setExportLoading(true)
    setDelError('')
    try {
      const res = await fetch('/api/account/export', { method: 'POST' })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setDelError(data.error || 'Export mislukt')
        return
      }
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `boekbrug-export-${new Date().toISOString().slice(0, 10)}.zip`
      a.click()
      URL.revokeObjectURL(url)
      setExportConfirmed(true)
    } catch {
      setDelError('Export mislukt — probeer opnieuw')
    } finally {
      setExportLoading(false)
    }
  }

  // [BOEK-032] تأكيد الحذف بـ email + password — تعطيل لا حذف فيزيائي
  async function confirmDelete() {
    if (!delEmail || !delPassword) {
      setDelError('Vul je e-mailadres en wachtwoord in')
      return
    }
    setDelLoading(true)
    setDelError('')
    try {
      const res = await fetch('/api/account/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: delEmail, password: delPassword }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setDelError(data.error || 'Verwijderen mislukt')
        return
      }
      await supabase.auth.signOut()
      router.push('/login')
    } catch {
      setDelError('Verwijderen mislukt — probeer opnieuw')
    } finally {
      setDelLoading(false)
    }
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
                onKeyDown={e => e.key === 'Enter' && sendInvite()}
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
        {/* محاسب ZZP'er الحالي */}
        {profile.role === 'zzper' && accountant && (
          <div className="bg-white rounded-2xl p-5 shadow-sm space-y-3">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">
              Jouw boekhouder
            </p>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-900">
                  {accountant.company_name || accountant.full_name}
                </p>
                <p className="text-xs text-gray-400">{accountant.email}</p>
              </div>
              <button
                onClick={unlinkAccountant}
                className="text-xs text-red-400 hover:text-red-600 font-medium"
              >
                Ontkoppelen
              </button>
            </div>
          </div>
        )}

        {/* [BOEK-032] Gevarenzone — gegevens exporteren + account verwijderen */}
        <div className="bg-white rounded-2xl p-5 shadow-sm space-y-3 border border-red-100">
          <p className="text-xs font-semibold text-red-400 uppercase tracking-wide">
            Gevarenzone
          </p>
          <p className="text-sm text-gray-500">
            Exporteer eerst al je gegevens. Daarna kun je je account verwijderen.
            Je gegevens worden niet direct gewist: facturen en administratie
            moeten wettelijk 7 jaar bewaard blijven (Bewaarplicht). Je account
            wordt gedeactiveerd en is daarna niet meer toegankelijk.
          </p>
          <div className="flex flex-col sm:flex-row gap-2">
            <button
              onClick={exportData}
              disabled={exportLoading}
              className="flex-1 bg-[#1A73E8] text-white px-4 py-2.5 rounded-xl text-sm font-semibold hover:opacity-90 disabled:opacity-50"
            >
              {exportLoading
                ? 'Exporteren...'
                : exportConfirmed
                ? 'Opnieuw exporteren'
                : 'Exporteer mijn gegevens'}
            </button>
            <button
              onClick={() => { setDelError(''); setDeleteModalOpen(true) }}
              disabled={!exportConfirmed}
              className="flex-1 border border-red-300 text-red-600 px-4 py-2.5 rounded-xl text-sm font-semibold hover:bg-red-50 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Account verwijderen
            </button>
          </div>
          {!exportConfirmed && (
            <p className="text-xs text-gray-400">
              Verwijderen is pas mogelijk nadat je je gegevens hebt geëxporteerd.
            </p>
          )}
        </div>

      </div>

      {/* [BOEK-032] Bevestig verwijderen — e-mail + wachtwoord */}
      {deleteModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4"
          onClick={() => { if (!delLoading) setDeleteModalOpen(false) }}
        >
          <div
            className="bg-white w-full max-w-sm p-6 space-y-4"
            style={{ borderRadius: 28 }}
            onClick={e => e.stopPropagation()}
          >
            <h2 className="text-base font-bold text-gray-900">Account verwijderen</h2>
            <p className="text-sm text-gray-500">
              Bevestig met je e-mailadres en wachtwoord. Je account wordt
              gedeactiveerd en is daarna niet meer toegankelijk. Je gegevens
              blijven wettelijk bewaard (Bewaarplicht ~7 jaar).
            </p>
            <div className="space-y-2">
              <input
                type="email"
                value={delEmail}
                onChange={e => setDelEmail(e.target.value)}
                className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm"
                placeholder="E-mailadres"
              />
              <input
                type="password"
                value={delPassword}
                onChange={e => setDelPassword(e.target.value)}
                className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm"
                placeholder="Wachtwoord"
              />
            </div>
            {delError && <p className="text-sm text-red-500">{delError}</p>}
            <div className="flex gap-2 pt-1">
              <button
                onClick={() => setDeleteModalOpen(false)}
                disabled={delLoading}
                className="flex-1 border border-gray-300 text-gray-600 px-4 py-2.5 rounded-xl text-sm font-semibold hover:bg-gray-50 disabled:opacity-50"
              >
                Annuleren
              </button>
              <button
                onClick={confirmDelete}
                disabled={delLoading}
                className="flex-1 bg-red-600 text-white px-4 py-2.5 rounded-xl text-sm font-semibold hover:bg-red-700 disabled:opacity-50"
              >
                {delLoading ? 'Verwijderen...' : 'Definitief verwijderen'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}