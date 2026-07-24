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
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'

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
  const limit = await checkRateLimit({ userId: token, endpoint: '/api/pay', ...RATE_LIMITS.PUBLIC_PAY })
  if (!limit.allowed) return rateLimitResponse(limit)

  const pipeline = createPipelineClient()

  const { data: invoice } = await pipeline
    .from('invoices')
    .select('id, sender_id, direction, invoice_type, status, invoice_number, payment_reference, total_inc_btw, client_name, pay_token, due_date')
    .eq('pay_token', token)
    .maybeSingle()
  // [BUNDEL-BETAALVERZOEK] Not a single-invoice token → maybe a bundle token.
  // Same contract: minimal projection or a 404 that never confirms existence.
  if (!invoice) return bundleView(pipeline, token)

  // The owner's OWN payout details — the beneficiary.
  const { data: owner } = await pipeline
    .from('profiles')
    .select('iban, company_name, full_name')
    .eq('id', (invoice as { sender_id: string }).sender_id)
    .single()

  const view = toPublicPayView(
    invoice as BetaalverzoekInvoice,
    owner ?? { iban: null, company_name: null, full_name: null }
  )
  // null = not payable (draft, wrong type, missing IBAN). 404 — no existence leak.
  if (!view) return NextResponse.json({ error: 'Onbekende betaallink' }, { status: 404 })

  return NextResponse.json(view)
}

// [BUNDEL-BETAALVERZOEK] Resolve a bundle token → the combined public view
// (per-invoice lines + one sum + one QR). toPublicBundlePayView is the single
// allowlist; anything not renderable → the same 404 as an unknown token.
async function bundleView(pipeline: ReturnType<typeof createPipelineClient>, token: string) {
  const notFound = NextResponse.json({ error: 'Onbekende betaallink' }, { status: 404 })

  const { data: bundle } = await pipeline
    .from('pay_bundles')
    .select('id, user_id')
    .eq('token', token)
    .maybeSingle()
  if (!bundle) return notFound

  const { data: links } = await pipeline
    .from('pay_bundle_invoices')
    .select('invoice_id')
    .eq('bundle_id', bundle.id)
  const ids = (links ?? []).map((l) => l.invoice_id)
  if (ids.length === 0) return notFound

  const { data: invoices } = await pipeline
    .from('invoices')
    .select('id, sender_id, direction, invoice_type, status, invoice_number, payment_reference, total_inc_btw, amount_paid, client_name, pay_token, due_date')
    .in('id', ids)
    .eq('sender_id', bundle.user_id)
  if (!invoices || invoices.length === 0) return notFound

  const { data: owner } = await pipeline
    .from('profiles')
    .select('iban, company_name, full_name')
    .eq('id', bundle.user_id)
    .single()

  const view = toPublicBundlePayView(
    invoices as BetaalverzoekInvoice[],
    owner ?? { iban: null, company_name: null, full_name: null }
  )
  if (!view) return notFound

  return NextResponse.json(view)
}
