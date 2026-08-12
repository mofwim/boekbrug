// src/app/api/invoice/[id]/correct/route.ts
// [CORRIGEER] "The details are wrong on a SENT invoice" — the legal shape of editing one.
//
//   POST /api/invoice/<id>/correct   body: { reason?: string }
//
// WHAT THE OWNER ASKED FOR, AND WHY IT CANNOT BE AN UPDATE
// The wish is honest: the address block, a date, the client's name — wrong on an invoice that is
// already out, with the LINES perfectly fine. The obvious fix is an edit form. That obvious fix is
// the one thing this product may never build: a sent factuur carries a number from a gapless,
// forward-only series (Art. 35 Wet OB), and the customer holds a copy. An in-place edit makes the
// owner's administration disagree with the paper their customer books — the exact defect this app
// exists to prevent, and the same answer we gave when a SUPPLIER's package let them edit a sent
// invoice at us.
//
// THE LEGAL SHAPE of "edit the details, keep the lines" is a correction pair, and both halves
// already exist in this codebase:
//
//   1. /api/invoice/creditnota  — cancels the sent invoice in the books (mirrored lines, its own
//                                 CR number, linked via original_invoice_id, PDF delivered);
//   2. /api/invoice/[id]/duplicate — a fresh DRAFT with the same lines and client fields.
//
// A draft is fully editable — details AND lines — but the lines arrive prefilled and correct, so
// the owner touches only what was wrong, then sends; the send mints the next number in the
// series. This route only ORCHESTRATES the two, so there is exactly one behaviour whether the
// owner corrects via this button or does the two steps by hand.
//
// ORDER AND FAILURE. The creditnota goes FIRST: it is the half with legal weight, and if it
// fails nothing has happened. If the duplicate then fails, the books are still correct — the bad
// invoice is cancelled — and the owner has lost only prefilled convenience, which the response
// says in so many words. The reverse order could mint a correcting draft while the wrong invoice
// stays live in the books.

import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase-server'
// [ACTING-FOR] Corrigeren annuleert een uitgegeven factuur — dat is een besluit van de EIGENAAR,
// niet van een verkoopmedewerker. Dezelfde grendel als supersede.
import { requireOwner } from '@/lib/owner-only'

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  { const w = await requireOwner('Gegevens van een verstuurde factuur corrigeren'); if (w.response) return w.response }
  const { id } = await params
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json().catch(() => ({}))
  const reason: string = typeof body?.reason === 'string' && body.reason.trim()
    ? body.reason.trim()
    : 'Gegevens gecorrigeerd'

  // Both halves are called over HTTP against our own routes, not by duplicating their logic —
  // the creditnota route alone knows the one-credit-per-invoice lock, the CR numbering and the
  // delivery; the duplicate route alone knows the deploy-safe column probing. Re-implementing
  // either here would be the two-definitions defect with a route boundary in the middle.
  const origin = request.nextUrl.origin
  const cookie = request.headers.get('cookie') ?? ''

  const creditRes = await fetch(`${origin}/api/invoice/creditnota`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', cookie },
    body: JSON.stringify({ original_invoice_id: id, reason }),
  })
  const credit = await creditRes.json().catch(() => ({}))
  if (!creditRes.ok) {
    // The creditnota route's refusals are already owner-readable (already credited, money
    // settled, accountant lock). Pass them through rather than translating a translation.
    return NextResponse.json(
      { error: credit?.error || 'Creditnota maken mislukt', step: 'creditnota' },
      { status: creditRes.status },
    )
  }

  const dupRes = await fetch(`${origin}/api/invoice/${id}/duplicate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', cookie },
  })
  const dup = await dupRes.json().catch(() => ({}))
  if (!dupRes.ok || !dup?.invoiceId) {
    // The books are already right: the wrong invoice is cancelled. Only the convenience is lost.
    return NextResponse.json(
      {
        error: 'De creditnota is gemaakt, maar het nieuwe concept niet — maak de factuur opnieuw aan via Nieuwe factuur.',
        step: 'duplicate',
        creditnota_id: credit?.creditnota_id ?? null,
      },
      { status: 500 },
    )
  }

  return NextResponse.json({
    success: true,
    creditnota_id: credit?.creditnota_id ?? null,
    creditnota_number: credit?.creditnota_number ?? null,
    draft_id: dup.invoiceId,
  })
}
