// src/app/api/pay/[token]/route.ts
// [BETAALVERZOEK] PUBLIC, login-free read for the /pay/[token] page. The paying
// customer has no session, so this uses the service-role pipeline client — which
// means the projection MUST be tight. toPublicPayView (betaalverzoek.ts) is the
// single allowlist: it returns only the beneficiary/amount/reference/QR a customer
// needs and nothing else (no client email/address/BTW, no internal ids, no other
// invoices). Anything not payable → 404, so the endpoint never confirms the
// existence of a draft/non-payable invoice.

import { NextRequest, NextResponse } from 'next/server'
import { createPipelineClient } from '@/lib/supabase-pipeline'
import { toPublicPayView, toPublicBundlePayView, type BetaalverzoekInvoice } from '@/lib/betaalverzoek'
import { checkRateLimitByKey, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
// [DEEL-CREDIT] Coverage, not presence — see the header of credited-invoices.ts.
import { creditedTotalsFrom, fullyCreditedIdsFrom, creditedOnInvoice } from '@/lib/credited-invoices'
// [MOLLIE] Alleen de META-vraag (is er een koppeling?) — nooit de sleutel zelf op dit pad.
import { getMollieConnectionMeta } from '@/lib/mollie-connection'
// [ALARM] Opgevangen fouten die tóch iemand moeten bereiken — zie report-handled.ts.
import { reportHandledFailure } from '@/lib/report-handled'

export const dynamic = 'force-dynamic'

// A pay_token is a uuid. Reject anything else before touching the DB — a cheap,
// enumeration-proof guard (the token space is 2^122, unguessable).
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params
  if (!UUID_RE.test(token)) {
    return NextResponse.json({ error: 'Onbekende betaallink' }, { status: 404 })
  }

  // Bucket per token so one shared/leaked link can't be hammered.
  //
  // [COST-GUARD] Was checkRateLimit({ userId: token }). `token` IS a valid uuid,
  // but it is invoices.pay_token — not a profiles.id — so it violated
  // rate_limits' foreign key on EVERY request, the helper failed open, and this
  // limiter never once ran. Now on the text-keyed bucket, which has no FK.
  //
  // failOpen: this path spends no money and the caller is a customer trying to
  // pay an invoice. A database blip must not stand between them and that.
  const limit = await checkRateLimitByKey({
    bucketKey: `pay:${token}`,
    endpoint: '/api/pay',
    ...RATE_LIMITS.PUBLIC_PAY,
    failOpen: true,
  })
  if (!limit.allowed) return rateLimitResponse(limit)

  const pipeline = createPipelineClient()

  // [PAY-READ-HONEST] This is the one page in the product with no login, read by someone who is
  // trying to PAY. Its every failure path ends at "Onbekende betaallink", and a dropped error made
  // a database hiccup say exactly that — to a customer holding a real invoice. They conclude the
  // link is dead or a scam and close the tab; the owner sees an invoice that was never paid and is
  // told nothing. Of all the silent-empty reads in this codebase this is the only one whose wrong
  // answer is delivered to somebody outside the company.
  const { data: invoice, error: invoiceErr } = await pipeline
    .from('invoices')
    .select('id, sender_id, direction, invoice_type, status, invoice_number, payment_reference, total_inc_btw, amount_paid, client_name, pay_token, due_date')
    .eq('pay_token', token)
    .maybeSingle()
  if (invoiceErr) return payUnavailable('invoice lookup failed', { token: tokenTail(token), error: invoiceErr.message })
  // [BUNDEL-BETAALVERZOEK] Not a single-invoice token → maybe a bundle token.
  // Same contract: minimal projection or a 404 that never confirms existence.
  if (!invoice) return bundleView(pipeline, token)

  // [CREDITNOTA-NO-CHASE] The owner WITHDREW this invoice with a creditnota. The invoice keeps
  // its 'sent' status and positive total on purpose (the +omzet stays, netted by the
  // creditnota), so every payability rule below still passes it — and this page would keep
  // asking a real customer, from a link they already have, to transfer money that is no longer
  // owed. A shared link stays live forever, so "the owner just won't share it" is no guard.
  // 404 like every other not-payable case: the page says the link is unknown, never why.
  // [DEEL-CREDIT] …but only when the credits COVER the invoice. A partial credit does not
  // withdraw it: the rest is genuinely still owed, and hiding the page would leave the customer
  // no way to pay it and the owner no way to be paid. So the page stays live and asks for the
  // REMAINDER — the reduction is threaded into the amount below, where openAmount subtracts it.
  const credited = await creditedOnInvoice(pipeline as never, (invoice as { id: string }).id)
  if (credited === null) {
    // Fail CLOSED, exactly as before: a lookup that failed must never let the page ask for the
    // full amount on an invoice that may have been credited.
    return NextResponse.json({ error: 'Onbekende betaallink' }, { status: 404 })
  }
  const invoiceTotal = Math.abs(Number((invoice as { total_inc_btw: number | null }).total_inc_btw) || 0)
  if (credited > 0 && credited + 0.005 >= invoiceTotal) {
    return NextResponse.json({ error: 'Onbekende betaallink' }, { status: 404 })
  }

  // The owner's OWN payout details — the beneficiary.
  const { data: owner } = await pipeline
    .from('profiles')
    .select('iban, company_name, full_name')
    .eq('id', (invoice as { sender_id: string }).sender_id)
    .single()

  const view = toPublicPayView(
    { ...(invoice as BetaalverzoekInvoice), credited_inc_btw: credited },
    owner ?? { iban: null, company_name: null, full_name: null }
  )
  // null = not payable (draft, wrong type, missing IBAN). 404 — no existence leak.
  if (!view) return NextResponse.json({ error: 'Onbekende betaallink' }, { status: 404 })

  // [MOLLIE] Mag de pagina een iDEAL-knop tonen? Eén boolean, geen geheimen: de knop verschijnt
  // alleen als de eigenaar zijn eigen Mollie-account koppelde, en de link zelf wordt pas
  // aangemaakt als de klant er echt op drukt (POST /api/pay/[token]/ideal).
  const idealAvailable = !view.alreadyPaid
    && (await getMollieConnectionMeta((invoice as { sender_id: string }).sender_id))?.status === 'active'

  return NextResponse.json({ ...view, idealAvailable })
}

// [CREDITNOTA-NO-CHASE]/[DEEL-CREDIT] creditedOn is verhuisd naar credited-invoices.ts
// (creditedOnInvoice), zodat de iDEAL-route en deze pagina één 'gecrediteerd'-waarheid delen.

// [BUNDEL-BETAALVERZOEK] Resolve a bundle token → the combined public view
// (per-invoice lines + one sum + one QR). toPublicBundlePayView is the single
// allowlist; anything not renderable → the same 404 as an unknown token.
/**
 * [PAY-READ-HONEST] "We cannot look right now" — never "this link does not exist".
 *
 * A 503 with a retry sentence, because the customer's next move differs completely: an unknown link
 * means give up, a temporary failure means try again in a minute. And it alarms, because an owner
 * whose customers are being turned away from their own payment page would want to know that today,
 * not at the end of the month when the invoice is still open.
 */
function payUnavailable(what: string, context: Record<string, unknown>) {
  reportHandledFailure({
    tag: 'PAY-READ-HONEST',
    message: `public payment page: ${what} — customer told to retry, not that the link is unknown`,
    severity: 'gate-unavailable',
    context,
  })
  return NextResponse.json(
    { error: 'We kunnen deze betaalpagina nu even niet laden. Probeer het over een minuut opnieuw — je link blijft geldig.' },
    { status: 503 },
  )
}

/** Only the last six characters of the token, so a report can be correlated without carrying a
 *  working payment link into an error tracker. */
function tokenTail(token: string): string {
  return `…${token.slice(-6)}`
}

async function bundleView(pipeline: ReturnType<typeof createPipelineClient>, token: string) {
  const notFound = NextResponse.json({ error: 'Onbekende betaallink' }, { status: 404 })

  const { data: bundle, error: bundleErr } = await pipeline
    .from('pay_bundles')
    .select('id, user_id')
    .eq('token', token)
    .maybeSingle()
  if (bundleErr) return payUnavailable('bundle lookup failed', { token: tokenTail(token), error: bundleErr.message })
  if (!bundle) return notFound

  const { data: links, error: linksErr } = await pipeline
    .from('pay_bundle_invoices')
    .select('invoice_id')
    .eq('bundle_id', bundle.id)
  if (linksErr) return payUnavailable('bundle links lookup failed', { token: tokenTail(token), error: linksErr.message })
  const ids = (links ?? []).map((l) => l.invoice_id)
  if (ids.length === 0) return notFound

  const { data: invoices, error: invoicesErr } = await pipeline
    .from('invoices')
    .select('id, sender_id, direction, invoice_type, status, invoice_number, payment_reference, total_inc_btw, amount_paid, client_name, pay_token, due_date')
    .in('id', ids)
    .eq('sender_id', bundle.user_id)
  if (invoicesErr) return payUnavailable('bundle invoices lookup failed', { token: tokenTail(token), error: invoicesErr.message })
  if (!invoices || invoices.length === 0) return notFound

  // [CREDITNOTA-NO-CHASE] Drop any invoice in the bundle the owner has since withdrawn, so the
  // combined amount never asks for money that is no longer owed. Fails CLOSED (the whole page
  // 404s) rather than risk over-asking. If nothing is left, the link is spent.
  // Scoped to THIS bundle's invoices, so the read is small and — unlike an owner-wide select —
  // cannot be silently truncated by PostgREST's ~1000-row cap. A truncated credited set would
  // fail OPEN (a withdrawn invoice slipping back into the payable set and the combined amount
  // over-asking), which is exactly the outcome the fail-closed design exists to prevent.
  // [DEEL-CREDIT] With the amount, so a partly credited invoice can stay in the bundle for what it
  // still owes instead of being dropped whole. (The comment sits ABOVE the chain rather than inside
  // it: [RLS-UIT] matches service-role queries on their own text, and a comment spliced between the
  // links changes that text — the query then reads as a new, unreviewed one.)
  const { data: creditRows, error: creditErr } = await pipeline
    .from('invoices')
    .select('original_invoice_id, total_inc_btw')
    .eq('invoice_type', 'creditnota')
    .in('original_invoice_id', ids)
  // Still fails CLOSED — nothing is rendered, so the combined amount can never over-ask. What
  // changes is only what the customer is told: 503 and "try again" instead of "unknown link". Both
  // refuse equally; one of them is true.
  if (creditErr) return payUnavailable('credited-invoice lookup failed', { token: tokenTail(token), error: creditErr.message })
  const creditRowList = (creditRows ?? []) as { original_invoice_id: string | null; total_inc_btw: number | null }[]
  const creditedByInvoice = creditedTotalsFrom(creditRowList)
  const volledig = fullyCreditedIdsFrom(
    creditRowList,
    invoices as { id: string; total_inc_btw?: number | null }[],
  )
  // Fully credited leaves the bundle; partly credited stays, carrying what it gave back so the
  // combined amount asks for the remainder and never for the full total.
  const payable = (invoices as { id: string }[])
    .filter((i) => !volledig.has(i.id))
    .map((i) => ({ ...i, credited_inc_btw: creditedByInvoice.get(i.id) ?? 0 }))
  if (payable.length === 0) return notFound

  // Without the owner's IBAN buildEpcQrPayload refuses and the page 404s — fail-closed, and right:
  // a payment page with no account number is not a payment page. But the customer then reads
  // "unknown link" about an invoice that exists, because a profile read blinked.
  const { data: owner, error: ownerErr } = await pipeline
    .from('profiles')
    .select('iban, company_name, full_name')
    .eq('id', bundle.user_id)
    .maybeSingle()
  if (ownerErr) return payUnavailable('payee lookup failed', { token: tokenTail(token), error: ownerErr.message })

  const view = toPublicBundlePayView(
    payable as BetaalverzoekInvoice[],
    owner ?? { iban: null, company_name: null, full_name: null }
  )
  if (!view) return notFound

  return NextResponse.json(view)
}
