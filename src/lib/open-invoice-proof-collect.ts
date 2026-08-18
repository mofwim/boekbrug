// src/lib/open-invoice-proof-collect.ts
// [OPENSTAAND-BEWIJS] The reads behind the proof. Server-only; the rule itself is pure and lives
// in open-invoice-proof.ts.
//
// WHAT IT COMPARES, AND WHAT IT DELIBERATELY LEAVES OUT
//
//   invoices      incoming, status 'received' (confirmed by a human, not yet paid), type 'factuur'.
//                 A creditnota is not a bill that can be "already paid", and a 'processing' row has
//                 not been verified yet — the verify queue owns that one.
//   transactions  status 'pending' and not linked to any invoice. A line already booked against
//                 another invoice is not a missing payment; and a line the owner themselves set
//                 aside as 'not_found' is a judgement they already made, which this may not
//                 re-open every time the screen loads.
//
// The window: from a month before the OLDEST open invoice. A payment made before the bill existed
// is not that bill's payment, and the month of slack absorbs a prepayment and a date read a few
// days off. Everything is bounded and every bound is reported — see `capped` below.

import { fetchAllRows } from './supabase-paginate'
import { proveOpenInvoices, type OpenInvoiceProof } from './open-invoice-proof'
import type { InvoiceForMatching } from './bank-matching'
import type { BankTransaction } from './bank-parser'

/** A month of slack before the oldest open invoice — see the header. */
const LOOKBACK_DAYS = 31

/**
 * Hard ceilings, so a large administratie cannot turn a page load into a scan. The pairing is
 * quadratic (every invoice against every line), and 200 × 2000 is already 400.000 comparisons.
 *
 * Whatever is dropped is REPORTED. A bounded check presented as a complete one is the exact shape
 * of false reassurance this whole feature exists to remove.
 */
const MAX_INVOICES = 200
const MAX_TRANSACTIONS = 2000

export interface OpenInvoiceProofResult extends OpenInvoiceProof {
  /** The most recent bank line this owner has, whatever its status. Null when there are none. */
  bankThrough: string | null
  /**
   * [NO-SILENT-EMPTY] A read did not answer. The screen must then say it could not look, never
   * "geen betaling gevonden" — an absence over a failed read is the most convincing lie this
   * feature could tell.
   */
  readFailed: boolean
  /** What the ceilings dropped, so the screen can say the check was bounded. */
  capped: { invoices: number; transactions: number }
}

function daysBefore(iso: string, days: number): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso)
  if (!m) return iso
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])))
  d.setUTCDate(d.getUTCDate() - days)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`
}

export async function collectOpenInvoiceProof(args: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  pipeline: any
  ownerId: string
}): Promise<OpenInvoiceProofResult> {
  const empty: OpenInvoiceProofResult = {
    checkedInvoices: 0, checkedTransactions: 0, hits: [],
    bankThrough: null, readFailed: false, capped: { invoices: 0, transactions: 0 },
  }

  // ── The open bills ──
  let invoiceRows: Array<Record<string, unknown>>
  try {
    invoiceRows = await fetchAllRows((from, to) => args.pipeline
      .from('invoices')
      .select('id, invoice_number, client_name, total_inc_btw, amount_paid, invoice_date, due_date, direction, status, accountant_status, vendor_iban, payment_reference, payment_prepared_at, invoice_type')
      .eq('receiver_id', args.ownerId)
      .eq('direction', 'incoming')
      .eq('status', 'received')
      .order('invoice_date', { ascending: true })
      .order('id', { ascending: true })
      .range(from, to))
  } catch (e) {
    console.error('[OPENSTAAND-BEWIJS] open invoices unreadable', {
      ownerId: args.ownerId, error: e instanceof Error ? e.message : String(e),
    })
    return { ...empty, readFailed: true }
  }

  const open = invoiceRows
    .filter((r) => (r.invoice_type ?? 'factuur') === 'factuur')
    .filter((r) => {
      const paid = Math.max(0, Number(r.amount_paid) || 0)
      return Math.abs(Number(r.total_inc_btw) || 0) - paid > 0.005
    })
  const cappedInvoices = Math.max(0, open.length - MAX_INVOICES)
  const invoices: InvoiceForMatching[] = open.slice(0, MAX_INVOICES).map((r) => ({
    id: String(r.id),
    invoice_number: (r.invoice_number as string | null) ?? null,
    total_inc_btw: r.total_inc_btw as number | null,
    amount_paid: r.amount_paid as number | null,
    invoice_date: (r.invoice_date as string | null) ?? null,
    due_date: (r.due_date as string | null) ?? null,
    client_name: (r.client_name as string | null) ?? null,
    direction: 'incoming',
    status: (r.status as string | null) ?? null,
    accountant_status: (r.accountant_status as string | null) ?? null,
    vendor_iban: (r.vendor_iban as string | null) ?? null,
    payment_reference: (r.payment_reference as string | null) ?? null,
    payment_prepared_at: (r.payment_prepared_at as string | null) ?? null,
  }))

  // ── The horizon: how far the bank data reaches. Asked even when nothing is open, because it is
  // the sentence that qualifies every other number on the screen.
  let bankThrough: string | null = null
  try {
    const { data, error } = await args.pipeline
      .from('bank_transactions')
      .select('date')
      .eq('user_id', args.ownerId)
      .not('date', 'is', null)
      .order('date', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (error) throw new Error(error.message)
    bankThrough = (data as { date?: string } | null)?.date ?? null
  } catch (e) {
    console.error('[OPENSTAAND-BEWIJS] bank horizon unreadable', {
      ownerId: args.ownerId, error: e instanceof Error ? e.message : String(e),
    })
    return { ...empty, readFailed: true }
  }

  if (invoices.length === 0) {
    return { ...empty, bankThrough, capped: { invoices: cappedInvoices, transactions: 0 } }
  }

  // ── The payments that are not attached to anything ──
  const since = daysBefore(invoices[0].invoice_date ?? '1970-01-01', LOOKBACK_DAYS)
  let txRows: Array<Record<string, unknown>>
  try {
    txRows = await fetchAllRows((from, to) => args.pipeline
      .from('bank_transactions')
      .select('id, date, amount, description, counterpart_name, counterpart_iban, reference')
      .eq('user_id', args.ownerId)
      .eq('status', 'pending')
      .is('invoice_id', null)
      .gte('date', since)
      .order('date', { ascending: false })
      .order('id', { ascending: true })
      .range(from, to))
  } catch (e) {
    console.error('[OPENSTAAND-BEWIJS] bank transactions unreadable', {
      ownerId: args.ownerId, error: e instanceof Error ? e.message : String(e),
    })
    return { ...empty, bankThrough, readFailed: true }
  }

  const cappedTransactions = Math.max(0, txRows.length - MAX_TRANSACTIONS)
  const transactions: BankTransaction[] = txRows.slice(0, MAX_TRANSACTIONS).map((r) => ({
    date: String(r.date ?? ''),
    amount: Number(r.amount) || 0,
    currency: 'EUR',
    description: String(r.description ?? ''),
    counterpartName: (r.counterpart_name as string | null) ?? null,
    counterpartIban: (r.counterpart_iban as string | null) ?? null,
    reference: (r.reference as string | null) ?? null,
    transactionId: String(r.id ?? ''),
    rawLine: '',
  }))

  return {
    ...proveOpenInvoices(invoices, transactions),
    bankThrough,
    readFailed: false,
    capped: { invoices: cappedInvoices, transactions: cappedTransactions },
  }
}
