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
  /**
   * [REDEN] De KOPPEN van wat er ontbreekt — niet alleen hoeveel.
   *
   * /api/readiness stuurt al `missing[]` met leesbare Nederlandse koppen mee; het bord
   * hield daar alleen `.length` van over. De boekhouder las dus "62% · 4 ontbreekt" en moest
   * het bord verlaten om te leren dát het om een bankafschrift ging. Eén getal werd zo een
   * navigatie; de koppen maken er een handeling van.
   *
   * ⚠️ ALLEEN DE KOPPEN. Bewust NIET `detail` en NIET `fix`:
   *   · elke `fix`-href is een EIGENAARSROUTE (readiness.ts:139-145, bv. /dashboard/incoming)
   *     en zou de boekhouder naar zijn eigen lege pagina's sturen;
   *   · de `detail` van de verificatierij is letterlijk AV §7.3's "inkomende facturen die je
   *     nog niet hebt gecontroleerd" — het AANTAL is verdedigbaar als "nog niet klaar", de
   *     inhoud is voor de eigenaar.
   * Verbreed dit niet zonder §7.3 er weer bij te pakken.
   */
  missingTitles?: string[]
  /** Waarom de rij niet laadde, als de reden bekend is (bv. koppeling verbroken). */
  errorReason?: 'unlinked' | 'unknown'
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
