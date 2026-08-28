// src/lib/pay-link.ts
// [BETAALBLOK] The one place that turns an invoice into "here is how to pay me".
//
// Not pure — it mints the pay token, which is a write. The SHAPE of the block is decided in
// pay-block.ts, which is pure and tested; this file only does the I/O that block needs.
//
// ── WHY BOTH CALLERS GO THROUGH HERE ──
// The invoice mail and every reminder tier need identical payment details. If they built their own
// the day the reference changed, a customer would hold a reminder that contradicts the invoice it
// is reminding them of — and a customer who cannot tell which of two references is real does not
// pick one, they call.
//
// ── WHY THE TOKEN IS MINTED AT SEND TIME ──
// /pay/[token] existed and worked long before this; the only way to reach it was the owner
// pressing "Betaalverzoek" by hand and sending the link themselves. So the page was built,
// secured, tested — and in the ordinary flow nobody ever saw it. Minting on send is what connects
// the two. The token is reused forever after, so the link a customer keeps stays alive.

import type { SupabaseClient } from '@supabase/supabase-js'

import { buildBetaalverzoek, type BetaalverzoekInvoice, type BetaalverzoekOwner } from './betaalverzoek'
import { buildPayBlock, type PayBlock } from './pay-block'
import { SITE_URL } from './site'

/**
 * The payment block for one outgoing invoice, or null when there is none to build.
 *
 * Null is the ordinary answer in three cases, and all three are correct: the owner never filled in
 * an IBAN, the document is a creditnota (money going the other way), or the invoice is already
 * paid. buildBetaalverzoek decides all of that; this function never second-guesses it.
 *
 * NEVER THROWS. It is called from inside the send path and from the reminder cron, and in both
 * places the mail matters more than the block: an invoice that fails to reach its customer because
 * a token could not be minted would be a far worse bug than the one this fixes.
 */
export async function payBlockForInvoice(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any>,
  {
    invoice,
    owner,
    ownerId,
    openstaand,
  }: {
    invoice: BetaalverzoekInvoice
    owner: BetaalverzoekOwner
    /** The seller. Scopes the token write, beside RLS. */
    ownerId: string
    /**
     * What is still open, when the caller already knows it (a reminder does). Left out, the amount
     * buildBetaalverzoek computed from the invoice row is used — which is the same figure for an
     * invoice that has just been sent.
     */
    openstaand?: number | null
  },
): Promise<PayBlock | null> {
  try {
    const built = buildBetaalverzoek(invoice, owner)
    if (!built.ok) return null

    const token = await ensurePayToken(supabase, invoice, ownerId)

    const amount = typeof openstaand === 'number' && Number.isFinite(openstaand) && openstaand > 0
      ? openstaand
      : built.amount

    return buildPayBlock({
      // No token → no link, and the block still carries the IBAN, the amount and the reference.
      // Degrading to the half we have beats sending a mail with no payment details at all, which
      // is precisely the state this whole change exists to end.
      payUrl: token ? `${SITE_URL}/pay/${token}` : null,
      iban: built.iban ?? null,
      beneficiaryName: built.beneficiaryName ?? null,
      amount: amount ?? null,
      reference: built.reference ?? null,
    })
  } catch {
    return null
  }
}

/**
 * The invoice's pay token, minting one on first use.
 *
 * Lifted verbatim from api/invoice/[id]/betaalverzoek — including the compare-and-swap, which is
 * not optional: two concurrent callers both minted a uuid, and the loser handed the customer a
 * link that resolved to nothing. `.is('pay_token', null)` makes the write the arbiter, and the
 * loser re-reads the winner's token so every path returns the same live link.
 *
 * Returns null when the token cannot be established. The caller degrades; it never fails the mail.
 */
async function ensurePayToken(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any>,
  invoice: BetaalverzoekInvoice,
  ownerId: string,
): Promise<string | null> {
  if (invoice.pay_token) return invoice.pay_token

  const token = crypto.randomUUID()
  const { data: won, error } = await supabase
    .from('invoices')
    .update({ pay_token: token })
    .eq('id', invoice.id)
    .eq('sender_id', ownerId)
    .is('pay_token', null)
    .select('id')
  if (error) return null
  if (won && won.length > 0) return token

  const { data: herlezen } = await supabase
    .from('invoices')
    .select('pay_token')
    .eq('id', invoice.id)
    .eq('sender_id', ownerId)
    .maybeSingle()
  return (herlezen as { pay_token?: string | null } | null)?.pay_token ?? null
}
