'use client'

// src/app/dashboard/klaar/KlaarClient.tsx
// [READINESS] The owner's one screen that answers one question: "ben ik klaar voor de
// boekhouder?" — not a dashboard, not charts. A single verdict, the strict rubric behind
// it (so the score is never a black box), the few things to fix, the few things to eyeball,
// and one button to hand it all over. A pure projection of /api/readiness.

import { useEffect, useState, type ReactNode } from 'react'
import Link from 'next/link'
import { lastCompletedQuarter } from '@/lib/quarter'
import { M3, FONT, FONT_NUM, COLUMN } from '@/lib/design/tokens'

const eur = new Intl.NumberFormat('nl-NL', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 })

type DimensionKey = 'invoices' | 'bank' | 'cash' | 'vat'
interface Dimension { key: DimensionKey; label: string; weight: number; applicable: boolean; subscore: number; detail: string }
interface Item { severity: 'missing' | 'risk'; title: string; detail?: string; fix?: { label: string; href: string } }
type Status = 'ready' | 'almost' | 'attention'
interface Report {
  quarterLabel: string
  score: number
  status: Status
  ready: boolean
  dimensions: Dimension[]
  missing: Item[]
  risks: Item[]
  notes: string[]
}
interface ApiResponse {
  ok: boolean
  year: number
  quarter: number
  report: Report
  concept: { verschuldigd: number; voorbelasting: number; saldo: number }
}

const STATUS_META: Record<Status, { emoji: string; title: string; bg: string; fg: string; bar: string }> = {
  ready:     { emoji: '🟢', title: 'Klaar voor de boekhouder', bg: M3.successContainer, fg: M3.success, bar: M3.success },
  almost:    { emoji: '🟡', title: 'Bijna klaar',              bg: M3.warningContainer, fg: M3.warning, bar: '#E37400' },
  attention: { emoji: '🔴', title: 'Nog niet klaar',           bg: M3.errorContainer,   fg: M3.error,   bar: M3.error },
}

const DIM_ICON: Record<DimensionKey, string> = {
  invoices: 'receipt_long', bank: 'account_balance', cash: 'point_of_sale', vat: 'calculate',
}

export default function KlaarClient() {
  const init = lastCompletedQuarter()
  const [year, setYear] = useState(init.year)
  // Typed number (not the lib's 1|2|3|4) so the quarter picker's setQuarter(q) accepts it.
  const [quarter, setQuarter] = useState<number>(init.quarter)
  const [data, setData] = useState<ApiResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  // [TZ] Amsterdam, not the device's zone: around New Year those differ, and "which years may I
  // pick" would then be answered by whichever side of midnight the viewer happens to be on.
  const todayNl = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Amsterdam', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
  const curYear = Number(todayNl.slice(0, 4))
  const curQuarter = Math.floor((Number(todayNl.slice(5, 7)) - 1) / 3) + 1
  // [QUARTER] Refresh via a bump key so the manual "Vernieuwen" fetch runs through the
  // SAME cancellable effect — clicking refresh then quickly changing quarter can no longer
  // land stale-quarter data (the superseded request's cancelled flag is always set).
  const [reloadKey, setReloadKey] = useState(0)

  // [PAKKET-STAY] Fetch the ZIP rather than navigating to it — see the button below.
  const [pkgBusy, setPkgBusy] = useState(false)
  const [pkgError, setPkgError] = useState<string | null>(null)
  async function downloadPackage(y: number, q: number) {
    setPkgBusy(true); setPkgError(null)
    try {
      const res = await fetch(`/api/closing-package?year=${y}&quarter=${q}`)
      if (!res.ok) {
        const j = await res.json().catch(() => ({} as { error?: string }))
        setPkgError(j?.error ?? 'Het pakket kon niet worden gemaakt. Probeer het opnieuw.')
        return
      }
      const blob = await res.blob()
      const cd = res.headers.get('content-disposition') ?? ''
      const named = /filename="?([^";]+)"?/i.exec(cd)?.[1]
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = named || `BoekBrug-Q${q}-${y}.zip`
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
    } catch {
      setPkgError('Geen verbinding — het pakket is niet gedownload.')
    } finally {
      setPkgBusy(false)
    }
  }

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      // Reset binnen de async-wikkel, vóór de eerste await: dezelfde tick als voorheen,
      // maar zonder synchrone setState in de effect-body (cascaderende renders).
      setLoading(true); setError(false); setData(null)
      try {
        const r = await fetch(`/api/readiness?year=${year}&quarter=${quarter}`)
        if (!r.ok) throw new Error('readiness')
        const j = await r.json()
        if (!cancelled) setData(j)
      } catch {
        if (!cancelled) setError(true)
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [year, quarter, reloadKey])

  const report = data?.report ?? null
  const meta = report ? STATUS_META[report.status] : STATUS_META.attention
  const teBetalen = data ? data.concept.saldo >= 0 : true

  return (
    <div style={{ minHeight: '100vh', background: M3.bg, fontFamily: FONT }}>
      <div style={{ maxWidth: COLUMN.work, margin: '0 auto', padding: '20px 16px 80px' }}>
        <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center' }}>
          <button onClick={() => setReloadKey((k) => k + 1)} title="Vernieuwen" style={{ background: 'none', border: 'none', cursor: 'pointer', color: M3.primary, display: 'flex', alignItems: 'center', gap: 4, fontSize: 13, fontWeight: 600, fontFamily: FONT }}>
            <span className="material-symbols-outlined" style={{ fontSize: 18 }}>refresh</span>Vernieuwen
          </button>
        </div>

        <h1 style={{ fontSize: 24, fontWeight: 700, color: M3.onSurface, margin: '12px 0 14px' }}>Ben ik klaar?</h1>

        {/* Quarter picker */}
        <div style={{ display: 'flex', gap: 6, marginBottom: 18, alignItems: 'center' }}>
          {/* A quarter that has not started cannot be assessed. Without this the picker offered
              Q4 in January and answered with a confident 🔴 "Nog niet klaar · 0%" about a period
              that does not exist yet — an alarm the owner can do nothing about. The app already
              knows the rule: /api/btw/file refuses to file a quarter that has not ENDED
              ([FILING-WINDOW]); this is the same idea one step earlier. The CURRENT quarter stays
              selectable — checking your progress mid-quarter is the point of this screen. */}
          {[1, 2, 3, 4].map((q) => {
            const active = quarter === q
            const future = year > curYear || (year === curYear && q > curQuarter)
            return (
              <button key={q} onClick={() => !future && setQuarter(q)} disabled={future} title={future ? 'Dit kwartaal is nog niet begonnen' : undefined} style={{ flex: 1, padding: '9px 0', borderRadius: 10, cursor: future ? 'default' : 'pointer', fontFamily: FONT, fontSize: 14, fontWeight: 600, border: `1px solid ${active ? M3.primary : M3.outlineVariant}`, background: active ? M3.primary : M3.surface, color: active ? '#fff' : M3.onSurface, opacity: future ? 0.4 : 1 }}>Q{q}</button>
            )
          })}
          <div style={{ display: 'flex', alignItems: 'center', gap: 2, paddingInlineStart: 6 }}>
            <button onClick={() => setYear((y) => Math.max(2000, y - 1))} title="Vorig jaar" style={{ width: 28, height: 28, borderRadius: 8, border: 'none', background: 'none', cursor: 'pointer', color: M3.primary }}>
              <span className="material-symbols-outlined icon-dir" style={{ fontSize: 20 }}>chevron_left</span>
            </button>
            <span style={{ fontSize: 14, fontWeight: 700, color: M3.onSurface, minWidth: 40, textAlign: 'center' }}>{year}</span>
            {/* Stepping INTO the current year can strand the selection on a quarter that has not
                started (Q4 2025 → 2026 in January), so the quarter is clamped with the year. */}
            <button onClick={() => { const next = Math.min(year + 1, curYear); setYear(next); if (next === curYear && quarter > curQuarter) setQuarter(curQuarter) }} disabled={year >= curYear} title="Volgend jaar" style={{ width: 28, height: 28, borderRadius: 8, border: 'none', background: 'none', cursor: year >= curYear ? 'default' : 'pointer', color: year >= curYear ? M3.outlineVariant : M3.primary, opacity: year >= curYear ? 0.5 : 1 }}>
              <span className="material-symbols-outlined icon-dir" style={{ fontSize: 20 }}>chevron_right</span>
            </button>
          </div>
        </div>

        {loading && <div style={{ color: M3.neutral, fontSize: 14, padding: '32px 0', textAlign: 'center' }}>Controleren…</div>}
        {/* A bare sentence on the screen that decides whether the quarter may be handed over is a
            dead end — and the retry it needed was already sitting in setReloadKey, driving the
            "Vernieuwen" link above. Say what it does NOT mean, and offer the way out. */}
        {!loading && (error || !report) && (
          <div style={{ background: M3.errorContainer, borderRadius: 14, padding: '18px 20px', textAlign: 'center', margin: '12px 0' }}>
            <div style={{ fontSize: 14.5, fontWeight: 700, color: M3.error }}>Kon de status niet laden</div>
            <div style={{ fontSize: 13, color: M3.onSurface, marginTop: 4, lineHeight: 1.5 }}>
              Dit zegt <strong>niets</strong> over of je klaar bent — we konden het alleen niet controleren.
            </div>
            <button
              onClick={() => setReloadKey((k) => k + 1)}
              style={{ marginTop: 12, padding: '9px 18px', borderRadius: 10, border: 'none', background: M3.primary, color: '#fff', fontSize: 13.5, fontWeight: 600, cursor: 'pointer', fontFamily: FONT }}
            >
              Opnieuw proberen
            </button>
          </div>
        )}

        {report && (
          <>
            {/* ── The verdict hero ── */}
            <div style={{ background: meta.bg, borderRadius: 18, padding: '22px 20px', marginBottom: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <span style={{ fontSize: 30, lineHeight: 1 }}>{meta.emoji}</span>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 19, fontWeight: 700, color: meta.fg }}>{meta.title}</div>
                  <div style={{ fontSize: 13, color: meta.fg, opacity: 0.85 }}>{report.quarterLabel}</div>
                </div>
                <div style={{ textAlign: 'end' }}>
                  <div style={{ fontSize: 30, fontWeight: 800, color: meta.fg, fontFamily: FONT_NUM, lineHeight: 1 }}>{report.score}%</div>
                  <div style={{ fontSize: 11, color: meta.fg, opacity: 0.8 }}>compleet</div>
                </div>
              </div>
              <div style={{ height: 8, borderRadius: 99, background: 'rgba(0,0,0,0.08)', marginTop: 16, overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${report.score}%`, background: meta.bar, borderRadius: 99, transition: 'width .4s' }} />
              </div>
            </div>

            {/* ── One-click handover ──
                [PAKKET-STAY] Fetched, not navigated to — the same fix the accountant's bridge
                already carries. The route answers every refusal with JSON, so an <a href> replaced
                this screen with a page of raw braces AND threw away the quarter and year the owner
                had selected (both client state). A failure now stays a sentence under the button. */}
            <button
              onClick={() => downloadPackage(year, quarter)}
              disabled={pkgBusy}
              style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, padding: '15px 18px', borderRadius: 14, border: 'none', background: M3.primary, color: '#fff', fontSize: 15.5, fontWeight: 700, marginBottom: 8, cursor: pkgBusy ? 'default' : 'pointer', fontFamily: FONT, opacity: pkgBusy ? 0.6 : 1 }}
            >
              <span className="material-symbols-outlined" style={{ fontSize: 20 }}>inventory_2</span>
              {pkgBusy ? 'Pakket maken…' : 'Download voor de boekhouder'}
            </button>
            {pkgError && (
              <div role="alert" style={{ fontSize: 13, color: M3.error, textAlign: 'center', marginBottom: 8, lineHeight: 1.45 }}>
                {pkgError}
              </div>
            )}
            <div style={{ fontSize: 12.5, color: M3.neutral, textAlign: 'center', marginBottom: 22, lineHeight: 1.5 }}>
              Eén ZIP: facturen, bonnen, bankafschrift, dagomzet én je concept BTW-aangifte.
            </div>

            {/* ── What still needs to happen (missing) ── */}
            {report.missing.length > 0 && (
              <Section title="Wat moet er nog gebeuren" tone="warning" icon="checklist">
                {report.missing.map((m, i) => <ItemRow key={i} item={m} tone="warning" />)}
              </Section>
            )}

            {/* ── Eyeball these (risks) ── */}
            {report.risks.length > 0 && (
              <Section title="Even controleren" tone="error" icon="visibility">
                {report.risks.map((r, i) => <ItemRow key={i} item={r} tone="error" />)}
              </Section>
            )}

            {report.missing.length === 0 && report.risks.length === 0 && (
              <div style={{ background: M3.successContainer, color: M3.success, borderRadius: 14, padding: '14px 16px', fontSize: 14, fontWeight: 600, marginBottom: 18, display: 'flex', alignItems: 'center', gap: 8 }}>
                <span className="material-symbols-outlined" style={{ fontSize: 20 }}>task_alt</span>
                Niets openstaand — alles sluit aan.
              </div>
            )}

            {/* ── The rubric behind the score (never a black box) ── */}
            <div style={{ background: M3.surface, borderRadius: 14, border: `1px solid ${M3.outlineVariant}`, padding: '6px 16px', marginBottom: 16 }}>
              <div style={{ fontSize: 11.5, color: M3.neutral, textTransform: 'uppercase', letterSpacing: '.04em', padding: '12px 0 6px', fontWeight: 600 }}>
                Waar de score op gebaseerd is
              </div>
              {/* [DISAMBIGUATE] Each row shows two figures — the colored number is how
                  COMPLETE that part is; the grey chip is how heavily it WEIGHS in the total.
                  Two bare percentages side by side read as competing scores, so name them. */}
              <div style={{ fontSize: 12, color: M3.neutral, lineHeight: 1.45, padding: '0 0 8px' }}>
                Het <b style={{ color: M3.onSurface, fontWeight: 600 }}>gekleurde percentage</b> is hoe compleet dit onderdeel is. Het <b style={{ color: M3.onSurface, fontWeight: 600 }}>grijze label</b> is hoe zwaar het meetelt in je totaalscore.
              </div>
              {report.dimensions.map((d, i) => (
                <DimRow key={d.key} d={d} last={i === report.dimensions.length - 1} />
              ))}
            </div>

            {/* ── Concept BTW summary (the number they hand over) ── */}
            <div style={{ background: M3.surface, borderRadius: 14, border: `1px solid ${M3.outlineVariant}`, padding: '14px 18px', marginBottom: 16 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                <span style={{ fontSize: 14, fontWeight: 600, color: M3.onSurface }}>
                  {teBetalen ? 'Concept BTW te betalen' : 'Concept BTW terug te ontvangen'}
                </span>
                <span style={{ fontSize: 20, fontWeight: 700, color: teBetalen ? M3.onSurface : M3.success, fontFamily: FONT_NUM }}>
                  {eur.format(Math.abs(data!.concept.saldo))}
                </span>
              </div>
              <Link href={`/dashboard/aangifte?year=${year}&quarter=${quarter}`} style={{ fontSize: 12.5, color: M3.primary, textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 2, marginTop: 6 }}>
                Bekijk de concept-aangifte
                <span className="material-symbols-outlined icon-dir" style={{ fontSize: 16 }}>chevron_right</span>
              </Link>
            </div>

            {/* ── Honest limits ── */}
            <div style={{ fontSize: 12, color: M3.neutral, lineHeight: 1.6 }}>
              {report.notes.map((n, i) => <div key={i} style={{ marginBottom: 4 }}>• {n}</div>)}
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function Section({ title, tone, icon, children }: { title: string; tone: 'warning' | 'error'; icon: string; children: ReactNode }) {
  const color = tone === 'warning' ? M3.warning : M3.error
  return (
    <div style={{ background: M3.surface, borderRadius: 14, border: `1px solid ${tone === 'warning' ? M3.warningContainer : M3.errorContainer}`, padding: '14px 16px', marginBottom: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <span className="material-symbols-outlined" style={{ fontSize: 20, color }}>{icon}</span>
        <span style={{ fontSize: 13, fontWeight: 700, color, textTransform: 'uppercase', letterSpacing: '.03em' }}>{title}</span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>{children}</div>
    </div>
  )
}

function ItemRow({ item, tone }: { item: Item; tone: 'warning' | 'error' }) {
  const color = tone === 'warning' ? M3.warning : M3.error
  // A gap that STATES a problem but offers no way to act is a dead-end. When the item
  // carries a fix destination, the whole row becomes a tap-through to exactly where the
  // owner resolves it — so "what's missing" and "where to fix it" are one action.
  const body = (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
      <span className="material-symbols-outlined" style={{ fontSize: 18, color, flexShrink: 0, marginTop: 1 }}>
        {tone === 'warning' ? 'radio_button_unchecked' : 'error_outline'}
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: M3.onSurface, lineHeight: 1.4 }}>{item.title}</div>
        {item.detail && <div style={{ fontSize: 12.5, color: M3.neutral, marginTop: 2, lineHeight: 1.5 }}>{item.detail}</div>}
        {item.fix && (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 2, marginTop: 6, fontSize: 12.5, fontWeight: 700, color: M3.primary }}>
            {item.fix.label}
            <span className="material-symbols-outlined icon-dir" style={{ fontSize: 16 }}>chevron_right</span>
          </span>
        )}
      </div>
    </div>
  )
  if (item.fix) {
    return (
      <Link href={item.fix.href} style={{ display: 'block', textDecoration: 'none', borderRadius: 12, padding: 6, margin: -6 }}>
        {body}
      </Link>
    )
  }
  return body
}

function DimRow({ d, last }: { d: Dimension; last: boolean }) {
  const pct = d.applicable ? Math.round(d.subscore * 100) : null
  const barColor = pct == null ? M3.outlineVariant : pct >= 90 ? M3.success : pct >= 60 ? '#E37400' : M3.error
  return (
    <div style={{ padding: '11px 0', borderBottom: last ? 'none' : `1px solid #f1f3f4` }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span className="material-symbols-outlined" style={{ fontSize: 20, color: M3.neutral }}>{DIM_ICON[d.key]}</span>
        <span style={{ flex: 1, fontSize: 14, fontWeight: 600, color: M3.onSurface }}>{d.label}</span>
        {/* Weight as a muted chip — reads as a label ("how much it counts"), not a score.
            Hidden when n.v.t.: a non-applicable part is EXCLUDED from the score, so it
            weighs nothing here — showing "weegt 20%" would contradict that. */}
        {pct != null && (
          <span style={{ fontSize: 10.5, color: M3.neutral, fontWeight: 600, background: '#f1f3f4', borderRadius: 6, padding: '2px 7px', whiteSpace: 'nowrap' }}>
            weegt {d.weight}%
          </span>
        )}
        <span style={{ fontSize: 13, fontWeight: 700, fontFamily: FONT_NUM, color: pct == null ? M3.neutral : barColor, minWidth: 44, textAlign: 'end' }}>
          {pct == null ? 'n.v.t.' : `${pct}%`}
        </span>
      </div>
      {/* Thin fill bar — makes the colored percentage read as a completeness level. */}
      {pct != null && (
        <div style={{ height: 4, borderRadius: 2, background: '#f1f3f4', marginTop: 8, marginInlineStart: 30, overflow: 'hidden' }}>
          <div style={{ height: '100%', width: `${pct}%`, background: barColor, borderRadius: 2 }} />
        </div>
      )}
      <div style={{ fontSize: 12, color: M3.neutral, marginTop: 6, marginInlineStart: 30, lineHeight: 1.45 }}>{d.detail}</div>
    </div>
  )
}
