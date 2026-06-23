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
export default function BrugClient({ nodes, role }: { nodes: TreeNode[]; role: string | null }) {
  const [cwd, setCwd] = useState<string[]>([])
  const [showHidden, setShowHidden] = useState(false)
  const router = useRouter()

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