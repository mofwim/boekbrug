'use client'

// src/modules/accountant/pages/AccountantWerkboard.tsx
// [WERKBOARD] The accountant's daily driver — merges the BTW-deadline agenda and
// the cross-client readiness board into ONE screen, plus a safe per-client
// reminder ("Herinner").
//   · Deadline hero  — the Belastingdienst deadline for the selected quarter
//     (getAangifteDeadline: last day of the month after the quarter).
//   · Readiness rows — each client's score + status from /api/readiness
//     (?clientId=…), the SAME buildReadiness verdict the client sees on
//     "Ben ik klaar?", so accountant and client never disagree.
//   · Herinner       — an IN-APP notification to the client (notify-client),
//     never an external email, and only after the accountant confirms per client
//     (review-before-send; no blind mass send).
// UI language is identical to the other accountant tools (Google Workspace, Roboto).

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useSubPageHeader } from '@/components/nav/SubPageHeaderContext'
import { EL1, FONT, M3, R, COLUMN } from '@/lib/design/tokens'
import { rowMatchesQuery } from '@/lib/search'
import { getAangifteDeadline, daysUntil } from '../accountant.service'
import {
  summarizeBoard,
  needsAction,
  type BoardRow,
  type BoardStatus,
} from '../readiness-board'

// Same semantic colours as the owner's readiness screen (STATUS_META) so a client
// sees the identical green/amber/red the accountant sees.
const STATUS_META: Record<BoardStatus, { label: string; color: string; bg: string; dot: string }> = {
  ready:     { label: 'Klaar',       color: '#137333', bg: '#CEEAD6', dot: '🟢' },
  almost:    { label: 'Bijna klaar', color: '#7C5800', bg: '#FEE8C4', dot: '🟡' },
  attention: { label: 'Nog niet',    color: '#B3261E', bg: '#F9DEDC', dot: '🔴' },
}

const MAX_PARALLEL = 4
const NL_MONTHS = ['januari', 'februari', 'maart', 'april', 'mei', 'juni', 'juli', 'augustus', 'september', 'oktober', 'november', 'december']

function formatDutchDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number)
  return `${d} ${NL_MONTHS[m - 1]} ${y}`
}
function deadlineColor(days: number): string {
  if (days <= 7) return '#C5221F'
  if (days <= 14) return '#B26A00'
  return '#1A73E8'
}
function countdownLabel(days: number): string {
  if (days < 0) return `${Math.abs(days)} ${Math.abs(days) === 1 ? 'dag' : 'dagen'} verlopen`
  if (days === 0) return 'Deadline is vandaag'
  return `Nog ${days} ${days === 1 ? 'dag' : 'dagen'}`
}

// [WERKBOARD-NUDGE] The reminder the client receives — states the quarter and how
// many things are still missing, and points at their own "Ben ik klaar?" screen
// where every gap is listed with a fix-link. Honest and specific, never a guilt trip.
function nudgeMessage(quarterLabel: string, missingCount?: number): { title: string; body: string } {
  const what = missingCount && missingCount > 0
    ? `nog ${missingCount} ${missingCount === 1 ? 'ding' : 'dingen'}`
    : 'nog een paar dingen'
  return {
    title: 'Herinnering van je boekhouder',
    body: `Voor ${quarterLabel} mist je boekhouder ${what} om je administratie af te ronden. Kijk op "Ben ik klaar?" wat er nog nodig is.`,
  }
}

type NudgeState = 'idle' | 'confirm' | 'sending' | 'sent' | 'error'

interface Props {
  clients: Array<{ id: string; name: string }>
  year: number
  quarter: number
}

export default function AccountantWerkboard({ clients, year: initYear, quarter: initQuarter }: Props) {
  const router = useRouter()
  const currentYear = new Date().getFullYear()

  const [year, setYear] = useState(initYear)
  const [quarter, setQuarter] = useState(initQuarter)
  const [onlyAction, setOnlyAction] = useState(false)
  const [query, setQuery] = useState('')
  const [reloadKey, setReloadKey] = useState(0)

  // [HEADER-SYSTEM] This board is registered in the shared sub-page bar
  // (DashboardChrome/STATIC_TITLES -> "Aangifte & status"). Instead of drawing a
  // bespoke header, push the refresh control into the shared bar's actions slot.
  useSubPageHeader(
    {
      actions: (
        <button
          onClick={() => setReloadKey(k => k + 1)}
          title="Vernieuwen"
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: M3.primary, display: 'flex', alignItems: 'center', gap: 4, fontSize: 13, fontWeight: 600, fontFamily: FONT }}
        >
          <span className="material-symbols-outlined" style={{ fontSize: 18 }}>refresh</span>
          Vernieuwen
        </button>
      ),
    },
    [],
  )
  const [rows, setRows] = useState<BoardRow[]>(
    () => clients.map(c => ({ id: c.id, name: c.name, state: 'loading' as const })),
  )
  const [nudge, setNudge] = useState<Record<string, NudgeState>>({})

  const quarterLabel = `Q${quarter} ${year}`
  const deadline = getAangifteDeadline(year, quarter)
  const days = daysUntil(deadline)
  const heroColor = deadlineColor(days)

  const loadOne = useCallback(async (id: string, y: number, q: number): Promise<BoardRow> => {
    const base = clients.find(c => c.id === id)!
    try {
      const res = await fetch(`/api/readiness?clientId=${encodeURIComponent(id)}&year=${y}&quarter=${q}`)
      // [REDEN] 403 = de koppeling is verbroken terwijl het bord openstond. Het antwoord
      // weet dat; de rij gooide het weg en toonde "Kon status niet laden" — een storing waar
      // de boekhouder op gaat klikken. Zeg wat er is.
      if (!res.ok) return { ...base, state: 'error', errorReason: res.status === 403 ? 'unlinked' : 'unknown' }
      const json = await res.json()
      const report = json?.report
      if (!report) return { ...base, state: 'error', errorReason: 'unknown' }
      const missing: unknown[] = Array.isArray(report.missing) ? report.missing : []
      return {
        ...base,
        state: 'ok',
        score: report.score,
        status: report.status as BoardStatus,
        missingCount: missing.length,
        riskCount: Array.isArray(report.risks) ? report.risks.length : 0,
        // [REDEN] Alleen de koppen — zie de toelichting bij BoardRow.missingTitles.
        missingTitles: missing
          .map(m => (m && typeof m === 'object' && 'title' in m ? String((m as { title: unknown }).title) : ''))
          .filter(Boolean),
      }
    } catch {
      return { ...base, state: 'error' }
    }
  }, [clients])

  // Fetch every client's readiness for the selected quarter, MAX_PARALLEL at a time.
  // Re-runs on quarter change / refresh; a stale run is cancelled so a quick switch
  // can't write old-quarter rows. Resets any per-row nudge state too.
  useEffect(() => {
    let cancelled = false
    // Reset in dezelfde tick, maar buiten de effect-body zelf.
    void (async () => {
      setRows(clients.map(c => ({ id: c.id, name: c.name, state: 'loading' as const })))
      setNudge({})
    })()

    const queue = [...clients]
    async function worker() {
      while (!cancelled) {
        const next = queue.shift()
        if (!next) return
        const row = await loadOne(next.id, year, quarter)
        if (cancelled) return
        setRows(prev => prev.map(r => (r.id === row.id ? row : r)))
      }
    }
    const workers = Array.from({ length: Math.min(MAX_PARALLEL, clients.length) }, worker)
    void Promise.all(workers)
    return () => { cancelled = true }
  }, [clients, year, quarter, reloadKey, loadOne])

  const summary = useMemo(() => summarizeBoard(rows), [rows])
  // [SMART-FILTER] status toggle (bestaand) + naam-zoeken (nieuw) samen.
  const visible = useMemo(() => {
    const q = query.trim()
    let list = onlyAction ? rows.filter(needsAction) : rows
    if (q) list = list.filter((r) => rowMatchesQuery(q, [r.name]))
    return list
  }, [rows, onlyAction, query])

  function openClient(clientId: string) {
    router.push(`/dashboard/clients/${clientId}/kwartaal?q=${quarter}&year=${year}`)
  }

  async function sendNudge(row: BoardRow) {
    setNudge(prev => ({ ...prev, [row.id]: 'sending' }))
    const msg = nudgeMessage(quarterLabel, row.missingCount)
    try {
      const res = await fetch('/api/notifications/notify-client', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clientId: row.id,
          title: msg.title,
          body: msg.body,
          type: 'status',
          link: '/dashboard/klaar',
        }),
      })
      setNudge(prev => ({ ...prev, [row.id]: res.ok ? 'sent' : 'error' }))
    } catch {
      setNudge(prev => ({ ...prev, [row.id]: 'error' }))
    }
  }

  const tabStyle = (active: boolean) => ({
    padding: '7px 14px', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer',
    border: `1px solid ${active ? '#1A73E8' : '#E0E0E0'}`,
    background: active ? '#D3E3FD' : '#FFFFFF',
    color: active ? '#041E49' : '#5F6368', fontFamily: "'Roboto', sans-serif",
  })

  // [HEADER-SYSTEM] No bespoke header here — the shared sub-page bar renders the
  // back + "Aangifte & status" title + the refresh action (registered above via
  // useSubPageHeader).
  return (
    <div style={{ minHeight: '100vh', backgroundColor: '#F8F9FA', fontFamily: FONT }}>
      <main style={{ maxWidth: COLUMN.work, margin: '0 auto', padding: '24px 16px', display: 'flex', flexDirection: 'column', gap: 16 }}>

        {/* ── Deadline hero (from #1) — follows the selected quarter ── */}
        <div style={{
          backgroundColor: M3.surface, borderRadius: R.lg, boxShadow: EL1, padding: '20px',
          display: 'flex', alignItems: 'center', gap: 16, borderInlineStart: `4px solid ${heroColor}`,
        }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <p style={{ fontSize: 13, fontWeight: 600, color: '#5F6368', margin: '0 0 4px', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              BTW-aangifte {quarterLabel}
            </p>
            <p style={{ fontSize: 28, fontWeight: 700, color: heroColor, margin: '0 0 4px', lineHeight: 1.1 }}>
              {countdownLabel(days)}
            </p>
            <p style={{ fontSize: 13, color: '#5F6368', margin: 0 }}>Uiterlijk {formatDutchDate(deadline)}</p>
          </div>
          <span style={{ fontSize: 40, flexShrink: 0 }}>🗓️</span>
        </div>

        {/* ── Quarter picker ── */}
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          {[1, 2, 3, 4].map(q => {
            const active = quarter === q
            return (
              <button key={q} onClick={() => setQuarter(q)} style={{
                flex: 1, padding: '9px 0', borderRadius: 8, cursor: 'pointer',
                fontFamily: "'Roboto', sans-serif", fontSize: 14, fontWeight: 600,
                border: `1px solid ${active ? '#1A73E8' : '#E0E0E0'}`,
                background: active ? '#1A73E8' : '#FFFFFF', color: active ? '#fff' : '#202124',
              }}>Q{q}</button>
            )
          })}
          <div style={{ display: 'flex', alignItems: 'center', gap: 2, paddingInlineStart: 6 }}>
            <button onClick={() => setYear(y => Math.max(2000, y - 1))} title="Vorig jaar" style={{ width: 28, height: 28, borderRadius: 8, border: 'none', background: 'none', cursor: 'pointer', color: '#1A73E8' }}>
              <span className="material-symbols-outlined icon-dir" style={{ fontSize: 20 }}>chevron_left</span>
            </button>
            <span style={{ fontSize: 14, fontWeight: 700, color: '#202124', minWidth: 40, textAlign: 'center' }}>{year}</span>
            <button onClick={() => setYear(y => Math.min(y + 1, currentYear))} disabled={year >= currentYear} title="Volgend jaar" style={{ width: 28, height: 28, borderRadius: 8, border: 'none', background: 'none', cursor: year >= currentYear ? 'default' : 'pointer', color: year >= currentYear ? '#E0E0E0' : '#1A73E8', opacity: year >= currentYear ? 0.5 : 1 }}>
              <span className="material-symbols-outlined icon-dir" style={{ fontSize: 20 }}>chevron_right</span>
            </button>
          </div>
        </div>

        {/* ── Headline counts ── */}
        {clients.length > 0 && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
            {[
              { n: summary.ready, label: 'Klaar', color: summary.ready > 0 ? '#137333' : '#5F6368' },
              { n: summary.almost, label: 'Bijna', color: summary.almost > 0 ? '#7C5800' : '#5F6368' },
              { n: summary.attention, label: 'Nog niet', color: summary.attention > 0 ? '#B3261E' : '#5F6368' },
            ].map(s => (
              <div key={s.label} style={{ backgroundColor: M3.surface, borderRadius: R.lg, boxShadow: EL1, padding: '12px 8px', textAlign: 'center' }}>
                <p style={{ fontSize: 22, fontWeight: 700, color: s.color, margin: 0 }}>{s.n}</p>
                <p style={{ fontSize: 11, color: '#5F6368', margin: '2px 0 0' }}>{s.label}</p>
              </div>
            ))}
          </div>
        )}

        {/* ── Filter ── */}
        {clients.length > 0 && (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <button onClick={() => setOnlyAction(false)} style={tabStyle(!onlyAction)}>Alle klanten</button>
            <button onClick={() => setOnlyAction(true)} style={tabStyle(onlyAction)}>
              Actie nodig{summary.actionNeeded > 0 ? ` (${summary.actionNeeded})` : ''}
            </button>
            <div style={{ position: 'relative', flex: 1, minWidth: 160 }}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#9aa0a6" strokeWidth="2" style={{ position: 'absolute', insetInlineStart: 12, top: '50%', transform: 'translateY(-50%)' }}><circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3" strokeLinecap="round" /></svg>
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Zoek klant…"
                aria-label="Klanten zoeken"
                style={{ width: '100%', boxSizing: 'border-box', padding: '8px 30px', borderRadius: 8, border: '1px solid #E0E0E0', fontSize: 13.5, outline: 'none', color: '#202124', background: '#FFFFFF' }}
              />
              {query && (
                <button onClick={() => setQuery('')} aria-label="Wissen" className="tap-44" style={{ position: 'absolute', insetInlineEnd: 8, top: '50%', transform: 'translateY(-50%)', width: 19, height: 19, borderRadius: '50%', border: 'none', background: '#E0E0E0', color: '#5F6368', cursor: 'pointer', fontSize: 12, lineHeight: 1 }}>×</button>
              )}
            </div>
            {/* [HERTIKKEN] De machineleesbare CSV over ALLE klanten van dit kwartaal.
                Deze route (/api/export?accountant=true) was volledig afgebouwd en had nul
                aanroepers in de hele app — af, en onbereikbaar. Eén link. */}
            <a
              href={`/api/export?year=${year}&quarter=${quarter}&accountant=true`}
              style={{ fontSize: 12.5, fontWeight: 600, color: '#1A73E8', textDecoration: 'none', border: '1px solid #E0E0E0', borderRadius: 8, padding: '6px 12px', whiteSpace: 'nowrap' }}
            >
              ⬇︎ Alle klanten (CSV)
            </a>
          </div>
        )}

        {/* ── Client board ── */}
        <div style={{ backgroundColor: M3.surface, borderRadius: R.lg, boxShadow: EL1, overflow: 'hidden' }}>
          {clients.length === 0 ? (
            <p style={{ fontSize: 14, color: '#5F6368', padding: '32px 16px', textAlign: 'center', margin: 0 }}>Nog geen klanten gekoppeld</p>
          ) : visible.length === 0 ? (
            <p style={{ fontSize: 14, color: '#5F6368', padding: '32px 16px', textAlign: 'center', margin: 0 }}>
              {query.trim() ? `Geen klanten gevonden voor “${query.trim()}”` : 'Alle klanten zijn klaar 🎉'}
            </p>
          ) : (
            visible.map((row, idx) => {
              const meta = row.state === 'ok' && row.status ? STATUS_META[row.status] : null
              const canNudge = row.state === 'ok' && row.status !== 'ready'
              const nState = nudge[row.id] ?? 'idle'
              const last = idx === visible.length - 1
              return (
                <div key={row.id} style={{ borderBottom: last ? 'none' : '1px solid #F1F3F4' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 16px', minHeight: 60 }}>
                    {/* Name + facts → opens the client's quarter */}
                    <button
                      onClick={() => openClient(row.id)}
                      style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 2, background: 'none', border: 'none', cursor: 'pointer', textAlign: 'start', padding: 0 }}
                    >
                      <span style={{ fontSize: 14, fontWeight: 500, color: '#202124', maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{row.name}</span>
                      <span style={{ fontSize: 12, color: '#5F6368', maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {row.state === 'loading' && 'Controleren…'}
                        {row.state === 'error' && (row.errorReason === 'unlinked'
                          ? 'Koppeling verbroken'
                          : 'Kon status niet laden')}
                        {row.state === 'ok' && (
                          <>
                            {row.score}% compleet
                            {(row.missingCount ?? 0) > 0 && ` · ${row.missingCount} ontbreekt`}
                            {(row.riskCount ?? 0) > 0 && ` · ${row.riskCount} nakijken`}
                          </>
                        )}
                      </span>
                    </button>

                    {/* Reminder — only for clients not yet ready */}
                    {canNudge && (nState === 'idle' || nState === 'confirm') && (
                      <button
                        onClick={() => setNudge(prev => ({ ...prev, [row.id]: nState === 'confirm' ? 'idle' : 'confirm' }))}
                        style={{ flexShrink: 0, fontSize: 12, fontWeight: 600, color: '#1A73E8', background: 'none', border: '1px solid #E0E0E0', borderRadius: 6, padding: '5px 10px', cursor: 'pointer', fontFamily: "'Roboto', sans-serif" }}
                      >
                        Herinner
                      </button>
                    )}
                    {nState === 'sending' && <span style={{ flexShrink: 0, fontSize: 12, color: '#5F6368' }}>Versturen…</span>}
                    {nState === 'sent' && <span style={{ flexShrink: 0, fontSize: 12, fontWeight: 600, color: '#137333' }}>✓ Verstuurd</span>}
                    {nState === 'error' && (
                      <button onClick={() => setNudge(prev => ({ ...prev, [row.id]: 'confirm' }))} style={{ flexShrink: 0, fontSize: 12, fontWeight: 600, color: '#B3261E', background: 'none', border: 'none', cursor: 'pointer' }}>Mislukt · opnieuw</button>
                    )}

                    {/* Status chip */}
                    {row.state === 'loading' && <span style={{ flexShrink: 0, fontSize: 11, fontWeight: 600, color: '#5F6368', backgroundColor: '#F1F3F4', padding: '3px 8px', borderRadius: 6 }}>…</span>}
                    {row.state === 'error' && <span style={{ flexShrink: 0, fontSize: 11, fontWeight: 600, color: '#5F6368', backgroundColor: '#F1F3F4', padding: '3px 8px', borderRadius: 6 }}>—</span>}
                    {meta && <span style={{ flexShrink: 0, fontSize: 11, fontWeight: 600, color: meta.color, backgroundColor: meta.bg, padding: '3px 8px', borderRadius: 6, whiteSpace: 'nowrap' }}>{meta.dot} {meta.label}</span>}
                  </div>

                  {/* [REDEN + PAKKET] De twee dingen waarvoor de boekhouder anders het bord
                      moest verlaten: WAT er ontbreekt, en HET BESTAND.

                      Bewust alleen bij een geladen rij, en bewust geen extra knoppenrij als
                      er niets te melden is — een bord dat altijd vol staat leest niemand. */}
                  {row.state === 'ok' && ((row.missingTitles?.length ?? 0) > 0 || row.status === 'ready') && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', padding: '0 16px 12px', marginTop: -4 }}>
                      {(row.missingTitles ?? []).slice(0, 3).map((titel) => (
                        <span
                          key={titel}
                          title={titel}
                          style={{ fontSize: 11.5, color: '#7C5800', backgroundColor: '#FEF7E0', border: '1px solid #FDE9B8', borderRadius: 6, padding: '3px 8px', maxWidth: 240, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                        >
                          {titel}
                        </span>
                      ))}
                      {(row.missingTitles?.length ?? 0) > 3 && (
                        <span style={{ fontSize: 11.5, color: '#5F6368' }}>+{(row.missingTitles?.length ?? 0) - 3} meer</span>
                      )}

                      {/* Het pakket, rechtstreeks. /api/closing-package is al dubbelpad-
                          geautoriseerd (owner óf gekoppelde boekhouder), dus dit is dezelfde
                          link die /brug al gebruikt — alleen nu zonder eerst weg te navigeren.
                          Hij kwam voor het bestand; dat hoort niet drie klikken verderop. */}
                      <a
                        href={`/api/closing-package?year=${year}&quarter=${quarter}&clientId=${encodeURIComponent(row.id)}`}
                        style={{ marginInlineStart: 'auto', flexShrink: 0, fontSize: 12, fontWeight: 600, color: '#1A73E8', textDecoration: 'none', border: '1px solid #E0E0E0', borderRadius: 6, padding: '5px 10px' }}
                      >
                        ⬇︎ Pakket
                      </a>
                    </div>
                  )}

                  {/* Review-before-send: the exact message, then confirm. No blind send. */}
                  {nState === 'confirm' && (
                    <div style={{ padding: '0 16px 14px', display: 'flex', flexDirection: 'column', gap: 8 }}>
                      <div style={{ backgroundColor: '#F8F9FA', border: '1px solid #E0E0E0', borderRadius: 8, padding: '10px 12px' }}>
                        <p style={{ fontSize: 12, fontWeight: 600, color: '#202124', margin: '0 0 3px' }}>{nudgeMessage(quarterLabel, row.missingCount).title}</p>
                        <p style={{ fontSize: 12, color: '#5F6368', margin: 0, lineHeight: 1.5 }}>{nudgeMessage(quarterLabel, row.missingCount).body}</p>
                      </div>
                      <div style={{ display: 'flex', gap: 8 }}>
                        <button onClick={() => sendNudge(row)} style={{ fontSize: 13, fontWeight: 600, color: '#fff', backgroundColor: '#1A73E8', border: 'none', borderRadius: 8, padding: '8px 16px', cursor: 'pointer', fontFamily: "'Roboto', sans-serif" }}>Verstuur herinnering</button>
                        <button onClick={() => setNudge(prev => ({ ...prev, [row.id]: 'idle' }))} style={{ fontSize: 13, fontWeight: 600, color: '#5F6368', backgroundColor: '#fff', border: '1px solid #E0E0E0', borderRadius: 8, padding: '8px 16px', cursor: 'pointer', fontFamily: "'Roboto', sans-serif" }}>Annuleren</button>
                      </div>
                      <p style={{ fontSize: 11, color: '#80868b', margin: 0 }}>De klant krijgt dit als melding in de app (geen e-mail).</p>
                    </div>
                  )}
                </div>
              )
            })
          )}
        </div>

        <p style={{ fontSize: 11, color: '#80868b', margin: '0 4px', lineHeight: 1.5 }}>
          Zelfde score en verdict als de klant ziet op &ldquo;Ben ik klaar?&rdquo;. &ldquo;Herinner&rdquo;
          stuurt een melding in de app naar de klant — je bevestigt per klant.
        </p>

      </main>
    </div>
  )
}
