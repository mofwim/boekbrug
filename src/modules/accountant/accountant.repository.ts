// src/modules/accountant/accountant.repository.ts
// [BOEK-028] Accountant Portal — repository layer — May 2026
//
// RULE: This is the ONLY file that calls supabase.from() for accountant data.
//       No page, component, or hook may bypass this file.
//
// Access control: every function verifies accountant ↔ client linkage
// via accountant_clients before returning any data.
//
// Visibility rule: accountant sees ONLY invoices where
//   shared = true  (shared GENERATED ALWAYS AS status='paid' — model A)
//   [BOEK-FOUNDATION-TYPES] 'voldaan' removed — not in DB CHECK constraint
//   'received' invoices are NEVER returned here.

import { createServerSupabaseClient } from '@/lib/supabase-server'
import {
  computeClientStatus,
  getCurrentQuarter,
  getQuarterRange,
} from './accountant.service'
import type {
  AccountantOverview,
  ClientDetail,
  ClientSummary,
  InvoiceRow,
  TodoItem,
} from './accountant.types'

// ─────────────────────────────────────────────────────────
// Clients
// ─────────────────────────────────────────────────────────

/**
 * Returns all clients linked to this accountant, with computed status.
 * Sorted: wacht → bijna_klaar → klaar (most urgent first).
 */
export async function getAccountantClients(
  accountantId: string
): Promise<ClientSummary[]> {
  const supabase = await createServerSupabaseClient()

  const { data, error } = await supabase
    .from('accountant_clients')
    .select(`
      created_at,
      profiles!zzper_id (
        id,
        full_name,
        company_name,
        email
      )
    `)
    .eq('accountant_id', accountantId)

  if (error || !data) return []

  const { year, quarter } = getCurrentQuarter()
  const { start, end } = getQuarterRange(year, quarter)

  // For each client, compute status from current quarter data
  const summaries = await Promise.all(
    data.map(async (row: any) => {
      const profile = row.profiles
      if (!profile) return null

      // Count paid invoices in current quarter
      const { count: totalInvoices } = await supabase
        .from('invoices')
        .select('id', { count: 'exact', head: true })
        .eq('sender_id', profile.id)
        .in('status', ['paid'])
        .eq('shared', true)
        .gte('invoice_date', start)
        .lte('invoice_date', end)

      // Count verwerkt invoices in current quarter
      const { count: processedInvoices } = await supabase
        .from('invoices')
        .select('id', { count: 'exact', head: true })
        .eq('sender_id', profile.id)
        .in('status', ['paid'])
        .eq('shared', true)
        .eq('accountant_status', 'verwerkt')
        .gte('invoice_date', start)
        .lte('invoice_date', end)

      // Check for bank document in current quarter (doc_type = 'bank')
      const { count: bankCount } = await supabase
        .from('documents')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', profile.id)
        .eq('doc_type', 'bank')
        .gte('created_at', start)
        .lte('created_at', end + 'T23:59:59')

      // Last document upload (any type)
      const { data: lastDoc } = await supabase
        .from('documents')
        .select('created_at')
        .eq('user_id', profile.id)
        .order('created_at', { ascending: false })
        .limit(1)

      let lastUploadDaysAgo: number | null = null
      if (lastDoc && lastDoc.length > 0) {
        const diffMs = Date.now() - new Date(lastDoc[0].created_at).getTime()
        lastUploadDaysAgo = Math.floor(diffMs / (1000 * 60 * 60 * 24))
      }

      const status = computeClientStatus({
        hasBank: (bankCount ?? 0) > 0,
        totalInvoices: totalInvoices ?? 0,
        processedInvoices: processedInvoices ?? 0,
        lastUploadDaysAgo,
      })

      return {
        id: profile.id,
        full_name: profile.full_name,
        company_name: profile.company_name,
        email: profile.email,
        status,
        linked_at: row.created_at ?? "",
      } satisfies ClientSummary
    })
  )

  const valid = summaries.filter((s): s is ClientSummary => s !== null)

  // Sort: wacht first, then bijna_klaar, then klaar
  const ORDER = { wacht: 0, bijna_klaar: 1, klaar: 2 }
  return valid.sort((a, b) => ORDER[a.status] - ORDER[b.status])
}

// ─────────────────────────────────────────────────────────
// Client detail
// ─────────────────────────────────────────────────────────

/**
 * Returns full profile of a single client.
 * Returns null if the client is not linked to this accountant — never throws.
 */
export async function getClientDetail(
  accountantId: string,
  clientId: string
): Promise<ClientDetail | null> {
  const supabase = await createServerSupabaseClient()

  // Verify linkage first
  const { data: link } = await supabase
    .from('accountant_clients')
    .select('created_at')
    .eq('accountant_id', accountantId)
    .eq('zzper_id', clientId)
    .maybeSingle()

  if (!link) return null

  const { data: profile } = await supabase
    .from('profiles')
    .select(`
      id, full_name, company_name, email,
      kvk_number, btw_number, iban,
      address, postal_code, city
    `)
    .eq('id', clientId)
    .maybeSingle()

  if (!profile) return null

  // Compute status
  const { year, quarter } = getCurrentQuarter()
  const { start, end } = getQuarterRange(year, quarter)

  const { count: totalInvoices } = await supabase
    .from('invoices')
    .select('id', { count: 'exact', head: true })
    .eq('sender_id', clientId)
    .in('status', ['paid'])
    .eq('shared', true)
    .gte('invoice_date', start)
    .lte('invoice_date', end)

  const { count: processedInvoices } = await supabase
    .from('invoices')
    .select('id', { count: 'exact', head: true })
    .eq('sender_id', clientId)
    .in('status', ['paid'])
    .eq('shared', true)
    .eq('accountant_status', 'verwerkt')
    .gte('invoice_date', start)
    .lte('invoice_date', end)

  const { count: bankCount } = await supabase
    .from('documents')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', clientId)
    .eq('doc_type', 'bank')
    .gte('created_at', start)
    .lte('created_at', end + 'T23:59:59')

  const { data: lastDoc } = await supabase
    .from('documents')
    .select('created_at')
    .eq('user_id', clientId)
    .order('created_at', { ascending: false })
    .limit(1)

  let lastUploadDaysAgo: number | null = null
  if (lastDoc && lastDoc.length > 0) {
    const diffMs = Date.now() - new Date(lastDoc[0].created_at).getTime()
    lastUploadDaysAgo = Math.floor(diffMs / (1000 * 60 * 60 * 24))
  }

  const status = computeClientStatus({
    hasBank: (bankCount ?? 0) > 0,
    totalInvoices: totalInvoices ?? 0,
    processedInvoices: processedInvoices ?? 0,
    lastUploadDaysAgo,
  })

  return {
    id: profile.id,
    full_name: profile.full_name,
    company_name: profile.company_name,
    email: profile.email,
    kvk_number: profile.kvk_number,
    btw_number: profile.btw_number,
    iban: profile.iban,
    address: profile.address,
    postal_code: profile.postal_code,
    city: profile.city,
    status,
    linked_at: link.created_at ?? "",
  } satisfies ClientDetail
}

// ─────────────────────────────────────────────────────────
// Overview (3 numbers)
// ─────────────────────────────────────────────────────────

/**
 * Returns the three summary numbers for the accountant home page.
 * Reuses getAccountantClients to avoid duplicating status logic.
 */
export async function getAccountantOverview(
  accountantId: string
): Promise<AccountantOverview> {
  const clients = await getAccountantClients(accountantId)

  return {
    total_clients: clients.length,
    ready_for_quarter: clients.filter(c => c.status === 'klaar').length,
    waiting: clients.filter(c => c.status === 'wacht').length,
  }
}

// ─────────────────────────────────────────────────────────
// Todo feed
// ─────────────────────────────────────────────────────────

/**
 * Returns action items the accountant needs to handle today.
 * One TodoItem per client per issue type.
 * Sorted by urgency: client_question first, then invoices_to_process, then missing_file.
 */
export async function getTodoFeed(accountantId: string): Promise<TodoItem[]> {
  const supabase = await createServerSupabaseClient()

  // Get all linked clients (id + name only — lightweight)
  const { data: links } = await supabase
    .from('accountant_clients')
    .select(`
      profiles!zzper_id (
        id,
        full_name,
        company_name
      )
    `)
    .eq('accountant_id', accountantId)

  if (!links) return []

  const { year, quarter } = getCurrentQuarter()
  const { start, end } = getQuarterRange(year, quarter)

  const todos: TodoItem[] = []

  await Promise.all(
    links.map(async (row: any) => {
      const profile = row.profiles
      if (!profile) return

      const clientName: string = profile.company_name || profile.full_name || 'Onbekend'
      const clientId: string = profile.id

      // 1. Invoices with 'vraag' status (client needs to answer)
      const { count: vraagCount } = await supabase
        .from('invoices')
        .select('id', { count: 'exact', head: true })
        .eq('sender_id', clientId)
        .in('status', ['paid'])
        .eq('shared', true)
        .eq('accountant_status', 'vraag')

      if ((vraagCount ?? 0) > 0) {
        todos.push({
          client_id: clientId,
          client_name: clientName,
          type: 'client_question',
          description: `${clientName} — vraag open`,
          count: vraagCount ?? 0,
        })
      }

      // 2. Paid invoices without accountant_status = 'verwerkt' (this quarter)
      const { count: unprocessedCount } = await supabase
        .from('invoices')
        .select('id', { count: 'exact', head: true })
        .eq('sender_id', clientId)
        .in('status', ['paid'])
        .eq('shared', true)
        .not('accountant_status', 'eq', 'verwerkt')
        .gte('invoice_date', start)
        .lte('invoice_date', end)

      if ((unprocessedCount ?? 0) > 0) {
        todos.push({
          client_id: clientId,
          client_name: clientName,
          type: 'invoices_to_process',
          description: `${clientName} — ${unprocessedCount} factuur${(unprocessedCount ?? 0) > 1 ? 'en' : ''} te verwerken`,
          count: unprocessedCount ?? 0,
        })
      }

      // 3. Missing bank file for current quarter
      const { count: bankCount } = await supabase
        .from('documents')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', clientId)
        .eq('doc_type', 'bank')
        .gte('created_at', start)
        .lte('created_at', end + 'T23:59:59')

      if ((bankCount ?? 0) === 0) {
        todos.push({
          client_id: clientId,
          client_name: clientName,
          type: 'missing_file',
          description: `${clientName} — bankafschrift ontbreekt`,
        })
      }
    })
  )

  // Sort: client_question → invoices_to_process → missing_file
  const URGENCY: Record<string, number> = {
    client_question: 0,
    invoices_to_process: 1,
    missing_file: 2,
  }
  return todos.sort((a, b) => URGENCY[a.type] - URGENCY[b.type])
}

// ─────────────────────────────────────────────────────────
// Client invoices (accountant view)
// ─────────────────────────────────────────────────────────

/**
 * Returns paid invoices for a client in a given quarter.
 * Verifies linkage before querying — returns [] if not linked.
 *
 * btw_rate is NOT selected (not in DB).
 * Compute in UI: Math.round((btw_amount / total_ex_btw) * 100)
 */
export async function getClientPaidInvoices(
  accountantId: string,
  clientId: string,
  year: number,
  quarter: number
): Promise<InvoiceRow[]> {
  const supabase = await createServerSupabaseClient()

  // Verify linkage
  const { data: link } = await supabase
    .from('accountant_clients')
    .select('id')
    .eq('accountant_id', accountantId)
    .eq('zzper_id', clientId)
    .maybeSingle()

  if (!link) return []

  const { start, end } = getQuarterRange(year, quarter)

  const { data, error } = await supabase
    .from('invoices')
    .select(`
      id,
      invoice_number,
      client_name,
      status,
      direction,
      invoice_type,
      total_ex_btw,
      btw_amount,
      total_inc_btw,
      invoice_date,
      marked_paid_at,
      accountant_status,
      accountant_note,
      replaced_by_number
    `)
    .eq('sender_id', clientId)
    .in('status', ['paid'])
    .eq('shared', true)
    .gte('invoice_date', start)
    .lte('invoice_date', end)
    .order('invoice_date', { ascending: true })

  if (error || !data) return []

  return data as InvoiceRow[]
}

// ─────────────────────────────────────────────────────────
// Client management (write operations)
// ─────────────────────────────────────────────────────────

/**
 * Unlinks a client from this accountant.
 * Verifies ownership before deleting — returns error string if not allowed.
 * Note: data archival (BOEK-032) is deferred — only the link row is removed.
 */
export async function unlinkClient(
  accountantId: string,
  clientId: string
): Promise<{ error?: string }> {
  const supabase = await createServerSupabaseClient()

  // Verify this link belongs to this accountant
  const { data: link } = await supabase
    .from('accountant_clients')
    .select('id')
    .eq('accountant_id', accountantId)
    .eq('zzper_id', clientId)
    .maybeSingle()

  if (!link) return { error: 'Klant niet gevonden of geen toegang.' }

  const { error } = await supabase
    .from('accountant_clients')
    .delete()
    .eq('id', link.id)

  if (error) return { error: 'Verwijderen mislukt. Probeer het opnieuw.' }
  return {}
}

/**
 * Creates an invitation for a client email.
 * Uses the invitations table with invited_by = 'accountant'.
 * zzper_id is null because the client may not have an account yet.
 * The client's email is stored in accountant_email (field repurposed for this direction).
 * Full invite flow (email sending) is handled by BOEK-011/015 endpoints once live.
 */
export async function inviteClient(
  accountantId: string,
  clientEmail: string
): Promise<{ error?: string }> {
  const supabase = await createServerSupabaseClient()

  // Validate email format
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
  if (!emailRegex.test(clientEmail)) return { error: 'Ongeldig e-mailadres.' }

  // Check for duplicate pending invite from this accountant
  const { data: existing } = await supabase
    .from('invitations')
    .select('id, status')
    .eq('accountant_email', clientEmail)
    .eq('invited_by', 'accountant')
    .maybeSingle()

  if (existing?.status === 'pending') {
    return { error: 'Er is al een uitnodiging verstuurd naar dit adres.' }
  }

  const { error } = await supabase
    .from('invitations')
    .insert({
      zzper_id: null,
      accountant_email: clientEmail,
      invited_by: 'accountant',
      status: 'pending',
    })

  if (error) return { error: 'Uitnodiging versturen mislukt. Probeer het opnieuw.' }
  return {}
}