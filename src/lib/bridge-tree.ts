// src/lib/bridge-tree.ts
// [BOEK-002] Bridge Folder Rendering — the heart of the Rendering philosophy.
// [BRIDGE-A] June 2026 — sharing criterion expanded (sent/received/paid) +
//            paid/verwerkt semantic split + accounting buckets for accountant.
//
// Invoices are NOT stored in physical folders. They are RENDERED into a tree
// from their metadata (invoice_date + direction + status + payment_method).
// Physical documents keep their real folder_id. This module merges both into
// ONE visual tree while keeping them as TWO logical sources.
//
// Pure functions only — no Supabase, no fetching, no side effects.
// The server page fetches rows and passes them in; this returns a TreeNode[].
// That makes the whole rendering layer unit-testable and free of RLS concerns
// (RLS already filtered the rows before they reach here).
//
// [BRIDGE-A] Semantic rules (decided, signed):
//   - 'Verwerkt' is NEVER a path node. It is the accountant's processing state
//     (accountant_status) and renders as a BADGE only. The old code routed
//     paid invoices into a 'Verwerkt' folder — that was a semantic bug
//     (payment state mislabeled as processing state).
//   - paid    → [year, Q, 'Voldaan', Bank|Contant]            (both views)
//   - unpaid  → ZZP view:        [year, Q, Verzonden|Ontvangen]
//               accountant view: [year, Q, Debiteuren|Crediteuren]
//     The ZZP'er hates accounting jargon — Debiteuren/Crediteuren appear in
//     accountantView only.
//   - 'overdue' is NEVER a stored status (computed: sent + due_date < today).
//     It renders as a 'Verlopen' badge on unpaid nodes — never as a folder
//     and never read from the status column.
//
// Ownership: owned by [BOEK-002]; [BRIDGE-A] edits tagged inline. It READS the
// shapes of invoices/documents but does not import or modify bestanden.ts.

// ============================================================================
// Types — minimal shapes needed for rendering (derived from DB schema)
// ============================================================================

/** Only the invoice columns the renderer needs. */
export interface BridgeInvoice {
  id: string
  invoice_number: string | null
  invoice_type: 'factuur' | 'creditnota' | 'pro_forma' | 'offerte' | null
  status:
    | 'draft' | 'sent' | 'paid' | 'overdue' | 'received'
    | 'processing' | 'processed' | 'unclear' | 'archived' | null
  direction: 'outgoing' | 'incoming' | null
  invoice_date: string | null          // ISO date or null
  /** [BRIDGE-A] needed for the computed 'Verlopen' badge (never from status). */
  due_date: string | null
  /** [BRIDGE-A] accountant processing state → 'Verwerkt'/'Vraag' badges. */
  accountant_status: 'te_verwerken' | 'in_behandeling' | 'verwerkt' | 'vraag' | null
  payment_method: 'bank' | 'kas' | null
  total_inc_btw: number | null
  document_id: string | null           // linked physical PDF, if any
  pdf_url: string | null
  // ownership (for accountant Klanten dimension)
  sender_id: string | null
  receiver_id: string | null
}

/** Only the document columns the renderer needs. */
export interface BridgeDocument {
  id: string
  file_name: string
  file_url: string | null
  folder_id: string | null
  doc_type: string | null
  year: number | null
  period: string | null
  invoice_id: string | null            // if set, this PDF belongs to an invoice
  user_id: string
  created_at: string | null
}

/** A physical folder row (read-only, for documents placement). */
export interface BridgeFolder {
  id: string
  name: string
  parent_id: string | null
  folder_type: string | null
  user_id: string | null
}

export type NodeSource = 'invoice' | 'document'

/** A badge shown on a node (e.g. "Verlopen", "Creditnota", "Verwerkt"). */
export interface NodeBadge {
  label: string
  tone: 'success' | 'warning' | 'error' | 'neutral' | 'info'
}

/**
 * Unified node — invoice (rendered) or document (physical) wear the SAME shape
 * so the UI renders one coherent tree. `source` tells where it came from.
 */
export interface TreeNode {
  source: NodeSource
  id: string
  displayName: string
  /** Full path segments from root, e.g. ['2026','Q2','Voldaan','Bank']. */
  path: string[]
  date: string | null
  amount: number | null
  badges: NodeBadge[]
  /** Invoice: PDF via document_id link; Document: its own file_url. */
  pdfUrl: string | null
  /** Hidden by default in normal view (e.g. archived) — UI toggles visibility. */
  hidden: boolean
  /** Klanten/[clientId] prefix dimension for accountant view (null for client). */
  clientId: string | null
}

// ============================================================================
// Constants — node labels (Dutch UI)
// ============================================================================

const NODE = {
  // ZZP labels (no accounting jargon)
  verzonden: 'Verzonden',
  ontvangen: 'Ontvangen',
  // [BRIDGE-A] accountant labels (accountantView only)
  debiteuren: 'Debiteuren',            // outgoing, unpaid — receivables
  crediteuren: 'Crediteuren',          // incoming, unpaid — payables
  // [BRIDGE-A] paid bucket — both views. Replaces the old (wrong) 'Verwerkt'
  // path node: Verwerkt is accountant_status, rendered as a badge only.
  voldaan: 'Voldaan',
  bank: 'Bank',
  kas: 'Contant',            // UI label for DB 'kas'
  concept: 'Concept',
  inbox: 'Inbox',
  offertes: 'Offertes',
  proforma: 'Pro-forma',
  archief: 'Archief',
  overig: 'Overig',
} as const

// ============================================================================
// Helpers
// ============================================================================

/** Quarter (1–4) from an ISO date string. */
function quarterOf(dateIso: string): number {
  const month = new Date(dateIso).getUTCMonth() // 0–11
  return Math.floor(month / 3) + 1
}

/** Year as string from an ISO date. */
function yearOf(dateIso: string): string {
  return String(new Date(dateIso).getUTCFullYear())
}

/** Bank|Contant leaf label from payment_method (defaults to Bank if missing). */
function methodLeaf(method: BridgeInvoice['payment_method']): string {
  return method === 'kas' ? NODE.kas : NODE.bank
}

/**
 * [BRIDGE-A] Branch label for an UNPAID official invoice.
 * ZZP view keeps plain Dutch; accountant view gets accounting buckets.
 * Defaults to outgoing if direction is null (same fallback as before).
 */
function unpaidBranch(
  direction: BridgeInvoice['direction'],
  accountantView: boolean
): string {
  if (direction === 'incoming') {
    return accountantView ? NODE.crediteuren : NODE.ontvangen
  }
  return accountantView ? NODE.debiteuren : NODE.verzonden
}

/** [BRIDGE-A] ISO-date string compare is safe for YYYY-MM-DD. */
function isPastDue(dueDate: string | null, todayIso: string): boolean {
  return !!dueDate && dueDate.slice(0, 10) < todayIso
}

// ============================================================================
// Core: render ONE invoice into its tree path
// ============================================================================
// Check order (decided in architecture): invoice_type → status (+ date) → Overig.
// Every invoice gets a node. No silent loss.
//
// [BRIDGE-A] creditnota change: it now follows the SAME status routing as a
// factuur (so a paid creditnota lands in Voldaan, an unpaid one in the unpaid
// branch) while keeping its 'Creditnota' badge. Previously it was pinned to
// Verzonden regardless of status — inconsistent with the accounting split.

function invoicePath(
  inv: BridgeInvoice,
  accountantView: boolean,
  todayIso: string
): { path: string[]; badges: NodeBadge[] } {
  const badges: NodeBadge[] = []
  const type = inv.invoice_type ?? 'factuur'

  // 1) Non-factuur types live in their own branches (not tax-invoice tree)
  if (type === 'offerte') {
    return { path: [NODE.offertes], badges }
  }
  if (type === 'pro_forma') {
    return { path: [NODE.proforma], badges }
  }
  if (type === 'creditnota') {
    // [BRIDGE-A] badge + fall through to normal status routing (see note above)
    badges.push({ label: 'Creditnota', tone: 'info' })
  }

  // 2) status drives placement
  const status = inv.status

  // Draft → Concept (never visible to accountant; shared=false — draft is the
  // only non-shared active status under the [BRIDGE-A] criterion)
  if (status === 'draft') {
    return { path: [NODE.concept], badges }
  }

  // Archived → Archief (hidden by default, see node.hidden)
  if (status === 'archived') {
    return { path: [NODE.archief], badges }
  }

  // "Awaiting human confirmation" group → Inbox
  if (status === 'processing' || status === 'unclear') {
    return { path: [NODE.inbox], badges }
  }

  // No date but otherwise active → Inbox (must not vanish)
  if (!inv.invoice_date) {
    return { path: [NODE.inbox], badges }
  }

  // From here invoice_date is present → compute year/quarter
  const yr = yearOf(inv.invoice_date)
  const q = `Q${quarterOf(inv.invoice_date)}`

  // [BRIDGE-A] Paid → .../Voldaan/[Bank|Contant] — payment state, NOT
  // 'Verwerkt' (that was the semantic bug: accountant_status is a badge).
  if (status === 'paid') {
    return { path: [yr, q, NODE.voldaan, methodLeaf(inv.payment_method)], badges }
  }

  // Unpaid official invoice → direction bucket.
  // 'overdue' is handled defensively (DB CHECK allows it even though the app
  // never stores it) and gets the same routing as 'sent'.
  if (
    status === 'sent' || status === 'received' ||
    status === 'processed' || status === 'overdue'
  ) {
    // [BRIDGE-A] 'Verlopen' is COMPUTED (due_date in the past), never a folder
    if (status === 'overdue' || isPastDue(inv.due_date, todayIso)) {
      badges.push({ label: 'Verlopen', tone: 'error' })
    }
    return { path: [yr, q, unpaidBranch(inv.direction, accountantView)], badges }
  }

  // Unknown/future status value → Overig safety net (+ caller can log)
  return { path: [NODE.overig], badges }
}

/**
 * Status + accountant badges.
 * [BRIDGE-A] 'Verwerkt' / 'Vraag' come from accountant_status ONLY — this is
 * the single place the processing state surfaces in the tree.
 */
function statusBadges(inv: BridgeInvoice, base: NodeBadge[]): NodeBadge[] {
  const out = [...base]
  if (inv.status === 'paid') {
    out.push({ label: 'Betaald', tone: 'success' })
    if (inv.payment_method === 'kas') out.push({ label: 'Contant', tone: 'neutral' })
  }
  // [BRIDGE-A] processing state badges (apply to any shared invoice)
  if (inv.accountant_status === 'verwerkt') {
    out.push({ label: 'Verwerkt', tone: 'success' })
  } else if (inv.accountant_status === 'vraag') {
    out.push({ label: 'Vraag', tone: 'warning' })
  }
  return out
}

// ============================================================================
// Documents → physical tree path (from folder hierarchy)
// ============================================================================

/** Walk parent_id chain to build a folder's path segments. */
function folderPath(folderId: string | null, folderMap: Map<string, BridgeFolder>): string[] {
  const segments: string[] = []
  let current = folderId ? folderMap.get(folderId) : undefined
  let guard = 0
  while (current && guard < 32) {
    segments.unshift(current.name)
    current = current.parent_id ? folderMap.get(current.parent_id) : undefined
    guard++
  }
  return segments
}

// ============================================================================
// Public API
// ============================================================================

export interface BuildBridgeTreeInput {
  invoices: BridgeInvoice[]
  documents: BridgeDocument[]
  folders: BridgeFolder[]
  /**
   * Accountant view: prefix every node path with the owning client id so the
   * UI can group under Klanten/[client]. Client's own view leaves this null.
   * [BRIDGE-A] Also switches unpaid bucket labels to Debiteuren/Crediteuren.
   */
  accountantView?: boolean
  /**
   * Map of clientId → display label (e.g. "Mohammad — ABC BV"). Used in the
   * Klanten path segment so the accountant sees names, not UUIDs. If a client
   * id is missing from the map, the UUID is used as a safe fallback.
   */
  clientNames?: Map<string, string>
  /**
   * [BRIDGE-A] 'Today' as ISO date (YYYY-MM-DD) for the computed 'Verlopen'
   * badge. Defaults to the current date. Injectable for unit tests.
   */
  today?: string
  /** Optional sink for unexpected status values routed to Overig. */
  onUnexpected?: (kind: 'invoice_status', value: string, id: string) => void
}

/** Resolve a client's display label; falls back to the raw id if unknown. */
function clientLabel(clientId: string, names?: Map<string, string>): string {
  return names?.get(clientId) ?? clientId
}

/**
 * Merge invoices (rendered) + documents (physical) into one TreeNode[].
 *
 * Duplicate-PDF rule (decided): if an invoice has a document_id, that document
 * is its attachment — we render the invoice node and EXCLUDE that document from
 * the document side, so the PDF never appears twice.
 */
export function buildBridgeTree(input: BuildBridgeTreeInput): TreeNode[] {
  const {
    invoices, documents, folders,
    accountantView = false, clientNames, onUnexpected,
  } = input

  // [BRIDGE-A] single 'today' for the whole build — stable + testable
  const todayIso = (input.today ?? new Date().toISOString()).slice(0, 10)

  const folderMap = new Map<string, BridgeFolder>()
  for (const f of folders) folderMap.set(f.id, f)

  // PDFs already represented by an invoice (via document_id) → exclude from docs.
  const invoiceLinkedDocIds = new Set<string>()
  for (const inv of invoices) {
    if (inv.document_id) invoiceLinkedDocIds.add(inv.document_id)
  }

  const nodes: TreeNode[] = []

  // ---- Invoices (rendered) ----
  for (const inv of invoices) {
    const { path, badges } = invoicePath(inv, accountantView, todayIso)

    // Detect the Overig safety-net route to optionally log it.
    if (path.length === 1 && path[0] === NODE.overig && inv.status) {
      onUnexpected?.('invoice_status', inv.status, inv.id)
    }

    // Resolve attached PDF url: prefer invoice.pdf_url, else linked document.
    let pdfUrl = inv.pdf_url
    if (!pdfUrl && inv.document_id) {
      const doc = documents.find(d => d.id === inv.document_id)
      pdfUrl = doc?.file_url ?? null
    }

    // Owning client for accountant grouping:
    // outgoing → sender_id is the ZZP'er; incoming → receiver_id.
    const clientId =
      inv.direction === 'incoming' ? inv.receiver_id : inv.sender_id

    // [BOEK-005] In accountant view, only show rows belonging to a LINKED client
    // (clientId present in clientNames). This excludes the accountant's own
    // invoices (they are not their own client) and any unlinked stray rows.
    if (accountantView) {
      if (!clientId || !clientNames?.has(clientId)) continue
    }

    const finalPath = accountantView && clientId
      ? ['Klanten', clientLabel(clientId, clientNames), ...path]
      : path

    nodes.push({
      source: 'invoice',
      id: inv.id,
      displayName: inv.invoice_number ?? '(concept)',
      path: finalPath,
      date: inv.invoice_date,
      amount: inv.total_inc_btw,
      badges: statusBadges(inv, badges),
      pdfUrl,
      hidden: inv.status === 'archived',
      clientId: accountantView ? clientId : null,
    })
  }

  // ---- Documents (physical) ----
  for (const doc of documents) {
    if (invoiceLinkedDocIds.has(doc.id)) continue // attached to an invoice already

    // [BOEK-005] In accountant view, only linked clients' documents (same rule
    // as invoices) — excludes the accountant's own docs and unlinked strays.
    if (accountantView && !clientNames?.has(doc.user_id)) continue

    const path = folderPath(doc.folder_id, folderMap)
    // Fallback: a document with no/unknown folder → Overig (never lost).
    const finalBase = path.length > 0 ? path : [NODE.overig]
    const finalPath =
      accountantView ? ['Klanten', clientLabel(doc.user_id, clientNames), ...finalBase] : finalBase

    nodes.push({
      source: 'document',
      id: doc.id,
      displayName: doc.file_name,
      path: finalPath,
      date: doc.created_at,
      amount: null,
      badges: [],
      pdfUrl: doc.file_url,
      hidden: false,
      clientId: accountantView ? doc.user_id : null,
    })
  }

  return nodes
}