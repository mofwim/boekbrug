//src/app/dashboard/settings/page.tsx
'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase'
import { useRouter } from 'next/navigation'
import { BackLink } from '@/components/ui/BackLink'
import { PushNotificationCard } from '@/components/settings/PushNotificationCard'
// [FACTUUR-B] numbering extraction (client-side live preview)
import { previewInvoiceStart, reasonToDutch } from '@/lib/invoice-template'
// [BRIDGE-POLISH 3a-3] formal validation for KVK / BTW / IBAN
import {
  validateKvk, validateBtw, validateIban,
  normalizeBtw, normalizeIban,
} from '@/lib/validation'

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
  // [REGIME-FLAGS] KOR (kleineondernemersregeling) opt-in. Saved with the profile; drives the
  // accountant-handoff flag ("KOR is actief — bereken geen BTW"), never a figure by itself.
  const [korActive, setKorActive] = useState(false)
  // [KASSTELSEL] BTW basis: factuurstelsel (accrual) vs kasstelsel (cash basis — BTW on the pay
  // date). vat_scheme_since is the effective date; set when switching TO kas so a past quarter is
  // never retroactively rewritten.
  const [vatScheme, setVatScheme] = useState<'factuur' | 'kas'>('factuur')
  const [vatSchemeSince, setVatSchemeSince] = useState<string | null>(null)
  // [REMINDERS] Automatic payment reminders — opt-in + cadence, saved with the profile.
  // Default OFF: nothing is ever e-mailed to a client until the owner turns this on.
  const [remindersEnabled, setRemindersEnabled] = useState(false)
  const [reminderOffsetsText, setReminderOffsetsText] = useState('14, 30')

  // حالة دعوة المحاسب
  const [accountantEmail, setAccountantEmail] = useState('')

  // حالات التحميل والنجاح والخطأ
  const [loadingProfile, setLoadingProfile] = useState(false)
  const [loadingInvite, setLoadingInvite] = useState(false)
  const [successProfile, setSuccessProfile] = useState('')
  const [successInvite, setSuccessInvite] = useState('')
  const [errorProfile, setErrorProfile] = useState('')
  const [errorInvite, setErrorInvite] = useState('')
  // [BRIDGE-POLISH 3a-3] per-field validation errors (KVK / BTW / IBAN)
  const [fieldErrors, setFieldErrors] = useState<{ kvk?: string; btw?: string; iban?: string }>({})

  // [BOEK-032] حالة تصدير البيانات + حذف الحساب
  const [exportConfirmed, setExportConfirmed] = useState(false)
  const [exportLoading, setExportLoading] = useState(false)
  const [deleteModalOpen, setDeleteModalOpen] = useState(false)
  const [delEmail, setDelEmail] = useState('')
  const [delPassword, setDelPassword] = useState('')
  const [delLoading, setDelLoading] = useState(false)
  const [delError, setDelError] = useState('')

  // [FACTUUR-B] factuurnummering
  const [numberingNext, setNumberingNext] = useState<string>('')
  const [numberingLocked, setNumberingLocked] = useState(false)
  const [numberingInput, setNumberingInput] = useState('')
  const [numberingLoading, setNumberingLoading] = useState(false)
  const [numberingSuccess, setNumberingSuccess] = useState('')
  const [numberingError, setNumberingError] = useState('')

  // [FACTUUR-B] load current numbering state (next number + lock)
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/invoice/numbering')
        if (!res.ok) return
        const d = await res.json()
        if (d?.ok) {
          setNumberingNext(d.next ?? '')
          setNumberingLocked(!!d.locked)
        }
      } catch { /* silent */ }
    })()
  }, [])

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
        setKorActive(!!data.kor_active)
        setVatScheme(data.vat_scheme === 'kas' ? 'kas' : 'factuur')
        setVatSchemeSince(data.vat_scheme_since ?? null)
        setRemindersEnabled(!!data.reminders_enabled)
        setReminderOffsetsText(
          (Array.isArray(data.reminder_offsets) && data.reminder_offsets.length > 0
            ? data.reminder_offsets
            : [14, 30]
          ).join(', ')
        )
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

    // [BRIDGE-POLISH 3a-3] Formal validation BEFORE any write. Empty values are
    // valid (all three fields are optional); only non-empty malformed values
    // block the save. Errors surface inline per field.
    const kvkRes  = validateKvk(kvk)
    const btwRes  = validateBtw(btw)
    const ibanRes = validateIban(iban)
    const nextErrors = {
      kvk:  kvkRes.valid  ? undefined : kvkRes.error,
      btw:  btwRes.valid  ? undefined : btwRes.error,
      iban: ibanRes.valid ? undefined : ibanRes.error,
    }
    if (!kvkRes.valid || !btwRes.valid || !ibanRes.valid) {
      setFieldErrors(nextErrors)
      setErrorProfile('Controleer de gemarkeerde velden')
      setLoadingProfile(false)
      return
    }
    setFieldErrors({})

    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return

    // [KASSTELSEL] When switching TO kas, anchor the effective date to the CURRENT quarter's
    // start (a clean boundary — no mid-quarter straddle): the current + future quarters compute
    // kas, past quarters stay factuur and are never retroactively rewritten. Keep the existing
    // since-date if already on kas. (A different agreed start-date is an accountant matter.)
    const now = new Date()
    const qStart = `${now.getFullYear()}-${String(Math.floor(now.getMonth() / 3) * 3 + 1).padStart(2, '0')}-01`
    let since = vatSchemeSince
    if (vatScheme === 'kas' && (profile.vat_scheme !== 'kas' || !since)) since = qStart

    // [REMINDERS] Parse the cadence text into positive ints (unique, ascending).
    // Empty/garbage falls back to the default {14,30} so the schedule is never blank.
    const parsedOffsets = Array.from(new Set(
      reminderOffsetsText
        .split(',')
        .map(s => parseInt(s.trim(), 10))
        .filter(n => Number.isInteger(n) && n > 0)
    )).sort((a, b) => a - b)
    const finalOffsets = parsedOffsets.length > 0 ? parsedOffsets : [14, 30]

    // [BRIDGE-POLISH 3a-3] Store the CANONICAL form (normalized), never the raw
    // input — so what we persist always matches what was validated. KVK keeps
    // its trimmed digits; BTW/IBAN are upper-cased + whitespace-stripped.
    const { error } = await supabase
      .from('profiles')
      .update({
        full_name: fullName,
        company_name: companyName,
        kvk_number: kvk.trim() || null,
        btw_number: normalizeBtw(btw) || null,
        iban: normalizeIban(iban) || null,
        address: address,
        postal_code: postalCode,
        city: city,
        kor_active: korActive,
        vat_scheme: vatScheme,
        vat_scheme_since: since,
      })
      .eq('id', user.id)

    if (error) {
      setErrorProfile('Opslaan mislukt — probeer opnieuw')
    } else {
      // [REMINDERS] Persist the reminder preferences in a SEPARATE, best-effort
      // update — never bundled with the core save above. Reason: if this deploys
      // before the invoice_reminders migration is applied, those two columns don't
      // exist yet; bundling them would make the WHOLE profile save fail ("column
      // does not exist") and brick Instellingen for every user. Split out, a
      // pre-migration miss is a silent no-op here while name/KVK/BTW still save.
      // Post-migration it simply succeeds. Order of deploy vs. migration no longer
      // matters.
      const { error: remErr } = await supabase
        .from('profiles')
        .update({ reminders_enabled: remindersEnabled, reminder_offsets: finalOffsets })
        .eq('id', user.id)
      if (remErr) {
        console.warn('[REMINDERS] reminder-preferences save skipped (migration applied?)', remErr.message)
      }

      // Reflect the normalized values back into the form fields
      setBtw(normalizeBtw(btw))
      setIban(normalizeIban(iban))
      setKvk(kvk.trim())
      setVatSchemeSince(since) // [KASSTELSEL] keep local since in sync with what we persisted
      setReminderOffsetsText(finalOffsets.join(', ')) // [REMINDERS] reflect the normalized cadence
      setSuccessProfile('Profiel opgeslagen ✓')
    }

    setLoadingProfile(false)
  }

  // [FACTUUR-B] save numbering via the single server authority (lock + seed live there)
  async function saveNumbering() {
    setNumberingLoading(true); setNumberingError(''); setNumberingSuccess('')
    try {
      const res = await fetch('/api/invoice/numbering', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ invoice_start: numberingInput.trim() }),
      })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) {
        setNumberingError(d?.error || 'Opslaan mislukt — probeer opnieuw')
        if (d?.locked) setNumberingLocked(true)
      } else {
        setNumberingNext(d.next ?? '')
        setNumberingInput('')
        setNumberingSuccess('Nummering opgeslagen ✓')
      }
    } catch {
      setNumberingError('Opslaan mislukt — probeer opnieuw')
    }
    setNumberingLoading(false)
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
    <div className="min-h-screen bg-[#f8f9fa] flex items-center justify-center">
      <p className="text-gray-400 text-sm">Laden...</p>
    </div>
  )

  return (
    <div className="min-h-screen bg-[#f8f9fa]">

      {/* Header */}
      <div className="bg-white border-b border-gray-200 px-6 py-4 sticky top-0 z-10">
        <div className="max-w-2xl mx-auto flex items-center gap-3">
          <BackLink className="text-gray-400 hover:text-gray-600 text-sm" style={{ color: 'inherit' }} />
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
                onChange={e => { setKvk(e.target.value); setFieldErrors(p => ({ ...p, kvk: undefined })) }}
                className={`w-full border rounded-xl px-3 py-2 text-sm ${fieldErrors.kvk ? 'border-red-400' : 'border-gray-300'}`}
                placeholder="12345678"
              />
              {fieldErrors.kvk && <p className="text-xs text-red-500 mt-1">{fieldErrors.kvk}</p>}
            </div>

            {/* رقم BTW */}
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">BTW-nummer</label>
              <input
                type="text"
                value={btw}
                onChange={e => { setBtw(e.target.value); setFieldErrors(p => ({ ...p, btw: undefined })) }}
                className={`w-full border rounded-xl px-3 py-2 text-sm ${fieldErrors.btw ? 'border-red-400' : 'border-gray-300'}`}
                placeholder="NL123456789B01"
              />
              {fieldErrors.btw && <p className="text-xs text-red-500 mt-1">{fieldErrors.btw}</p>}
            </div>

            {/* IBAN */}
            <div className="col-span-2">
              <label className="block text-xs font-medium text-gray-500 mb-1">IBAN</label>
              <input
                type="text"
                value={iban}
                onChange={e => { setIban(e.target.value); setFieldErrors(p => ({ ...p, iban: undefined })) }}
                className={`w-full border rounded-xl px-3 py-2 text-sm ${fieldErrors.iban ? 'border-red-400' : 'border-gray-300'}`}
                placeholder="NL12 ABNA 0123 4567 89"
              />
              {fieldErrors.iban && <p className="text-xs text-red-500 mt-1">{fieldErrors.iban}</p>}
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
                placeholder="Vul je stad in"
              />
            </div>
          </div>

          {successProfile && <p className="text-sm text-green-600">{successProfile}</p>}
          {errorProfile && <p className="text-sm text-red-500">{errorProfile}</p>}

          {/* [REGIME-FLAGS] KOR — kleineondernemersregeling opt-in. Saved with the profile. */}
          <div className="border-t border-gray-100 pt-4">
            <label className="flex items-start gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={korActive}
                onChange={e => setKorActive(e.target.checked)}
                className="mt-0.5 h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
              />
              <span>
                <span className="block text-sm font-medium text-gray-800">
                  Ik gebruik de kleineondernemersregeling (KOR)
                </span>
                <span className="block text-xs text-gray-500 mt-0.5">
                  Onder de KOR breng je geen BTW in rekening. Je concept-aangifte krijgt dan een
                  duidelijke notitie voor je boekhouder — de omzet blijft kloppen, alleen de
                  BTW-afdracht vervalt.
                </span>
              </span>
            </label>
          </div>

          {/* [KASSTELSEL] BTW-methode: factuurstelsel (accrual) vs kasstelsel (cash basis). */}
          <div className="border-t border-gray-100 pt-4 space-y-2">
            <span className="block text-sm font-medium text-gray-800">BTW-methode</span>
            <label className="flex items-start gap-3 cursor-pointer">
              <input
                type="radio"
                name="vat_scheme"
                checked={vatScheme === 'factuur'}
                onChange={() => setVatScheme('factuur')}
                className="mt-0.5 h-4 w-4 border-gray-300 text-blue-600 focus:ring-blue-500"
              />
              <span>
                <span className="block text-sm text-gray-800">Factuurstelsel (standaard)</span>
                <span className="block text-xs text-gray-500 mt-0.5">
                  BTW telt op de factuurdatum. De meeste ondernemers gebruiken dit.
                </span>
              </span>
            </label>
            <label className="flex items-start gap-3 cursor-pointer">
              <input
                type="radio"
                name="vat_scheme"
                checked={vatScheme === 'kas'}
                onChange={() => setVatScheme('kas')}
                className="mt-0.5 h-4 w-4 border-gray-300 text-blue-600 focus:ring-blue-500"
              />
              <span>
                <span className="block text-sm text-gray-800">Kasstelsel</span>
                <span className="block text-xs text-gray-500 mt-0.5">
                  BTW telt op de betaaldatum — voor veel winkels/horeca verplicht. Ingaat vanaf het
                  huidige kwartaal; eerdere kwartalen blijven ongewijzigd. Een betaalde factuur
                  zonder betaaldatum blokkeert &ldquo;klaar&rdquo; tot je de betaling koppelt.
                </span>
              </span>
            </label>
          </div>

          {/* [REMINDERS] Automatische betalingsherinneringen — opt-in + cadence. */}
          <div className="border-t border-gray-100 pt-4 space-y-3">
            <label className="flex items-start gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={remindersEnabled}
                onChange={e => setRemindersEnabled(e.target.checked)}
                className="mt-0.5 h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
              />
              <span>
                <span className="block text-sm font-medium text-gray-800">
                  Stuur automatisch betalingsherinneringen
                </span>
                <span className="block text-xs text-gray-500 mt-0.5">
                  Staat een verstuurde factuur na de vervaldatum nog open, dan mailt BoekBrug je klant
                  automatisch een vriendelijke herinnering met het openstaande bedrag. Een betaalde
                  factuur wordt nooit herinnerd — jij hoeft niets te doen.
                </span>
              </span>
            </label>
            {remindersEnabled && (
              <div className="pl-7">
                <label className="block text-xs font-medium text-gray-500 mb-1">
                  Herinner na (dagen na vervaldatum)
                </label>
                <input
                  type="text"
                  value={reminderOffsetsText}
                  onChange={e => setReminderOffsetsText(e.target.value)}
                  className="w-40 border border-gray-300 rounded-xl px-3 py-2 text-sm"
                  placeholder="14, 30"
                />
                <span className="block text-xs text-gray-400 mt-1">
                  Bijv. &ldquo;14, 30&rdquo;: een vriendelijke herinnering na 14 dagen, een steviger na 30.
                </span>
              </div>
            )}
          </div>

          {/* زر الحفظ */}
          <button
            onClick={saveProfile}
            disabled={loadingProfile}
            className="bg-blue-600 text-white px-6 py-2.5 rounded-xl text-sm font-semibold hover:bg-blue-700 disabled:opacity-50"
          >
            {loadingProfile ? 'Opslaan...' : 'Opslaan'}
          </button>
        </div>

        {/* [PUSH] Meldingen (push notifications) — self-hides when unavailable */}
        <PushNotificationCard />

        {/* [FACTUUR-B] Factuurnummering — ZZP'er only */}
        {profile.role === 'zzper' && (
          <div className="bg-white rounded-2xl p-5 shadow-sm space-y-3">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">
              Factuurnummering
            </p>

            {numberingNext && (
              <p className="text-sm text-gray-600">
                Je volgende factuur wordt:{' '}
                <span className="font-semibold text-gray-900">{numberingNext}</span>
              </p>
            )}

            {numberingLocked ? (
              <p className="text-sm text-gray-500">
                🔒 Je nummering staat vast — er is al een factuur verstuurd.
                Wijzigen kan niet meer (wettelijk verplicht).
              </p>
            ) : (
              <>
                <p className="text-sm text-gray-500">
                  Kom je van een ander programma? Vul je volgende factuurnummer in —
                  bijv. <span className="font-mono">045-2026</span>.
                </p>
                <input
                  type="text"
                  value={numberingInput}
                  onChange={e => { setNumberingInput(e.target.value); setNumberingError(''); setNumberingSuccess('') }}
                  className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm"
                  placeholder="bijv. 045-2026"
                />

                {/* live preview */}
                {(() => {
                  const t = numberingInput.trim()
                  if (!t) return null
                  const p = previewInvoiceStart(t, new Date().getFullYear())
                  if (p.ok) return (
                    <p className="text-sm text-green-600">
                      ✓ Eerste factuur: <span className="font-semibold">{p.first}</span> · volgende: {p.next}
                    </p>
                  )
                  if (p.reason !== 'empty') return <p className="text-sm text-amber-600">{reasonToDutch(p.reason)}</p>
                  return null
                })()}

                {numberingSuccess && <p className="text-sm text-green-600">{numberingSuccess}</p>}
                {numberingError && <p className="text-sm text-red-500">{numberingError}</p>}

                <button
                  onClick={saveNumbering}
                  disabled={
                    numberingLoading ||
                    (numberingInput.trim() !== '' &&
                      !previewInvoiceStart(numberingInput.trim(), new Date().getFullYear()).ok)
                  }
                  className="bg-blue-600 text-white px-6 py-2.5 rounded-xl text-sm font-semibold hover:bg-blue-700 disabled:opacity-50"
                >
                  {numberingLoading ? 'Opslaan...' : 'Nummering opslaan'}
                </button>
              </>
            )}
          </div>
        )}

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