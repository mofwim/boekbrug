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
import { pickPaidTwin, type DoublePayResult, type DoublePayUnchecked } from '@/lib/double-pay-check'
// [TZ] the owner's day, never the UTC one — see format-nl.ts
import { amsterdamToday } from '@/lib/format-nl'
import { escapeLikeValue } from '@/lib/sanitize'

// Recent window for "already paid" — a vendor re-sending an invoice happens
// within weeks, not years. 120 days is generous without flagging unrelated
// same-amount invoices from long ago.
const RECENT_DAYS = 120

// [DUBBEL-BEWIJS] The candidate ceiling, lifted out of the query so the answer can NAME it. It was
// already here as a bare `.limit(50)`; what it was not doing was telling anyone. A search that
// silently drops its oldest rows and reports "no duplicate" is a bounded check wearing a complete
// one's clothes — the same defect this whole file is about, one level down.
const MAX_CANDIDATES = 50

/** The route's one shape. Every exit builds one of these, so no exit can forget a field. */
function answer(r: DoublePayResult) {
  return NextResponse.json({
    // `duplicate` stays exactly what it was, for any caller still reading the old shape: TRUE only
    // for a real twin. An `unchecked` result is deliberately NOT a duplicate — it is not a
    // negative either, and that is what the three fields beside it are for.
    duplicate: r.outcome === 'twin',
    match: r.match,
    outcome: r.outcome,
    search: r.search,
    reason: r.reason,
  })
}

/** "We could not answer", with the reason attached. Never rendered as a clean check. */
function unchecked(reason: DoublePayUnchecked) {
  return answer({ outcome: 'unchecked', match: null, search: null, reason })
}

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
  // [DUBBEL-BEWIJS] The error is read now. maybeSingle() separates the two cases this line used to
  // merge: `error` set means the READ failed, while data null with no error means the row is
  // genuinely not this owner's. The first is "we could not look" and the second is "there is
  // nothing here to look at" — and they were both answering `duplicate: false`.
  const { data: target, error: targetError } = await supabase
    .from('invoices')
    // [PAY-SAFE-NUMBER] invoice_number rides along — it is what tells a re-sent invoice
    // (the case this check exists for) apart from the next bill in a running account.
    .select('id, receiver_id, direction, vendor_iban, client_name, total_inc_btw, invoice_number, invoice_date')
    .eq('id', body.invoiceId)
    .eq('receiver_id', user.id)
    .eq('direction', 'incoming')
    .maybeSingle()

  if (targetError) {
    console.error('[DUBBEL-BEWIJS] invoice unreadable — reporting unchecked, not "no duplicate"', {
      userId: user.id, invoiceId: body.invoiceId, error: targetError.message,
    })
    return unchecked('invoice_unreadable')
  }
  if (!target) {
    // Not found / not theirs — don't leak WHICH it is, and don't claim a clean check either. The
    // pay path is guarded separately, so nothing here has to block; the owner is simply told that
    // this particular reassurance was not earned.
    return unchecked('invoice_unreadable')
  }

  const amount = target.total_inc_btw
  // [DUBBEL-BEWIJS] Without an amount there is no signal to form — which is a reason to stay
  // silent about DUPLICATES, never a reason to stay silent about the check. And this is not a rare
  // corner: an invoice whose amount we never read is a document the reader could not make sense
  // of, which is precisely the document most likely to have been uploaded twice. The check used to
  // switch itself off hardest on the invoices it understood least, and say nothing about it.
  if (typeof amount !== 'number' || !isFinite(amount) || amount <= 0) {
    return unchecked('no_amount')
  }

  // [TZ] Counted back from the owner's Amsterdam day, not from UTC's. The window is 120 days wide
  // so an hour cannot change the answer — but the rule in format-nl.ts:17-23 is that every date
  // boundary in this app is Amsterdam's, and a boundary that is "usually the same" is exactly the
  // kind that gets copied into a place where it is not.
  const windowStart = new Date(`${amsterdamToday()}T00:00:00Z`)
  windowStart.setUTCDate(windowStart.getUTCDate() - RECENT_DAYS)
  const sinceIso = windowStart.toISOString().slice(0, 10)

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
    .limit(MAX_CANDIDATES)

  if (target.vendor_iban) {
    query = query.eq('vendor_iban', target.vendor_iban)
  } else if (target.client_name && target.client_name.trim()) {
    // [LIKE-ESCAPE] The value is a PATTERN, not a string. A vendor written "A_B" or "50% Korting"
    // turns `_`/`%` into wildcards and matches ANOTHER supplier — here that means warning the
    // owner about a payment to someone they never paid. Same escape the ingestion paths use.
    query = query.ilike('client_name', escapeLikeValue(target.client_name.trim()))
  } else {
    // Amount alone is too loose to warn on — see the note on the amount above for why the SILENCE
    // that used to accompany it was the dangerous half.
    return unchecked('no_vendor')
  }

  // [DUBBEL-BEWIJS] THE one that mattered most. `matches ?? []` turned a failed read into an empty
  // candidate set, pickPaidTwin found no twin in it — correctly, there was nothing to find — and
  // the owner got a pay dialog that looked exactly like a completed search. The one question this
  // route exists to answer, answered "no" by a database hiccup, on the screen where the owner is
  // about to send money out the door a second time.
  const { data: matches, error: matchesError } = await query
  if (matchesError) {
    console.error('[DUBBEL-BEWIJS] paid candidates unreadable — reporting unchecked, not "no duplicate"', {
      userId: user.id, invoiceId: target.id, error: matchesError.message,
    })
    return unchecked('candidates_unreadable')
  }
  const candidates = matches ?? []

  // [PAY-SAFE-NUMBER] Vendor + amount + recency got us the candidates; the invoice NUMBER decides
  // which of them is actually a re-send worth stopping the owner for. See double-pay-check.ts —
  // without this, a supplier billing the same amount on a rhythm (a boekhouder's monthly fee, a
  // huurcontract, an abonnement) tripped this warning every single period.
  const m = pickPaidTwin(target, candidates)

  // The SEARCH, reported whichever way the conclusion goes. `candidates` is the set the rule was
  // handed — deliberately the count BEFORE pickPaidTwin's fences, because that is how wide the
  // search was; reporting the survivors instead would describe the conclusion twice and the search
  // not at all.
  const search = {
    candidates: candidates.length,
    anchor: target.vendor_iban ? ('iban' as const) : ('name' as const),
    days: RECENT_DAYS,
    capped: candidates.length >= MAX_CANDIDATES,
    limit: MAX_CANDIDATES,
  }

  if (m) {
    return answer({
      outcome: 'twin',
      match: {
        id: m.id, // [PAY-SAFE] the original paid invoice — for "view original" deep-link
        invoice_number: m.invoice_number,
        client_name: m.client_name,
        total_inc_btw: m.total_inc_btw,
        payment_date: m.payment_date ?? m.marked_paid_at ?? null,
      },
      search,
      reason: null,
    })
  }

  // The only exit entitled to say the coast is clear, because it is the only one that looked.
  return answer({ outcome: 'clear', match: null, search, reason: null })
}