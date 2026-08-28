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
import { translator, type Translator } from '@/lib/i18n/t'
import { useLocale } from '@/lib/i18n/use-locale'
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
const STATUS_META: Record<BoardStatus, { color: string; bg: string; dot: string }> = {
  ready:     { color: '#137333', bg: '#CEEAD6', dot: '🟢' },
  almost:    { color: '#7C5800', bg: '#FEE8C4', dot: '🟡' },
  attention: { color: '#B3261E', bg: '#F9DEDC', dot: '🔴' },
}

// The word beside the dot. A key per status, not a Dutch label on the colour table — the colour
// is the same in every language and the word is not.
const STATUS_LABEL_KEY = {
  ready:     'bh.werk.status.ready',
  almost:    'bh.werk.status.almost',
  attention: 'bh.werk.status.attention',
} as const satisfies Record<BoardStatus, string>

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
function countdownLabel(t: Translator, days: number): string {
  if (days < 0) {
    const n = Math.abs(days)
    return t(n === 1 ? 'bh.werk.countdown.verlopenEen' : 'bh.werk.countdown.verlopenMeer', { n })
  }
  if (days === 0) return t('bh.werk.countdown.vandaag')
  return t(days === 1 ? 'bh.werk.countdown.nogEen' : 'bh.werk.countdown.nogMeer', { n: days })
}

// [WERKBOARD-NUDGE] The reminder the client receives — states the quarter and how
// many things are still missing, and points at their own "Ben ik klaar?" screen
// where every gap is listed with a fix-link. Honest and specific, never a guilt trip.
//
// [TAAL] Dutch, and NOT through the translator — deliberately. This text is not read by the
// accountant looking at this board; it is stored and delivered to the CLIENT, like the invoice
// mail. Binding it to the accountant's language setting would send an Arabic notification to a
// Dutch owner because their bookkeeper reads Arabic. The confirm panel shows it verbatim, which
// is the point: what is previewed is exactly what is sent.
function nudgeMessage(quarterLabel: string, missingCount?: number): { title: string; body: string } {
  const what = missingCount && missingCount > 0
    ? `nog ${missingCount} ${missingCount === 1 ? 'ding' : 'dingen'}`
    : 'nog een paar dingen'
  return {
    title: 'Herinnering van je boekhouder', // [TAAL-DB] Gaat naar de KLANT, in diens taal — niet in die van de boekhouder.
    body: `Voor ${quarterLabel} mist je boekhouder ${what} om je administratie af te ronden. Kijk op "Ben ik klaar?" wat er nog nodig is.`, // [TAAL-DB] Berichttekst voor de klant; "Ben ik klaar?" is de naam van diens eigen scherm.
  }
}

type NudgeState = 'idle' | 'confirm' | 'sending' | 'sent' | 'error'

interface Props {
  clients: Array<{ id: string; name: string }>
  year: number
  quarter: number
}

export default function AccountantWerkboard({ clients, year: initYear, quarter: initQuarter }: Props) {
  const locale = useLocale()
  const t = translator(locale)
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
          title={t('bh.werk.vernieuwen')}
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: M3.primary, display: 'flex', alignItems: 'center', gap: 4, fontSize: 13, fontWeight: 600, fontFamily: FONT }}
        >
          <span className="material-symbols-outlined" style={{ fontSize: 18 }} aria-hidden>refresh</span>
          {t('bh.werk.vernieuwen')}
        </button>
      ),
    },
    [t],
  )
  const [rows, setRows] = useState<BoardRow[]>(
    () => clients.map(c => ({ id: c.id, name: c.name, state: 'loading' as const })),
  )
  const [nudge, setNudge] = useState<Record<string, NudgeState>>({})
  // [PAKKET-VERS] Per klant: wanneer dit kwartaalpakket voor het laatst is opgehaald en of er
  // sindsdien iets in het kwartaal is bijgekomen. Alleen aanwezig voor klanten waarvan deze
  // boekhouder het pakket al eens ophaalde — voor de rest is er geen kopie die oud kan zijn.
  const [vers, setVers] = useState<Record<string, { downloadedAt: string; total: number; sentence: string; unknown?: boolean }>>({})

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

  // [PAKKET-VERS] Eén vraag voor het hele bord: welke pakketten van dit kwartaal heb ik al
  // opgehaald, en is de administratie sindsdien veranderd? Mislukt de vraag, dan verdwijnen de
  // regels gewoon — een bord zonder versheidsregel zegt niets, en dat is eerlijker dan een
  // verzonnen "nog vers".
  useEffect(() => {
    let cancelled = false
    void (async () => {
      // Reset in dezelfde tick, maar buiten de effect-body zelf — zelfde idioom als de
      // readiness-effect hieronder, om dezelfde lint-reden.
      setVers({})
      try {
        const res = await fetch(`/api/closing-package/vers?year=${year}&quarter=${quarter}`)
        if (!res.ok || cancelled) return
        const json = await res.json()
        if (!cancelled && json?.perClient) setVers(json.perClient)
      } catch { /* geen regel is eerlijker dan een verzonnen regel */ }
    })()
    return () => { cancelled = true }
  }, [year, quarter])

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
              {t('bh.werk.hero.btwAangifte', { kwartaal: quarterLabel })}
            </p>
            <p style={{ fontSize: 28, fontWeight: 700, color: heroColor, margin: '0 0 4px', lineHeight: 1.1 }}>
              {countdownLabel(t, days)}
            </p>
            <p style={{ fontSize: 13, color: '#5F6368', margin: 0 }}>{t('bh.werk.hero.uiterlijk', { datum: formatDutchDate(deadline) })}</p>
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
            <button onClick={() => setYear(y => Math.max(2000, y - 1))} title={t('bh.werk.jaar.vorig')} style={{ width: 28, height: 28, borderRadius: 8, border: 'none', background: 'none', cursor: 'pointer', color: '#1A73E8' }}>
              <span className="material-symbols-outlined icon-dir" style={{ fontSize: 20 }} aria-hidden>chevron_left</span>
            </button>
            <span style={{ fontSize: 14, fontWeight: 700, color: '#202124', minWidth: 40, textAlign: 'center' }}>{year}</span>
            <button onClick={() => setYear(y => Math.min(y + 1, currentYear))} disabled={year >= currentYear} title={t('bh.werk.jaar.volgend')} style={{ width: 28, height: 28, borderRadius: 8, border: 'none', background: 'none', cursor: year >= currentYear ? 'default' : 'pointer', color: year >= currentYear ? '#E0E0E0' : '#1A73E8', opacity: year >= currentYear ? 0.5 : 1 }}>
              <span className="material-symbols-outlined icon-dir" style={{ fontSize: 20 }} aria-hidden>chevron_right</span>
            </button>
          </div>
        </div>

        {/* ── Headline counts ── */}
        {clients.length > 0 && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
            {[
              { id: 'ready', n: summary.ready, label: t('bh.werk.telling.klaar'), color: summary.ready > 0 ? '#137333' : '#5F6368' },
              { id: 'almost', n: summary.almost, label: t('bh.werk.telling.bijna'), color: summary.almost > 0 ? '#7C5800' : '#5F6368' },
              { id: 'attention', n: summary.attention, label: t('bh.werk.telling.nogNiet'), color: summary.attention > 0 ? '#B3261E' : '#5F6368' },
            ].map(s => (
              <div key={s.id} style={{ backgroundColor: M3.surface, borderRadius: R.lg, boxShadow: EL1, padding: '12px 8px', textAlign: 'center' }}>
                <p style={{ fontSize: 22, fontWeight: 700, color: s.color, margin: 0 }}>{s.n}</p>
                <p style={{ fontSize: 11, color: '#5F6368', margin: '2px 0 0' }}>{s.label}</p>
              </div>
            ))}
          </div>
        )}

        {/* ── Filter ── */}
        {clients.length > 0 && (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <button onClick={() => setOnlyAction(false)} style={tabStyle(!onlyAction)}>{t('bh.werk.filter.alle')}</button>
            <button onClick={() => setOnlyAction(true)} style={tabStyle(onlyAction)}>
              {t('bh.werk.filter.actie')}{summary.actionNeeded > 0 ? ` (${summary.actionNeeded})` : ''}
            </button>
            <div style={{ position: 'relative', flex: 1, minWidth: 160 }}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#9aa0a6" strokeWidth="2" style={{ position: 'absolute', insetInlineStart: 12, top: '50%', transform: 'translateY(-50%)' }}><circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3" strokeLinecap="round" /></svg>
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t('bh.werk.zoek.placeholder')}
                aria-label={t('bh.werk.zoek.aria')}
                style={{ width: '100%', boxSizing: 'border-box', padding: '8px 30px', borderRadius: 8, border: '1px solid #E0E0E0', fontSize: 13.5, outline: 'none', color: '#202124', background: '#FFFFFF' }}
              />
              {query && (
                <button onClick={() => setQuery('')} aria-label={t('bh.werk.zoek.wissen')} className="tap-44" style={{ position: 'absolute', insetInlineEnd: 8, top: '50%', transform: 'translateY(-50%)', width: 19, height: 19, borderRadius: '50%', border: 'none', background: '#E0E0E0', color: '#5F6368', cursor: 'pointer', fontSize: 12, lineHeight: 1 }}>×</button>
              )}
            </div>
            {/* [HERTIKKEN] De machineleesbare CSV over ALLE klanten van dit kwartaal.
                Deze route (/api/export?accountant=true) was volledig afgebouwd en had nul
                aanroepers in de hele app — af, en onbereikbaar. Eén link. */}
            <a
              href={`/api/export?year=${year}&quarter=${quarter}&accountant=true`}
              style={{ fontSize: 12.5, fontWeight: 600, color: '#1A73E8', textDecoration: 'none', border: '1px solid #E0E0E0', borderRadius: 8, padding: '6px 12px', whiteSpace: 'nowrap' }}
            >
              ⬇︎ {t('bh.werk.csv')}
            </a>
          </div>
        )}

        {/* ── Client board ── */}
        <div style={{ backgroundColor: M3.surface, borderRadius: R.lg, boxShadow: EL1, overflow: 'hidden' }}>
          {clients.length === 0 ? (
            <p style={{ fontSize: 14, color: '#5F6368', padding: '32px 16px', textAlign: 'center', margin: 0 }}>{t('bh.werk.leeg.geenKlanten')}</p>
          ) : visible.length === 0 ? (
            <p style={{ fontSize: 14, color: '#5F6368', padding: '32px 16px', textAlign: 'center', margin: 0 }}>
              {query.trim()
                ? t('bh.werk.leeg.geenTreffer', { zoekterm: query.trim() })
                : t('bh.werk.leeg.allemaalKlaar')}
            </p>
          ) : (
            visible.map((row, idx) => {
              const meta = row.state === 'ok' && row.status ? STATUS_META[row.status] : null
              const statusLabel = row.state === 'ok' && row.status ? t(STATUS_LABEL_KEY[row.status]) : ''
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
                        {row.state === 'loading' && t('bh.werk.rij.controleren')}
                        {row.state === 'error' && (row.errorReason === 'unlinked'
                          ? t('bh.werk.rij.koppelingVerbroken')
                          : t('bh.werk.rij.statusOnbekend'))}
                        {row.state === 'ok' && (
                          <>
                            {t('bh.werk.rij.compleet', { score: row.score ?? '' })}
                            {(row.missingCount ?? 0) > 0 && ` · ${t('bh.werk.rij.ontbreekt', { n: row.missingCount ?? 0 })}`}
                            {(row.riskCount ?? 0) > 0 && ` · ${t('bh.werk.rij.nakijken', { n: row.riskCount ?? 0 })}`}
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
                        {t('bh.werk.herinner')}
                      </button>
                    )}
                    {nState === 'sending' && <span style={{ flexShrink: 0, fontSize: 12, color: '#5F6368' }}>{t('bh.werk.versturen')}</span>}
                    {nState === 'sent' && <span style={{ flexShrink: 0, fontSize: 12, fontWeight: 600, color: '#137333' }}>✓ {t('bh.werk.verstuurd')}</span>}
                    {nState === 'error' && (
                      <button onClick={() => setNudge(prev => ({ ...prev, [row.id]: 'confirm' }))} style={{ flexShrink: 0, fontSize: 12, fontWeight: 600, color: '#B3261E', background: 'none', border: 'none', cursor: 'pointer' }}>{t('bh.werk.mislukt')}</button>
                    )}

                    {/* Status chip */}
                    {row.state === 'loading' && <span style={{ flexShrink: 0, fontSize: 11, fontWeight: 600, color: '#5F6368', backgroundColor: '#F1F3F4', padding: '3px 8px', borderRadius: 6 }}>…</span>}
                    {row.state === 'error' && <span style={{ flexShrink: 0, fontSize: 11, fontWeight: 600, color: '#5F6368', backgroundColor: '#F1F3F4', padding: '3px 8px', borderRadius: 6 }}>—</span>}
                    {meta && <span style={{ flexShrink: 0, fontSize: 11, fontWeight: 600, color: meta.color, backgroundColor: meta.bg, padding: '3px 8px', borderRadius: 6, whiteSpace: 'nowrap' }}>{meta.dot} {statusLabel}</span>}
                  </div>

                  {/* [REDEN + PAKKET] De twee dingen waarvoor de boekhouder anders het bord
                      moest verlaten: WAT er ontbreekt, en HET BESTAND.

                      Bewust alleen bij een geladen rij, en bewust geen extra knoppenrij als
                      er niets te melden is — een bord dat altijd vol staat leest niemand. */}
                  {row.state === 'ok' && ((row.missingTitles?.length ?? 0) > 0 || row.status === 'ready' || vers[row.id]) && (
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
                        <span style={{ fontSize: 11.5, color: '#5F6368' }}>{t('bh.werk.meer', { n: (row.missingTitles?.length ?? 0) - 3 })}</span>
                      )}

                      {/* Het pakket, rechtstreeks. /api/closing-package is al dubbelpad-
                          geautoriseerd (owner óf gekoppelde boekhouder), dus dit is dezelfde
                          link die /brug al gebruikt — alleen nu zonder eerst weg te navigeren.
                          Hij kwam voor het bestand; dat hoort niet drie klikken verderop. */}
                      <a
                        href={`/api/closing-package?year=${year}&quarter=${quarter}&clientId=${encodeURIComponent(row.id)}`}
                        style={{ marginInlineStart: 'auto', flexShrink: 0, fontSize: 12, fontWeight: 600, color: '#1A73E8', textDecoration: 'none', border: '1px solid #E0E0E0', borderRadius: 6, padding: '5px 10px' }}
                      >
                        ⬇︎ {t('bh.werk.pakket')}
                      </a>
                      {/* [IB-JAAR] Het jaar van deze klant, geordend voor de IB-aangifte — dezelfde
                          dubbelpad-route; het scherm geeft clientId alleen door. */}
                      <a
                        href={`/dashboard/jaar?clientId=${encodeURIComponent(row.id)}`}
                        style={{ flexShrink: 0, fontSize: 12, fontWeight: 600, color: '#1A73E8', textDecoration: 'none', border: '1px solid #E0E0E0', borderRadius: 6, padding: '5px 10px' }}
                      >
                        {t('bh.werk.jaarKnop')}
                      </a>
                      {/* [XAF] Het jaar als XML Auditfile Financieel 3.2 — het bestand dat het
                          eigen pakket van het kantoor importeert. Zelfde dubbelpad-route. */}
                      <a
                        href={`/api/xaf?year=${year}&clientId=${encodeURIComponent(row.id)}`}
                        style={{ flexShrink: 0, fontSize: 12, fontWeight: 600, color: '#1A73E8', textDecoration: 'none', border: '1px solid #E0E0E0', borderRadius: 6, padding: '5px 10px' }}
                      >
                        ⬇︎ XAF
                      </a>

                      {/* [PAKKET-VERS] De kopie op de eigen schijf veroudert vanaf het moment van
                          downloaden, en een gedeelde map kan dat niet eens zeggen. Amber zodra er
                          iets bijkwam of we het niet konden nakijken; grijs als de kopie nog de
                          administratie is. Volle breedte onder de chips, want de zin hoort bij de
                          hele rij, niet bij de knop. */}
                      {vers[row.id] && (
                        <p style={{ flexBasis: '100%', fontSize: 11.5, margin: '2px 0 0', lineHeight: 1.5, color: (vers[row.id].total > 0 || vers[row.id].unknown) ? '#7C5800' : '#80868b' }}>
                          {vers[row.id].sentence}
                        </p>
                      )}
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
                        <button onClick={() => sendNudge(row)} style={{ fontSize: 13, fontWeight: 600, color: '#fff', backgroundColor: '#1A73E8', border: 'none', borderRadius: 8, padding: '8px 16px', cursor: 'pointer', fontFamily: "'Roboto', sans-serif" }}>{t('bh.werk.verstuurHerinnering')}</button>
                        <button onClick={() => setNudge(prev => ({ ...prev, [row.id]: 'idle' }))} style={{ fontSize: 13, fontWeight: 600, color: '#5F6368', backgroundColor: '#fff', border: '1px solid #E0E0E0', borderRadius: 8, padding: '8px 16px', cursor: 'pointer', fontFamily: "'Roboto', sans-serif" }}>{t('bh.werk.annuleren')}</button>
                      </div>
                      <p style={{ fontSize: 11, color: '#80868b', margin: 0 }}>{t('bh.werk.melding')}</p>
                    </div>
                  )}
                </div>
              )
            })
          )}
        </div>

        <p style={{ fontSize: 11, color: '#80868b', margin: '0 4px', lineHeight: 1.5 }}>
          {t('bh.werk.voetnoot')}
        </p>

      </main>
    </div>
  )
}
