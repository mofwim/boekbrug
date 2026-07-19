'use client'

// src/app/dashboard/kas/KasClient.tsx
// [CASH-LEDGER] The cash book. Running balance + a light add form + the ledger.
// Cash sales (in) and cash expenses (out); deposits/withdrawals to the bank are
// 'transfer' so they change the drawer balance but never the revenue/cost picture.

import { useEffect, useRef, useState } from 'react'
import { BackLink } from '@/components/ui/BackLink'

const M3 = {
  primary: '#1A73E8', onPrimary: '#fff', onSurface: '#202124', neutral: '#5F6368',
  surface: '#FFFFFF', outlineVariant: '#E0E0E0', success: '#137333', error: '#B3261E',
  warning: '#E37400', // [COHERENCE-KAS-UPLOAD] calm amber for "couldn't read — check bestanden"
  primaryContainer: '#D3E3FD',
}
const FONT = "'Roboto', -apple-system, sans-serif"
const FONT_NUM = "'Roboto Mono', monospace"
const eur = new Intl.NumberFormat('nl-NL', { style: 'currency', currency: 'EUR' })

const CATS: { key: string; label: string }[] = [
  { key: 'omzet', label: 'Omzet' },
  { key: 'kosten', label: 'Kost' },
  { key: 'prive', label: 'Privé' },
  { key: 'transfer', label: 'Naar/van bank' },
]

interface Entry {
  id: string
  entry_date: string
  direction: 'in' | 'out'
  amount: number
  category: string
  description: string | null
}

// [KASBOEK] The live quarterly cash book (a pure projection over the truth layer — see
// /api/kasboek). Mirrors the shapes in lib/kasboek.ts, only the fields the panel renders.
interface KasRow { date: string; beginsaldo: number; ontvangsten: number; uitgaven: number; descriptions: string[]; eindsaldo: number }
interface KasMonth { key: string; label: string; rows: KasRow[]; totalIn: number; totalOut: number }
interface Kasboek {
  year: number; quarter: number; openingBalance: number; closingBalance: number
  months: KasMonth[]; totalIn: number; totalOut: number
}

// Previous quarter for the ◀ selector (Q1 → Q4 of the prior year).
function prevQuarter(y: number, q: number): { year: number; quarter: number } {
  return q <= 1 ? { year: y - 1, quarter: 4 } : { year: y, quarter: q - 1 }
}
function nextQuarter(y: number, q: number): { year: number; quarter: number } {
  return q >= 4 ? { year: y + 1, quarter: 1 } : { year: y, quarter: q + 1 }
}

function formatDate(iso: string | null): string {
  if (!iso) return ''
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso)
  if (!m) return ''
  const months = ['jan.', 'feb.', 'mrt.', 'apr.', 'mei', 'jun.', 'jul.', 'aug.', 'sep.', 'okt.', 'nov.', 'dec.']
  return `${Number(m[3])} ${months[Number(m[2]) - 1]}`
}
function todayIso(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Amsterdam', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
}

export default function KasClient() {
  const [entries, setEntries] = useState<Entry[]>([])
  const [search, setSearch] = useState('')  // [SEARCH] in-page live ledger filter
  const [balance, setBalance] = useState(0)
  // [KAS-OPENING] the drawer's starting float (beginsaldo) — a config value the owner sets once.
  const [openingBalance, setOpeningBalance] = useState(0)
  const [openingEdit, setOpeningEdit] = useState(false)
  const [openingInput, setOpeningInput] = useState('')
  const [openingSaving, setOpeningSaving] = useState(false)
  const [loading, setLoading] = useState(true)
  // [COHERENCE-ERRSTATE] Distinguish "loaded, drawer is empty" from "load failed".
  // Without this, a /api/cash failure was swallowed and the page showed a reassuring
  // €0,00 saldo + "Nog geen kasboekingen" — a false money figure indistinguishable
  // from a fresh account (locked constraint #3: no false reassurance).
  const [loadError, setLoadError] = useState(false)

  const [direction, setDirection] = useState<'in' | 'out'>('in')
  const [amount, setAmount] = useState('')
  const [category, setCategory] = useState('omzet')
  const [btwRate, setBtwRate] = useState(21)
  const [date, setDate] = useState(todayIso())
  const [description, setDescription] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  // [KASBOEK] Live quarterly cash book. Loaded lazily; on first open the endpoint defaults to
  // the last completed quarter and tells us which one it picked (kb.year/kb.quarter).
  const [kbOpen, setKbOpen] = useState(false)
  const [kb, setKb] = useState<Kasboek | null>(null)
  const [kbLoading, setKbLoading] = useState(false)
  const [kbPeriod, setKbPeriod] = useState<{ year: number; quarter: number } | null>(null)

  async function loadKasboek(period: { year: number; quarter: number } | null) {
    setKbLoading(true)
    try {
      const qs = period ? `?year=${period.year}&quarter=${period.quarter}` : ''
      const res = await fetch(`/api/kasboek${qs}`)
      const json = await res.json()
      if (res.ok && json.kasboek) {
        setKb(json.kasboek as Kasboek)
        setKbPeriod({ year: json.kasboek.year, quarter: json.kasboek.quarter })
      }
    } catch { /* silent — the panel shows a retry */ } finally { setKbLoading(false) }
  }

  function openKasboek() {
    setKbOpen(true)
    if (!kb) void loadKasboek(null)
  }

  async function load() {
    try {
      const res = await fetch('/api/cash')
      const json = await res.json()
      if (res.ok) { setEntries(json.entries ?? []); setBalance(json.balance ?? 0); setOpeningBalance(json.openingBalance ?? 0); setLoadError(false) }
      else { setLoadError(true) }
    } catch { setLoadError(true) } finally { setLoading(false) }
  }

  // [KAS-OPENING] Persist the starting float, then reload so the saldo reflects it immediately.
  async function saveOpeningBalance() {
    const val = Number((openingInput || '').replace(',', '.'))
    if (!Number.isFinite(val) || val < 0) { setError('Beginsaldo moet 0 of hoger zijn'); return }
    setOpeningSaving(true)
    try {
      const res = await fetch('/api/cash', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kas_opening_balance: val }),
      })
      if (res.ok) { setOpeningEdit(false); await load() }
      else { const j = await res.json().catch(() => ({})); setError(j.error || 'Kon beginsaldo niet opslaan') }
    } catch { setError('Verbinding mislukt') } finally { setOpeningSaving(false) }
  }
  // Initial load — inline async IIFE so no setState runs synchronously in the effect.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch('/api/cash')
        const json = await res.json()
        if (!cancelled) {
          if (res.ok) { setEntries(json.entries ?? []); setBalance(json.balance ?? 0); setOpeningBalance(json.openingBalance ?? 0); setLoadError(false) }
          else { setLoadError(true) }
        }
      } catch { if (!cancelled) setLoadError(true) } finally { if (!cancelled) setLoading(false) }
    })()
    return () => { cancelled = true }
  }, [])

  // Default the category to match the direction (in → omzet, out → kost).
  function setDir(d: 'in' | 'out') {
    setDirection(d)
    setCategory(d === 'in' ? 'omzet' : 'kosten')
  }

  async function add() {
    const val = Number(amount.replace(',', '.'))
    if (!Number.isFinite(val) || val <= 0) { setError('Vul een bedrag groter dan 0 in.'); return }
    setSaving(true); setError('')
    try {
      const res = await fetch('/api/cash', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ entry_date: date, direction, amount: val, category, description, btw_rate: category === 'omzet' ? btwRate : undefined }),
      })
      if (res.ok) { setAmount(''); setDescription(''); await load(); if (kbOpen) void loadKasboek(kbPeriod) }
      else { setError('Kon de boeking niet opslaan. Probeer opnieuw.') }
    } catch { setError('Er ging iets mis.') } finally { setSaving(false) }
  }

  async function remove(id: string) {
    setEntries((prev) => prev.filter((e) => e.id !== id)) // optimistic
    try { await fetch(`/api/cash?id=${id}`, { method: 'DELETE' }); await load(); if (kbOpen) void loadKasboek(kbPeriod) } catch { await load() }
  }

  // [KAS-UPLOAD] Add a receipt/invoice the owner ALREADY paid in cash. It runs through the normal
  // intake (AI read + duplicate guard), pre-marked "contant betaald" (paid_method=kas + the chosen
  // date), so it lands in the verify queue with method + date pre-filled. The human confirms there,
  // and that confirm books the invoice→kasboek cash settlement automatically — keeping the BTW
  // aftrekbaar. It is deliberately NOT a manual cash 'kosten' entry (that would drop the
  // voorbelasting and double-count once the same receipt is booked as an invoice).
  const [cashUploading, setCashUploading] = useState(false)
  // [COHERENCE-KAS-UPLOAD] The link target depends on WHERE the file actually landed:
  // a recognised invoice/receipt goes to the verify queue (Te verifiëren); an
  // unreadable/unrecognised photo goes to Mijn bestanden. The success link must point
  // to the real destination, never blindly to the verify queue on any res.ok.
  const [cashUploadMsg, setCashUploadMsg] = useState<{ kind: 'ok' | 'warn' | 'err'; text: string; link?: { href: string; label: string } } | null>(null)
  const cashFileRef = useRef<HTMLInputElement | null>(null)

  async function uploadCashInvoice(file: File) {
    setCashUploading(true); setCashUploadMsg(null)
    try {
      const form = new FormData()
      form.append('file', file)
      form.append('paid_method', 'kas')
      form.append('paid_date', date) // the date chosen in the form above (defaults to today)
      const res = await fetch('/api/intake', { method: 'POST', body: form })
      const json = await res.json().catch(() => ({}))
      if (res.ok && json?.destination === 'document') {
        // [COHERENCE-KAS-UPLOAD] The AI could not read the photo or did not recognise
        // it as an invoice/bon, so paid_method=kas was NOT applied and the file went to
        // Mijn bestanden — NOT the verify queue. Showing "bevestig in Te verifiëren"
        // here would send the owner to an empty queue and the cash payment would never
        // be booked. Surface the server's honest message + a link to where it actually is.
        setCashUploadMsg({
          kind: 'warn',
          text: json?.message || 'We konden dit document niet lezen. Het staat in je bestanden — controleer het, of upload een duidelijkere foto als het een factuur of bon is.',
          link: { href: `/dashboard/bestanden${json?.folder_id ? `?folder=${json.folder_id}` : ''}`, label: 'Ga naar Mijn bestanden →' },
        })
      } else if (res.ok) {
        setCashUploadMsg({
          kind: 'ok',
          text: 'Bon toegevoegd. Bevestig ‘contant betaald’ in Te verifiëren — daarna staat de betaling automatisch in je kasboek.',
          link: { href: '/dashboard/incoming', label: 'Ga naar Te verifiëren →' },
        })
      } else if (json?.duplicate) {
        setCashUploadMsg({ kind: 'err', text: 'Deze bon staat er al — hij is eerder toegevoegd.' })
      } else {
        setCashUploadMsg({ kind: 'err', text: json?.error || 'Uploaden mislukt — probeer het opnieuw.' })
      }
    } catch {
      setCashUploadMsg({ kind: 'err', text: 'Er ging iets mis bij het uploaden.' })
    } finally {
      setCashUploading(false)
      if (cashFileRef.current) cashFileRef.current.value = ''
    }
  }

  // [CASH-SETTLE] 'betaling' is a system-managed settlement of a cash-paid invoice — labelled
  // for display, but never offered in the add form (CATS), and not manually deletable (undo the
  // payment on the invoice instead; the kasboek then reconciles it away).
  // A 'transfer' is disambiguated by DIRECTION so the accountant sees the real move: cash OUT of
  // the drawer to the bank = storting, cash INTO the drawer from the bank = opname.
  const catLabel = (k: string, dir?: 'in' | 'out') => {
    if (k === 'betaling') return 'Factuurbetaling (contant)'
    if (k === 'transfer') return dir === 'in' ? 'Opname (van bank)' : dir === 'out' ? 'Storting (naar bank)' : 'Naar/van bank'
    return CATS.find((c) => c.key === k)?.label ?? k
  }

  // [SEARCH] In-page live filter over the cash ledger (omschrijving / categorie / bedrag).
  const kasFold = (s: string) => (s ?? '').toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '')
  const kq = kasFold(search.trim())
  const kqDigits = search.replace(/[^\d]/g, '')
  const kAmountLike = kqDigits.length >= 2 && /^[\d.,\s€-]+$/.test(search.trim())
  const filteredEntries = kq
    ? entries.filter((e) =>
        kasFold(e.description ?? '').includes(kq) ||
        kasFold(catLabel(e.category, e.direction)).includes(kq) ||
        (kAmountLike && String(Math.trunc(Math.abs(e.amount ?? 0))) === kqDigits)
      )
    : entries

  return (
    <div style={{ minHeight: '100vh', background: '#F8F9FA', fontFamily: FONT }}>
      <div style={{ maxWidth: 640, margin: '0 auto', padding: '20px 16px 64px' }}>
        <BackLink style={{ color: M3.primary }} />

        {/* [COHERENCE-ERRSTATE] A failed load must NOT show a reassuring €0,00 saldo that
            looks like an empty drawer. Show the number ONLY when the data actually loaded;
            on error surface an honest banner with a retry instead of a false money figure. */}
        {loadError && (
          <div style={{ margin: '16px 0 0', background: '#FCECEA', border: `1px solid ${M3.error}`, borderRadius: 14, padding: '14px 16px' }}>
            <div style={{ fontSize: 14.5, fontWeight: 700, color: M3.error }}>We konden je kassaldo niet laden</div>
            <div style={{ fontSize: 13, color: M3.onSurface, marginTop: 4 }}>
              Het bedrag hieronder is daarom <strong>niet</strong> je echte saldo. Probeer het opnieuw.
            </div>
            <button
              type="button"
              onClick={() => { setLoading(true); void load() }}
              style={{ marginTop: 10, padding: '8px 16px', borderRadius: 10, border: 'none', background: M3.primary, color: '#fff', fontSize: 13.5, fontWeight: 600, cursor: 'pointer' }}
            >
              Opnieuw proberen
            </button>
          </div>
        )}

        {/* Balance */}
        <div style={{ margin: '16px 0 20px' }}>
          <div style={{ fontSize: 12.5, fontWeight: 700, letterSpacing: 0.6, color: M3.neutral }}>KAS — SALDO IN KASSA</div>
          <div style={{ fontFamily: FONT_NUM, fontSize: 34, fontWeight: 700, color: loadError ? M3.neutral : balance < 0 ? M3.error : M3.onSurface, marginTop: 4 }}>
            {loadError ? '—' : eur.format(balance)}
          </div>
          {balance < 0 && (
            <div style={{ fontSize: 12.5, color: M3.error, marginTop: 2 }}>Negatief saldo — je hebt meer uitgaven dan ontvangsten geboekt.</div>
          )}
          {/* [KAS-OPENING] Beginsaldo — the cash already in the drawer when you started. Included in
              the saldo above; not counted as omzet. Set it once so the saldo matches reality. */}
          {!openingEdit ? (
            <button
              type="button"
              onClick={() => { setOpeningInput(openingBalance ? String(openingBalance).replace('.', ',') : ''); setOpeningEdit(true); setError('') }}
              style={{ marginTop: 6, background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontSize: 12, color: M3.neutral, textAlign: 'left' }}
            >
              Beginsaldo kas: <strong style={{ color: M3.onSurface }}>{eur.format(openingBalance)}</strong> · wijzigen
            </button>
          ) : (
            <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 12.5, color: M3.neutral }}>Beginsaldo kas €</span>
              <input
                inputMode="decimal" value={openingInput} onChange={(e) => setOpeningInput(e.target.value)}
                placeholder="0,00" autoFocus
                style={{ width: 90, padding: '6px 8px', borderRadius: 8, border: `1px solid ${M3.outlineVariant}`, fontSize: 14, fontFamily: FONT_NUM }}
              />
              <button type="button" onClick={saveOpeningBalance} disabled={openingSaving}
                style={{ padding: '6px 12px', borderRadius: 8, border: 'none', background: M3.primary, color: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
                {openingSaving ? 'Bezig…' : 'Opslaan'}
              </button>
              <button type="button" onClick={() => { setOpeningEdit(false); setError('') }}
                style={{ padding: '6px 10px', borderRadius: 8, border: `1px solid ${M3.outlineVariant}`, background: 'none', fontSize: 13, cursor: 'pointer', color: M3.neutral }}>
                Annuleren
              </button>
            </div>
          )}
        </div>

        {/* [KAS-UPLOAD] Add a cash-paid invoice/receipt (photo or PDF). It goes to the verify queue
            pre-marked "contant betaald"; the human confirms and the payment lands in the kasboek
            automatically — the BTW stays aftrekbaar (unlike a plain cash-cost entry). */}
        <div style={{ background: M3.surface, borderRadius: 16, border: `1px solid ${M3.outlineVariant}`, padding: 16, marginBottom: 20 }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: M3.onSurface, marginBottom: 4 }}>Contant betaalde factuur toevoegen</div>
          <div style={{ fontSize: 12.5, color: M3.neutral, marginBottom: 12, lineHeight: 1.45 }}>
            Foto of PDF van een bon die je contant hebt betaald. We lezen hem uit en zetten hem klaar als ‘contant betaald’ — jij bevestigt, daarna staat de betaling automatisch in je kasboek en blijft de BTW aftrekbaar.
          </div>
          <input
            ref={cashFileRef} type="file" accept="image/*,application/pdf" style={{ display: 'none' }}
            onChange={(e) => { const f = e.target.files?.[0]; if (f) void uploadCashInvoice(f) }}
          />
          <button
            onClick={() => cashFileRef.current?.click()} disabled={cashUploading}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '11px 16px', borderRadius: 12, border: 'none', cursor: cashUploading ? 'default' : 'pointer', background: M3.primary, color: M3.onPrimary, fontFamily: FONT, fontSize: 14, fontWeight: 600, opacity: cashUploading ? 0.6 : 1 }}
          >
            {cashUploading ? 'Bezig met uploaden…' : '📄 Bon uploaden'}
          </button>
          {cashUploadMsg && (
            <div style={{ marginTop: 10, fontSize: 12.5, color: cashUploadMsg.kind === 'ok' ? M3.success : cashUploadMsg.kind === 'warn' ? M3.warning : M3.error, lineHeight: 1.45 }}>
              {cashUploadMsg.text}
              {cashUploadMsg.link && (
                <> <a href={cashUploadMsg.link.href} style={{ color: M3.primary, fontWeight: 600 }}>{cashUploadMsg.link.label}</a></>
              )}
            </div>
          )}
        </div>

        {/* Add form */}
        <div style={{ background: M3.surface, borderRadius: 16, border: `1px solid ${M3.outlineVariant}`, padding: 16, marginBottom: 20 }}>
          <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
            <Toggle active={direction === 'in'} onClick={() => setDir('in')} label="Ontvangen" color={M3.success} />
            <Toggle active={direction === 'out'} onClick={() => setDir('out')} label="Uitgegeven" color={M3.error} />
          </div>

          <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
            <input
              inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0,00"
              style={{ flex: 1, minWidth: 0, padding: '12px 14px', fontSize: 16, borderRadius: 12, border: `1.5px solid ${M3.outlineVariant}`, fontFamily: FONT_NUM, boxSizing: 'border-box' }}
            />
            <input
              type="date" value={date} onChange={(e) => setDate(e.target.value)}
              style={{ padding: '12px 14px', fontSize: 16, borderRadius: 12, border: `1.5px solid ${M3.outlineVariant}`, fontFamily: FONT, boxSizing: 'border-box' }}
            />
          </div>

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
            {CATS.map((c) => {
              const active = category === c.key
              return (
                <button key={c.key} onClick={() => setCategory(c.key)}
                  style={{ padding: '7px 12px', borderRadius: 999, fontSize: 13, fontWeight: 500, cursor: 'pointer', fontFamily: FONT,
                    background: active ? M3.primaryContainer : '#F1F3F4', color: active ? '#041E49' : M3.neutral,
                    border: active ? `1px solid ${M3.primary}` : '1px solid transparent' }}>
                  {c.key === 'transfer' ? (direction === 'in' ? 'Opname (van bank)' : 'Storting (naar bank)') : c.label}
                </button>
              )
            })}
          </div>

          {/* BTW rate — only for a cash sale, so verschuldigde BTW is exact. */}
          {category === 'omzet' && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
              <span style={{ fontSize: 13, color: M3.neutral }}>BTW:</span>
              {[21, 9, 0].map((r) => {
                const active = btwRate === r
                return (
                  <button key={r} onClick={() => setBtwRate(r)}
                    style={{ padding: '6px 12px', borderRadius: 999, fontSize: 13, fontWeight: 500, cursor: 'pointer', fontFamily: FONT,
                      background: active ? M3.primaryContainer : '#F1F3F4', color: active ? '#041E49' : M3.neutral,
                      border: active ? `1px solid ${M3.primary}` : '1px solid transparent' }}>
                    {r}%
                  </button>
                )
              })}
            </div>
          )}

          <input
            value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Omschrijving (optioneel)"
            style={{ width: '100%', padding: '12px 14px', fontSize: 16, borderRadius: 12, border: `1.5px solid ${M3.outlineVariant}`, fontFamily: FONT, boxSizing: 'border-box', marginBottom: 12 }}
          />

          {error && <div style={{ fontSize: 13, color: M3.error, marginBottom: 10 }}>{error}</div>}

          <button onClick={add} disabled={saving}
            style={{ width: '100%', padding: '12px', borderRadius: 12, border: 'none', background: saving ? '#dadce0' : M3.primary, color: M3.onPrimary, fontSize: 15, fontWeight: 600, cursor: saving ? 'default' : 'pointer', fontFamily: FONT }}>
            {saving ? 'Bezig…' : 'Toevoegen'}
          </button>
        </div>

        {/* Ledger */}
        <div style={{ fontSize: 12.5, fontWeight: 700, letterSpacing: 0.6, color: M3.neutral, margin: '0 2px 10px' }}>BOEKINGEN</div>

        {/* [SEARCH] In-page live filter over the ledger */}
        {!loading && !loadError && entries.length > 0 && (
          <div style={{ position: 'relative', marginBottom: 10 }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#9aa0a6" strokeWidth="2" style={{ position: 'absolute', left: 13, top: '50%', transform: 'translateY(-50%)' }}><circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3" strokeLinecap="round" /></svg>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Zoek in boekingen (omschrijving, categorie, bedrag)…"
              aria-label="Kasboekingen zoeken"
              style={{ width: '100%', boxSizing: 'border-box', padding: '10px 38px', borderRadius: 12, border: `1px solid ${M3.outlineVariant}`, fontSize: 14, outline: 'none', background: '#fff', color: M3.onSurface, fontFamily: FONT }}
            />
            {search && (
              <button onClick={() => setSearch('')} aria-label="Wissen"
                style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', width: 22, height: 22, borderRadius: '50%', border: 'none', background: '#e5e5ea', color: '#3a3a3c', cursor: 'pointer', fontSize: 13, lineHeight: 1 }}>×</button>
            )}
          </div>
        )}

        {loading ? (
          <div style={{ height: 80, borderRadius: 16, background: '#f1f3f4' }} />
        ) : loadError ? (
          <div style={{ background: '#FCECEA', border: `1px solid ${M3.error}`, borderRadius: 16, padding: '24px 20px', textAlign: 'center', color: M3.onSurface, fontSize: 14 }}>
            Kon de boekingen niet laden. Dit is <strong>niet</strong> hetzelfde als een lege kas — probeer het opnieuw.
          </div>
        ) : entries.length === 0 ? (
          <div style={{ background: M3.surface, border: `1px solid ${M3.outlineVariant}`, borderRadius: 16, padding: '24px 20px', textAlign: 'center', color: M3.neutral, fontSize: 14 }}>
            Nog geen kasboekingen. Voeg je eerste contante ontvangst of uitgave toe.
          </div>
        ) : filteredEntries.length === 0 ? (
          <div style={{ background: M3.surface, border: `1px solid ${M3.outlineVariant}`, borderRadius: 16, padding: '24px 20px', textAlign: 'center', color: M3.neutral, fontSize: 14 }}>
            Geen boekingen gevonden voor &ldquo;{search.trim()}&rdquo;.
          </div>
        ) : (
          <div style={{ background: M3.surface, border: `1px solid ${M3.outlineVariant}`, borderRadius: 16, overflow: 'hidden' }}>
            {filteredEntries.map((e, i) => (
              <div key={e.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', borderTop: i > 0 ? '1px solid #e0e0e0' : 'none' }}>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontSize: 14.5, fontWeight: 600, color: M3.onSurface, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {e.description?.trim() || catLabel(e.category, e.direction)}
                  </div>
                  <div style={{ fontSize: 12, color: M3.neutral, marginTop: 1 }}>{formatDate(e.entry_date)} · {catLabel(e.category, e.direction)}</div>
                </div>
                <div style={{ fontFamily: FONT_NUM, fontSize: 14.5, fontWeight: 700, color: e.direction === 'in' ? M3.success : M3.error, whiteSpace: 'nowrap' }}>
                  {e.direction === 'in' ? '+' : '−'}{eur.format(e.amount)}
                </div>
                {e.category === 'betaling' ? (
                  <span title="Automatisch: betaling van een contant betaalde factuur. Maak de betaling op de factuur ongedaan om dit te verwijderen."
                    style={{ flexShrink: 0, color: '#9aa0a6', fontSize: 16, lineHeight: 1 }}>🔗</span>
                ) : (
                  <button onClick={() => remove(e.id)} aria-label="Verwijderen"
                    style={{ flexShrink: 0, border: 'none', background: 'transparent', color: '#9aa0a6', fontSize: 18, cursor: 'pointer', lineHeight: 1 }}>×</button>
                )}
              </div>
            ))}
          </div>
        )}

        {/* [KASBOEK] Live quarterly cash book — the running-balance view the accountant gets,
            built live from the till's daily cash takings + these boekingen (never stored twice). */}
        <div style={{ marginTop: 28 }}>
          {!kbOpen ? (
            <button onClick={openKasboek}
              style={{ width: '100%', padding: '13px 16px', borderRadius: 16, border: `1px solid ${M3.outlineVariant}`, background: M3.surface, color: M3.onSurface, fontSize: 14.5, fontWeight: 600, cursor: 'pointer', fontFamily: FONT, textAlign: 'left', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span>📗 Kasboek per kwartaal — voor de boekhouder</span>
              <span style={{ color: M3.primary, fontSize: 20, lineHeight: 1 }}>＋</span>
            </button>
          ) : (
            <div style={{ background: M3.surface, border: `1px solid ${M3.outlineVariant}`, borderRadius: 16, padding: 16 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                <div style={{ fontSize: 12.5, fontWeight: 700, letterSpacing: 0.6, color: M3.neutral }}>KASBOEK — KWARTAAL</div>
                <button onClick={() => setKbOpen(false)} aria-label="Sluiten"
                  style={{ border: 'none', background: 'transparent', color: '#9aa0a6', fontSize: 20, cursor: 'pointer', lineHeight: 1 }}>×</button>
              </div>

              {/* Quarter selector */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 14, margin: '10px 0 6px' }}>
                <button onClick={() => kbPeriod && loadKasboek(prevQuarter(kbPeriod.year, kbPeriod.quarter))} disabled={!kbPeriod || kbLoading} aria-label="Vorig kwartaal"
                  style={{ border: `1px solid ${M3.outlineVariant}`, background: M3.surface, borderRadius: 999, width: 34, height: 34, cursor: kbPeriod ? 'pointer' : 'default', fontSize: 16, color: M3.onSurface }}>◀</button>
                <div style={{ fontSize: 15.5, fontWeight: 700, color: M3.onSurface, minWidth: 96, textAlign: 'center' }}>
                  {kbPeriod ? `Q${kbPeriod.quarter} ${kbPeriod.year}` : '—'}
                </div>
                <button onClick={() => kbPeriod && loadKasboek(nextQuarter(kbPeriod.year, kbPeriod.quarter))} disabled={!kbPeriod || kbLoading} aria-label="Volgend kwartaal"
                  style={{ border: `1px solid ${M3.outlineVariant}`, background: M3.surface, borderRadius: 999, width: 34, height: 34, cursor: kbPeriod ? 'pointer' : 'default', fontSize: 16, color: M3.onSurface }}>▶</button>
              </div>

              {kbLoading ? (
                <div style={{ height: 120, borderRadius: 12, background: '#F0F1F3', marginTop: 10 }} />
              ) : !kb ? (
                <div style={{ textAlign: 'center', color: M3.neutral, fontSize: 14, padding: '20px 0' }}>
                  Kon het kasboek niet laden. <button onClick={() => loadKasboek(kbPeriod)} style={{ border: 'none', background: 'transparent', color: M3.primary, cursor: 'pointer', fontFamily: FONT, fontSize: 14 }}>Opnieuw</button>
                </div>
              ) : (
                <>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13.5, color: M3.neutral, padding: '6px 2px', borderBottom: `1px solid ${M3.outlineVariant}` }}>
                    <span>Beginsaldo kwartaal</span>
                    <span style={{ fontFamily: FONT_NUM, fontWeight: 600, color: M3.onSurface }}>{eur.format(kb.openingBalance)}</span>
                  </div>

                  {kb.months.length === 0 ? (
                    <div style={{ textAlign: 'center', color: M3.neutral, fontSize: 14, padding: '18px 0' }}>
                      Geen kasbewegingen in dit kwartaal.
                    </div>
                  ) : kb.months.map((m) => (
                    <div key={m.key} style={{ marginTop: 14 }}>
                      <div style={{ fontSize: 13, fontWeight: 700, color: M3.onSurface, marginBottom: 4 }}>{m.label}</div>
                      <div style={{ border: `1px solid ${M3.outlineVariant}`, borderRadius: 10, overflow: 'hidden' }}>
                        {m.rows.map((r, i) => (
                          <div key={r.date} style={{ display: 'flex', alignItems: 'baseline', gap: 8, padding: '7px 10px', borderTop: i > 0 ? '1px solid #ECEFF1' : 'none', fontSize: 13 }}>
                            <span style={{ width: 52, flexShrink: 0, color: M3.neutral }}>{formatDate(r.date)}</span>
                            <span style={{ flex: 1, minWidth: 0, color: M3.onSurface, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {r.descriptions.length ? r.descriptions.join(' · ') : (r.ontvangsten > 0 ? 'Kasontvangsten' : 'Kasuitgave')}
                            </span>
                            {r.ontvangsten > 0 && <span style={{ fontFamily: FONT_NUM, color: M3.success, whiteSpace: 'nowrap' }}>+{eur.format(r.ontvangsten)}</span>}
                            {r.uitgaven > 0 && <span style={{ fontFamily: FONT_NUM, color: M3.error, whiteSpace: 'nowrap' }}>−{eur.format(r.uitgaven)}</span>}
                            <span style={{ fontFamily: FONT_NUM, fontWeight: 700, color: r.eindsaldo < 0 ? M3.error : M3.onSurface, minWidth: 72, textAlign: 'right', whiteSpace: 'nowrap' }}>{eur.format(r.eindsaldo)}</span>
                          </div>
                        ))}
                        <div style={{ display: 'flex', justifyContent: 'space-between', padding: '7px 10px', borderTop: `1px solid ${M3.outlineVariant}`, background: '#FAFAFA', fontSize: 12.5, fontWeight: 600, color: M3.neutral }}>
                          <span>Totaal {m.label}</span>
                          <span style={{ fontFamily: FONT_NUM }}>+{eur.format(m.totalIn)} · −{eur.format(m.totalOut)}</span>
                        </div>
                      </div>
                    </div>
                  ))}

                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14, fontWeight: 700, padding: '10px 2px 2px', marginTop: 8, borderTop: `2px solid ${M3.outlineVariant}` }}>
                    <span>Eindsaldo kwartaal</span>
                    <span style={{ fontFamily: FONT_NUM, color: kb.closingBalance < 0 ? M3.error : M3.onSurface }}>{eur.format(kb.closingBalance)}</span>
                  </div>

                  {kbPeriod && (
                    <a href={`/api/kasboek?year=${kbPeriod.year}&quarter=${kbPeriod.quarter}&format=xlsx`}
                      style={{ display: 'block', marginTop: 14, padding: '11px', borderRadius: 12, background: M3.primaryContainer, color: '#041E49', fontSize: 14, fontWeight: 600, textAlign: 'center', textDecoration: 'none', fontFamily: FONT }}>
                      ⬇︎ Download voor boekhouder (.xlsx)
                    </a>
                  )}
                  <div style={{ fontSize: 11.5, color: M3.neutral, marginTop: 8, lineHeight: 1.4 }}>
                    Dit kasboek wordt live berekend uit je dagelijkse contante omzet en je kasboekingen.
                    De omzet is al één keer geteld in je resultaat — dit overzicht toont alleen het kassaldo, dus niets wordt dubbel geboekt.
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function Toggle({ active, onClick, label, color }: { active: boolean; onClick: () => void; label: string; color: string }) {
  return (
    <button onClick={onClick}
      style={{ flex: 1, padding: '10px', borderRadius: 12, fontSize: 14, fontWeight: 600, cursor: 'pointer', fontFamily: FONT,
        background: active ? color : '#F1F3F4', color: active ? '#fff' : '#5F6368', border: 'none' }}>
      {label}
    </button>
  )
}
