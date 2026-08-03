// src/lib/incasso-settle.ts
// [AUTO-INCASSO] The pass that books what the bank already collected.
//
// The decision itself lives in auto-incasso.ts and is pure. This file is the I/O around it: which
// suppliers the owner marked, which of their invoices are still open, and the one write per
// invoice that turns "still to pay" into "paid on the vervaldatum".
//
// ── THE WRITE GOES THROUGH THE SAME DOOR AS EVERY OTHER PAYMENT ──
// apply_manual_payment, exactly as the "Betaald" toggle calls it. Not an UPDATE on invoices: the
// money invariant of this app is `invoices.amount_paid = SUM(bank_tx_invoices.amount_applied)`,
// and a direct status write satisfies neither side of it. The RPC takes the row lock, re-checks
// 'verwerkt' and the payable status under it, clamps the amount, and writes the bank_tx_invoices
// row that keeps the invariant true. An automatic booking is exactly the kind that must not get
// its own shortcut.
//
// ── payment_method STAYS 'bank' ──
// Because it is true: the money left the bank account. What is NOT true is that anyone watched it
// happen, and that is recorded on the invoice itself (field_confidence._auto_incasso), not only in
// the audit log — so a later bank line can confirm this booking, and a storno is findable rather
// than invisible.
//
// ── BEST-EFFORT, PER USER, NEVER FATAL ──
// Same contract as its neighbours in the hourly reconcile (runBankAutoConfirm,
// reconcileCashSettlements): one owner's failure never stops the rest, nothing throws to the
// caller, and a pass that could not run says so (`ok: false`) instead of reporting an empty
// success — a silent no-op here would look exactly like an owner who has no incasso suppliers.

import { createHash } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'

import { fetchAllRows } from '@/lib/supabase-paginate'
import { supplierNameKey } from '@/lib/supplier-registry'
import { reportHandledFailure } from '@/lib/report-handled'
import {
  incassoDecision,
  withIncassoMark,
  INCASSO_HOLD_REASON,
  type IncassoInvoice,
  type IncassoHold,
} from '@/lib/auto-incasso'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = SupabaseClient<any>

/** The columns the decision needs, plus what the marker write and the summary need. */
const INCASSO_COLS = 'id, invoice_number, client_name, status, direction, accountant_status, invoice_type, invoice_date, due_date, total_ex_btw, btw_amount, total_inc_btw, amount_paid, field_confidence, supplier_id' as const

/** One invoice this pass settled — enough for the owner to recognise it without a second read. */
export interface IncassoBooked {
  invoiceId: string
  invoiceNumber: string | null
  supplier: string | null
  amount: number
  paidOn: string
}

/** One invoice this pass deliberately did NOT settle, and why — in Dutch, ready to show. */
export interface IncassoHeld {
  invoiceId: string
  invoiceNumber: string | null
  supplier: string | null
  hold: IncassoHold
  reason: string
}

export interface IncassoSettleSummary {
  /** False when the pass could not run at all. Never presented as "nothing to do". */
  ok: boolean
  booked: IncassoBooked[]
  held: IncassoHeld[]
  /** True when the auto_incasso column does not exist yet — the feature is simply off. */
  unsupported?: boolean
}

const BAILED: IncassoSettleSummary = { ok: false, booked: [], held: [] }

/**
 * [DEPLOY-SAFE] Does this database have the column yet?
 *
 * Code ships before a migration is applied. Every reader must treat that window as "no supplier is
 * on incasso", which is precisely today's behaviour — not as an error, and above all not as an
 * empty answer that reads like "you have none". Cached after the first success: the column cannot
 * disappear, and the probe is one round trip per process otherwise.
 */
let incassoColumnKnown = false
export async function incassoSupported(supabase: Client): Promise<boolean> {
  if (incassoColumnKnown) return true
  try {
    const { error } = await supabase.from('suppliers').select('auto_incasso').limit(1)
    if (error) return false
    incassoColumnKnown = true
    return true
  } catch {
    return false
  }
}

/** The suppliers this owner marked as collecting automatically. */
export interface IncassoSupplier {
  id: string
  name: string
  nameKey: string | null
}

/**
 * Read them, honestly.
 *
 * Throws on a failed read rather than returning `[]`. [NO-SILENT-EMPTY]: an empty list here means
 * "this owner marked nobody", and every caller acts on that by leaving the invoices alone and
 * showing the Betalen button again. A database hiccup must not be able to produce that sentence.
 */
export async function readIncassoSuppliers(supabase: Client, userId: string): Promise<IncassoSupplier[]> {
  const { data, error } = await supabase
    .from('suppliers')
    .select('id, name, name_key')
    .eq('user_id', userId)
    .eq('auto_incasso', true)
  if (error) throw new Error(error.message)
  return (data ?? []).map((r: { id: string; name: string; name_key: string | null }) => ({
    id: r.id, name: r.name, nameKey: r.name_key,
  }))
}

/**
 * Does this invoice belong to one of them?
 *
 * Two keys, because an invoice may carry either. supplier_id is the strong one and is what recent
 * imports store; name_key is the fallback that also reaches the rows imported before the registry
 * existed — which, on a screen full of years-old rent invoices, is most of them.
 */
export function belongsToIncassoSupplier(
  inv: { client_name?: string | null; supplier_id?: string | null },
  suppliers: IncassoSupplier[],
): IncassoSupplier | null {
  if (suppliers.length === 0) return null
  if (inv.supplier_id) {
    const byId = suppliers.find((s) => s.id === inv.supplier_id)
    if (byId) return byId
  }
  const key = supplierNameKey(inv.client_name)
  if (!key) return null
  return suppliers.find((s) => s.nameKey === key) ?? null
}

/**
 * A stable idempotency key for one collection.
 *
 * apply_manual_payment already refuses a second booking on a paid invoice, so this is the second
 * lock rather than the only one — but the two callers of this pass (the hourly cron and the moment
 * the owner flips the switch) can genuinely run at the same second, and "the row lock decided it"
 * is a weaker promise than "there is only one key". Derived from the invoice and the date it is
 * booked on, so a re-run produces the same key and the RPC reports the already-booked state.
 */
export function incassoClientKey(invoiceId: string, paidOn: string): string {
  const h = createHash('sha256').update(`auto-incasso:${invoiceId}:${paidOn}`).digest('hex')
  // Shape it as a v5-style uuid — the RPC's parameter is a uuid and the route validates the shape.
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`
}

/**
 * Book every collection that has run, for one owner.
 *
 * `payClient` is the client whose identity the RPC sees. From the cron that is service-role
 * (auth.uid() NULL, user pinned by p_user_id); from a request it is the session client, so the
 * database's own 'verwerkt' trigger fires with a real auth.uid(). Both are correct; passing it in
 * keeps this pass usable from either without a second implementation.
 */
export async function settleIncassoForUser(
  supabase: Client,
  payClient: Client,
  userId: string,
  today: string,
): Promise<IncassoSettleSummary> {
  try {
    if (!(await incassoSupported(supabase))) return { ok: true, booked: [], held: [], unsupported: true }

    const suppliers = await readIncassoSuppliers(supabase, userId)
    if (suppliers.length === 0) return { ok: true, booked: [], held: [] }

    // Every OPEN purchase invoice. Paged past PostgREST's silent ~1000-row ceiling for the same
    // reason the Crediteuren screen is: an owner with a backlog is exactly the owner this helps,
    // and a truncated read would leave the oldest ones — the ones wearing "te laat" — behind.
    const rows = await fetchAllRows<Record<string, unknown>>((from, to) => supabase
      .from('invoices')
      .select(INCASSO_COLS)
      .eq('receiver_id', userId)
      .eq('direction', 'incoming')
      .eq('status', 'received')
      .order('id', { ascending: true })
      .range(from, to)
    )

    const booked: IncassoBooked[] = []
    const held: IncassoHeld[] = []

    for (const raw of rows) {
      const inv = raw as unknown as IncassoInvoice & { supplier_id?: string | null; field_confidence: Record<string, unknown> | null }
      const supplier = belongsToIncassoSupplier(inv, suppliers)
      if (!supplier) continue

      const decision = incassoDecision(inv, today)
      if (!decision.settle) {
        // 'not-yet-due' is the normal, expected state of an invoice waiting for its collection
        // date — reporting it as "held" every hour would bury the four that mean something.
        if (decision.hold !== 'not-yet-due') {
          held.push({
            invoiceId: inv.id, invoiceNumber: inv.invoice_number ?? null, supplier: supplier.name,
            hold: decision.hold, reason: INCASSO_HOLD_REASON[decision.hold],
          })
        }
        continue
      }

      const { data: applyRows, error } = await payClient.rpc('apply_manual_payment', {
        p_user_id: userId,
        p_invoice_id: inv.id,
        p_amount: null,                       // settle the whole remaining balance
        p_pay_date: decision.paymentDate,     // the vervaldatum — the day the bank moved it
        p_method: 'bank',                     // true: the money left the bank account
        p_payable_statuses: ['received'],
        p_client_key: incassoClientKey(inv.id, decision.paymentDate),
      })
      if (error) {
        // Every refusal here is one the RPC is right to make (already paid, verwerkt, a status
        // that moved under us). It is not this pass's job to argue with the row lock — the invoice
        // simply stays open and visible, which is the safe side of every one of those cases.
        const msg = (error.message ?? '').toLowerCase()
        if (!msg.includes('already') && !msg.includes('verwerkt') && !msg.includes('not payable')) {
          console.error('[AUTO-INCASSO] booking failed', { userId, invoiceId: inv.id, error: error.message })
        }
        continue
      }
      const row = Array.isArray(applyRows)
        ? (applyRows[0] as { applied: number; is_paid: boolean; duplicate: boolean } | undefined)
        : undefined
      if (!row || row.duplicate === true) continue

      // The assumption, written where a later reader will find it. Deliberately AFTER the payment
      // and never rolled back over: a correct booking must not be undone because a marker failed
      // to save. But it cannot be silent either — without it, an assumed payment is
      // indistinguishable from an observed one, which is the whole reason the marker exists.
      const { error: markErr } = await payClient
        .from('invoices')
        .update({ field_confidence: withIncassoMark(inv.field_confidence, {
          at: new Date().toISOString(), paid_on: decision.paymentDate, supplier: supplier.name,
        }) })
        .eq('id', inv.id)
      if (markErr) {
        reportHandledFailure({
          tag: 'AUTO-INCASSO',
          message: 'payment booked but the assumption marker was not saved — it now looks like an observed payment',
          severity: 'data-integrity',
          context: { userId, invoiceId: inv.id, error: markErr.message },
        })
      }

      booked.push({
        invoiceId: inv.id,
        invoiceNumber: inv.invoice_number ?? null,
        supplier: supplier.name,
        amount: Math.round((row.applied ?? 0) * 100) / 100,
        paidOn: decision.paymentDate,
      })
    }

    return { ok: true, booked, held }
  } catch (e) {
    // [NO-SILENT-EMPTY] ok:false, never an empty success. "Nothing was collected" and "we could not
    // look" are different answers, and only one of them means the owner can stop watching.
    console.error('[AUTO-INCASSO] settle pass bailed', { userId, error: e instanceof Error ? e.message : String(e) })
    return BAILED
  }
}
