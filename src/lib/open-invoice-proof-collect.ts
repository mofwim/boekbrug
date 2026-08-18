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
import { proveIncomingPayments, proveOpenInvoices, type ProofDirection } from './open-invoice-proof'
import type { OpenInvoiceProofResult } from './open-invoice-proof-types'
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

// The shape this returns is declared with the other shapes, not here: the sentences are built
// from it, and the text module may not import a file that talks to the database. Re-exported so
// every caller keeps the import it already had.
export type { OpenInvoiceProofResult } from './open-invoice-proof-types'

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
  /**
   * Which side of the books. 'incoming' — the bills the owner PAYS, and the money is a debit.
   * 'outgoing' — the invoices the owner ISSUED, and the money arrives as a credit.
   *
   * The engine already reads the sign, so this changes only the two things it cannot know: which
   * column identifies the owner (receiver_id or sender_id), and which statuses mean "issued and
   * not yet settled".
   */
  direction?: ProofDirection
  /**
   * [HERINNER-BEWIJS] Narrow the question to specific invoices, without narrowing the SEARCH.
   *
   * The reminder path asks about one invoice at a time ("is this customer's payment already in the
   * bank, before I chase them?"). It could not simply run its own query: the filtering has to
   * happen AFTER the pairing, because a bank line only becomes evidence when the engine has seen
   * it beside every open invoice — a payment that fits this invoice AND fits three others is
   * exactly the pairing a per-invoice query would have called certain.
   *
   * Undefined = every open invoice, which is what both screens ask for.
   */
  invoiceIds?: readonly string[]
}): Promise<OpenInvoiceProofResult> {
  const direction: ProofDirection = args.direction ?? 'incoming'
  const wanted = args.invoiceIds ? new Set(args.invoiceIds) : null
  const empty: OpenInvoiceProofResult = {
    direction, checkedInvoices: 0, checkedTransactions: 0, hits: [],
    bankThrough: null, readFailed: false, capped: { invoices: 0, transactions: 0 },
    incoming: null,
  }

  // ── The open bills ──
  let invoiceRows: Array<Record<string, unknown>>
  try {
    invoiceRows = await fetchAllRows((from, to) => args.pipeline
      .from('invoices')
      .select('id, invoice_number, client_name, total_inc_btw, amount_paid, invoice_date, due_date, direction, status, accountant_status, vendor_iban, payment_reference, payment_prepared_at, invoice_type')
      // The owner is the RECEIVER of a purchase invoice and the SENDER of a sales one.
      .eq(direction === 'outgoing' ? 'sender_id' : 'receiver_id', args.ownerId)
      .eq('direction', direction)
      // 'received' = a purchase invoice a human confirmed and has not paid. On the sales side the
      // same state is 'sent' or 'overdue' — 'draft' was never issued, so nobody can have paid it.
      .in('status', direction === 'outgoing' ? ['sent', 'overdue'] : ['received'])
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
    direction,
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

  // ── The payments that are not attached to anything ──
  //
  // The window starts a month before the OLDEST open invoice: a payment made before the bill
  // existed is not that bill's payment, and the month of slack absorbs a prepayment and a date
  // read a few days off.
  //
  // With nothing open there is no such anchor, and this used to return early — answering "niets te
  // controleren" about an owner who may well be receiving money into a book with no invoices in
  // it, which is precisely the state [BINNENGEKOMEN-BEWIJS] exists to name. The window is then the
  // same month measured back from the newest bank line, and the panel states it either way.
  const anchor = invoices[0]?.invoice_date ?? bankThrough ?? '1970-01-01'
  const since = daysBefore(anchor, LOOKBACK_DAYS)
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

  const proof = proveOpenInvoices(invoices, transactions, direction)
  // [BINNENGEKOMEN-BEWIJS] The same two sets, asked the other question. Only on the sales side:
  // an unattached CREDIT there is a customer payment, while on the purchase side it would be a
  // refund or a deposit — a different question with a different answer.
  const incoming = direction === 'outgoing'
    ? proveIncomingPayments(invoices, transactions)
    : null
  // The counts stay whole on purpose. `checkedInvoices` is the SCOPE of the search, and the search
  // really did hold this payment against all of them — reporting the caller's shortlist instead
  // would turn the one honest number on the panel into a smaller, flattering one.
  return {
    ...proof,
    hits: wanted ? proof.hits.filter((h) => wanted.has(h.invoiceId)) : proof.hits,
    bankThrough,
    readFailed: false,
    capped: { invoices: cappedInvoices, transactions: cappedTransactions },
    incoming,
  }
}
