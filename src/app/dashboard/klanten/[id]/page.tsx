// src/app/dashboard/klanten/[id]/page.tsx
// [KLANTEN] Customer detail — the mini-CRM view (gateway #2): contact + notes + the full
// invoice history and running totals for one customer. Server-rendered (RLS), then a small
// client for notes editing + quick actions.
export const dynamic = 'force-dynamic'

import { redirect } from 'next/navigation'
import { createServerSupabaseClient } from '@/lib/supabase-server'
import { getSessionUser } from '@/lib/session-user'
import KlantDetailClient, { type KlantInvoice } from './KlantDetailClient'
import { fetchAllRows } from '@/lib/supabase-paginate'
import { round2 } from '@/lib/invoice-totals'
import { clientPaymentBehaviour } from '@/lib/client-payment-behaviour'
import { amsterdamTodayDayNumber } from '@/lib/invoice-reminders'
// [DEEL-CREDIT] "Openstaand" has ONE definition in this app and it lives here. This screen used to
// spell its own; see the note at the totals below for what that cost.
import { summarise, type SalesInvoice } from '@/lib/sales-overview'
import { creditedTotalsFrom } from '@/lib/credited-invoices'

/**
 * De klok, één keer gelezen, buiten de render om — dezelfde vorm als readClock() op /verkoop en
 * /accountant/debiteuren. `Date.now()` in het lichaam van een component is onzuiver, ook in een
 * servercomponent.
 */
function readClock(): number {
  return new Date().getTime()
}

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createServerSupabaseClient()
  // [WATERVAL] Memoised per request (session-user.ts) — the dashboard layout above already asked.
  const user = await getSessionUser()
  if (!user) redirect('/login')

  const { data: client } = await supabase
    .from('clients')
    .select('id, name, email, kvk_number, btw_number, iban, address, postal_code, city, notes')
    .eq('id', id)
    .eq('user_id', user.id)
    .maybeSingle()
  if (!client) redirect('/dashboard/klanten')

  type KlantInvoiceRow = { id: string; invoice_number: string | null; invoice_date: string | null; due_date: string | null; status: string | null; total_inc_btw: number | null; direction: string | null; payment_date: string | null; amount_paid: number | null; invoice_type: string | null; original_invoice_id: string | null }

  // This customer's invoices: linked by the robust client_id, PLUS legacy invoices that
  // predate the link (client_id NULL, matched by the name snapshot). Both scoped to the
  // owner's outgoing invoices. Two queries keeps the name match safe from filter-string
  // injection (a client name can contain commas/parentheses).
  // [VOL-GELEZEN] Gepagineerd: dit scherm belooft "de volledige factuurhistorie en lopende
  // totalen", en PostgREST kapt elk antwoord stil op ~1000 rijen — een vaste klant voorbij de
  // duizend kreeg stil te lage "Gefactureerd"/"Openstaand" totalen (dagslot-audit).
  const base = () => supabase
    .from('invoices')
    // [BETAALGEDRAG] payment_date joins the select: it is what turns this history into a measured
    // betaalgedrag instead of a note the owner types from memory (kld.notitiesHint).
    // [DEEL-CREDIT] amount_paid, invoice_type and original_invoice_id are what turn the totals
    // below into the app's own definition of openstaand instead of this screen's private one.
    .select('id, invoice_number, invoice_date, due_date, status, total_inc_btw, direction, payment_date, amount_paid, invoice_type, original_invoice_id')
    .eq('sender_id', user.id)
    .eq('direction', 'outgoing')
  const [byId, byName] = await Promise.all([
    fetchAllRows<KlantInvoiceRow>((from, to) =>
      base().eq('client_id', id).order('id', { ascending: true }).range(from, to)),
    fetchAllRows<KlantInvoiceRow>((from, to) =>
      base().is('client_id', null).eq('client_name', client.name).order('id', { ascending: true }).range(from, to)),
  ])
  const seen = new Set<string>()
  const invoices: KlantInvoice[] = [...(byId ?? []), ...(byName ?? [])]
    .filter((iv) => (seen.has(iv.id) ? false : (seen.add(iv.id), true)))
    .map((iv) => ({
      id: iv.id, invoice_number: iv.invoice_number, invoice_date: iv.invoice_date,
      due_date: iv.due_date, status: iv.status, total_inc_btw: iv.total_inc_btw,
      payment_date: iv.payment_date, amount_paid: iv.amount_paid,
      invoice_type: iv.invoice_type, original_invoice_id: iv.original_invoice_id,
    }))
    .sort((a, b) => (b.invoice_date ?? '').localeCompare(a.invoice_date ?? ''))

  // ── [DEEL-CREDIT] The two numbers above the history ────────────────────────────────────────
  //
  // "Openstaand" was `sum(total_inc_btw) over everything whose status is not 'paid'`. Three
  // different things were wrong with that at once, and all three inflate it:
  //
  //   · it never subtracted amount_paid, so a € 1.000 invoice with € 900 already matched from the
  //     bank counted as € 1.000 — while the reminder mail and the pay-QR asked for € 100;
  //   · it counted CONCEPTEN, which nobody owes and which may never be sent at all;
  //   · it counted an ARCHIVED or CANCELLED invoice, which stateOf calls 'vervallen' precisely
  //     because including it produces a number that is wrong.
  //
  // This is the screen the owner opens before telephoning that customer, and it disagreed with
  // the debiteurenlijst, the daily-truth tile and the reminder mail — all three of which already
  // go through summarise()/openAmount(). So it goes through the same engine now: one definition,
  // and the credit notes this customer holds are netted against the invoices they credit rather
  // than being counted as debts of their own.
  const credited = creditedTotalsFrom(
    invoices.filter((iv) => (iv.invoice_type ?? 'factuur') === 'creditnota'),
  )
  const nowMs = readClock()
  const sales: SalesInvoice[] = invoices.map((iv) => ({
    id: iv.id, invoice_number: iv.invoice_number, client_name: client.name, client_email: client.email,
    invoice_date: iv.invoice_date, due_date: iv.due_date, total_inc_btw: iv.total_inc_btw,
    amount_paid: iv.amount_paid, status: iv.status, invoice_type: iv.invoice_type,
  }))
  const open = summarise(sales, nowMs, credited).outstanding
  // "Gefactureerd" is what actually went out: a concept was never sent, a vervallen invoice was
  // withdrawn, and a creditnota is stored negative — so it subtracts here exactly as it did on
  // paper. The old sum counted all three the wrong way round.
  const billed = round2(
    invoices.reduce((s, iv) => {
      const st = (iv.status ?? '').toLowerCase()
      if (st === 'draft' || st === 'archived' || st === 'cancelled' || st === 'credited') return s
      return s + (iv.total_inc_btw ?? 0)
    }, 0),
  )

  // [BETAALGEDRAG] Computed here, where the clock lives — the engine takes the Amsterdam day as a
  // number and stays pure. The client turns it into sentences, because that is where the locale is.
  const behaviour = clientPaymentBehaviour(invoices, amsterdamTodayDayNumber())

  return (
    <KlantDetailClient
      client={client}
      invoices={invoices}
      totals={{ billed, open, count: invoices.length }}
      behaviour={behaviour}
    />
  )
}
