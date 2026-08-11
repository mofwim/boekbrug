'use client'

// src/app/dashboard/bank/categoriseren/CategoriseClient.tsx
// [BANK-IDENTITY] Give each unexplained bank line an identity. One tap confirms the
// suggestion (memory → AI); confirming also TRAINS the memory so the same counterpart
// is auto-categorized next time. Self-contained: fetches /api/bank/categorize.
//
// Honest completion: the "Alles is gecategoriseerd" state shows ONLY when the server's
// true DB-wide remaining count is 0 — not merely because this page is empty. A capped
// page with more behind it says so, and offers a one-tap sweep of the confident ones.

import { useEffect, useMemo, useState } from 'react'
import { SELECTABLE_CATEGORIES } from '@/lib/bank-categories'
import { M3, FONT, FONT_NUM, COLUMN } from '@/lib/design/tokens'
import { rowMatchesQuery } from '@/lib/search'
import { useLocale } from '@/lib/i18n/use-locale'
import { translator } from '@/lib/i18n/t'

const eur = new Intl.NumberFormat('nl-NL', { style: 'currency', currency: 'EUR' })

// Triage categories offered to the owner (Dutch), from the single source of truth.
// The AI/memory pre-selects one.
const CATS = SELECTABLE_CATEGORIES

interface Item {
  id: string
  date: string | null
  amount: number | null
  counterpart_name: string | null
  description: string | null
  suggested: string
  suggested_source: 'memory' | 'ai' | 'similar'
  suggested_confident: boolean
  suggested_similar_to?: string | null
  confirmed?: boolean
}

type Mode = 'todo' | 'review'

function formatDate(iso: string | null): string {
  if (!iso) return ''
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso)
  if (!m) return ''
  const months = ['jan.', 'feb.', 'mrt.', 'apr.', 'mei', 'jun.', 'jul.', 'aug.', 'sep.', 'okt.', 'nov.', 'dec.']
  return `${Number(m[3])} ${months[Number(m[2]) - 1]}`
}

// The "lijkt op" hint carries a normalized counterpart KEY (lowercased, noise stripped).
// Title-case it so the owner sees a readable name, not a mangled internal string.
function prettyKey(key: string): string {
  return key.replace(/\b\w/g, (c) => c.toUpperCase())
}

export default function CategoriseClient() {
  const t = translator(useLocale())
  const [items, setItems] = useState<Item[]>([])
  const [choice, setChoice] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [totalRemaining, setTotalRemaining] = useState(0)
  const [hasMore, setHasMore] = useState(false)
  const [confidentAvailable, setConfidentAvailable] = useState(0)
  const [bulkBusy, setBulkBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [mode, setMode] = useState<Mode>('todo')
  const [search, setSearch] = useState('')

  async function load(which: Mode = mode) {
    try {
      // [AUTO-EXCLUDE-REVIEW] Forward ?year&quarter into the review fetch so the readiness
      // deep-link scopes the review list to exactly the quarter it counted (else an older
      // quarter's flagged lines could fall off the all-time page and never clear).
      let reviewQuery = '/api/bank/categorize?scope=review'
      if (typeof window !== 'undefined') {
        const sp = new URLSearchParams(window.location.search)
        const y = sp.get('year'), q = sp.get('quarter')
        if (y && q) reviewQuery += `&year=${encodeURIComponent(y)}&quarter=${encodeURIComponent(q)}`
        // [AUTO-EXCLUDE-REVIEW] Forward only=excluded so the readiness deep-link shows just the
        // flagged privé/overboeking/belasting lines (the counted set), not every categorised line.
        if (sp.get('only') === 'excluded') reviewQuery += '&only=excluded'
      }
      const url = which === 'review' ? reviewQuery : '/api/bank/categorize'
      const res = await fetch(url)
      const json = await res.json()
      if (res.ok) {
        const list: Item[] = json.items ?? []
        setItems(list)
        setTotalRemaining(json.total_remaining ?? list.length)
        setHasMore(Boolean(json.has_more))
        setConfidentAvailable(json.confident_available ?? 0)
        const initial: Record<string, string> = {}
        for (const it of list) initial[it.id] = it.suggested
        setChoice(initial)
        setError(null)
      } else {
        setError(t('cat.fout.laden'))
      }
    } catch {
      setError(t('cat.fout.laden'))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    let cancelled = false
    // [AUTO-EXCLUDE-REVIEW] Honour ?view=review so the readiness "Controleer" link lands straight in
    // the review list (auto-coded privé/overboeking/belasting to eyeball), not the to-do queue.
    const wantReview = typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('view') === 'review'
    const initial: Mode = wantReview ? 'review' : 'todo'
    ;(async () => {
      // De modus zetten hoort bij het laden van diezelfde lijst; binnen de async-wikkel
      // draait het in dezelfde tick, zonder synchrone setState in de effect-body.
      if (wantReview) setMode('review')
      if (!cancelled) await load(initial)
    })()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function switchMode(next: Mode) {
    if (next === mode) return
    setMode(next)
    setLoading(true)
    await load(next)
  }

  // [SHADOW] See BankClient: a local `confirm` shadows window.confirm module-wide.
  async function confirmCategory(id: string) {
    const category = choice[id]
    if (!category) return
    setBusy(id)
    setError(null)
    try {
      const res = await fetch('/api/bank/categorize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transaction_id: id, category }),
      })
      if (res.ok) {
        setItems((prev) => prev.filter((it) => it.id !== id))
        // Only the to-do queue tracks a DB-wide remaining count; review mode doesn't.
        if (mode === 'todo') setTotalRemaining((n) => Math.max(0, n - 1))
      } else {
        setError(t('cat.fout.opslaan'))
      }
    } catch {
      setError(t('cat.fout.opslaan'))
    } finally {
      setBusy(null)
    }
  }

  // One-tap sweep: fill ONLY the confident suggestions (memory + specific patterns).
  // The server never auto-applies a sign-only guess, so nothing is invented.
  async function bulkApply() {
    setBulkBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/bank/categorize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'bulk' }),
      })
      const json = await res.json()
      if (res.ok) {
        // Reload from the server so the list + true counts reflect reality.
        setLoading(true)
        await load()
      } else {
        setError(t('cat.fout.automatisch'))
      }
      return json
    } catch {
      setError(t('cat.fout.automatisch'))
    } finally {
      setBulkBusy(false)
    }
  }

  const trulyDone = totalRemaining === 0 && items.length === 0
  // [SMART-FILTER] live filter over the LOADED transactions (tegenpartij /
  // omschrijving / bedrag). The list is server-capped (PAGE_SIZE), so when
  // hasMore is set this narrows only what's on screen — the empty-state says so.
  // [PERF] useMemo: alleen herberekenen als de zoekterm of de geladen transacties
  // wijzigen — niet bij elke render (categorie-chips tikken raakt dit filter niet).
  const rawC = search.trim()
  const displayItems = useMemo(
    () =>
      rawC
        ? items.filter((it) => rowMatchesQuery(rawC, [it.counterpart_name, it.description], [it.amount]))
        : items,
    [rawC, items]
  )

  return (
    <div style={{ minHeight: '100vh', background: M3.bg, fontFamily: FONT }}>
      <div style={{ maxWidth: COLUMN.work, margin: '0 auto', padding: '20px 16px 64px' }}>
        {/* [HEADER-SYSTEM] Title "Wat is dit?" + back live in the shared sub-page
            bar; the in-body h1 that repeated it was removed. Subtitle stays. */}
        <header style={{ margin: '16px 0 16px' }}>
          <p style={{ fontSize: 15, color: M3.neutral, margin: 0 }}>
            {mode === 'todo'
              ? 'Geef elke banktransactie een plek. We onthouden je keuze per bedrijf.'
              : 'Controleer wat we al hebben ingevuld en wijzig een verkeerde categorie.'}
          </p>
        </header>

        {/* Two views: nog te doen (leeg = klaar) en het al-ingevulde herzien, zodat een
            fout ingevulde categorie (die geld uit je W&V kan verbergen) altijd te
            corrigeren is. */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 18 }}>
          {([['todo', 'Te doen'], ['review', 'Ingevuld wijzigen']] as [Mode, string][]).map(([m, label]) => (
            <button
              key={m}
              onClick={() => switchMode(m)}
              style={{
                padding: '8px 14px', borderRadius: 999, fontSize: 13.5, fontWeight: 600, cursor: 'pointer', fontFamily: FONT,
                background: mode === m ? M3.primaryContainer : '#F1F3F4',
                color: mode === m ? '#041E49' : M3.neutral,
                border: mode === m ? `1px solid ${M3.primary}` : '1px solid transparent',
              }}
            >
              {label}
            </button>
          ))}
        </div>

        {error && (
          <div role="alert" style={{ background: '#FCE8E6', color: '#B3261E', borderRadius: 12, padding: '12px 14px', fontSize: 14, marginBottom: 14 }}>
            {error}
          </div>
        )}

        {loading ? (
          <div style={{ height: 120, borderRadius: 16, background: '#f1f3f4' }} />
        ) : mode === 'todo' && trulyDone ? (
          <div style={{ background: M3.successContainer, borderRadius: 16, padding: '24px 20px', textAlign: 'center' }}>
            <div style={{ fontSize: 32, marginBottom: 6 }}>✓</div>
            <div style={{ fontSize: 16, fontWeight: 600, color: '#0B5345' }}>{t('cat.klaar')}</div>
            <div style={{ fontSize: 14, color: '#0B5345', marginTop: 2 }}>{t('cat.geenAandacht')}</div>
          </div>
        ) : mode === 'review' && items.length === 0 ? (
          <div style={{ background: '#F1F3F4', borderRadius: 16, padding: '24px 20px', textAlign: 'center' }}>
            <div style={{ fontSize: 15, fontWeight: 600, color: M3.onSurface }}>{t('cat.nogNiets')}</div>
            <div style={{ fontSize: 14, color: M3.neutral, marginTop: 2 }}>{t('cat.zodra')}</div>
          </div>
        ) : (
          <>
            {/* Honest running total + one-tap sweep of the confident suggestions (to-do only). */}
            {mode === 'todo' && (
              <>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 14, flexWrap: 'wrap' }}>
                  <div style={{ fontSize: 14, color: M3.neutral }}>
                    <strong style={{ color: M3.onSurface }}>{totalRemaining}</strong> {totalRemaining === 1 ? 'transactie' : 'transacties'} te doen
                    {hasMore && <span> · we tonen de eerste {items.length}</span>}
                  </div>
                  {confidentAvailable > 0 && (
                    <button
                      onClick={bulkApply}
                      disabled={bulkBusy}
                      style={{
                        padding: '9px 14px', borderRadius: 999, border: `1px solid ${M3.primary}`,
                        background: bulkBusy ? '#F1F3F4' : M3.primaryContainer, color: '#041E49',
                        fontSize: 13.5, fontWeight: 600, cursor: bulkBusy ? 'default' : 'pointer', fontFamily: FONT,
                      }}
                    >
                      {bulkBusy ? 'Bezig…' : `${confidentAvailable} zekere invullen`}
                    </button>
                  )}
                </div>
                {confidentAvailable > 0 && (
                  <p style={{ fontSize: 12.5, color: M3.neutral, margin: '0 0 14px' }}>
                    We vullen alleen transacties in die we zeker weten (onthouden of duidelijk herkend, zoals
                    belasting, overboekingen en bankkosten). De rest laten we aan jou — we verzinnen niets.
                  </p>
                )}
              </>
            )}

            {mode === 'review' && (
              <>
                <p style={{ fontSize: 12.5, color: M3.neutral, margin: '0 0 14px' }}>
                  Tik op een categorie om die te wijzigen en bevestig. Wat de app zelf invulde staat bovenaan.
                </p>
                {/* [HONEST-TRUNCATION] A >200 review page must say so — never let a
                    search that misses the loaded page read as "niets gevonden". */}
                {hasMore && (
                  <div style={{ fontSize: 13, color: M3.neutral, margin: '0 0 14px' }}>
                    <strong style={{ color: M3.onSurface }}>{totalRemaining}</strong> ingevulde transacties · we tonen de eerste {items.length}
                  </div>
                )}
              </>
            )}

            {/* [SMART-FILTER] live filter over the loaded transactions */}
            <div style={{ position: 'relative', marginBottom: 12 }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#9aa0a6" strokeWidth="2" style={{ position: 'absolute', insetInlineStart: 13, top: '50%', transform: 'translateY(-50%)' }}><circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3" strokeLinecap="round" /></svg>
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={t('cat.zoek')}
                aria-label={t('bank.zoek.aria')}
                style={{ width: '100%', boxSizing: 'border-box', padding: '11px 38px', borderRadius: 12, border: `1px solid ${M3.outlineVariant}`, fontSize: 14.5, outline: 'none', background: M3.surface, color: M3.onSurface, fontFamily: FONT }}
              />
              {search && (
                <button onClick={() => setSearch('')} aria-label={t('inkoop.wissen')} className="tap-44" style={{ position: 'absolute', insetInlineEnd: 10, top: '50%', transform: 'translateY(-50%)', width: 22, height: 22, borderRadius: '50%', border: 'none', background: '#e5e5ea', color: '#3a3a3c', cursor: 'pointer', fontSize: 13, lineHeight: 1 }}>×</button>
              )}
            </div>

            {rawC && displayItems.length === 0 ? (
              <div style={{ background: M3.surface, borderRadius: 16, border: `1px solid ${M3.outlineVariant}`, padding: '22px 18px', textAlign: 'center' }}>
                <div style={{ fontSize: 14, color: M3.neutral }}>Geen transacties gevonden voor &ldquo;{rawC}&rdquo;{hasMore ? ` in de eerste ${items.length}` : ''}.</div>
                {hasMore && <div style={{ fontSize: 12.5, color: M3.neutral, marginTop: 4 }}>Er staan er nog {totalRemaining - items.length} in de wachtrij die nog niet geladen zijn.</div>}
              </div>
            ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {displayItems.map((it) => (
              <div key={it.id} style={{ background: M3.surface, borderRadius: 16, border: `1px solid ${M3.outlineVariant}`, padding: '14px 16px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 15, fontWeight: 600, color: M3.onSurface, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {it.counterpart_name?.trim() || it.description?.trim() || 'Onbekende transactie'}
                    </div>
                    <div style={{ fontSize: 12.5, color: M3.neutral, marginTop: 2 }}>
                      {formatDate(it.date)}
                      {mode === 'review'
                        ? (it.confirmed ? ' · door jou bevestigd' : ' · automatisch ingevuld')
                        : it.suggested_source === 'memory'
                          ? ' · onthouden'
                          : it.suggested_source === 'similar'
                            ? (it.suggested_similar_to ? ` · lijkt op ${prettyKey(it.suggested_similar_to)}` : ' · lijkt op eerdere')
                            : it.suggested_confident ? ' · herkend' : ' · voorstel'}
                    </div>
                  </div>
                  <div style={{ fontFamily: FONT_NUM, fontSize: 15, fontWeight: 700, color: M3.onSurface, whiteSpace: 'nowrap' }}>
                    {eur.format(it.amount ?? 0)}
                  </div>
                </div>

                {/* Category chips — pre-selected to the suggestion. */}
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 12 }}>
                  {CATS.map((c) => {
                    const active = choice[it.id] === c.key
                    return (
                      <button
                        key={c.key}
                        onClick={() => setChoice((p) => ({ ...p, [it.id]: c.key }))}
                        style={{
                          padding: '7px 12px', borderRadius: 999, fontSize: 13, fontWeight: 500, cursor: 'pointer',
                          fontFamily: FONT,
                          background: active ? M3.primaryContainer : '#F1F3F4',
                          color: active ? '#041E49' : M3.neutral,
                          border: active ? `1px solid ${M3.primary}` : '1px solid transparent',
                        }}
                      >
                        {c.label}
                      </button>
                    )
                  })}
                </div>

                <button
                  onClick={() => confirmCategory(it.id)}
                  disabled={busy === it.id}
                  style={{
                    marginTop: 12, width: '100%', padding: '11px', borderRadius: 12, border: 'none',
                    background: busy === it.id ? '#dadce0' : M3.primary, color: M3.onPrimary,
                    fontSize: 15, fontWeight: 600, cursor: busy === it.id ? 'default' : 'pointer', fontFamily: FONT,
                  }}
                >
                  {busy === it.id ? 'Bezig…' : 'Bevestigen'}
                </button>
              </div>
            ))}
            </div>
            )}

            {/* When the page is empty but the DB still has lines (auto-applied confident
                ones left the page), tell the truth instead of a green "done". */}
            {items.length === 0 && totalRemaining > 0 && (
              <div style={{ background: M3.warnContainer, borderRadius: 16, padding: '18px 20px', textAlign: 'center' }}>
                <div style={{ fontSize: 15, fontWeight: 600, color: '#7A4F00' }}>
                  Nog {totalRemaining} {totalRemaining === 1 ? 'transactie' : 'transacties'} te doen
                </div>
                <div style={{ fontSize: 13.5, color: '#7A4F00', marginTop: 4 }}>
                   {t('cat.vernieuw')}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
