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

// [BRIDGE-HUB] Per-client readiness summary (Layer 1). Mirrors the server type
// in page.tsx — kept inline to avoid a cross-file import of a server module.
interface ClientSummary {
  id: string
  label: string
  verified: number
  pending: number
  status: 'ready' | 'review' | 'empty'
}

// ─── Design tokens — Material You (BoekBrug Design System v1.0) ───────────────
const M3 = {
  primary:          '#1A73E8',
  onPrimary:        '#FFFFFF',
  primaryContainer: '#D3E3FD',
  surface:          '#FFFBFE',
  onSurface:        '#1C1B1F',
  surfaceVariant:   '#E7E0EC',
  outline:          '#79747E',
  success:          '#34A853',
  error:            '#B3261E',
  warning:          '#E37400',
}
const FONT = "'Google Sans', 'Roboto', -apple-system, sans-serif"
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
  neutral: { bg: '#E7E0EC', color: '#49454F' },
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
export default function BrugClient({ nodes, role, clientSummaries }: { nodes: TreeNode[]; role: string | null; clientSummaries?: ClientSummary[] }) {
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
  const now = new Date()
  const curYear = now.getFullYear()
  const curQuarter = Math.floor(now.getMonth() / 3) + 1

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
                href={`/api/closing-package?clientId=${selectedClient.id}&year=${curYear}&quarter=${curQuarter}`}
                style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '12px 16px', borderRadius: R.md, border: 'none', background: M3.primary, color: '#fff', fontSize: 14, fontWeight: 600, cursor: 'pointer', fontFamily: FONT, textDecoration: 'none', flexShrink: 0 }}
              >
                <span className="material-symbols-outlined" style={{ fontSize: 18 }}>inventory_2</span>
                Download kwartaal
              </a>
            )}
          </div>

          {selectedClient ? (
            <>
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
                <OverzichtPanel clientId={selectedClient.id} year={curYear} quarter={curQuarter} />
              )}

              {/* Kwartaal tab — lazy-loaded quarter numbers */}
              {hubTab === 'kwartaal' && (
                <KwartaalPanel clientId={selectedClient.id} year={curYear} quarter={curQuarter} />
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
            <FileRow key={`${file.source}-${file.id}`} node={file} />
          ))}
        </div>
      )}
      </>
      )}
    </div>
  )
}

// ─── File / invoice row ────────────────────────────────────────────────────────
function FileRow({ node }: { node: TreeNode }) {
  const icon = node.source === 'invoice' ? 'receipt_long' : 'description'

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

  if (node.pdfUrl) {
    return (
      <a href={node.pdfUrl} target="_blank" rel="noopener noreferrer" style={{ textDecoration: 'none' }}>
        {inner}
      </a>
    )
  }
  return inner
}
// ─── [BRIDGE-HUB] Layer 2 — Overzicht panel (readiness, honest status) ────────
interface PackageSummary {
  quarter: string
  outgoingCount: number
  incomingCount: number
  filesIncluded: number
  bankStatementIncluded: boolean
  warnings: { code: string; message: string }[]
  generatedAt: string
}

function OverzichtPanel({ clientId, year, quarter }: { clientId: string; year: number; quarter: number }) {
  const [data, setData] = useState<PackageSummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  useEffect(() => {
    let cancelled = false
    setLoading(true); setError(false); setData(null)
    const params = new URLSearchParams({ year: String(year), quarter: String(quarter), clientId })
    fetch(`/api/closing-package/summary?${params}`)
      .then(r => r.ok ? r.json() : Promise.reject())
      .then(j => { if (!cancelled) setData(j) })
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

  const totalInvoices = data.outgoingCount + data.incomingCount
  // Honest readiness: complete when there are verified invoices and no warnings.
  const isComplete = data.warnings.length === 0 && totalInvoices > 0

  return (
    <div style={{ fontFamily: FONT }}>
      {/* Status banner — the single most important line */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '14px 16px', borderRadius: R.lg, marginBottom: 14, background: isComplete ? '#CEEAD6' : '#FEE8C4' }}>
        <span className="material-symbols-outlined" style={{ fontSize: 24, color: isComplete ? '#137333' : '#7C5800' }}>
          {isComplete ? 'verified' : 'warning'}
        </span>
        <div>
          <div style={{ fontSize: 15, fontWeight: 700, color: isComplete ? '#137333' : '#7C5800' }}>
            {isComplete ? 'Compleet' : 'Nog niet compleet'}
          </div>
          <div style={{ fontSize: 12.5, color: isComplete ? '#137333' : '#7C5800', opacity: 0.85 }}>
            {data.quarter} · {isComplete ? 'klaar om af te sluiten' : `${data.warnings.length} ${data.warnings.length === 1 ? 'aandachtspunt' : 'aandachtspunten'}`}
          </div>
        </div>
      </div>

      {/* What's inside — real counts only */}
      <div style={{ background: '#fff', borderRadius: R.lg, boxShadow: EL1, padding: '14px 16px', marginBottom: 14 }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: M3.outline, textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 12 }}>
          Wat zit erin
        </div>
        <SummaryRow icon="receipt_long" label="Uitgaande facturen" value={String(data.outgoingCount)} />
        <SummaryRow icon="receipt" label="Inkomende facturen" value={String(data.incomingCount)} />
        <SummaryRow icon="picture_as_pdf" label="Facturen met PDF" value={`${data.filesIncluded} / ${totalInvoices}`} />
        <SummaryRow
          icon="account_balance"
          label="Bankafschrift"
          value={data.bankStatementIncluded ? 'Aanwezig' : 'Ontbreekt'}
          valueColor={data.bankStatementIncluded ? '#137333' : M3.error}
          last
        />
      </div>

      {/* Honest missing list — specific, never a fake score */}
      {data.warnings.length > 0 && (
        <div style={{ background: '#fff', borderRadius: R.lg, boxShadow: EL1, padding: '14px 16px', border: `1px solid #FEE8C4` }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: '#7C5800', textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 10 }}>
            Aandachtspunten
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {data.warnings.map((w, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 13.5, color: M3.onSurface }}>
                <span className="material-symbols-outlined" style={{ fontSize: 18, color: M3.warning, flexShrink: 0 }}>error_outline</span>
                <span>{w.message}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function SummaryRow({ icon, label, value, valueColor, last }: { icon: string; label: string; value: string; valueColor?: string; last?: boolean }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderBottom: last ? 'none' : `1px solid #F1F1F1` }}>
      <span className="material-symbols-outlined" style={{ fontSize: 20, color: M3.outline }}>{icon}</span>
      <span style={{ flex: 1, fontSize: 14, color: M3.onSurface }}>{label}</span>
      <span style={{ fontSize: 14, fontWeight: 700, color: valueColor ?? M3.onSurface }}>{value}</span>
    </div>
  )
}

// ─── [BRIDGE-HUB] Layer 2 — Kwartaal panel (lazy-loads quarter numbers) ────────
interface ZzpSummary {
  totalIn: number
  totalOut: number
  totalBtwIn: number
  totalBtwOut: number
}

function KwartaalPanel({ clientId, year, quarter }: { clientId: string; year: number; quarter: number }) {
  const [data, setData] = useState<ZzpSummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  useEffect(() => {
    let cancelled = false
    setLoading(true); setError(false); setData(null)
    const params = new URLSearchParams({ year: String(year), quarter: String(quarter), clientId })
    fetch(`/api/quarterly?${params}`)
      .then(r => r.json())
      .then(j => {
        if (cancelled) return
        // Accountant path returns a full QuarterlySummary; derive in/out from it.
        // ZZP path returns totalIn/totalOut directly. Support both shapes.
        if (j && typeof j === 'object') {
          if ('totalIn' in j) {
            setData({ totalIn: j.totalIn, totalOut: j.totalOut, totalBtwIn: j.totalBtwIn, totalBtwOut: j.totalBtwOut })
          } else if ('totalIncl' in j) {
            // QuarterlySummary: split incoming/outgoing from invoices array
            const invs = Array.isArray(j.invoices) ? j.invoices : []
            let tIn = 0, tOut = 0, bIn = 0, bOut = 0
            for (const inv of invs) {
              const inc = inv.total_inc_btw ?? 0, btw = inv.btw_amount ?? 0
              if (inv.direction === 'incoming') { tOut += inc; bOut += btw }
              else { tIn += inc; bIn += btw }
            }
            setData({ totalIn: tIn, totalOut: tOut, totalBtwIn: bIn, totalBtwOut: bOut })
          } else {
            setError(true)
          }
        } else setError(true)
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
  if (error || !data) {
    return (
      <div style={{ textAlign: 'center', padding: '32px 20px', background: '#fff', borderRadius: R.lg, boxShadow: EL1, fontFamily: FONT }}>
        <p style={{ fontSize: 14, color: M3.error, margin: 0 }}>Cijfers konden niet geladen worden</p>
      </div>
    )
  }

  return (
    <div style={{ fontFamily: FONT }}>
      <div style={{ fontSize: 13, fontWeight: 600, color: M3.outline, marginBottom: 10 }}>
        Q{quarter} {year}
      </div>
      {/* Inkomsten */}
      <div style={{ background: '#fff', borderRadius: R.lg, boxShadow: EL1, padding: '14px 16px', marginBottom: 10, border: `1px solid #CEEAD6` }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: '#137333', textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 8 }}>
          Inkomsten — geverifieerd
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <div>
            <div style={{ fontSize: 11, color: M3.outline }}>Incl. BTW</div>
            <div style={{ fontSize: 20, fontWeight: 700, color: '#137333' }}>{fmtEur(data.totalIn)}</div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 11, color: M3.outline }}>BTW</div>
            <div style={{ fontSize: 20, fontWeight: 700, color: '#137333' }}>{fmtEur(data.totalBtwIn)}</div>
          </div>
        </div>
      </div>
      {/* Uitgaven */}
      <div style={{ background: '#fff', borderRadius: R.lg, boxShadow: EL1, padding: '14px 16px', border: `1px solid #F9DEDC` }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: '#B3261E', textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 8 }}>
          Uitgaven — geverifieerd
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <div>
            <div style={{ fontSize: 11, color: M3.outline }}>Incl. BTW</div>
            <div style={{ fontSize: 20, fontWeight: 700, color: '#B3261E' }}>{fmtEur(data.totalOut)}</div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 11, color: M3.outline }}>BTW</div>
            <div style={{ fontSize: 20, fontWeight: 700, color: '#B3261E' }}>{fmtEur(data.totalBtwOut)}</div>
          </div>
        </div>
      </div>
    </div>
  )
}