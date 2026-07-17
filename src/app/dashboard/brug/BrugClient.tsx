'use client'

// src/app/dashboard/brug/BrugClient.tsx
// [BOEK-002] Bridge view — drill-down navigation (mobile-first).
// Receives the pre-built TreeNode[] from the server and renders it as a
// breadcrumb + folder/file list. No fetching, no rendering logic here —
// that all lives server-side in bridge-tree.ts.

import { useMemo, useState, useEffect } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import type { TreeNode, NodeBadge } from '@/lib/bridge-tree'
import { lastCompletedQuarter } from '@/lib/quarter'

// [BRIDGE-HUB] Per-client readiness summary (Layer 1). Mirrors the server type
// in page.tsx — kept inline to avoid a cross-file import of a server module.
interface ClientSummary {
  id: string
  label: string
  verified: number
  pending: number
  status: 'ready' | 'review' | 'empty'
}

// [READINESS-P3] Accountant-asserted per-document status, keyed by document id.
// Empty map / missing key = no status claim (honest default — never invented).
type DocStatusMap = Record<string, { status: string; vraag_text: string | null }>

// Document status → badge label + tone. 'te_verwerken' is the neutral default;
// the three action buttons drive verwerkt / in_behandeling / vraag.
const DOC_STATUS_META: Record<string, { label: string; tone: NodeBadge['tone'] }> = {
  verwerkt:       { label: 'Verwerkt',       tone: 'success' },
  in_behandeling: { label: 'In behandeling', tone: 'warning' },
  vraag:          { label: 'Vraag',          tone: 'error' },
  te_verwerken:   { label: 'Te verwerken',   tone: 'neutral' },
}

// ─── Design tokens — Material You (BoekBrug Design System v1.0) ───────────────
const M3 = {
  primary:          '#1A73E8',
  onPrimary:        '#FFFFFF',
  primaryContainer: '#D3E3FD',
  surface:          '#ffffff',
  onSurface:        '#202124',
  surfaceVariant:   '#f1f3f4',
  outline:          '#80868b',
  success:          '#34A853',
  error:            '#B3261E',
  warning:          '#E37400',
}
const FONT = "'Roboto', -apple-system, sans-serif"
const R = { sm: 8, md: 12, lg: 16, full: 9999 }
const EL1 = '0 1px 2px rgba(0,0,0,0.08)'

const NL_EUR = new Intl.NumberFormat('nl-NL', { style: 'currency', currency: 'EUR' })
const NL_DATE = new Intl.DateTimeFormat('nl-NL', { day: 'numeric', month: 'short', year: 'numeric' })
const fmtEur = (n: number | null) => (n == null ? '' : NL_EUR.format(n))
const fmtDate = (s: string | null) => (s ? NL_DATE.format(new Date(s)) : '')

// Badge tone → colors
const TONE: Record<NodeBadge['tone'], { bg: string; color: string }> = {
  success: { bg: '#CEEAD6', color: '#137333' },
  warning: { bg: '#FEE8C4', color: '#7C5800' },
  error:   { bg: '#F9DEDC', color: '#B3261E' },
  info:    { bg: '#D3E3FD', color: '#1967D2' },
  neutral: { bg: '#f1f3f4', color: '#5f6368' },
}

// [BRIDGE-POLISH 3a-1] Direction marker — reuses existing TONE swatches so no
// new palette is introduced. Uitg. (outgoing) = success green; Ink. (incoming)
// = error red — matching the colour language used elsewhere in the bridge.
const DIRECTION_MARK: Record<'outgoing' | 'incoming', { label: string; tone: NodeBadge['tone'] }> = {
  outgoing: { label: 'Uitg.', tone: 'success' },
  incoming: { label: 'Ink.',  tone: 'error' },
}

// ─── Level view: from flat nodes + current path → subfolders + files here ─────
interface LevelView {
  folders: { name: string; count: number }[]
  files: TreeNode[]
}

function computeLevel(nodes: TreeNode[], cwd: string[], showHidden: boolean): LevelView {
  const folderCounts = new Map<string, number>()
  const files: TreeNode[] = []

  for (const n of nodes) {
    if (n.hidden && !showHidden) continue
    if (n.path.length < cwd.length) continue
    let underCwd = true
    for (let i = 0; i < cwd.length; i++) {
      if (n.path[i] !== cwd[i]) { underCwd = false; break }
    }
    if (!underCwd) continue

    const rest = n.path.slice(cwd.length)
    if (rest.length === 0) {
      files.push(n)
    } else {
      const sub = rest[0]
      folderCounts.set(sub, (folderCounts.get(sub) ?? 0) + 1)
    }
  }

  const folders = [...folderCounts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => a.name.localeCompare(b.name, 'nl'))

  files.sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''))
  return { folders, files }
}

// Whether any hidden (e.g. archived) node exists at all → show the toggle.
function hasHidden(nodes: TreeNode[]): boolean {
  return nodes.some(n => n.hidden)
}

// ─── Component ────────────────────────────────────────────────────────────────
export default function BrugClient({ nodes, role, clientSummaries, docStatus }: { nodes: TreeNode[]; role: string | null; clientSummaries?: ClientSummary[]; docStatus: DocStatusMap }) {
  const [cwd, setCwd] = useState<string[]>([])
  const [showHidden, setShowHidden] = useState(false)
  const router = useRouter()

  // [BRIDGE-HUB] Layer 2 — accountant control center: pick a client (dropdown),
  // then switch tabs (Kwartaal / Documenten). The classic folder tree is reused
  // for the Documenten tab, scoped to the selected client.
  const isAccountant = role === 'accountant'
  const [selectedClientId, setSelectedClientId] = useState<string>('')
  const [hubTab, setHubTab] = useState<'overzicht' | 'kwartaal' | 'documenten'>('overzicht')
  const selectedClient = useMemo(
    () => clientSummaries?.find(c => c.id === selectedClientId) ?? null,
    [clientSummaries, selectedClientId]
  )
  const curYear = new Date().getFullYear()

  // [BRIDGE-QUARTER-PICKER] The accountant works per quarter/year and can switch both
  // (Q1–Q4 buttons + year arrows). The default lands on the LAST COMPLETED quarter — the
  // one whose BTW is due — via the SHARED quarter.ts helper (UTC), so the accountant hub
  // opens on the SAME quarter the owner's klaar/resultaat/aangifte default to (previously
  // this was a duplicated local-time computation that could drift a day at a boundary).
  const lastCompleted = lastCompletedQuarter()
  const [selectedYear, setSelectedYear] = useState<number>(lastCompleted.year)
  const [selectedQuarter, setSelectedQuarter] = useState<number>(lastCompleted.quarter)

  // [BRIDGE-REFRESH] Re-fetch when the tab regains focus. The page is
  // force-dynamic server-side, but tab/folder navigation here is client-side
  // state (cwd) — it never re-runs the server fetch. So when the accountant
  // processed an invoice / the client marked one paid in ANOTHER tab and comes
  // back, router.refresh() re-runs the server component and the fresh nodes
  // flow in as a prop. No manual reload needed. (Layer 1 — full Realtime for
  // the bridge comes later with the interactive hub.)
  useEffect(() => {
    const onFocus = () => {
      if (document.visibilityState === 'visible') router.refresh()
    }
    window.addEventListener('visibilitychange', onFocus)
    window.addEventListener('focus', onFocus)
    return () => {
      window.removeEventListener('visibilitychange', onFocus)
      window.removeEventListener('focus', onFocus)
    }
  }, [router])

  const level = useMemo(() => computeLevel(nodes, cwd, showHidden), [nodes, cwd, showHidden])
  const showToggle = useMemo(() => hasHidden(nodes), [nodes])
  const homeHref = role === 'accountant' ? '/dashboard/accountant' : '/dashboard'

  const isEmpty = level.folders.length === 0 && level.files.length === 0

  // [BRIDGE-HUB] When the accountant picks a client and opens the Documenten
  // tab, scope the tree to that client by seeding cwd to ['Klanten', label].
  // Selecting a different client resets the dive.
  useEffect(() => {
    if (isAccountant && selectedClient && hubTab === 'documenten') {
      setCwd(prev => {
        const root = ['Klanten', selectedClient.label]
        // already inside this client → keep the deeper position
        if (prev[0] === 'Klanten' && prev[1] === selectedClient.label) return prev
        return root
      })
    }
  }, [isAccountant, selectedClient, hubTab])

  return (
    <div style={{ maxWidth: 720, margin: '0 auto', padding: '16px 16px 80px', fontFamily: FONT }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: M3.onSurface, margin: 0, letterSpacing: -0.3 }}>
          Brug
        </h1>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {/* [BRIDGE-REFRESH] expliciete vernieuw-knop — naast de automatische focus-refresh */}
          <button
            onClick={() => router.refresh()}
            title="Vernieuwen"
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: M3.primary, display: 'flex', alignItems: 'center', gap: 4, fontSize: 13, fontWeight: 600, fontFamily: FONT, padding: '4px 6px', borderRadius: R.sm }}
          >
            <span className="material-symbols-outlined" style={{ fontSize: 18 }}>refresh</span>
            Vernieuwen
          </button>
          <Link
            href={homeHref}
            style={{ fontSize: 13, fontWeight: 600, color: M3.primary, textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 4 }}
          >
            <span className="material-symbols-outlined" style={{ fontSize: 18 }}>home</span>
            Home
          </Link>
        </div>
      </div>

      {/* [BRIDGE-HUB] Layer 2 — accountant control center: client dropdown +
          persistent Pakket action + tabs. ZZP keeps the classic tree below. */}
      {isAccountant && clientSummaries && clientSummaries.length > 0 && (
        <div style={{ marginBottom: 20 }}>
          {/* Client picker + Pakket */}
          <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
            <div style={{ flex: 1, position: 'relative' }}>
              <select
                value={selectedClientId}
                onChange={e => { setSelectedClientId(e.target.value); setHubTab('overzicht') }}
                style={{ width: '100%', appearance: 'none', padding: '12px 40px 12px 14px', borderRadius: R.md, border: `1px solid ${M3.outline}`, background: '#fff', fontSize: 15, fontWeight: 600, color: M3.onSurface, fontFamily: FONT, cursor: 'pointer' }}
              >
                <option value="">— Kies een klant —</option>
                {clientSummaries.map(c => (
                  <option key={c.id} value={c.id}>{c.label}</option>
                ))}
              </select>
              <span className="material-symbols-outlined" style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none', color: M3.outline, fontSize: 22 }}>expand_more</span>
            </div>
            {selectedClient && (
              <a
                href={`/api/closing-package?clientId=${selectedClient.id}&year=${selectedYear}&quarter=${selectedQuarter}`}
                style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '12px 16px', borderRadius: R.md, border: 'none', background: M3.primary, color: '#fff', fontSize: 14, fontWeight: 600, cursor: 'pointer', fontFamily: FONT, textDecoration: 'none', flexShrink: 0 }}
              >
                <span className="material-symbols-outlined" style={{ fontSize: 18 }}>inventory_2</span>
                Download kwartaal
              </a>
            )}
          </div>

          {selectedClient ? (
            <>
              {/* [BRIDGE-QUARTER-PICKER] Quarter selector (Q1–Q4) + year arrows.
                  Shows all four quarters so an empty current quarter never hides
                  a full earlier one. Defaults to the last completed quarter. */}
              <div style={{ display: 'flex', gap: 6, marginBottom: 16 }}>
                {[1, 2, 3, 4].map(q => {
                  const active = selectedQuarter === q
                  return (
                    <button
                      key={q}
                      onClick={() => setSelectedQuarter(q)}
                      style={{
                        flex: 1, padding: '10px 0', borderRadius: R.md, cursor: 'pointer',
                        fontFamily: FONT, fontSize: 14, fontWeight: 600,
                        border: `1px solid ${active ? M3.primary : M3.outline}`,
                        background: active ? M3.primary : '#fff',
                        color: active ? M3.onPrimary : M3.onSurface,
                        transition: 'background 0.15s, border-color 0.15s',
                      }}
                    >
                      Q{q}
                    </button>
                  )
                })}
                <div style={{ display: 'flex', alignItems: 'center', gap: 2, paddingLeft: 8 }}>
                  <button
                    onClick={() => setSelectedYear(y => Math.max(2000, y - 1))}
                    title="Vorig jaar"
                    style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 28, height: 28, borderRadius: R.sm, border: 'none', background: 'none', cursor: 'pointer', color: M3.primary }}
                  >
                    <span className="material-symbols-outlined" style={{ fontSize: 20 }}>chevron_left</span>
                  </button>
                  <span style={{ fontSize: 14, fontWeight: 700, color: M3.onSurface, minWidth: 40, textAlign: 'center' }}>
                    {selectedYear}
                  </span>
                  <button
                    onClick={() => setSelectedYear(y => Math.min(y + 1, curYear))}
                    disabled={selectedYear >= curYear}
                    title="Volgend jaar"
                    style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 28, height: 28, borderRadius: R.sm, border: 'none', background: 'none', cursor: selectedYear >= curYear ? 'default' : 'pointer', color: selectedYear >= curYear ? M3.outline : M3.primary, opacity: selectedYear >= curYear ? 0.4 : 1 }}
                  >
                    <span className="material-symbols-outlined" style={{ fontSize: 20 }}>chevron_right</span>
                  </button>
                </div>
              </div>

              {/* Tabs */}
              <div style={{ display: 'flex', gap: 6, marginBottom: 16, borderBottom: `1px solid ${M3.surfaceVariant}` }}>
                {([['overzicht', 'Overzicht', 'fact_check'], ['kwartaal', 'Kwartaal', 'bar_chart'], ['documenten', 'Documenten', 'folder']] as const).map(([key, label, icon]) => (
                  <button
                    key={key}
                    onClick={() => setHubTab(key)}
                    style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '10px 16px', border: 'none', background: 'none', cursor: 'pointer', fontFamily: FONT, fontSize: 14, fontWeight: 600, color: hubTab === key ? M3.primary : M3.outline, borderBottom: `2px solid ${hubTab === key ? M3.primary : 'transparent'}`, marginBottom: -1 }}
                  >
                    <span className="material-symbols-outlined" style={{ fontSize: 18 }}>{icon}</span>
                    {label}
                  </button>
                ))}
              </div>

              {/* Overzicht tab — readiness status + honest missing list */}
              {hubTab === 'overzicht' && (
                <OverzichtPanel clientId={selectedClient.id} year={selectedYear} quarter={selectedQuarter} />
              )}

              {/* Kwartaal tab — lazy-loaded quarter numbers */}
              {hubTab === 'kwartaal' && (
                <KwartaalPanel clientId={selectedClient.id} year={selectedYear} quarter={selectedQuarter} />
              )}
            </>
          ) : (
            <div style={{ textAlign: 'center', padding: '40px 20px', background: '#fff', borderRadius: R.lg, boxShadow: EL1 }}>
              <span className="material-symbols-outlined" style={{ fontSize: 40, color: '#C4C7C5', display: 'block', marginBottom: 8 }}>groups</span>
              <p style={{ fontSize: 14, fontWeight: 600, color: M3.onSurface, margin: 0 }}>Kies een klant om te beginnen</p>
              <p style={{ fontSize: 12.5, color: M3.outline, margin: '4px 0 0' }}>{clientSummaries.length} klanten gekoppeld</p>
            </div>
          )}
        </div>
      )}

      {/* Document tree — for ZZP always; for accountant only inside Documenten tab */}
      {(!isAccountant || (selectedClient && hubTab === 'documenten')) && (
      <>
      {/* Breadcrumb */}
      <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 4, marginBottom: 12, fontSize: 14 }}>
        <button
          onClick={() => setCwd([])}
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: cwd.length === 0 ? M3.onSurface : M3.primary, fontWeight: cwd.length === 0 ? 700 : 600, fontFamily: FONT, padding: '4px 6px', borderRadius: R.sm }}
        >
          Alles
        </button>
        {cwd.map((seg, i) => (
          <span key={i} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <span className="material-symbols-outlined" style={{ fontSize: 16, color: M3.outline }}>chevron_right</span>
            <button
              onClick={() => setCwd(cwd.slice(0, i + 1))}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: i === cwd.length - 1 ? M3.onSurface : M3.primary, fontWeight: i === cwd.length - 1 ? 700 : 600, fontFamily: FONT, padding: '4px 6px', borderRadius: R.sm }}
            >
              {seg}
            </button>
          </span>
        ))}
      </div>

      {/* Archief toggle (only if hidden nodes exist) */}
      {showToggle && (
        <button
          onClick={() => setShowHidden(v => !v)}
          style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 12, padding: '6px 12px', borderRadius: R.full, border: `1px solid ${M3.outline}`, background: showHidden ? M3.primaryContainer : 'transparent', color: showHidden ? '#041E49' : M3.outline, fontSize: 12.5, fontWeight: 600, cursor: 'pointer', fontFamily: FONT }}
        >
          <span className="material-symbols-outlined" style={{ fontSize: 16 }}>
            {showHidden ? 'visibility' : 'visibility_off'}
          </span>
          Toon archief
        </button>
      )}

      {/* Empty state */}
      {isEmpty && (
        <div style={{ textAlign: 'center', padding: '56px 20px', background: '#fff', borderRadius: R.lg, boxShadow: EL1 }}>
          <span className="material-symbols-outlined" style={{ fontSize: 44, color: '#C4C7C5', display: 'block', marginBottom: 10 }}>folder_open</span>
          <p style={{ fontSize: 15, fontWeight: 600, color: M3.onSurface, margin: 0 }}>Niets hier</p>
        </div>
      )}

      {/* Folders */}
      {level.folders.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: level.files.length > 0 ? 16 : 0 }}>
          {level.folders.map(f => (
            <button
              key={f.name}
              onClick={() => setCwd([...cwd, f.name])}
              style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 16px', borderRadius: R.lg, border: 'none', background: '#fff', boxShadow: EL1, cursor: 'pointer', fontFamily: FONT, textAlign: 'left', width: '100%' }}
            >
              <span className="material-symbols-outlined" style={{ fontSize: 24, color: M3.primary }}>folder</span>
              <span style={{ flex: 1, fontSize: 15, fontWeight: 600, color: M3.onSurface }}>{f.name}</span>
              <span style={{ fontSize: 12, color: M3.outline, fontWeight: 600 }}>{f.count}</span>
              <span className="material-symbols-outlined" style={{ fontSize: 20, color: M3.outline }}>chevron_right</span>
            </button>
          ))}
        </div>
      )}

      {/* Files at this level */}
      {level.files.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {level.files.map(file => (
            <FileRow key={`${file.source}-${file.id}`} node={file} isClient={!isAccountant} docStatus={docStatus} />
          ))}
        </div>
      )}
      </>
      )}
    </div>
  )
}

// ─── File / invoice row ────────────────────────────────────────────────────────
function FileRow({ node, isClient, docStatus }: { node: TreeNode; isClient: boolean; docStatus: DocStatusMap }) {
  const icon = node.source === 'invoice' ? 'receipt_long' : 'description'

  // [READINESS-P3] Document processing status (accountant assertion). Only meaningful
  // for document nodes; invoices carry their own badges from bridge-tree. Local state
  // so an accountant's click reflects immediately without a full reload. Honest
  // default: a document with no row is `null` → no status badge is ever shown.
  const isDoc = node.source === 'document'
  const [status, setStatus] = useState<string | null>(
    isDoc ? (docStatus[node.id]?.status ?? null) : null
  )
  const [busy, setBusy] = useState(false)

  async function applyStatus(next: 'verwerkt' | 'in_behandeling' | 'vraag') {
    let vraagText: string | undefined
    if (next === 'vraag') {
      const answer = window.prompt('Vraag over dit document (optioneel):')
      if (answer === null) return // cancelled — assert nothing
      vraagText = answer.trim() || undefined
    }
    setBusy(true)
    try {
      const res = await fetch('/api/accountant/subject-status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subjectId: node.id, status: next, vraagText }),
      })
      if (res.ok) setStatus(next)
    } catch {
      // leave the previous (truthful) status in place on failure
    } finally {
      setBusy(false)
    }
  }

  const statusMeta = isDoc && status ? DOC_STATUS_META[status] : undefined

  const inner = (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 16px', borderRadius: R.lg, background: '#fff', boxShadow: EL1, width: '100%' }}>
      <span className="material-symbols-outlined" style={{ fontSize: 22, color: node.source === 'invoice' ? M3.success : M3.outline }}>{icon}</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          {/* [BRIDGE-POLISH 3a-1] direction marker (invoices only) */}
          {node.direction && (
            <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: R.full, background: TONE[DIRECTION_MARK[node.direction].tone].bg, color: TONE[DIRECTION_MARK[node.direction].tone].color }}>
              {DIRECTION_MARK[node.direction].label}
            </span>
          )}
          <span style={{ fontSize: 14.5, fontWeight: 600, color: M3.onSurface, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {node.displayName}
          </span>
          {node.badges.map((b, i) => (
            <span key={i} style={{ fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: R.full, background: TONE[b.tone].bg, color: TONE[b.tone].color }}>
              {b.label}
            </span>
          ))}
          {/* [READINESS-P3] Document status badge — read-only claim, shown to both
              accountant and client. Only rendered when a status row exists. */}
          {statusMeta && (
            <span style={{ fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: R.full, background: TONE[statusMeta.tone].bg, color: TONE[statusMeta.tone].color }}>
              {statusMeta.label}
            </span>
          )}
        </div>
        {/* [BRIDGE-POLISH 3a-1] counterparty name (invoices only) */}
        {node.partyName && (
          <div style={{ fontSize: 12.5, color: M3.onSurface, marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {node.partyName}
          </div>
        )}
        {(node.date || node.amount != null) && (
          <div style={{ fontSize: 12, color: M3.outline, marginTop: 2, display: 'flex', gap: 10 }}>
            {node.date && <span>{fmtDate(node.date)}</span>}
            {node.amount != null && <span style={{ fontWeight: 600 }}>{fmtEur(node.amount)}</span>}
          </div>
        )}
      </div>
      {node.pdfUrl && (
        <span className="material-symbols-outlined" style={{ fontSize: 20, color: M3.primary }}>open_in_new</span>
      )}
    </div>
  )

  // [BRIDGE-OPEN-LOCATION] For the owner (not the accountant), when this node has a
  // real file in "Mijn bestanden", offer a button that opens that file's folder and
  // highlights it. Uses the existing ?folder= & ?focus= handling in BestandenPage.
  const locationBtn =
    isClient && node.hasLocation && node.docId ? (
      <a
        href={
          node.folderId
            ? `/dashboard/bestanden?folder=${node.folderId}&focus=${node.docId}`
            : `/dashboard/bestanden?focus=${node.docId}`
        }
        title="Open in Mijn bestanden"
        aria-label="Open in Mijn bestanden"
        onClick={e => e.stopPropagation()}
        style={{
          flexShrink: 0, width: 40, height: 40, borderRadius: R.full,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: M3.surfaceVariant ?? '#E7E8EC', textDecoration: 'none',
        }}
      >
        <span className="material-symbols-outlined" style={{ fontSize: 20, color: M3.primary }}>
          folder_open
        </span>
      </a>
    ) : null

  const openable =
    node.pdfUrl ? (
      <a href={node.pdfUrl} target="_blank" rel="noopener noreferrer" style={{ textDecoration: 'none', flex: 1, minWidth: 0 }}>
        {inner}
      </a>
    ) : (
      <div style={{ flex: 1, minWidth: 0 }}>{inner}</div>
    )

  // Both actions have their own hit area; the location button never triggers the PDF.
  const row = locationBtn ? (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%' }}>
      {openable}
      {locationBtn}
    </div>
  ) : (
    openable
  )

  // [READINESS-P3] Accountant-only document actions. The buttons live OUTSIDE the
  // openable anchor so clicking one never opens the PDF. Clients (isClient) get the
  // read-only badge above but no buttons — they cannot assert a status.
  if (!isClient && isDoc) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, width: '100%' }}>
        {row}
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', paddingLeft: 4 }}>
          {([['verwerkt', 'Verwerkt'], ['in_behandeling', 'In behandeling'], ['vraag', 'Vraag']] as const).map(([key, label]) => {
            const active = status === key
            const meta = DOC_STATUS_META[key]
            return (
              <button
                key={key}
                onClick={() => applyStatus(key)}
                disabled={busy}
                style={{
                  fontSize: 11, fontWeight: 600, padding: '4px 10px', borderRadius: R.full,
                  border: `1px solid ${active ? TONE[meta.tone].color : M3.outline}`,
                  background: active ? TONE[meta.tone].bg : '#fff',
                  color: active ? TONE[meta.tone].color : M3.outline,
                  cursor: busy ? 'default' : 'pointer', fontFamily: FONT, opacity: busy ? 0.6 : 1,
                }}
              >
                {label}
              </button>
            )
          })}
        </div>
      </div>
    )
  }

  return row
}
// ─── [BRIDGE-HUB] Layer 2 — Overzicht panel (the per-client readiness verdict) ────
// [ACCOUNTANT-TRUTH] Uses the SAME strict readiness engine the owner sees
// (/api/readiness?clientId): a weighted score, what's still missing, and the
// reconciliation differences to eyeball — not the old binary warnings view. The
// accountant now opens on the exact verdict the store owner reads.
type ReadinessStatus = 'ready' | 'almost' | 'attention'
interface ReadinessReport {
  quarterLabel: string
  score: number
  status: ReadinessStatus
  missing: { title: string; detail?: string }[]
  risks: { title: string; detail?: string }[]
}
interface ReadinessResponse {
  report: ReadinessReport
  concept: { verschuldigd: number; voorbelasting: number; saldo: number }
}
const READINESS_STATUS: Record<ReadinessStatus, { emoji: string; title: string; bg: string; fg: string }> = {
  ready:     { emoji: '🟢', title: 'Klaar voor verwerking', bg: '#CEEAD6', fg: '#137333' },
  almost:    { emoji: '🟡', title: 'Bijna klaar',            bg: '#FEE8C4', fg: '#7C5800' },
  attention: { emoji: '🔴', title: 'Nog niet klaar',         bg: '#F9DEDC', fg: '#B3261E' },
}

function OverzichtPanel({ clientId, year, quarter }: { clientId: string; year: number; quarter: number }) {
  const [data, setData] = useState<ReadinessResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  useEffect(() => {
    let cancelled = false
    setLoading(true); setError(false); setData(null)
    const params = new URLSearchParams({ year: String(year), quarter: String(quarter), clientId })
    fetch(`/api/readiness?${params}`)
      .then(r => (r.ok ? r.json() : Promise.reject()))
      .then(j => { if (!cancelled) (j?.report ? setData(j) : setError(true)) })
      .catch(() => { if (!cancelled) setError(true) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [clientId, year, quarter])

  if (loading) {
    return <div style={{ textAlign: 'center', padding: '40px 20px', color: M3.outline, fontFamily: FONT, fontSize: 14 }}>Overzicht laden…</div>
  }
  if (error || !data) {
    return (
      <div style={{ textAlign: 'center', padding: '32px 20px', background: '#fff', borderRadius: R.lg, boxShadow: EL1, fontFamily: FONT }}>
        <p style={{ fontSize: 14, color: M3.error, margin: 0 }}>Overzicht kon niet geladen worden</p>
      </div>
    )
  }

  const rep = data.report
  const meta = READINESS_STATUS[rep.status]
  const teBetalen = data.concept.saldo >= 0

  const itemList = (title: string, color: string, items: { title: string; detail?: string }[]) => (
    <div style={{ background: '#fff', borderRadius: R.lg, boxShadow: EL1, padding: '14px 16px', marginBottom: 12 }}>
      <div style={{ fontSize: 12, fontWeight: 700, color, textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 10 }}>{title}</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {items.map((it, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
            <span className="material-symbols-outlined" style={{ fontSize: 18, color, flexShrink: 0, marginTop: 1 }}>error_outline</span>
            <div>
              <div style={{ fontSize: 13.5, fontWeight: 600, color: M3.onSurface }}>{it.title}</div>
              {it.detail && <div style={{ fontSize: 12, color: M3.outline, marginTop: 2, lineHeight: 1.5 }}>{it.detail}</div>}
            </div>
          </div>
        ))}
      </div>
    </div>
  )

  return (
    <div style={{ fontFamily: FONT }}>
      {/* Verdict — the strict, turnover-aware readiness (same as the owner sees) */}
      <div style={{ background: meta.bg, borderRadius: R.lg, padding: '16px', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 12 }}>
        <span style={{ fontSize: 26, lineHeight: 1 }}>{meta.emoji}</span>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: meta.fg }}>{meta.title}</div>
          <div style={{ fontSize: 12.5, color: meta.fg, opacity: 0.85 }}>{rep.quarterLabel}</div>
        </div>
        <div style={{ fontSize: 24, fontWeight: 800, color: meta.fg }}>{rep.score}%</div>
      </div>

      {rep.missing.length > 0 && itemList('Wat moet er nog gebeuren', '#7C5800', rep.missing)}
      {rep.risks.length > 0 && itemList('Even controleren', M3.error, rep.risks)}
      {rep.missing.length === 0 && rep.risks.length === 0 && (
        <div style={{ background: '#CEEAD6', color: '#137333', borderRadius: R.lg, padding: '12px 16px', marginBottom: 12, fontSize: 13.5, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 8 }}>
          <span className="material-symbols-outlined" style={{ fontSize: 20 }}>task_alt</span>
          Niets openstaand — alles sluit aan.
        </div>
      )}

      {/* Concept BTW saldo — the number to file */}
      <div style={{ background: '#fff', borderRadius: R.lg, boxShadow: EL1, padding: '12px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <span style={{ fontSize: 13.5, fontWeight: 600, color: M3.onSurface }}>
          {teBetalen ? 'Concept BTW te betalen' : 'Concept BTW terug te ontvangen'}
        </span>
        <span style={{ fontSize: 18, fontWeight: 700, color: teBetalen ? M3.onSurface : '#137333' }}>{fmtEur(Math.abs(data.concept.saldo))}</span>
      </div>
    </div>
  )
}

// ─── [BRIDGE-HUB] Layer 2 — Kwartaal panel: the TURNOVER-AWARE result ──────────
// [ACCOUNTANT-TRUTH] Was invoice-only (/api/quarterly) — for a retail client that
// OMITTED almost all revenue (till turnover isn't an invoice), so the accountant saw a
// near-zero income while the ZIP beside it held the correct figure. Now it uses the same
// cross-channel engine the owner sees (/api/result?clientId): omzet/kosten/resultaat +
// concept BTW (5a/5b/5g) from invoices + bank + kas + dagomzet, de-duplicated. The number
// the accountant reads now matches the ZIP and the owner's readiness screen.
interface QuarterResult { omzet: number; kosten: number; resultaat: number; cashOmzetZonderBtw: number }
interface ConceptBtw { verschuldigd: number; voorbelasting: number; saldo: number }

function KwartaalPanel({ clientId, year, quarter }: { clientId: string; year: number; quarter: number }) {
  const [pnl, setPnl] = useState<QuarterResult | null>(null)
  const [concept, setConcept] = useState<ConceptBtw | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  useEffect(() => {
    let cancelled = false
    setLoading(true); setError(false); setPnl(null); setConcept(null)
    const params = new URLSearchParams({ year: String(year), quarter: String(quarter), clientId })
    // P&L (omzet/kosten/resultaat, cents-accurate) from /api/result; the concept BTW
    // (5a/5b/5g, WHOLE-EURO per the Belastingdienst form) from /api/aangifte — so the
    // Kwartaal tab's "5g" equals the Overzicht verdict, the owner's screens and the ZIP,
    // instead of the raw cents scalar it used to (wrongly) label "5a/5b/5g".
    Promise.all([
      fetch(`/api/result?${params}`).then(r => (r.ok ? r.json() : Promise.reject())),
      fetch(`/api/aangifte?${params}`).then(r => (r.ok ? r.json() : Promise.reject())),
    ])
      .then(([rj, aj]) => {
        if (cancelled) return
        if (rj?.result && aj?.aangifte) { setPnl(rj.result); setConcept(aj.aangifte) }
        else setError(true)
      })
      .catch(() => { if (!cancelled) setError(true) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [clientId, year, quarter])

  if (loading) {
    return (
      <div style={{ textAlign: 'center', padding: '40px 20px', color: M3.outline, fontFamily: FONT, fontSize: 14 }}>
        Cijfers laden…
      </div>
    )
  }
  if (error || !pnl || !concept) {
    return (
      <div style={{ textAlign: 'center', padding: '32px 20px', background: '#fff', borderRadius: R.lg, boxShadow: EL1, fontFamily: FONT }}>
        <p style={{ fontSize: 14, color: M3.error, margin: 0 }}>Cijfers konden niet geladen worden</p>
      </div>
    )
  }

  const teBetalen = concept.saldo >= 0
  const line = (label: string, value: string, opts: { color?: string; strong?: boolean; top?: boolean } = {}) => (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', padding: '7px 0', borderTop: opts.top ? '1px solid #eef1f4' : 'none', marginTop: opts.top ? 4 : 0 }}>
      <span style={{ fontSize: opts.strong ? 14.5 : 13.5, fontWeight: opts.strong ? 700 : 500, color: opts.color ?? M3.onSurface }}>{label}</span>
      <span style={{ fontSize: opts.strong ? 18 : 15, fontWeight: opts.strong ? 700 : 600, color: opts.color ?? M3.onSurface }}>{value}</span>
    </div>
  )

  return (
    <div style={{ fontFamily: FONT }}>
      <div style={{ fontSize: 12.5, fontWeight: 600, color: M3.outline, marginBottom: 10 }}>
        Q{quarter} {year} · alle kanalen (kassa, bank, kas, facturen)
      </div>

      {/* Resultaat — cross-channel P&L (cents-accurate) */}
      <div style={{ background: '#fff', borderRadius: R.lg, boxShadow: EL1, padding: '10px 16px', marginBottom: 10 }}>
        {line('Omzet (excl. BTW)', fmtEur(pnl.omzet), { color: '#137333' })}
        {line('Kosten (excl. BTW)', fmtEur(pnl.kosten), { color: '#B3261E' })}
        {line('Resultaat', fmtEur(pnl.resultaat), { strong: true, top: true })}
      </div>

      {/* Concept BTW — whole-euro, matches het formulier, de ZIP en het Overzicht */}
      <div style={{ background: '#fff', borderRadius: R.lg, boxShadow: EL1, padding: '10px 16px' }}>
        {line('BTW verschuldigd (5a)', fmtEur(concept.verschuldigd))}
        {line('Voorbelasting (5b)', `− ${fmtEur(concept.voorbelasting)}`)}
        {line(
          teBetalen ? 'Concept te betalen (5g)' : 'Concept terug te ontvangen (5g)',
          fmtEur(Math.abs(concept.saldo)),
          { strong: true, top: true, color: teBetalen ? M3.onSurface : '#137333' },
        )}
      </div>

      {pnl.cashOmzetZonderBtw > 0 && (
        <div style={{ marginTop: 10, padding: '10px 12px', borderRadius: R.md, background: '#FEE8C4', color: '#7C5800', fontSize: 12.5, lineHeight: 1.5 }}>
          {fmtEur(pnl.cashOmzetZonderBtw)} omzet (contant of via de bank) heeft nog geen BTW-tarief — die BTW zit niet in 5a.
        </div>
      )}
    </div>
  )
}