// src/app/dashboard/bank/verdelen/[txId]/page.tsx
// [BETAALPLAN] Server component: auth, de bankregel, en de facturen die deze betaling MAG raken.
//
// De richtingsgrens valt hier, niet op het scherm. Geld dat wegging betaalt inkoopfacturen; geld
// dat binnenkwam betaalt verkoopfacturen. Een lijst die de verkeerde kant toont, nodigt uit tot een
// fout die daarna nergens meer opvalt — een afschrijving geboekt op een verkoopfactuur meldt omzet
// die nooit is binnengekomen, en geen enkel scherm verderop kan zien dat dat niet zo is.
//
// De server stuurt dus alleen wat mag. payment-plan.ts weigert het bovendien nóg een keer, en de
// route weigert het een derde keer: dit is geen dubbelop maar de volgorde waarin geld hoort te
// worden bewaakt — het scherm helpt, de server beslist.

import { redirect } from 'next/navigation'
import { createServerSupabaseClient } from '@/lib/supabase-server'
import { createPipelineClient } from '@/lib/supabase-pipeline'
import { settleableDirection } from '@/lib/payment-plan'
import VerdeelClient, { type VerdeelFactuur } from './VerdeelClient'

export const dynamic = 'force-dynamic'

export default async function VerdeelPage({ params }: { params: Promise<{ txId: string }> }) {
  const { txId } = await params
  const supabase = await createServerSupabaseClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const pipeline = createPipelineClient()

  const { data: tx } = await pipeline
    .from('bank_transactions')
    .select('id, amount, date, description, counterpart_name, user_id')
    .eq('id', txId)
    .eq('user_id', user.id)
    .maybeSingle()
  if (!tx) redirect('/dashboard/bank')

  // Wat eerdere koppelingen al van deze regel namen. Een koppeling zonder bedrag stamt van vóór
  // bank_tx_invoices_amount.sql en verrekende per definitie de hele factuur — als 0 lezen zou
  // dezelfde euro's twee keer laten uitgeven.
  let alreadyAllocated = 0
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: links } = await (pipeline as any)
      .from('bank_tx_invoices')
      .select('invoice_id, amount')
      .eq('transaction_id', txId)
      .eq('user_id', user.id)
    const rows = (links ?? []) as Array<{ invoice_id: string; amount: number | null }>
    const unpriced = rows.filter((r) => r.amount == null).map((r) => r.invoice_id)
    for (const r of rows) if (r.amount != null) alreadyAllocated += Math.abs(Number(r.amount) || 0)
    if (unpriced.length > 0) {
      const { data: olds } = await pipeline
        .from('invoices')
        .select('id, total_inc_btw')
        .in('id', unpriced)
      for (const o of olds ?? []) alreadyAllocated += Math.abs(Number(o.total_inc_btw) || 0)
    }
  } catch {
    /* zonder deze telling is het scherm ruimer dan nodig; de route weigert alsnog */
  }

  const richting = settleableDirection(Number(tx.amount) || 0)

  const { data: invRows } = await pipeline
    .from('invoices')
    .select('id, direction, invoice_type, invoice_number, client_name, invoice_date, total_inc_btw, amount_paid, accountant_status')
    .or(`sender_id.eq.${user.id},receiver_id.eq.${user.id}`)
    .eq('direction', richting)
    .in('status', richting === 'incoming' ? ['received', 'overdue', 'partial'] : ['sent', 'overdue', 'partial'])
    .order('invoice_date', { ascending: true })
    .limit(300)

  const facturen: VerdeelFactuur[] = (invRows ?? [])
    // Een factuur die de boekhouder al verwerkte is dicht voor nieuw geld — hem tonen zou een
    // keuze aanbieden die de server een klik later weigert.
    .filter((r) => r.accountant_status !== 'verwerkt')
    .map((r) => {
      const total = Math.abs(Number(r.total_inc_btw) || 0)
      const paid = Math.abs(Number(r.amount_paid) || 0)
      return {
        id: r.id,
        direction: richting,
        invoiceType: r.invoice_type,
        totalIncBtw: r.total_inc_btw,
        amountPaid: r.amount_paid,
        invoiceNumber: r.invoice_number,
        partyName: r.client_name,
        invoiceDate: r.invoice_date,
        open: Math.round(Math.max(0, total - paid) * 100) / 100,
      }
    })
    .filter((f) => f.open > 0.005)

  return (
    <VerdeelClient
      transactie={{
        id: tx.id,
        amount: Number(tx.amount) || 0,
        date: tx.date,
        description: tx.description,
        counterpartName: tx.counterpart_name,
        alreadyAllocated,
      }}
      facturen={facturen}
    />
  )
}
