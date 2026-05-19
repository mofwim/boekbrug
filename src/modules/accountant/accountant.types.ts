// src/modules/accountant/accountant.types.ts
// [BOEK-028] Accountant Portal — shared types — May 2026
// Single source of truth for all accountant module types.
// Do not import from here in ZZP modules.

// ─────────────────────────────────────────────────────────
// Client
// ─────────────────────────────────────────────────────────

/**
 * Computed from quarter data — never stored, never written manually.
 * klaar       = bank file present + all invoices verwerkt + at least 1 invoice
 * bijna_klaar = one or two items missing
 * wacht       = no upload in >21 days OR no bank file at all
 */
export type ClientStatus = 'klaar' | 'bijna_klaar' | 'wacht'

/** Lightweight summary — used in client list and overview counts */
export interface ClientSummary {
  id: string                   // profiles.id of the ZZP'er
  full_name: string | null
  company_name: string | null
  email: string | null
  status: ClientStatus         // computed by computeClientStatus()
  linked_at: string            // accountant_clients.created_at (ISO string)
}

/** Full detail — used in client detail page */
export interface ClientDetail extends ClientSummary {
  kvk_number: string | null
  btw_number: string | null
  iban: string | null
  address: string | null
  postal_code: string | null
  city: string | null
}

// ─────────────────────────────────────────────────────────
// Dashboard overview
// ─────────────────────────────────────────────────────────

/** Three numbers shown at the top of AccountantHome */
export interface AccountantOverview {
  total_clients: number
  ready_for_quarter: number    // status === 'klaar'
  waiting: number              // status === 'wacht'
}

// ─────────────────────────────────────────────────────────
// Todo feed
// ─────────────────────────────────────────────────────────

export type TodoType =
  | 'invoices_to_process'   // paid invoices without accountant_status = 'verwerkt'
  | 'missing_file'          // current quarter has no bank document
  | 'client_question'       // invoices with accountant_status = 'vraag'

export interface TodoItem {
  client_id: string
  client_name: string          // company_name || full_name
  type: TodoType
  description: string          // Dutch, ready to display
  count?: number               // number of invoices affected (when relevant)
}

// ─────────────────────────────────────────────────────────
// Invoices (accountant view)
// ─────────────────────────────────────────────────────────

/**
 * Accountant sees only: status IN ('paid','voldaan') AND sent_to_accountant = true
 * 'received' invoices (from Gmail, pending client confirmation) are NEVER visible here.
 * btw_rate is NOT in DB — always compute: Math.round((btw_amount / total_ex_btw) * 100)
 */
export interface InvoiceRow {
  id: string
  invoice_number: string
  client_name: string | null
  status: string
  direction: string
  invoice_type: string
  total_ex_btw: number
  btw_amount: number
  total_inc_btw: number
  invoice_date: string
  marked_paid_at: string | null  // when client marked paid — NOT actual payment date
  accountant_status: string | null
  accountant_note: string | null  // accountant-only, client never sees this
  replaced_by_number: string | null
}

// ─────────────────────────────────────────────────────────
// Quarter
// ─────────────────────────────────────────────────────────

export interface QuarterRange {
  start: string   // YYYY-MM-DD — inclusive
  end: string     // YYYY-MM-DD — inclusive
}