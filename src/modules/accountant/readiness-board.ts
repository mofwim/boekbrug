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
  /**
   * [SNEL-BORD] Het moment waarop dit rapport is BEREKEND, als de rij uit de opname komt.
   *
   * Afwezig zodra de verse lezing binnen is. Zolang hij er staat hoort het scherm hem te tonen:
   * readiness beslist of een kwartaal ingediend kan worden, en een cijfer van gisteren dat als vers
   * leest is de app die aanraadt aangifte te doen op iets wat niemand heeft nagekeken.
   */
  cachedAt?: string
  /**
   * [NO-SILENT-EMPTY] Het bijwerken is geprobeerd en mislukt, en dit is nog de opgenomen stand.
   *
   * Het cijfer blijft staan — het weggooien zou een boekhouder informatie afnemen die hij had —
   * maar nooit stilzwijgend: een stand die niet kon worden nagerekend mag niet als oordeel lezen.
   */
  refreshFailed?: boolean
}

/**
 * Eén rapport → één bordrij. Gedeeld door de verse lezing en de opgenomen stand, met opzet: dit is
 * de plek waar `missing[]` een aantal wordt en waar de koppen eruit komen, en twee kopieën daarvan
 * betekent dat het bord na een tijdje twee verschillende dingen over dezelfde klant kan zeggen.
 *
 * `report` komt van buiten (JSON uit een route of uit readiness_cache), dus alles wordt hier
 * gecontroleerd in plaats van aangenomen. Een rapport zonder score is geen rij: null terug.
 */
export function rowFromReport(
  base: { id: string; name: string },
  report: unknown,
): BoardRow | null {
  if (!report || typeof report !== 'object') return null
  const r = report as Record<string, unknown>
  if (typeof r.score !== 'number' || typeof r.status !== 'string') return null
  const missing: unknown[] = Array.isArray(r.missing) ? r.missing : []
  return {
    ...base,
    state: 'ok',
    score: r.score,
    status: r.status as BoardStatus,
    missingCount: missing.length,
    riskCount: Array.isArray(r.risks) ? r.risks.length : 0,
    // [REDEN] Alleen de koppen — zie de toelichting bij BoardRow.missingTitles.
    missingTitles: missing
      .map(m => (m && typeof m === 'object' && 'title' in m ? String((m as { title: unknown }).title) : ''))
      .filter(Boolean),
  }
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
