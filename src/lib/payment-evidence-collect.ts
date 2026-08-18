// src/lib/payment-evidence-collect.ts
// [BETAALBEWIJS] The reads behind the evidence. Server-only; the rule is pure and lives in
// payment-evidence.ts.
//
// Two reads for a whole screen, not two per row: the links for every invoice shown, then the bank
// lines those links point at. A per-invoice fetch would be an N+1 on the list the owner opens most.
//
// [DEPLOY-SAFE] bank_tx_invoices arrives by a hand-applied migration. Where it does not exist yet
// every invoice comes back 'unknown' rather than 'none' — "we could not look" is the truth there,
// and 'none' would tell the owner their payments have no evidence when what is missing is a table.

import { fetchAllRows } from './supabase-paginate'
import { classifyPayment, type PaymentEvidence, type PaymentLink } from './payment-evidence'
import { isMissingRelation } from './pg-missing'

export async function collectPaymentEvidence(args: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  pipeline: any
  ownerId: string
  invoiceIds: readonly string[]
}): Promise<Record<string, PaymentEvidence>> {
  const out: Record<string, PaymentEvidence> = {}
  if (args.invoiceIds.length === 0) return out

  // A failed read must reach every row as 'unknown', never as an absent key the screen renders as
  // nothing — the same distinction classifyPayment(null) exists for.
  const allUnknown = (): Record<string, PaymentEvidence> => {
    for (const id of args.invoiceIds) out[id] = { kind: 'unknown' }
    return out
  }

  let links: Array<Record<string, unknown>>
  try {
    links = await fetchAllRows((from, to) => args.pipeline
      .from('bank_tx_invoices')
      .select('invoice_id, transaction_id, amount_applied, paid_on, method')
      .eq('user_id', args.ownerId)
      .in('invoice_id', [...args.invoiceIds])
      .order('invoice_id', { ascending: true })
      .range(from, to))
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    if (isMissingRelation(message)) return allUnknown()
    console.error('[BETAALBEWIJS] payment links unreadable', { ownerId: args.ownerId, error: message })
    return allUnknown()
  }

  const txIds = [...new Set(links.map((l) => l.transaction_id).filter((v): v is string => typeof v === 'string' && v !== ''))]
  const byTx = new Map<string, NonNullable<PaymentLink['transaction']>>()
  if (txIds.length > 0) {
    try {
      const rows = await fetchAllRows<Record<string, unknown>>((from, to) => args.pipeline
        .from('bank_transactions')
        .select('id, date, amount, description, counterpart_name, counterpart_iban')
        .eq('user_id', args.ownerId)
        .in('id', txIds)
        .order('id', { ascending: true })
        .range(from, to))
      for (const r of rows) {
        byTx.set(String(r.id), {
          date: (r.date as string | null) ?? null,
          amount: (r.amount as number | null) ?? null,
          description: (r.description as string | null) ?? null,
          counterpartName: (r.counterpart_name as string | null) ?? null,
          counterpartIban: (r.counterpart_iban as string | null) ?? null,
        })
      }
    } catch (e) {
      // The LINKS read succeeded, so the shape of the payment is known — only the statement text
      // is missing. Reporting unknown for everything here would throw away a true answer; the
      // link without its transaction still says "a bank line carries this", which is the claim
      // that matters. What is lost is the sentence the owner recognises, and nothing more.
      console.warn('[BETAALBEWIJS] bank lines unreadable — the evidence stays without its text', {
        ownerId: args.ownerId, error: e instanceof Error ? e.message : String(e),
      })
    }
  }

  const perInvoice = new Map<string, PaymentLink[]>()
  for (const l of links) {
    const id = String(l.invoice_id ?? '')
    if (!id) continue
    const txId = typeof l.transaction_id === 'string' && l.transaction_id !== '' ? l.transaction_id : null
    const list = perInvoice.get(id) ?? []
    list.push({
      transactionId: txId,
      amountApplied: Number(l.amount_applied) || 0,
      paidOn: (l.paid_on as string | null) ?? null,
      method: (l.method as string | null) ?? null,
      transaction: txId ? byTx.get(txId) ?? null : null,
    })
    perInvoice.set(id, list)
  }

  for (const id of args.invoiceIds) out[id] = classifyPayment(perInvoice.get(id) ?? [])
  return out
}
