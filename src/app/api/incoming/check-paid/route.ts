// src/app/api/incoming/check-paid/route.ts
// [PAY-SAFE] Light no-double-pay check — READ-ONLY. Answers "have you likely
// already paid this?" BEFORE the owner marks an invoice paid. It NEVER writes,
// NEVER changes status, NEVER moves money. The owner remains the decision-maker
// (SAFECORE Pillar ⑤: warn, don't silently block). The actual paid-write stays
// in the existing executePay path (session client, B.4-guarded).
//
// LIGHT by design (per QUEUE-v2): reuse the paid-mark we already store. It looks
// for ANOTHER incoming invoice, already 'paid', from the SAME vendor for the
// SAME amount within a recent window — the "vendor re-sent the same invoice and
// I paid the first one" case. This is NOT the full bank-matching engine
// (BOEK-016, Phase 2); it's a cheap read over our own paid invoices.
//
// Why server-side (agreed): a client check is not trustworthy (refresh, second
// tab, tampering). The duplicate signal must be computed on the server against
// the live DB. Session client → RLS scopes to the owner automatically.

import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase-server'

// Recent window for "already paid" — a vendor re-sending an invoice happens
// within weeks, not years. 120 days is generous without flagging unrelated
// same-amount invoices from long ago.
const RECENT_DAYS = 120

export async function POST(req: NextRequest) {
  const supabase = await createServerSupabaseClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Niet ingelogd' }, { status: 401 })
  }

  let body: { invoiceId?: string } = {}
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Ongeldige aanvraag' }, { status: 400 })
  }
  if (!body.invoiceId) {
    return NextResponse.json({ error: 'invoiceId vereist' }, { status: 400 })
  }

  // Load the invoice the owner is about to pay (ownership-scoped).
  const { data: target } = await supabase
    .from('invoices')
    .select('id, receiver_id, direction, vendor_iban, client_name, total_inc_btw')
    .eq('id', body.invoiceId)
    .eq('receiver_id', user.id)
    .eq('direction', 'incoming')
    .maybeSingle()

  if (!target) {
    // Not found / not theirs — don't leak; just report no duplicate (the pay
    // path itself is guarded separately).
    return NextResponse.json({ duplicate: false })
  }

  const amount = target.total_inc_btw
  // Without an amount we can't form a meaningful signal → no warning.
  if (typeof amount !== 'number' || !isFinite(amount) || amount <= 0) {
    return NextResponse.json({ duplicate: false })
  }

  const sinceIso = new Date(Date.now() - RECENT_DAYS * 86_400_000)
    .toISOString()
    .slice(0, 10)

  // Candidate = ANOTHER incoming invoice, already paid, same amount, recent.
  // Anchor on vendor_iban when present (precise); else fall back to client_name
  // (vendor) via case-insensitive match. Amount is always required so we never
  // warn on amount alone or vendor alone.
  let query = supabase
    .from('invoices')
    .select('id, invoice_number, client_name, total_inc_btw, payment_date, marked_paid_at, vendor_iban')
    .eq('receiver_id', user.id)
    .eq('direction', 'incoming')
    .eq('status', 'paid')
    .eq('total_inc_btw', amount)
    .neq('id', target.id)
    .gte('payment_date', sinceIso)
    .limit(1)

  if (target.vendor_iban) {
    query = query.eq('vendor_iban', target.vendor_iban)
  } else if (target.client_name && target.client_name.trim()) {
    query = query.ilike('client_name', target.client_name.trim())
  } else {
    // No vendor anchor at all → amount alone is too loose; don't warn.
    return NextResponse.json({ duplicate: false })
  }

  const { data: matches } = await query

  if (matches && matches.length > 0) {
    const m = matches[0]
    return NextResponse.json({
      duplicate: true,
      match: {
        invoice_number: m.invoice_number,
        client_name: m.client_name,
        total_inc_btw: m.total_inc_btw,
        payment_date: m.payment_date ?? m.marked_paid_at ?? null,
      },
    })
  }

  return NextResponse.json({ duplicate: false })
}