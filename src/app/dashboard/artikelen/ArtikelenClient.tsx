'use client'

// src/app/dashboard/artikelen/ArtikelenClient.tsx
// [ARTIKELEN] The line-item catalog (gateway #1): the owner's recurring invoice lines,
// saved once and reused. Manage here; pick from it while making a factuur.

import { useEffect, useMemo, useState } from 'react'
import { type Article } from '@/lib/articles'
import { rowMatchesQuery } from '@/lib/search'
import { useDialog } from '@/components/ui/Dialog'
import { useToast } from '@/components/ui/Toast'
// [DESIGN] Palette and radius come from the shared source now
// (src/lib/design/tokens.ts). This file used to declare its own copy; see the
// header of tokens.ts for why the copies had to go — two of the values in them
// were below the contrast floor for text.
import { M3, R, COLUMN } from '@/lib/design/tokens'

const FONT = "'Roboto', -apple-system, sans-serif"
const FONT_NUM = "'Roboto Mono', monospace"
const EL1 = '0 1px 2px rgba(0,0,0,0.08)'
const eur = new Intl.NumberFormat('nl-NL', { style: 'currency', currency: 'EUR' })
const RATES = [21, 9, 0]

type Form = { code: string; description: string; unit_price: string; btw_rate: number; unit: string }
const EMPTY: Form = { code: '', description: '', unit_price: '', btw_rate: 21, unit: '' }

export default function ArtikelenClient() {
  const dialog = useDialog()
  // [MOTION] The app-wide snackbar (components/ui/Toast), bound to the name the
  // call sites already used. The local one it replaces could not stack, was
  // never announced to a screen reader, and vanished with the page.
  const setToast = useToast()
  const [articles, setArticles] = useState<Article[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState<Form>(EMPTY)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    try {
      const res = await fetch('/api/articles?all=1')
      const json = await res.json()
      if (res.ok) setArticles(json.articles ?? [])
    } catch { /* silent */ } finally { setLoading(false) }
  }

  const shown = useMemo(() => {
    // [SMART-FILTER] Dezelfde matcher als elke andere lijst: code + omschrijving (accent-loos)
    // én de prijs, zodat "45" ook op het bedrag zoekt. Gearchiveerde artikelen blijven zichtbaar
    // in dit beheerscherm.
    const q = search.trim()
    if (!q) return [...articles].sort((a, b) => Number(b.active) - Number(a.active) || b.usage_count - a.usage_count)
    return articles.filter((a) => rowMatchesQuery(q, [a.code, a.description], [a.unit_price]))
  }, [articles, search])

  function openNew() { setForm(EMPTY); setEditingId(null); setError(null); setShowForm(true) }
  function openEdit(a: Article) {
    setForm({ code: a.code ?? '', description: a.description, unit_price: String(a.unit_price), btw_rate: a.btw_rate, unit: a.unit ?? '' })
    setEditingId(a.id); setError(null); setShowForm(true)
  }

  async function save() {
    setError(null)
    const price = form.unit_price === '' ? 0 : Number(form.unit_price.replace(',', '.'))
    if (!Number.isFinite(price) || price < 0) { setError('Prijs moet 0 of hoger zijn.'); return }
    setSaving(true)
    const payload = {
      code: form.code, description: form.description,
      unit_price: price, btw_rate: form.btw_rate, unit: form.unit,
    }
    try {
      const res = await fetch(editingId ? `/api/articles/${editingId}` : '/api/articles', {
        method: editingId ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const json = await res.json()
      if (!res.ok) { setError(json.error ?? 'Kon niet opslaan.'); return }
      setShowForm(false); setToast(editingId ? 'Artikel bijgewerkt' : 'Artikel toegevoegd')
      await load()
    } catch { setError('Er ging iets mis.') } finally { setSaving(false) }
  }

  async function toggleArchive(a: Article) {
    await fetch(`/api/articles/${a.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: a.code, description: a.description, unit_price: a.unit_price, btw_rate: a.btw_rate, unit: a.unit, active: !a.active }),
    })
    await load()
  }

  async function remove(id: string) {
    const ok = await dialog.confirm({
      title: 'Dit artikel verwijderen?',
      message: 'Facturen waarop dit artikel al staat, blijven ongewijzigd.',
      confirmLabel: 'Verwijderen',
      danger: true,
    })
    if (!ok) return
    try {
      const res = await fetch(`/api/articles/${id}`, { method: 'DELETE' })
      if (!res.ok) { setToast('Verwijderen mislukt — probeer opnieuw.'); return }
      setToast('Artikel verwijderd')
    } catch { setToast('Verwijderen mislukt — probeer opnieuw.'); return }
    finally { await load() }
  }


  return (
    <div style={{ minHeight: '100vh', background: '#F8F9FA', fontFamily: FONT }}>
      <div style={{ maxWidth: COLUMN.work, margin: '0 auto', padding: '20px 16px 80px' }}>
        {/* [HEADER-SYSTEM] Title "Artikelen" + back live in the shared sub-page bar;
            the in-body h1 was removed. Subtitle + the search / new-item controls
            row below stay. */}
        <header style={{ margin: '16px 0 18px' }}>
          <p style={{ fontSize: 15, color: M3.neutral, margin: 0 }}>Je vaste factuurregels — één keer opslaan, steeds hergebruiken.</p>
        </header>

        <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
          {/* [SMART-FILTER] Zoekveld met label voor schermlezers en een wis-knop, net als bij facturen/categoriseren. */}
          <div style={{ flex: 1, position: 'relative' }}>
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Zoek op code, omschrijving of bedrag…"
              aria-label="Artikelen zoeken"
              style={{ width: '100%', boxSizing: 'border-box', borderRadius: R.full, border: `1px solid ${M3.outline}`, padding: '10px 36px 10px 16px', fontSize: 14, outline: 'none', fontFamily: FONT, background: M3.surface, color: M3.onSurface }} />
            {search && (
              <button onClick={() => setSearch('')} aria-label="Wissen" className="tap-44"
                style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', width: 22, height: 22, borderRadius: R.full, border: 'none', background: M3.surfaceVariant, color: M3.neutral, cursor: 'pointer', fontSize: 13, lineHeight: 1, fontFamily: FONT }}>×</button>
            )}
          </div>
          <button onClick={openNew} style={{ background: M3.primary, color: '#fff', border: 'none', borderRadius: R.full, padding: '10px 18px', cursor: 'pointer', fontSize: 14, fontWeight: 600, fontFamily: FONT, whiteSpace: 'nowrap' }}>+ Nieuw</button>
        </div>

        {showForm && (
          <div style={{ background: M3.surface, borderRadius: R.lg, boxShadow: EL1, padding: 18, marginBottom: 16 }}>
            <p style={{ fontSize: 16, fontWeight: 600, color: M3.onSurface, margin: '0 0 14px' }}>{editingId ? 'Artikel bewerken' : 'Nieuw artikel'}</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <Field label="Omschrijving *" value={form.description} onChange={(v) => setForm((p) => ({ ...p, description: v }))} placeholder="Transport tafel" />
              <div style={{ display: 'flex', gap: 12 }}>
                <div style={{ width: 110 }}><Field label="Code" value={form.code} onChange={(v) => setForm((p) => ({ ...p, code: v }))} placeholder="22" /></div>
                <div style={{ flex: 1 }}><Field label="Prijs (excl. BTW)" value={form.unit_price} onChange={(v) => setForm((p) => ({ ...p, unit_price: v }))} placeholder="45,00" inputMode="decimal" /></div>
                <div style={{ width: 90 }}><Field label="Eenheid" value={form.unit} onChange={(v) => setForm((p) => ({ ...p, unit: v }))} placeholder="stuk" /></div>
              </div>
              <div>
                <div style={{ fontSize: 12, color: M3.neutral, marginBottom: 6 }}>BTW-tarief</div>
                <div style={{ display: 'flex', gap: 6 }}>
                  {RATES.map((r) => (
                    <button key={r} onClick={() => setForm((p) => ({ ...p, btw_rate: r }))} style={{ flex: 1, padding: '9px 0', borderRadius: R.sm, cursor: 'pointer', fontSize: 13.5, fontWeight: 600, border: `1px solid ${form.btw_rate === r ? M3.primary : M3.outline}`, background: form.btw_rate === r ? M3.primary : M3.surface, color: form.btw_rate === r ? '#fff' : M3.onSurface, fontFamily: FONT }}>{r}%</button>
                  ))}
                </div>
              </div>
              {error && <div style={{ color: M3.error, fontSize: 13 }}>{error}</div>}
              <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
                <button onClick={() => setShowForm(false)} style={{ flex: 1, padding: 12, borderRadius: R.full, border: 'none', background: 'transparent', color: M3.primary, fontSize: 14, fontWeight: 600, cursor: 'pointer', fontFamily: FONT }}>Annuleren</button>
                <button onClick={save} disabled={saving || !form.description.trim()} style={{ flex: 1, padding: 12, borderRadius: R.full, border: 'none', background: saving || !form.description.trim() ? M3.surfaceVariant : M3.primary, color: saving || !form.description.trim() ? '#80868b' : '#fff', fontSize: 14, fontWeight: 600, cursor: saving ? 'default' : 'pointer', fontFamily: FONT }}>{saving ? 'Opslaan…' : 'Opslaan'}</button>
              </div>
            </div>
          </div>
        )}

        {loading ? (
          <div style={{ height: 160, borderRadius: R.lg, background: '#f1f3f4' }} />
        ) : shown.length === 0 ? (
          <div style={{ textAlign: 'center', color: M3.neutral, fontSize: 14, padding: '40px 0' }}>
            {search ? 'Geen artikel gevonden.' : 'Nog geen artikelen. Voeg je eerste vaste factuurregel toe.'}
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {shown.map((a) => (
              <div key={a.id} style={{ background: M3.surface, borderRadius: R.md, boxShadow: EL1, padding: '12px 14px', display: 'flex', alignItems: 'center', gap: 12, opacity: a.active ? 1 : 0.55 }}>
                {a.code && <span style={{ fontFamily: FONT_NUM, fontSize: 13, fontWeight: 700, color: M3.primary, background: M3.primaryContainer, borderRadius: R.sm, padding: '3px 8px', minWidth: 30, textAlign: 'center' }}>{a.code}</span>}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14.5, fontWeight: 600, color: M3.onSurface, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{a.description}{!a.active && ' · gearchiveerd'}</div>
                  <div style={{ fontSize: 12.5, color: M3.neutral }}>{a.btw_rate}% BTW{a.unit ? ` · per ${a.unit}` : ''}{a.usage_count > 0 ? ` · ${a.usage_count}× gebruikt` : ''}</div>
                </div>
                <span style={{ fontFamily: FONT_NUM, fontSize: 14, fontWeight: 700, color: M3.onSurface }}>{eur.format(a.unit_price)}</span>
                <div style={{ display: 'flex', gap: 4 }}>
                  <IconBtn label="Bewerk" onClick={() => openEdit(a)}>✎</IconBtn>
                  <IconBtn label={a.active ? 'Archiveer' : 'Herstel'} onClick={() => toggleArchive(a)}>{a.active ? '⌫' : '↩'}</IconBtn>
                  <IconBtn label="Verwijder" onClick={() => remove(a.id)} danger>🗑</IconBtn>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

    </div>
  )
}

function Field({ label, value, onChange, placeholder, inputMode }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string; inputMode?: 'decimal' | 'text' }) {
  return (
    <label style={{ display: 'block' }}>
      <span style={{ fontSize: 12, color: M3.neutral, display: 'block', marginBottom: 5 }}>{label}</span>
      <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} inputMode={inputMode}
        style={{ width: '100%', boxSizing: 'border-box', borderRadius: R.md, border: `2px solid ${value ? M3.primary : M3.outline}`, padding: '11px 13px', fontSize: 14, outline: 'none', fontFamily: FONT, background: M3.surface, color: M3.onSurface }} />
    </label>
  )
}

function IconBtn({ children, label, onClick, danger }: { children: React.ReactNode; label: string; onClick: () => void; danger?: boolean }) {
  return (
    <button onClick={onClick} title={label} aria-label={label}
      style={{ width: 32, height: 32, borderRadius: R.sm, border: 'none', background: 'transparent', cursor: 'pointer', fontSize: 15, color: danger ? M3.error : M3.neutral }}>{children}</button>
  )
}
