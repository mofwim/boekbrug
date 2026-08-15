// src/modules/accountant/work-queues.ts
// [WERKVOORRAAD] What is waiting for the accountant, in numbers, on the page he opens first.
//
// ── WHY THIS FILE EXISTS ──
// Four screens were built for the accountant — factureren, debiteuren, opvragen, bevestigen — and
// the portal home linked to all four as TILES. A tile is a door with nothing written on it. An
// accountant opening the portal could not see that twelve documents were holding up a quarter, or
// that €4.200 had been overdue for two months, without clicking each door in turn to find out.
//
// That is the difference between a control panel and a launcher, and it is not a cosmetic one:
// work you have to go looking for is work that waits. The whole premise of this portal is that the
// entrepreneur leans on his accountant; an accountant who has to remember to check four places
// leans back.
//
// ── WHY THE NUMBERS ARE SCOPED TO MANDATES, NOT TO LINKS ──
// Same boundary as the screens themselves. Seeing an administration is a LINK; acting inside it —
// invoicing in someone's name, mailing his customers, booking his purchase invoices — is a
// MANDATE. A count that ignored that would promise work the accountant is not allowed to do, and
// send him to a screen that correctly refuses him. So a zero here has two very different causes,
// and the home says which: nothing to do, or nobody has authorised you yet.
//
// ── WHY IT NEVER THROWS ──
// This runs on the accountant's FIRST screen. A missing migration (`kind` arrived with
// accountant_confirm_mandate.sql), an unreachable table, a slow query — none of those may turn the
// portal into an error page for the sake of a number. Every read is wrapped and every failure
// reads as "nothing known", which renders as a home without the work row rather than no home.
//
// NOTE ON LANGUAGE: identifiers and comments are English (AGENTS.md); the two Dutch strings are
// screen text and belong to the reader, not to the code.

import { createPipelineClient } from '@/lib/supabase-pipeline'
import { daysLate } from '@/lib/accountant-debtors'
import { outstandingAmount, type SalesInvoice } from '@/lib/sales-overview'
import { fullyCreditedIdsFrom, filterOpenReceivables, creditedTotalsFrom } from '@/lib/credited-invoices'

/** Minimal shape of the session client — the same relaxed form the screens use. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SessionClient = any

export interface WorkQueues {
  /** Purchase invoices waiting to be confirmed, at clients who authorised confirming. */
  toConfirm: number
  /** Overdue sales invoices at clients who authorised invoicing. */
  overdueCount: number
  /** What stands open on those, in euros. */
  overdueTotal: number
  /** Days late on the oldest of them — the number that says how bad it is. */
  worstDaysLate: number
  /** How many clients authorised invoicing/reminding, and confirming. */
  mandatedForInvoices: number
  mandatedForConfirm: number
  /**
   * Did every read succeed?
   *
   * False means a zero above is "we do not know", not "there is nothing". The home must not
   * present an unknown as an all-clear — that is the one way a work counter can do harm.
   */
  complete: boolean
}

const EMPTY: WorkQueues = {
  toConfirm: 0,
  overdueCount: 0,
  overdueTotal: 0,
  worstDaysLate: 0,
  mandatedForInvoices: 0,
  mandatedForConfirm: 0,
  complete: false,
}

/**
 * The client ids this accountant may ACT for, for one kind of mandate.
 *
 * Permission with the session client (RLS hands an accountant only his own mandates), then
 * intersected with the actual link — a mandate without a link is a mandate from a stranger, and
 * the database demands both anyway (has_active_invoice_mandate joins on accountant_clients).
 *
 * `kind` only exists after accountant_confirm_mandate.sql. A failure there is not an error, it is
 * an older database: the answer is then "nobody", which is exactly what it was before that
 * migration.
 */
async function mandatedClientIds(
  supabase: SessionClient,
  accountantId: string,
  kind: 'facturen' | 'bevestigen',
): Promise<string[] | null> {
  try {
    const { data: mandates, error } = await supabase
      .from('accountant_invoice_mandates')
      .select('zzper_id')
      .eq('accountant_id', accountantId)
      .eq('kind', kind)
      .is('revoked_at', null)
    if (error) return null

    const ids = Array.from(
      new Set((mandates ?? []).map((m: { zzper_id: string | null }) => m.zzper_id).filter(Boolean)),
    ) as string[]
    if (ids.length === 0) return []

    const { data: links, error: linkError } = await supabase
      .from('accountant_clients')
      .select('zzper_id')
      .eq('accountant_id', accountantId)
      .in('zzper_id', ids)
    if (linkError) return null

    return Array.from(
      new Set((links ?? []).map((l: { zzper_id: string | null }) => l.zzper_id).filter(Boolean)),
    ) as string[]
  } catch {
    return null
  }
}

/**
 * The two work queues, as numbers.
 *
 * Deliberately two queries and not a per-client fan-out. The comment on the home's page.tsx
 * records what that costs: getAccountantOverview once re-fetched the roster and ran five queries
 * per client, which at thirty clients was three hundred queries on the slowest screen the
 * accountant opens. A counter that makes the page it decorates slow is not worth its number.
 */
export async function getAccountantWorkQueues(
  supabase: SessionClient,
  accountantId: string,
  nowMs: number,
): Promise<WorkQueues> {
  const [invoiceClients, confirmClients] = await Promise.all([
    mandatedClientIds(supabase, accountantId, 'facturen'),
    mandatedClientIds(supabase, accountantId, 'bevestigen'),
  ])

  // A null anywhere means a read failed. Report what we do know, but never as complete.
  const complete = invoiceClients !== null && confirmClients !== null
  const forInvoices = invoiceClients ?? []
  const forConfirm = confirmClients ?? []

  const result: WorkQueues = {
    ...EMPTY,
    mandatedForInvoices: forInvoices.length,
    mandatedForConfirm: forConfirm.length,
    complete,
  }

  // service_role for the data, explicitly bounded to the ids we just proved — the same pattern
  // as accountant-access.ts and both screens: the PERMISSION is established with the session,
  // the DATA is fetched scoped afterwards.
  const pipeline = createPipelineClient()

  const [confirmCount, overdue] = await Promise.all([
    countAwaitingConfirmation(pipeline, forConfirm),
    sumOverdue(pipeline, forInvoices, nowMs),
  ])

  return {
    ...result,
    toConfirm: confirmCount ?? 0,
    overdueCount: overdue?.count ?? 0,
    overdueTotal: overdue?.total ?? 0,
    worstDaysLate: overdue?.worst ?? 0,
    complete: complete && confirmCount !== null && overdue !== null,
  }
}

/** How many purchase invoices are holding up a quarter. Null = we could not find out. */
async function countAwaitingConfirmation(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  pipeline: any,
  clientIds: string[],
): Promise<number | null> {
  if (clientIds.length === 0) return 0
  try {
    const { count, error } = await pipeline
      .from('invoices')
      .select('id', { count: 'exact', head: true })
      .in('receiver_id', clientIds)
      .eq('direction', 'incoming')
      .eq('status', 'processing')
    if (error) return null
    return Number(count ?? 0)
  } catch {
    return null
  }
}

/**
 * Money that is late, and how late the oldest of it is. Null = we could not find out.
 *
 * [CREDITNOTA-NO-CHASE] The same filter the debtor board runs, and for the same reason: a
 * creditnota arrives as a PAIR and outstandingAmount() takes the absolute value, so without it a
 * refund the entrepreneur OWES shows up as money he is owed — twice, and both times wrong. The
 * home is the last place that may be wrong about which way money is pointing.
 */
async function sumOverdue(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  pipeline: any,
  clientIds: string[],
  nowMs: number,
): Promise<{ count: number; total: number; worst: number } | null> {
  if (clientIds.length === 0) return { count: 0, total: 0, worst: 0 }
  try {
    const { data, error } = await pipeline
      .from('invoices')
      .select('id, invoice_date, due_date, total_inc_btw, amount_paid, status, invoice_type, original_invoice_id')
      .in('sender_id', clientIds)
      .eq('direction', 'outgoing')
      .in('status', ['sent', 'overdue', 'partial'])
      .limit(2000)
    if (error) return null

    const all = (data ?? []) as unknown as Array<
      SalesInvoice & { invoice_type?: string | null; original_invoice_id?: string | null }
    >
    // [DEEL-CREDIT] Dekkend gecrediteerd = van de lijst; deels gecrediteerd = de rest telt nog.
    const creditnotas = all.filter((r) => r.invoice_type === 'creditnota')
    const rows = filterOpenReceivables(all, fullyCreditedIdsFrom(creditnotas, all))
    // …en "de rest" is het totaal MINUS wat er is gecrediteerd. Zonder deze regel haalde de vorige
    // regel wel de volledig gecrediteerde facturen van de lijst, maar prijsde ze de deels
    // gecrediteerde op hun volle bedrag — het openstaande totaal dat de boekhouder ziet stond dan
    // te hoog met precies het bedrag dat de ondernemer zwart-op-wit heeft teruggegeven.
    const gecrediteerd = creditedTotalsFrom(creditnotas)

    let count = 0
    let total = 0
    let worst = 0
    for (const row of rows) {
      const late = daysLate(row, nowMs)
      if (late <= 0) continue
      const open = outstandingAmount(row, gecrediteerd.get(row.id) ?? 0)
      if (open <= 0) continue
      count += 1
      total += open
      if (late > worst) worst = late
    }
    return { count, total, worst }
  } catch {
    return null
  }
}
