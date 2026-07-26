// src/modules/accountant/readiness-board.ts
// [KLAAR-OVERZICHT] Pure helpers for the accountant's cross-client readiness board.
// No DB, no React — the board component fetches each client's rich readiness from
// /api/readiness (the single source of truth, same endpoint the owner's screen uses)
// and these functions aggregate the results. Kept pure so they are testable in node.

export type BoardStatus = 'ready' | 'almost' | 'attention'

/** One client's slot on the board — progressively filled as its fetch resolves. */
export interface BoardRow {
  id: string
  name: string
  state: 'loading' | 'ok' | 'error'
  score?: number          // 0..100 (present when state === 'ok')
  status?: BoardStatus    // readiness verdict (present when state === 'ok')
  missingCount?: number   // gaps to fix
  riskCount?: number      // reconciliation signals to eyeball
}

export interface BoardSummary {
  total: number
  loading: number
  error: number
  ready: number
  almost: number
  attention: number
  /** Clients still needing work: loaded rows that are not 'ready'. */
  actionNeeded: number
}

/** Headline counts for the board — every row lands in exactly one bucket. */
export function summarizeBoard(rows: BoardRow[]): BoardSummary {
  const s: BoardSummary = {
    total: rows.length,
    loading: 0, error: 0, ready: 0, almost: 0, attention: 0, actionNeeded: 0,
  }
  for (const r of rows) {
    if (r.state === 'loading') { s.loading++; continue }
    if (r.state === 'error') { s.error++; continue }
    if (r.status === 'ready') s.ready++
    else if (r.status === 'almost') s.almost++
    else s.attention++
    if (r.status !== 'ready') s.actionNeeded++
  }
  return s
}

/**
 * True when a loaded client still needs the accountant's attention (not ready).
 * Loading/error rows are treated as needing attention too, so the "Actie nodig"
 * filter never hides a client whose status we don't yet know.
 */
export function needsAction(row: BoardRow): boolean {
  if (row.state === 'ok') return row.status !== 'ready'
  return true
}
