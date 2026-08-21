'use client'

// src/app/dashboard/artikelen/ArtikelenClient.tsx
// [ARTIKELEN] The line-item catalog (gateway #1): the owner's recurring invoice lines,
// saved once and reused. Manage here; pick from it while making a factuur.

import { useEffect, useMemo, useState } from 'react'
// [SERVER-ZIN] Never a machine code in front of the owner — see server-message.ts.
import { failureText } from '@/lib/server-message'
import { type Article } from '@/lib/articles'
// [PRIJS-MODUS] Dezelfde omrekening als beide factuurschermen. Een eigen versie hier zou een
// tweede antwoord zijn op "wat is € 0,90 all-in, precies", en die twee lopen uit elkaar op de cent.
import { type PriceMode, priceFieldValue, inclFromEx, toDisplayCents } from '@/lib/price-mode'
import { rowMatchesQuery } from '@/lib/search'
import { useDialog } from '@/components/ui/Dialog'
import { useToast } from '@/components/ui/Toast'
// [DESIGN] Palette and radius come from the shared source now
// (src/lib/design/tokens.ts). This file used to declare its own copy; see the
// header of tokens.ts for why the copies had to go — two of the values in them
// were below the contrast floor for text.
import { M3, R, COLUMN } from '@/lib/design/tokens'
import { useLocale } from '@/lib/i18n/use-locale'
import { translator } from '@/lib/i18n/t'

const FONT = "'Roboto', -apple-system, sans-serif"
const FONT_NUM = "'Roboto Mono', monospace"
const EL1 = '0 1px 2px rgba(0,0,0,0.08)'
const eur = new Intl.NumberFormat('nl-NL', { style: 'currency', currency: 'EUR' })
const RATES = [21, 9, 0]

type Form = { code: string; description: string; unit_price: string; btw_rate: number; unit: string }
const EMPTY: Form = { code: '', description: '', unit_price: '', btw_rate: 21, unit: '' }

export default function ArtikelenClient() {
  const t = translator(useLocale())
  // [PRIJS-MODUS] Dezelfde sleutel als de factuurschermen (`boekbrug.priceMode`), met opzet: wie
  // zijn factuurregels all-in typt, typt zijn catalogus ook all-in. Twee losse voorkeuren voor
  // dezelfde vraag zouden betekenen dat het ene scherm een andere prijs toont dan het andere.
  const [priceMode, setPriceMode] = useState<PriceMode>('excl')
  useEffect(() => {
    try {
      const saved = localStorage.getItem('boekbrug.priceMode')
      // Zelfde uitzondering, met dezelfde reden, als de twee factuurschermen die deze sleutel al
      // lezen: localStorage is een extern systeem en dit is precies waar een effect voor is — de
      // opgeslagen keuze één keer binnenhalen bij het monteren. De regel beschermt tegen
      // cascade-renders, en dit is er geen. Bewust hetzelfde patroon als daar: één voorkeur die op
      // drie schermen op twee manieren wordt gelezen is één manier te veel.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (saved === 'incl' || saved === 'excl') setPriceMode(saved)
    } catch { /* opslag kan geblokkeerd zijn; excl is de veilige stand */ }
  }, [])
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

  /**
   * Switch between typing incl. and excl. btw.
   *
   * The number in the field is REWRITTEN so it keeps meaning the same money: € 0,90 all-in becomes
   * € 0,83 when you switch to excl, not a silent re-labelling of 0,90 as an ex-price. A toggle that
   * only changed the label would be a 21% price change nobody asked for.
   */
  function switchPriceMode(next: PriceMode) {
    setPriceMode(next)
    try { localStorage.setItem('boekbrug.priceMode', next) } catch { /* niet erg */ }
    setForm((p) => {
      const typed = p.unit_price === '' ? null : Number(p.unit_price.replace(',', '.'))
      if (typed === null || !Number.isFinite(typed)) return p
      const ex = priceMode === 'incl' ? typed / (1 + (p.btw_rate || 0) / 100) : typed
      return { ...p, unit_price: String(toDisplayCents(next === 'incl' ? inclFromEx(ex, p.btw_rate) : ex)) }
    })
  }

  /**
   * The other side of the price, or null while the field is empty or unreadable.
   *
   * Derived during render rather than kept in state: it is a function of the field and the rate,
   * and a second copy in state is a second thing that can be stale.
   */
  const counterPrice = (() => {
    const typed = form.unit_price === '' ? null : Number(form.unit_price.replace(',', '.'))
    if (typed === null || !Number.isFinite(typed) || typed < 0) return null
    const ex = priceMode === 'incl' ? typed / (1 + (form.btw_rate || 0) / 100) : typed
    return toDisplayCents(priceMode === 'incl' ? ex : inclFromEx(ex, form.btw_rate))
  })()

  function openNew() { setForm(EMPTY); setEditingId(null); setError(null); setShowForm(true) }
  function openEdit(a: Article) {
    // [PRIJSVELD-CENT] priceFieldValue, niet String(a.unit_price): de opgeslagen prijs kan een
    // breuk zijn (€ 0,8256880734…), en die rauw in een invoerveld zetten is een getal dat niemand
    // heeft getypt. Dezelfde functie die het factuurscherm gebruikt.
    setForm({ code: a.code ?? '', description: a.description, unit_price: String(priceFieldValue(a.unit_price, a.btw_rate, priceMode)), btw_rate: a.btw_rate, unit: a.unit ?? '' })
    setEditingId(a.id); setError(null); setShowForm(true)
  }

  async function save() {
    setError(null)
    const price = form.unit_price === '' ? 0 : Number(form.unit_price.replace(',', '.'))
    if (!Number.isFinite(price) || price < 0) { setError(t('art.prijsNegatief')); return }
    setSaving(true)
    const payload = {
      code: form.code, description: form.description,
      unit_price: price, btw_rate: form.btw_rate, unit: form.unit,
      // [PRIJS-MODUS] WELKE prijs hierboven staat. De server rekent hem om en slaat altijd de
      // ex-prijs op — dit is een invoerstand, geen opslagformaat.
      price_mode: priceMode,
    }
    try {
      const res = await fetch(editingId ? `/api/articles/${editingId}` : '/api/articles', {
        method: editingId ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const json = await res.json()
      if (!res.ok) { setError(failureText(res.status, json, t('art.fout.opslaan'))); return }
      setShowForm(false); setToast(editingId ? t('art.bijgewerkt') : t('art.toegevoegd'))
      await load()
    } catch { setError(t('bank.fout.algemeen')) } finally { setSaving(false) }
  }

  async function toggleArchive(a: Article) {
    // [PRIJS-MODUS] Alleen `archive`. Vroeger ging hier de HELE rij mee, en die reist dan door de
    // volledige validatie — die rondt unit_price af op centen. Bij een all-in prijs is de opgeslagen
    // prijs een breuk (€ 0,90 incl. bij 9% is € 0,8256880734…), en archiveren zou hem stilletjes
    // op € 0,83 zetten. De veiligste manier om een veld niet te overschrijven is het niet te sturen.
    await fetch(`/api/articles/${a.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ archive: a.active }),
    })
    await load()
  }

  async function remove(id: string) {
    const ok = await dialog.confirm({
      title: t('art.verwijderVraag'),
      message: t('art.verwijderUitleg'),
      confirmLabel: t('lijst.verwijderen'),
      danger: true,
    })
    if (!ok) return
    try {
      const res = await fetch(`/api/articles/${id}`, { method: 'DELETE' })
      if (!res.ok) { setToast(t('art.fout.verwijderen')); return }
      setToast(t('art.verwijderd'))
    } catch { setToast(t('art.fout.verwijderen')); return }
    finally { await load() }
  }


  // [ARTIKELEN-WIPE] Empty the whole catalogue in one action.
  //
  // Deleting thirty articles one tap at a time is not a safety feature, it is a missing one: the
  // owner does the same destructive thing anyway, thirty times, with thirty chances to hit the
  // wrong row. One deliberate action with one honest confirmation is faster AND safer.
  //
  // The confirmation names the one thing an owner emptying a list would rightly worry about, and
  // it happens to be reassuring: nothing points at an article. invoice_lines copied the text, the
  // price and the btw-rate at the moment each line was made, so an invoice from two years ago
  // keeps every word of what it said. What IS lost is the list, permanently.
  async function removeAll() {
    const used = articles.filter((a) => a.usage_count > 0).length
    const ok = await dialog.confirm({
      title: t('art.alles.titel', { n: articles.length }),
      message:
        t('art.alles.uitleg')
        + (used > 0 ? ` ${t('art.alles.gebruikt', { n: used })}` : '')
        + ` ${t('art.alles.weg')}`,
      confirmLabel: t('art.alles.bevestig'),
      danger: true,
    })
    if (!ok) return
    try {
      const res = await fetch('/api/articles', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        // The route refuses a bare DELETE on purpose: a request that empties a table on an empty
        // body is one mis-fired fetch away from doing it by accident.
        body: JSON.stringify({ confirm: 'ALLES' }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok || !json.ok) { setToast(typeof json.error === 'string' ? json.error : t('art.fout.leegmaken')); return }
      setToast(json.deleted === 1 ? t('art.verwijderdEen') : t('art.verwijderdMeer', { n: json.deleted }))
    } catch { setToast(t('art.fout.leegmakenVerbinding')); return }
    finally { await load() }
  }

  return (
    <div style={{ minHeight: '100vh', background: '#F8F9FA', fontFamily: FONT }}>
      <div style={{ maxWidth: COLUMN.work, margin: '0 auto', padding: '20px 16px 80px' }}>
        {/* [HEADER-SYSTEM] Title "Artikelen" + back live in the shared sub-page bar;
            the in-body h1 was removed. Subtitle + the search / new-item controls
            row below stay. */}
        <header style={{ margin: '16px 0 18px' }}>
          <p style={{ fontSize: 15, color: M3.neutral, margin: 0 }}>{t('art.uitleg')}</p>
        </header>


        <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
          {/* [SMART-FILTER] Zoekveld met label voor schermlezers en een wis-knop, net als bij facturen/categoriseren. */}
          <div style={{ flex: 1, position: 'relative' }}>
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t('art.zoek')}
              aria-label={t('art.zoek.aria')}
              style={{ width: '100%', boxSizing: 'border-box', borderRadius: R.full, border: `1px solid ${M3.outline}`, padding: '10px 36px 10px 16px', fontSize: 14, outline: 'none', fontFamily: FONT, background: M3.surface, color: M3.onSurface }} />
            {search && (
              <button onClick={() => setSearch('')} aria-label={t('inkoop.wissen')} className="tap-44"
                style={{ position: 'absolute', insetInlineEnd: 10, top: '50%', transform: 'translateY(-50%)', width: 22, height: 22, borderRadius: R.full, border: 'none', background: M3.surfaceVariant, color: M3.neutral, cursor: 'pointer', fontSize: 13, lineHeight: 1, fontFamily: FONT }}>×</button>
            )}
          </div>
          <button onClick={openNew} style={{ background: M3.primary, color: '#fff', border: 'none', borderRadius: R.full, padding: '10px 18px', cursor: 'pointer', fontSize: 14, fontWeight: 600, fontFamily: FONT, whiteSpace: 'nowrap' }}>{t('art.nieuw')}</button>
        </div>

        {/* [ARTIKELEN-WIPE] Only when there is something to empty, and deliberately quiet: a
            secondary link rather than a button beside "+ Nieuw", so the destructive action never
            competes for the thumb with the one people use every day. */}
        {!loading && articles.length > 0 && (
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: -8, marginBottom: 14 }}>
            <button
              onClick={removeAll}
              style={{ background: 'transparent', border: 'none', color: M3.error, fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: FONT, padding: '4px 2px' }}
            >
              {t('art.alles.knop', { n: articles.length })}
            </button>
          </div>
        )}

        {showForm && (
          <div style={{ background: M3.surface, borderRadius: R.lg, boxShadow: EL1, padding: 18, marginBottom: 16 }}>
            <p style={{ fontSize: 16, fontWeight: 600, color: M3.onSurface, margin: '0 0 14px' }}>{editingId ? t('art.bewerken') : t('art.nieuwArtikel')}</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <Field label={t('art.omschrijving')} value={form.description} onChange={(v) => setForm((p) => ({ ...p, description: v }))} placeholder={t('art.voorbeeld')} />
              <div style={{ display: 'flex', gap: 12 }}>
                <div style={{ width: 110 }}><Field label={t('art.code')} value={form.code} onChange={(v) => setForm((p) => ({ ...p, code: v }))} placeholder="22" /></div>
                <div style={{ flex: 1 }}>
                  <Field label={priceMode === 'incl' ? t('art.prijsIncl') : t('art.prijsExcl')} value={form.unit_price} onChange={(v) => setForm((p) => ({ ...p, unit_price: v }))} placeholder="45,00" inputMode="decimal" />
                  {/* [PRIJS-MODUS] De tegenprijs, live. Wie all-in typt wil zien wat er excl. btw op
                      de factuurregel belandt — dat is het getal waar hij zijn marge tegen afzet — en
                      andersom. Hij staat er ALTIJD, ook in excl-modus, want de vraag "en wat betaalt
                      mijn klant dan?" is even vaak de eerste. */}
                  {counterPrice !== null && (
                    <div style={{ fontSize: 11.5, color: M3.neutral, marginTop: 4, textAlign: 'start' }}>
                      {priceMode === 'incl'
                        ? t('art.tegenprijs.excl', { bedrag: eur.format(counterPrice) })
                        : t('art.tegenprijs.incl', { bedrag: eur.format(counterPrice) })}
                    </div>
                  )}
                </div>
                <div style={{ width: 90 }}><Field label={t('art.eenheid')} value={form.unit} onChange={(v) => setForm((p) => ({ ...p, unit: v }))} placeholder="stuk" /></div>
              </div>
              {/* [PRIJS-MODUS] Welke prijs staat er in het veld hierboven? Dezelfde keuze die de
                  factuurschermen al boden, en dezelfde onthouden voorkeur — wie zijn regels all-in
                  typt, typt zijn catalogus ook all-in. Opgeslagen wordt hoe dan ook de ex-prijs. */}
              <div>
                <div style={{ fontSize: 12, color: M3.neutral, marginBottom: 6 }}>{t('art.modus.aria')}</div>
                <div style={{ display: 'flex', gap: 6 }} role="group" aria-label={t('art.modus.aria')}>
                  {(['excl', 'incl'] as const).map((m) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => switchPriceMode(m)}
                      aria-pressed={priceMode === m}
                      style={{
                        flex: 1, padding: '9px 0', borderRadius: R.sm, cursor: 'pointer',
                        fontSize: 13.5, fontWeight: 600, fontFamily: FONT,
                        border: `1px solid ${priceMode === m ? M3.primary : M3.outline}`,
                        background: priceMode === m ? M3.primary : M3.surface,
                        color: priceMode === m ? '#fff' : M3.onSurface,
                      }}
                    >{m === 'incl' ? t('art.modus.incl') : t('art.modus.excl')}</button>
                  ))}
                </div>
              </div>

              <div>
                <div style={{ fontSize: 12, color: M3.neutral, marginBottom: 6 }}>{t('art.btwTarief')}</div>
                <div style={{ display: 'flex', gap: 6 }}>
                  {RATES.map((r) => (
                    <button key={r} onClick={() => setForm((p) => ({ ...p, btw_rate: r }))} style={{ flex: 1, padding: '9px 0', borderRadius: R.sm, cursor: 'pointer', fontSize: 13.5, fontWeight: 600, border: `1px solid ${form.btw_rate === r ? M3.primary : M3.outline}`, background: form.btw_rate === r ? M3.primary : M3.surface, color: form.btw_rate === r ? '#fff' : M3.onSurface, fontFamily: FONT }}>{r}%</button>
                  ))}
                </div>
              </div>
              {error && <div style={{ color: M3.error, fontSize: 13 }}>{error}</div>}
              <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
                <button onClick={() => setShowForm(false)} style={{ flex: 1, padding: 12, borderRadius: R.full, border: 'none', background: 'transparent', color: M3.primary, fontSize: 14, fontWeight: 600, cursor: 'pointer', fontFamily: FONT }}>{t('lijst.annuleren')}</button>
                <button onClick={save} disabled={saving || !form.description.trim()} style={{ flex: 1, padding: 12, borderRadius: R.full, border: 'none', background: saving || !form.description.trim() ? M3.surfaceVariant : M3.primary, color: saving || !form.description.trim() ? '#80868b' : '#fff', fontSize: 14, fontWeight: 600, cursor: saving ? 'default' : 'pointer', fontFamily: FONT }}>{saving ? t('corr.opslaanBezig') : t('art.opslaan')}</button>
              </div>
            </div>
          </div>
        )}

        {loading ? (
          <div style={{ height: 160, borderRadius: R.lg, background: '#f1f3f4' }} />
        ) : shown.length === 0 ? (
          <div style={{ textAlign: 'center', color: M3.neutral, fontSize: 14, padding: '40px 0' }}>
            {search ? t('art.geenGevonden') : t('art.leeg')}
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {shown.map((a) => (
              <div key={a.id} style={{ background: M3.surface, borderRadius: R.md, boxShadow: EL1, padding: '12px 14px', display: 'flex', alignItems: 'center', gap: 12, opacity: a.active ? 1 : 0.55 }}>
                {a.code && <span style={{ fontFamily: FONT_NUM, fontSize: 13, fontWeight: 700, color: M3.primary, background: M3.primaryContainer, borderRadius: R.sm, padding: '3px 8px', minWidth: 30, textAlign: 'center' }}>{a.code}</span>}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14.5, fontWeight: 600, color: M3.onSurface, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{a.description}{!a.active && ` · ${t('art.gearchiveerd')}`}</div>
                  <div style={{ fontSize: 12.5, color: M3.neutral }}>{t('art.btwLabel', { rate: a.btw_rate })}{a.unit ? ` · ${t('art.perEenheid', { unit: a.unit })}` : ''}{a.usage_count > 0 ? ` · ${t('art.keerGebruikt', { n: a.usage_count })}` : ''}</div>
                </div>
                <span style={{ fontFamily: FONT_NUM, fontSize: 14, fontWeight: 700, color: M3.onSurface }}>{eur.format(a.unit_price)}</span>
                <div style={{ display: 'flex', gap: 4 }}>
                  <IconBtn label={t('art.bewerk')} onClick={() => openEdit(a)}>✎</IconBtn>
                  <IconBtn label={a.active ? t('art.archiveer') : t('art.herstel')} onClick={() => toggleArchive(a)}>{a.active ? '⌫' : '↩'}</IconBtn>
                  <IconBtn label={t('art.verwijder')} onClick={() => remove(a.id)} danger>🗑</IconBtn>
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
