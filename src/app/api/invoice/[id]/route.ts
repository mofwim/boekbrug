// src/app/api/invoice/[id]/route.ts
// Invoice item route — GET (fetch one), PUT (edit a draft), DELETE (remove a draft).
// =====================================================
// [INVOICE-ROUTE-RESTORE] This file previously held a stray copy of the BOEK-010
// *files* route (GET on `documents`, DELETE → 410), so it exposed no PUT. The
// edit page (PUT save + edit→send) and InvoiceActions (DELETE) both hit
// /api/invoice/[id] and got 405/410 → editing and deleting were fully broken.
// Restored here with the real handlers.
//
// Legal guard (Art. 35 Wet OB 1968): only a DRAFT can be edited or deleted — a
// sent invoice has a committed legal number and is immutable. All access is via
// the session client and scoped by sender_id, so RLS is enforced.
// =====================================================

import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase-server'
// [BTW-ROUND] De totalen komen uit één module, dezelfde die /api/invoice/send gebruikt bij
// uitgifte. Hier stond een eigen berekening die de BTW PER REGEL optelde en één keer afrondde;
// send groepeert per TARIEF en rondt per tarief af (de methode van de PDF en de UBL-export).
// Op een factuur met gemengde tarieven scheelde dat een cent, dus het bedrag dat de ondernemer
// opsloeg was niet het bedrag dat hij verstuurde. Zie invoice-totals.ts.
import { computeInvoiceTotals, isValidBtwRate, round2 } from '@/lib/invoice-totals'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function ownedInvoice(supabase: any, id: string, userId: string) {
  return supabase
    .from('invoices')
    // [EDIT-LINES-SAFE] The stored totals come along as the PRE-IMAGE: if the line swap below
    // fails after the header is already written, restoring the old lines is only half the undo —
    // the header would still carry the new amounts. Both go back, or neither.
    .select('id, status, sender_id, total_ex_btw, btw_amount, total_inc_btw')
    .eq('id', id)
    .eq('sender_id', userId)
    .single()
}

// GET /api/invoice/[id] — the invoice + its lines (owner only).
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Niet ingelogd' }, { status: 401 })

  const { data: invoice, error } = await supabase
    .from('invoices')
    .select('*')
    .eq('id', id)
    .eq('sender_id', user.id)
    .single()
  if (error || !invoice) return NextResponse.json({ error: 'Factuur niet gevonden' }, { status: 404 })

  const { data: lines } = await supabase
    .from('invoice_lines')
    .select('*')
    .eq('invoice_id', id)

  return NextResponse.json({ invoice, lines: lines ?? [] })
}

// PUT /api/invoice/[id] — update a DRAFT's client fields, dates and lines, and
// recompute the stored totals from those lines.
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Niet ingelogd' }, { status: 401 })

  const { data: existing } = await ownedInvoice(supabase, id, user.id)
  if (!existing) return NextResponse.json({ error: 'Factuur niet gevonden' }, { status: 404 })
  if (existing.status !== 'draft') {
    return NextResponse.json(
      { error: 'Een verzonden factuur kan niet meer worden gewijzigd.' },
      { status: 409 }
    )
  }

  const body = await request.json().catch(() => ({}))
  const rawLines = Array.isArray(body.lines) ? body.lines : []
  if (rawLines.length === 0) {
    return NextResponse.json({ error: 'Minstens één factuurregel is vereist.' }, { status: 400 })
  }

  // Normalize lines and recompute totals (line sign is preserved, so a
  // creditnota draft keeps its negative amounts).
  type NormLine = {
    description: string
    quantity: number
    unit_price: number
    btw_rate: number
    line_total: number
  }
  // [BTW-TARIEF] Only a rate a Dutch invoice may actually carry. `Number(l.btw_rate) || 0`
  // silently turned anything unparseable — and a MISSING rate — into 0%, which is a real tariff
  // with a real meaning (vrijgesteld/verlegd). A draft saved that way looks perfect and books
  // zero BTW. Both editors offer exactly 21/9/0, so this can only reject a hand-made request.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const badRate = rawLines.findIndex((l: any) => !isValidBtwRate(l?.btw_rate))
  if (badRate !== -1) {
    return NextResponse.json(
      { error: `Regel ${badRate + 1} heeft een ongeldig BTW-tarief — kies 21%, 9% of 0%.` },
      { status: 400 }
    )
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const lines: NormLine[] = rawLines.map((l: any): NormLine => {
    const quantity = Number(l.quantity) || 0
    const unit_price = Number(l.unit_price) || 0
    return {
      description: String(l.description ?? ''),
      quantity,
      unit_price,
      btw_rate: Number(l.btw_rate),
      line_total: round2(quantity * unit_price),
    }
  })
  const { total_ex_btw, btw_amount, total_inc_btw } = computeInvoiceTotals(lines)

  // Header patch — only the client/date fields the edit form sends, plus totals.
  const patch: Record<string, unknown> = {
    total_ex_btw,
    btw_amount,
    total_inc_btw,
    updated_at: new Date().toISOString(),
  }
  for (const k of [
    'client_name',
    'client_email',
    'client_address',
    'client_postal_code',
    'client_city',
    'client_btw_number',
    'invoice_date',
    'due_date',
  ]) {
    if (k in body) patch[k] = body[k]
  }

  // [EDIT-CAS] Compare-and-swap on 'draft'. The status check above read a FETCHED row, and
  // invoices_zzp_update carries no status test — so a send that landed in between (another tab,
  // a double submit) left this UPDATE free to rewrite the totals of an invoice that had just
  // become legally issued, and the lines below would then be swapped under a committed number.
  // /api/invoice/send guards its own commit exactly this way and explains why; the edit path
  // mutates the same legal record and needs the same guard.
  const { data: patched, error: upErr } = await supabase
    .from('invoices')
    // patch has a dynamic key set (only the fields the form sent) → cast past
    // the generated row type.
    .update(patch as never)
    .eq('id', id)
    .eq('sender_id', user.id)
    .eq('status', 'draft')
    .select('id')
  if (upErr) return NextResponse.json({ error: 'Opslaan mislukt' }, { status: 500 })
  if (!patched || patched.length === 0) {
    // Lost the race: it is no longer a draft. Nothing was written, and the lines are untouched.
    return NextResponse.json(
      { error: 'Deze factuur is inmiddels verzonden en kan niet meer worden gewijzigd.' },
      { status: 409 }
    )
  }

  // Replace the lines wholesale.
  //
  // [EDIT-LINES-SAFE] Snapshot first, restore on failure. delete-then-insert is not atomic here
  // (no transaction over PostgREST), and the failure was not cosmetic: the header totals are
  // already committed above, so a failed insert left a draft with the NEW amounts and ZERO
  // lines. Sending that draft skips the recompute in /api/invoice/send (it only recomputes when
  // lines exist), mints a legal number, and renders a PDF with an empty table — a numbered
  // invoice, for a real amount, itemising nothing. Restoring the old lines keeps the draft
  // internally consistent (old lines, and the caller knows the save failed).
  const { data: previousLines } = await supabase
    .from('invoice_lines')
    .select('description, quantity, unit_price, btw_rate, line_total')
    .eq('invoice_id', id)

  await supabase.from('invoice_lines').delete().eq('invoice_id', id)
  const { error: insErr } = await supabase
    .from('invoice_lines')
    .insert(lines.map((l) => ({ invoice_id: id, ...l })))
  if (insErr) {
    // Put BOTH halves back: the old lines, and the header totals that belong to them. Restoring
    // only the lines would leave a draft whose stored amounts describe a version that no longer
    // exists — the same mismatch, just harder to notice.
    if (previousLines && previousLines.length > 0) {
      await supabase
        .from('invoice_lines')
        .insert(previousLines.map((l) => ({ invoice_id: id, ...l })))
    }
    await supabase
      .from('invoices')
      .update({
        total_ex_btw: existing.total_ex_btw,
        btw_amount: existing.btw_amount,
        total_inc_btw: existing.total_inc_btw,
      } as never)
      .eq('id', id)
      .eq('sender_id', user.id)
      .eq('status', 'draft')
    return NextResponse.json({ error: 'Opslaan mislukt (regels)' }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}

// DELETE /api/invoice/[id] — remove a DRAFT (and its lines). Sent invoices are
// immutable and cannot be deleted here.
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Niet ingelogd' }, { status: 401 })

  const { data: existing } = await ownedInvoice(supabase, id, user.id)
  if (!existing) return NextResponse.json({ error: 'Factuur niet gevonden' }, { status: 404 })
  if (existing.status !== 'draft') {
    return NextResponse.json(
      { error: 'Alleen een concept kan verwijderd worden.' },
      { status: 409 }
    )
  }

  // [DELETE-CAS] Delete the INVOICE, guarded on 'draft', and let the FK do the rest:
  // invoice_lines.invoice_id is ON DELETE CASCADE, so the lines go with it.
  //
  // The old order was the bug. It deleted the LINES first — and invoice_lines_delete_own has no
  // status test, while invoices_zzp_delete permits status='draft' only. So if the row was no
  // longer a draft (a send that landed between the check above and this write), the lines were
  // destroyed and the invoice survived, and the unchecked result reported success: a SENT
  // invoice, its number committed, silently stripped of everything it itemises, with the screen
  // saying "Verwijderd". That is the exact failure FacturenClient's own comment describes for
  // the client-side code this route was created to replace — reproduced here in the race window.
  const { data: deleted, error } = await supabase
    .from('invoices')
    .delete()
    .eq('id', id)
    .eq('sender_id', user.id)
    .eq('status', 'draft')
    .select('id')
  if (error) return NextResponse.json({ error: 'Verwijderen mislukt' }, { status: 500 })
  if (!deleted || deleted.length === 0) {
    // Nothing was removed — and because the invoice went first, nothing was damaged either.
    return NextResponse.json(
      { error: 'Deze factuur is inmiddels verzonden en kan niet meer worden verwijderd.' },
      { status: 409 }
    )
  }

  return NextResponse.json({ success: true })
}
