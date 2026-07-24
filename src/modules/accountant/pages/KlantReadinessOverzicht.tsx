'use client'

// src/modules/accountant/pages/KlantReadinessOverzicht.tsx
// [KLAAR-OVERZICHT] The accountant's cross-client version of the owner's "Ben ik
// klaar?" screen: every linked client's readiness score + status for a chosen
// quarter, on one board. Each row's rich readiness comes from /api/readiness
// (?clientId=…) — the SAME endpoint and buildReadiness verdict the owner sees, so
// the accountant and the client never disagree. Fetched client-side with a small
// concurrency cap; rows fill in progressively. UI language is identical to the
// other accountant tools (Google Workspace design, Roboto, #F8F9FA).

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useParentPath } from '@/lib/navigation-hooks'
import {
  summarizeBoard,
  needsAction,
  type BoardRow,
  type BoardStatus,
} from '../readiness-board'

// Same semantic colours as the owner's readiness screen (STATUS_META) so a
// client sees the identical green/amber/red the accountant sees.
const STATUS_META: Record<BoardStatus, { label: string; color: string; bg: string; dot: string }> = {
  ready:     { label: 'Klaar',       color: '#137333', bg: '#CEEAD6', dot: '🟢' },
  almost:    { label: 'Bijna klaar', color: '#7C5800', bg: '#FEE8C4', dot: '🟡' },
  attention: { label: 'Nog niet',    color: '#B3261E', bg: '#F9DEDC', dot: '🔴' },
}

// Concurrency cap for the per-client /api/readiness calls — each is a heavy
// projection, so we run a few at a time rather than N at once.
const MAX_PARALLEL = 4

interface Props {
  clients: Array<{ id: string; name: string }>
  year: number
  quarter: number
}

export default function KlantReadinessOverzicht({ clients, year: initYear, quarter: initQuarter }: Props) {
  const router = useRouter()
  const parentHref = useParentPath('accountant')
  const currentYear = new Date().getFullYear()

  const [year, setYear] = useState(initYear)
  const [quarter, setQuarter] = useState(initQuarter)
  const [onlyAction, setOnlyAction] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)

  // One row per client, keyed by id, progressively filled by the fetch pool.
  const [rows, setRows] = useState<BoardRow[]>(
    () => clients.map(c => ({ id: c.id, name: c.name, state: 'loading' as const })),
  )

  const loadOne = useCallback(async (id: string, y: number, q: number): Promise<BoardRow> => {
    const base = clients.find(c => c.id === id)!
    try {
      const res = await fetch(`/api/readiness?clientId=${encodeURIComponent(id)}&year=${y}&quarter=${q}`)
      if (!res.ok) return { ...base, state: 'error' }
      const json = await res.json()
      const report = json?.report
      if (!report) return { ...base, state: 'error' }
      return {
        ...base,
        state: 'ok',
        score: report.score,
        status: report.status as BoardStatus,
        missingCount: Array.isArray(report.missing) ? report.missing.length : 0,
        riskCount: Array.isArray(report.risks) ? report.risks.length : 0,
      }
    } catch {
      return { ...base, state: 'error' }
    }
  }, [clients])

  // Fetch every client's readiness for the selected quarter, MAX_PARALLEL at a
  // time. Re-runs when the quarter changes or the user hits refresh. A stale run
  // is cancelled so a quick quarter switch can't write old-quarter rows.
  useEffect(() => {
    let cancelled = false
    setRows(clients.map(c => ({ id: c.id, name: c.name, state: 'loading' as const })))

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
  const visible = useMemo(() => (onlyAction ? rows.filter(needsAction) : rows), [rows, onlyAction])

  function openClient(clientId: string) {
    router.push(`/dashboard/clients/${clientId}/kwartaal?q=${quarter}&year=${year}`)
  }

  const tabStyle = (active: boolean) => ({
    padding: '7px 14px', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer',
    border: `1px solid ${active ? '#1A73E8' : '#E0E0E0'}`,
    background: active ? '#D3E3FD' : '#FFFFFF',
    color: active ? '#041E49' : '#5F6368', fontFamily: "'Roboto', sans-serif",
  })

  return (
    <div style={{ minHeight: '100vh', backgroundColor: '#F8F9FA', fontFamily: "'Roboto', sans-serif" }}>

      {/* Header — identical to the other accountant tools */}
      <div style={{
        backgroundColor: '#FFFFFF', borderBottom: '1px solid #E0E0E0', padding: '0 24px',
        height: 64, display: 'flex', alignItems: 'center', gap: 16,
        position: 'sticky', top: 0, zIndex: 40,
      }}>
        <Link href={parentHref} style={{ textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 6, color: '#1A73E8', fontSize: 14, fontWeight: 500 }}>
          ← Terug
        </Link>
        <h1 style={{ fontSize: 18, fontWeight: 600, color: '#202124', margin: 0 }}>
          Wie is klaar?
        </h1>
        <button
          onClick={() => setReloadKey(k => k + 1)}
          title="Vernieuwen"
          style={{ marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer', color: '#1A73E8', display: 'flex', alignItems: 'center', gap: 4, fontSize: 13, fontWeight: 600, fontFamily: "'Roboto', sans-serif" }}
        >
          <span className="material-symbols-outlined" style={{ fontSize: 18 }}>refresh</span>
          Vernieuwen
        </button>
      </div>

      <main style={{ maxWidth: 720, margin: '0 auto', padding: '24px 16px', display: 'flex', flexDirection: 'column', gap: 16 }}>

        {/* ── Quarter picker (same control as the owner's Klaar screen) ── */}
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          {[1, 2, 3, 4].map(q => {
            const active = quarter === q
            return (
              <button
                key={q}
                onClick={() => setQuarter(q)}
                style={{
                  flex: 1, padding: '9px 0', borderRadius: 8, cursor: 'pointer',
                  fontFamily: "'Roboto', sans-serif", fontSize: 14, fontWeight: 600,
                  border: `1px solid ${active ? '#1A73E8' : '#E0E0E0'}`,
                  background: active ? '#1A73E8' : '#FFFFFF', color: active ? '#fff' : '#202124',
                }}
              >
                Q{q}
              </button>
            )
          })}
          <div style={{ display: 'flex', alignItems: 'center', gap: 2, paddingLeft: 6 }}>
            <button onClick={() => setYear(y => Math.max(2000, y - 1))} title="Vorig jaar" style={{ width: 28, height: 28, borderRadius: 8, border: 'none', background: 'none', cursor: 'pointer', color: '#1A73E8' }}>
              <span className="material-symbols-outlined" style={{ fontSize: 20 }}>chevron_left</span>
            </button>
            <span style={{ fontSize: 14, fontWeight: 700, color: '#202124', minWidth: 40, textAlign: 'center' }}>{year}</span>
            <button onClick={() => setYear(y => Math.min(y + 1, currentYear))} disabled={year >= currentYear} title="Volgend jaar" style={{ width: 28, height: 28, borderRadius: 8, border: 'none', background: 'none', cursor: year >= currentYear ? 'default' : 'pointer', color: year >= currentYear ? '#E0E0E0' : '#1A73E8', opacity: year >= currentYear ? 0.5 : 1 }}>
              <span className="material-symbols-outlined" style={{ fontSize: 20 }}>chevron_right</span>
            </button>
          </div>
        </div>

        {/* ── Honest headline counts (same 3-tile style as the other tools) ── */}
        {clients.length > 0 && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
            {[
              { n: summary.ready, label: 'Klaar', color: summary.ready > 0 ? '#137333' : '#5F6368' },
              { n: summary.almost, label: 'Bijna', color: summary.almost > 0 ? '#7C5800' : '#5F6368' },
              { n: summary.attention, label: 'Nog niet', color: summary.attention > 0 ? '#B3261E' : '#5F6368' },
            ].map(s => (
              <div key={s.label} style={{ backgroundColor: '#FFFFFF', border: '1px solid #E0E0E0', borderRadius: 8, padding: '12px 8px', textAlign: 'center' }}>
                <p style={{ fontSize: 22, fontWeight: 700, color: s.color, margin: 0 }}>{s.n}</p>
                <p style={{ fontSize: 11, color: '#5F6368', margin: '2px 0 0' }}>{s.label}</p>
              </div>
            ))}
          </div>
        )}

        {/* ── Filter: all vs only clients that still need work ── */}
        {clients.length > 0 && (
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={() => setOnlyAction(false)} style={tabStyle(!onlyAction)}>Alle klanten</button>
            <button onClick={() => setOnlyAction(true)} style={tabStyle(onlyAction)}>
              Actie nodig{summary.actionNeeded > 0 ? ` (${summary.actionNeeded})` : ''}
            </button>
          </div>
        )}

        {/* ── Client board ── */}
        <div style={{ backgroundColor: '#FFFFFF', border: '1px solid #E0E0E0', borderRadius: 8, overflow: 'hidden' }}>
          {clients.length === 0 ? (
            <p style={{ fontSize: 14, color: '#5F6368', padding: '32px 16px', textAlign: 'center', margin: 0 }}>
              Nog geen klanten gekoppeld
            </p>
          ) : visible.length === 0 ? (
            <p style={{ fontSize: 14, color: '#5F6368', padding: '32px 16px', textAlign: 'center', margin: 0 }}>
              Alle klanten zijn klaar 🎉
            </p>
          ) : (
            visible.map((row, idx) => {
              const meta = row.state === 'ok' && row.status ? STATUS_META[row.status] : null
              return (
                <button
                  key={row.id}
                  onClick={() => openClient(row.id)}
                  style={{
                    width: '100%', display: 'flex', alignItems: 'center', gap: 12,
                    padding: '12px 16px', background: 'none', border: 'none',
                    borderBottom: idx < visible.length - 1 ? '1px solid #F1F3F4' : 'none',
                    cursor: 'pointer', textAlign: 'left', transition: 'background 0.1s', minHeight: 60,
                  }}
                  onMouseEnter={e => (e.currentTarget.style.backgroundColor = '#F8F9FA')}
                  onMouseLeave={e => (e.currentTarget.style.backgroundColor = 'transparent')}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ fontSize: 14, fontWeight: 500, color: '#202124', margin: '0 0 2px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {row.name}
                    </p>
                    <p style={{ fontSize: 12, color: '#5F6368', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {row.state === 'loading' && 'Controleren…'}
                      {row.state === 'error' && 'Kon status niet laden'}
                      {row.state === 'ok' && (
                        <>
                          {row.score}% compleet
                          {(row.missingCount ?? 0) > 0 && ` · ${row.missingCount} ontbreekt`}
                          {(row.riskCount ?? 0) > 0 && ` · ${row.riskCount} nakijken`}
                        </>
                      )}
                    </p>
                  </div>

                  {/* Status chip / spinner */}
                  {row.state === 'loading' && (
                    <span style={{ fontSize: 11, fontWeight: 600, color: '#5F6368', backgroundColor: '#F1F3F4', padding: '3px 8px', borderRadius: 6, flexShrink: 0, whiteSpace: 'nowrap' }}>…</span>
                  )}
                  {row.state === 'error' && (
                    <span style={{ fontSize: 11, fontWeight: 600, color: '#5F6368', backgroundColor: '#F1F3F4', padding: '3px 8px', borderRadius: 6, flexShrink: 0, whiteSpace: 'nowrap' }}>—</span>
                  )}
                  {meta && (
                    <span style={{ fontSize: 11, fontWeight: 600, color: meta.color, backgroundColor: meta.bg, padding: '3px 8px', borderRadius: 6, flexShrink: 0, whiteSpace: 'nowrap' }}>
                      {meta.dot} {meta.label}
                    </span>
                  )}

                  <span style={{ color: '#1A73E8', fontSize: 14, fontWeight: 600, flexShrink: 0 }}>→</span>
                </button>
              )
            })
          )}
        </div>

        {/* Honest footnote — same verdict engine as the client's own screen */}
        <p style={{ fontSize: 11, color: '#80868b', margin: '0 4px', lineHeight: 1.5 }}>
          Zelfde score en verdict als de klant ziet op &ldquo;Ben ik klaar?&rdquo;. Tik op een
          klant om het kwartaal te openen.
        </p>

      </main>
    </div>
  )
}
