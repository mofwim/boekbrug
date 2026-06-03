// src/lib/bridge-tree.ts
// [BOEK-002] Bridge Folder Rendering — the heart of the Rendering philosophy.
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
// Ownership: this file is NEW and owned by [BOEK-002]. It READS the shapes of
// invoices/documents but does not import or modify bestanden.ts (BOEK-033).

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

/** A badge shown on a node (e.g. "Verlopen", "Creditnota", "Contant"). */
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
  /** Full path segments from root, e.g. ['2026','Q2','Verzonden','Verwerkt','Bank']. */
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
  verzonden: 'Verzonden',
  ontvangen: 'Ontvangen',
  verwerkt: 'Verwerkt',
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

/** Direction branch label; defaults to Verzonden if direction is null. */
function directionBranch(direction: BridgeInvoice['direction']): string {
  return direction === 'incoming' ? NODE.ontvangen : NODE.verzonden
}

// ============================================================================
// Core: render ONE invoice into its tree path
// ============================================================================
// Check order (decided in architecture): invoice_type → status (+ date) → Overig.
// Every invoice gets a node. No silent loss.

function invoicePath(inv: BridgeInvoice): { path: string[]; badges: NodeBadge[] } {
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
    // creditnota is outgoing; flagged, kept with sent invoices
    badges.push({ label: 'Creditnota', tone: 'info' })
    const yr = inv.invoice_date ? yearOf(inv.invoice_date) : null
    const path = yr ? [yr, `Q${quarterOf(inv.invoice_date!)}`, NODE.verzonden] : [NODE.verzonden]
    return { path, badges }
  }

  // 2) factuur — status drives placement
  const status = inv.status

  // Draft → Concept (never visible to accountant; shared is false anyway)
  if (status === 'draft') {
    return { path: [NODE.concept], badges }
  }

  // Archived → Archief (hidden by default, see node.hidden)
  if (status === 'archived') {
    return { path: [NODE.archief], badges }
  }

  // "Awaiting human confirmation" group → Inbox
  // processing / unclear, and received with no date yet.
  if (status === 'processing' || status === 'unclear') {
    return { path: [NODE.inbox], badges }
  }
  if (status === 'received' && !inv.invoice_date) {
    return { path: [NODE.inbox], badges }
  }

  // No date but otherwise active → Inbox (must not vanish)
  if (!inv.invoice_date) {
    return { path: [NODE.inbox], badges }
  }

  // From here invoice_date is present → compute year/quarter
  const yr = yearOf(inv.invoice_date)
  const q = `Q${quarterOf(inv.invoice_date)}`
  const branch = directionBranch(inv.direction)

  // Paid → .../[branch]/Verwerkt/[Bank|Contant]
  if (status === 'paid') {
    return { path: [yr, q, branch, NODE.verwerkt, methodLeaf(inv.payment_method)], badges }
  }

  // Overdue → branch + Verlopen badge (not yet paid)
  if (status === 'overdue') {
    badges.push({ label: 'Verlopen', tone: 'error' })
    return { path: [yr, q, branch], badges }
  }

  // sent / received(with date) / processed → branch (active, pending)
  if (status === 'sent' || status === 'received' || status === 'processed') {
    return { path: [yr, q, branch], badges }
  }

  // Unknown/future status value → Overig safety net (+ caller can log)
  return { path: [NODE.overig], badges }
}

/** Build a status badge for paid/contant context (visual cue). */
function statusBadges(inv: BridgeInvoice, base: NodeBadge[]): NodeBadge[] {
  const out = [...base]
  if (inv.status === 'paid') {
    out.push({ label: 'Betaald', tone: 'success' })
    if (inv.payment_method === 'kas') out.push({ label: 'Contant', tone: 'neutral' })
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
   */
  accountantView?: boolean
  /** Optional sink for unexpected status values routed to Overig. */
  onUnexpected?: (kind: 'invoice_status', value: string, id: string) => void
}

/**
 * Merge invoices (rendered) + documents (physical) into one TreeNode[].
 *
 * Duplicate-PDF rule (decided): if an invoice has a document_id, that document
 * is its attachment — we render the invoice node and EXCLUDE that document from
 * the document side, so the PDF never appears twice.
 */
export function buildBridgeTree(input: BuildBridgeTreeInput): TreeNode[] {
  const { invoices, documents, folders, accountantView = false, onUnexpected } = input

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
    const { path, badges } = invoicePath(inv)

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

    const finalPath = accountantView && clientId ? ['Klanten', clientId, ...path] : path

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

    const path = folderPath(doc.folder_id, folderMap)
    // Fallback: a document with no/unknown folder → Overig (never lost).
    const finalBase = path.length > 0 ? path : [NODE.overig]
    const finalPath =
      accountantView ? ['Klanten', doc.user_id, ...finalBase] : finalBase

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