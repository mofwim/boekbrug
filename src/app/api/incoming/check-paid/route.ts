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
import { pickPaidTwin } from '@/lib/double-pay-check'
import { escapeLikeValue } from '@/lib/sanitize'

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
    // [PAY-SAFE-NUMBER] invoice_number rides along — it is what tells a re-sent invoice
    // (the case this check exists for) apart from the next bill in a running account.
    .select('id, receiver_id, direction, vendor_iban, client_name, total_inc_btw, invoice_number, invoice_date')
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
  // Recency via payment_date OR marked_paid_at: a `.gte('payment_date', …)`
  // alone (SQL: NULL >= x → NULL) silently excluded a paid twin whose
  // payment_date is NULL — e.g. one auto-booked from a dateless bank line
  // (bank-auto-confirm writes payment_date: null when the tx has no date) or a
  // legacy row. Those are exactly the twins the warning exists to catch. Fall
  // back to marked_paid_at (the confirmation timestamp, always set on a paid
  // row) so recency still bounds the match.
  let query = supabase
    .from('invoices')
    .select('id, invoice_number, invoice_date, client_name, total_inc_btw, payment_date, marked_paid_at, vendor_iban')
    .eq('receiver_id', user.id)
    .eq('direction', 'incoming')
    .eq('status', 'paid')
    .eq('total_inc_btw', amount)
    .neq('id', target.id)
    .or(`payment_date.gte.${sinceIso},and(payment_date.is.null,marked_paid_at.gte.${sinceIso})`)
    // [PAY-SAFE-NUMBER] Was limit(1) — an arbitrary row out of everything this vendor was paid at
    // this amount. Now that the number decides, we need the SET: a same-number twin must win over
    // a same-amount stranger, and it may not be the row the database happened to hand back first.
    // Newest first, and a ceiling far above any real vendor's count inside 120 days — a supplier
    // billing the same amount 50 times in four months is invoicing daily. Ordering matters even
    // so: if that ceiling is ever reached, what gets dropped is the OLDEST, never the re-send we
    // are looking for (a vendor re-sends within days).
    // nullsFirst:false matters here. Postgres puts NULLs FIRST on a DESC sort, so a handful of
    // invoices whose date we never read would have filled the window ahead of every dated one —
    // and the row this check exists to find is a recent, dated re-send.
    .order('invoice_date', { ascending: false, nullsFirst: false })
    .limit(50)

  if (target.vendor_iban) {
    query = query.eq('vendor_iban', target.vendor_iban)
  } else if (target.client_name && target.client_name.trim()) {
    // [LIKE-ESCAPE] The value is a PATTERN, not a string. A vendor written "A_B" or "50% Korting"
    // turns `_`/`%` into wildcards and matches ANOTHER supplier — here that means warning the
    // owner about a payment to someone they never paid. Same escape the ingestion paths use.
    query = query.ilike('client_name', escapeLikeValue(target.client_name.trim()))
  } else {
    // No vendor anchor at all → amount alone is too loose; don't warn.
    return NextResponse.json({ duplicate: false })
  }

  const { data: matches } = await query

  // [PAY-SAFE-NUMBER] Vendor + amount + recency got us the candidates; the invoice NUMBER decides
  // which of them is actually a re-send worth stopping the owner for. See double-pay-check.ts —
  // without this, a supplier billing the same amount on a rhythm (a boekhouder's monthly fee, a
  // huurcontract, an abonnement) tripped this warning every single period.
  const m = pickPaidTwin(target, matches ?? [])

  if (m) {
    return NextResponse.json({
      duplicate: true,
      match: {
        id: m.id, // [PAY-SAFE] the original paid invoice — for "view original" deep-link
        invoice_number: m.invoice_number,
        client_name: m.client_name,
        total_inc_btw: m.total_inc_btw,
        payment_date: m.payment_date ?? m.marked_paid_at ?? null,
      },
    })
  }

  return NextResponse.json({ duplicate: false })
}