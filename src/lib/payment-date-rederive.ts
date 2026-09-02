// src/lib/payment-date-rederive.ts
// [PAYDATE-REDERIVE] After a reversal, an invoice's payment date must describe the money that is
// STILL on it — not the money that left.
//
// ── THE BUG, AND WHY IT IS LIVE ──
//
// Invoice A is settled in two instalments: EUR 1.000 on 1 May, EUR 2.000 on 15 June. The owner
// undoes the FIRST one. amount_paid is re-derived correctly (2.000 remains), but payment_date keeps
// saying 1 May — the date of the instalment that just went away. The only money still on that
// invoice arrived on 15 June.
//
// Under the KASSTELSEL, payment_date decides which QUARTER a payment counts in. A stale date moves
// money into a quarter it never belonged to, and it does so without a warning anywhere: the figure
// simply comes out wrong.
//
// The reversal paths already say in their own comments that they leave the stale date on purpose,
// "because recompute_invoice_amount_paid re-derives it a few lines down". It does not.
// invoice_payment_date_rederive.sql adds that derivation and HAS NOT BEEN APPLIED — the migration
// report said otherwise because its probe reads the NEW./OLD. column references only a TRIGGER
// function has, and this is an ordinary function. So every one of those comments describes a fix
// that never landed, which is worse than no comment: it is a reason to stop looking.
//
// ── WHY THE DERIVATION LIVES IN ONE PLACE ──
//
// The migration's own argument, and it does not change by being written in TypeScript: five call
// sites each carrying their own `payment_date: stillHasPayment ? inv.payment_date : null` is five
// chances to disagree. One derivation, called by all of them, is one truth.
//
// It is byte-for-byte the rule the SQL will apply once the migration is run — the earliest
// surviving link, its own date if it has one, else its bank transaction's, ties broken by
// created_at. So the two agree the day they both exist, and the day after this can be deleted.
//
// ── AND WHY NOTHING IS WRITTEN WHEN NOTHING SURVIVES ──
//
// No surviving link means the callers are already clearing the date themselves (a fully unpaid
// invoice has no payment date). Writing null here as well would also blank the recorded date of a
// PRE-join-table invoice, whose payment predates bank_tx_invoices and is therefore invisible to
// this query. Leaving both fields untouched is the same answer the SQL gives, for the same reason.
//
// Pure half + one read/write, and the write is best-effort by contract: the money was already
// re-derived by the caller, so a failure here costs a stale date, never a wrong amount.
// Run: npx tsx --test src/lib/payment-date-rederive.test.ts

/** One row of bank_tx_invoices, plus the date of the transaction it points at (null for manual). */
export interface SurvivingLink {
  /** A manual instalment carries its own date. */
  paid_on?: string | null
  /** 'kas' | 'bank' | … — a manual instalment carries its own method. */
  method?: string | null
  /** bank_transactions.date for the linked transaction, when there is one. */
  transaction_date?: string | null
  /** Tie-breaker, so two payments on one day resolve the same way every time. */
  created_at?: string | null
}

export interface RederivedPayment {
  /** ISO date of the earliest payment still on the invoice. */
  date: string
  /** Its method. 'bank' when the link does not state one — a link IS a bank line by default. */
  method: string
}

/** What a link is dated: its own date first, else the bank transaction it points at. */
function effectiveDate(link: SurvivingLink): string | null {
  const own = (link.paid_on ?? '').trim()
  if (own) return own
  const tx = (link.transaction_date ?? '').trim()
  return tx || null
}

/**
 * The date and method of the EARLIEST payment still on this invoice, or null when none of the
 * surviving links is dated at all.
 *
 * Ordering is exactly the SQL's: `ORDER BY coalesce(l.paid_on, bt.date) NULLS LAST, l.created_at`.
 * Undated links sort last and therefore only ever win when every link is undated — in which case
 * there is no date to write and this answers null, which is what the SQL's `IF v_date IS NOT NULL`
 * does with the same case.
 */
export function earliestSurvivingPayment(links: readonly SurvivingLink[] | null | undefined): RederivedPayment | null {
  if (!links || links.length === 0) return null
  const ranked = [...links].sort((a, b) => {
    const ad = effectiveDate(a)
    const bd = effectiveDate(b)
    if (ad === null && bd !== null) return 1   // NULLS LAST
    if (bd === null && ad !== null) return -1
    if (ad !== null && bd !== null && ad !== bd) return ad < bd ? -1 : 1
    return (a.created_at ?? '').localeCompare(b.created_at ?? '')
  })
  const winner = ranked[0]
  const date = effectiveDate(winner)
  if (!date) return null
  return { date, method: (winner.method ?? '').trim() || 'bank' }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = any

/**
 * Re-derive payment_date / payment_method on one invoice from the links that survive, and write
 * them. Call it right after recompute_invoice_amount_paid on every reversal path.
 *
 * NEVER THROWS, by the same contract the recompute itself has: the amount is already correct when
 * this runs, so every failure degrades to "the date is still the old one" — which is exactly the
 * state without this function, and never to a refused reversal.
 *
 * Returns what it wrote, or null when it wrote nothing.
 */
export async function rederivePaymentDate(
  client: AnyClient,
  userId: string,
  invoiceId: string,
): Promise<RederivedPayment | null> {
  try {
    // The links, with their transaction's date joined on. PostgREST embeds the related row, so the
    // date arrives without a second round-trip and without a second query to keep in step.
    const { data, error } = await client
      .from('bank_tx_invoices')
      .select('paid_on, method, created_at, bank_transactions(date)')
      .eq('invoice_id', invoiceId)
      .eq('user_id', userId)
    if (error) throw new Error(error.message)

    const links: SurvivingLink[] = ((data ?? []) as {
      paid_on: string | null; method: string | null; created_at: string | null
      bank_transactions?: { date: string | null } | { date: string | null }[] | null
    }[]).map((row) => {
      // The embed is an object for a to-one relation and an array in some PostgREST versions;
      // reading only the first of either keeps this from depending on which one answers.
      const tx = Array.isArray(row.bank_transactions) ? row.bank_transactions[0] : row.bank_transactions
      return {
        paid_on: row.paid_on,
        method: row.method,
        transaction_date: tx?.date ?? null,
        created_at: row.created_at,
      }
    })

    const derived = earliestSurvivingPayment(links)
    // Nothing survives, or nothing is dated → leave both columns alone. See the header.
    if (!derived) return null

    // Scoped to the owner even though the id is already known: the reversal paths hand this a
    // service client (the same one the recompute RPC runs under), and a service-role write whose
    // only filter is a row id is one typo away from touching someone else's invoice.
    const { error: upErr } = await client
      .from('invoices')
      .update({ payment_date: derived.date, payment_method: derived.method })
      .eq('id', invoiceId)
      .or(`sender_id.eq.${userId},receiver_id.eq.${userId}`)
    if (upErr) throw new Error(upErr.message)
    return derived
  } catch (e) {
    console.error('[PAYDATE-REDERIVE] the payment date was not re-derived — it may name money that left', {
      userId, invoiceId, error: e instanceof Error ? e.message : String(e),
    })
    return null
  }
}
