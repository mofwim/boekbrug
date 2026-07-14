// src/app/api/invoice/[id]/betaalverzoek/route.ts
// [BETAALVERZOEK] Owner-only: mint (or return) the public payment-request link for
// one outgoing invoice, plus the payment details to preview (owner IBAN, amount,
// invoice number as reference, and the EPC/SEPA QR payload). Session client → RLS,
// scoped by sender_id. No money movement — this only creates a shareable link to a
// public /pay page the customer opens to pay from THEIR OWN bank.

import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase-server'
import { buildBetaalverzoek, type BetaalverzoekInvoice } from '@/lib/betaalverzoek'
import { SITE_URL } from '@/lib/site'

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Niet ingelogd' }, { status: 401 })

  // Owner-scoped fetch (RLS + explicit sender_id). Only the fields the logic needs.
  const { data: invoice } = await supabase
    .from('invoices')
    .select('id, direction, invoice_type, status, invoice_number, payment_reference, total_inc_btw, client_name, pay_token, due_date')
    .eq('id', id)
    .eq('sender_id', user.id)
    .single()
  if (!invoice) return NextResponse.json({ error: 'Factuur niet gevonden' }, { status: 404 })

  // The owner's OWN payout details — the beneficiary of the QR.
  const { data: owner } = await supabase
    .from('profiles')
    .select('iban, company_name, full_name')
    .eq('id', user.id)
    .single()

  const built = buildBetaalverzoek(invoice as BetaalverzoekInvoice, owner ?? { iban: null, company_name: null, full_name: null })
  if (!built.ok) return NextResponse.json({ error: built.error }, { status: 400 })

  // Mint a random, unguessable token on first use; reuse it afterwards so the link
  // is stable (the customer may keep it). Scoped update — RLS enforces ownership.
  let token = invoice.pay_token as string | null
  if (!token) {
    token = crypto.randomUUID()
    const { error: upErr } = await supabase
      .from('invoices')
      .update({ pay_token: token } as never)
      .eq('id', id)
      .eq('sender_id', user.id)
    if (upErr) return NextResponse.json({ error: 'Betaallink aanmaken mislukt' }, { status: 500 })
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
  })
}
