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

// Symmetric round-to-cents (matches lib/invoice-numbering / the create page).
function round2(n: number): number {
  const v = Number(n) || 0
  return (v < 0 ? -1 : 1) * (Math.round(Math.abs(v) * 100 + 1e-9) / 100)
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function ownedInvoice(supabase: any, id: string, userId: string) {
  return supabase
    .from('invoices')
    .select('id, status, sender_id')
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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const lines: NormLine[] = rawLines.map((l: any): NormLine => {
    const quantity = Number(l.quantity) || 0
    const unit_price = Number(l.unit_price) || 0
    const btw_rate = Number(l.btw_rate) || 0
    return {
      description: String(l.description ?? ''),
      quantity,
      unit_price,
      btw_rate,
      line_total: round2(quantity * unit_price),
    }
  })
  const total_ex_btw = round2(lines.reduce((s, l) => s + l.line_total, 0))
  const btw_amount = round2(lines.reduce((s, l) => s + (l.line_total * l.btw_rate) / 100, 0))
  const total_inc_btw = round2(total_ex_btw + btw_amount)

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

  const { error: upErr } = await supabase
    .from('invoices')
    // patch has a dynamic key set (only the fields the form sent) → cast past
    // the generated row type.
    .update(patch as never)
    .eq('id', id)
    .eq('sender_id', user.id)
  if (upErr) return NextResponse.json({ error: 'Opslaan mislukt' }, { status: 500 })

  // Replace the lines wholesale.
  await supabase.from('invoice_lines').delete().eq('invoice_id', id)
  const { error: insErr } = await supabase
    .from('invoice_lines')
    .insert(lines.map((l) => ({ invoice_id: id, ...l })))
  if (insErr) return NextResponse.json({ error: 'Opslaan mislukt (regels)' }, { status: 500 })

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

  await supabase.from('invoice_lines').delete().eq('invoice_id', id)
  const { error } = await supabase
    .from('invoices')
    .delete()
    .eq('id', id)
    .eq('sender_id', user.id)
  if (error) return NextResponse.json({ error: 'Verwijderen mislukt' }, { status: 500 })

  return NextResponse.json({ success: true })
}
