// src/app/api/invoice/betaalverzoek-bundel/route.ts
// [BUNDEL-BETAALVERZOEK] Owner-only: mint (or reuse) ONE public payment-request
// link covering SEVERAL open outgoing invoices of the SAME customer. The klant
// pays the sum in one transfer, with every invoice number in the reference —
// the reconciliation engine then books that single bank line against all of
// them (book_bank_batch / bank_tx_invoices). Session client → RLS, scoped by
// sender_id. No money movement — this only creates a shareable /pay link.

import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase-server'
import {
  buildBundelBetaalverzoek,
  MAX_BUNDLE_INVOICES,
  type BetaalverzoekInvoice,
} from '@/lib/betaalverzoek'
import { SITE_URL } from '@/lib/site'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function POST(req: NextRequest) {
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Niet ingelogd' }, { status: 401 })

  let body: { invoiceIds?: unknown }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Ongeldige aanvraag' }, { status: 400 }) }

  const raw = Array.isArray(body.invoiceIds) ? body.invoiceIds : []
  const invoiceIds = [...new Set(raw.filter((v): v is string => typeof v === 'string' && UUID_RE.test(v)))]
  if (invoiceIds.length < 2 || invoiceIds.length > MAX_BUNDLE_INVOICES) {
    return NextResponse.json(
      { error: `Selecteer minimaal 2 en maximaal ${MAX_BUNDLE_INVOICES} facturen.` },
      { status: 400 }
    )
  }

  // Owner-scoped fetch (RLS + explicit sender_id). Only the fields the logic needs.
  const { data: invoices } = await supabase
    .from('invoices')
    .select('id, direction, invoice_type, status, invoice_number, payment_reference, total_inc_btw, amount_paid, client_name, pay_token, due_date')
    .in('id', invoiceIds)
    .eq('sender_id', user.id)
  if (!invoices || invoices.length !== invoiceIds.length) {
    return NextResponse.json({ error: 'Niet alle facturen gevonden' }, { status: 404 })
  }

  // The owner's OWN payout details — the beneficiary of the QR.
  const { data: owner } = await supabase
    .from('profiles')
    .select('iban, company_name, full_name')
    .eq('id', user.id)
    .single()

  const built = buildBundelBetaalverzoek(
    invoices as BetaalverzoekInvoice[],
    owner ?? { iban: null, company_name: null, full_name: null }
  )
  if (!built.ok) return NextResponse.json({ error: built.error }, { status: 400 })

  // Reuse an existing bundle with EXACTLY this invoice set, so re-clicking the
  // action returns the same stable link (the customer may already have it).
  const wanted = [...invoiceIds].sort().join(',')
  const { data: existing } = await supabase
    .from('pay_bundles')
    .select('id, token, pay_bundle_invoices(invoice_id)')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(25)
  let token: string | null = null
  for (const b of existing ?? []) {
    const set = ((b.pay_bundle_invoices ?? []) as { invoice_id: string }[])
      .map((l) => l.invoice_id).sort().join(',')
    if (set === wanted) { token = b.token; break }
  }

  if (!token) {
    const { data: bundle, error: bundleErr } = await supabase
      .from('pay_bundles')
      .insert({ user_id: user.id })
      .select('id, token')
      .single()
    if (bundleErr || !bundle) {
      return NextResponse.json({ error: 'Betaallink aanmaken mislukt' }, { status: 500 })
    }
    const { error: linkErr } = await supabase
      .from('pay_bundle_invoices')
      .insert(invoiceIds.map((invoice_id) => ({ user_id: user.id, bundle_id: bundle.id, invoice_id })))
    if (linkErr) {
      // Don't leave an empty bundle behind — it would 404 on /pay anyway.
      await supabase.from('pay_bundles').delete().eq('id', bundle.id).eq('user_id', user.id)
      return NextResponse.json({ error: 'Betaallink aanmaken mislukt' }, { status: 500 })
    }
    token = bundle.token
  }

  return NextResponse.json({
    ok: true,
    url: `${SITE_URL}/pay/${token}`,
    token,
    beneficiaryName: built.beneficiaryName,
    iban: built.iban,
    amount: built.amount,
    reference: built.reference,
    epcPayload: built.epcPayload,
    count: invoiceIds.length,
    items: built.items,
  })
}
