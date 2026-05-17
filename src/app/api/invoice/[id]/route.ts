// src/app/api/invoice/[id]/route.ts
// BOEK-001: Invoice Edit (PUT)
// BOEK-002: Invoice Delete (DELETE)
// [BOEK-031] Invoice numbering format: {seq}-{year} e.g. 001-2026, CR-001-2026, PF-001-2026

import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase-server'

// الحالات التي لا يمكن تعديلها — Human Control
const NON_EDITABLE_STATUSES = ['paid', 'processing', 'processed']

// ── مساعد مشترك ───────────────────────────────────────────────────────────────
async function getAuthorizedInvoice(
  supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>,
  invoiceId: string,
  userId: string
) {
  const { data: invoice, error } = await supabase
    .from('invoices')
    .select('id, sender_id, status, invoice_number')
    .eq('id', invoiceId)
    .single()

  if (error || !invoice) return { error: 'Factuur niet gevonden', status: 404 as const }
  if (invoice.sender_id !== userId) return { error: 'Geen toegang', status: 403 as const }

  return { invoice }
}

// ── PUT: Factuur bewerken (BOEK-001) ─────────────────────────────────────────
export async function PUT(
  request: NextRequest,
{ params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  try {
    const supabase = await createServerSupabaseClient()

    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { invoice, error, status } = await getAuthorizedInvoice(supabase, id, user.id)
    if (error) return NextResponse.json({ error }, { status })

    // Human Control: betaalde of verwerkte facturen mogen niet bewerkt worden
    if (NON_EDITABLE_STATUSES.includes(invoice!.status)) {
      return NextResponse.json(
        { error: 'Deze factuur kan niet meer worden bewerkt' },
        { status: 400 }
      )
    }

    const body = await request.json()
    const {
      client_name, client_email, client_address,
      client_postal_code, client_city, client_btw_number,
      invoice_date, due_date, lines
    } = body

    if (!client_name || !client_email || !invoice_date || !due_date) {
      return NextResponse.json({ error: 'Verplichte velden ontbreken' }, { status: 400 })
    }
    if (!lines || lines.length === 0) {
      return NextResponse.json({ error: 'Minimaal één factuurregel vereist' }, { status: 400 })
    }
    if (lines.some((l: any) => !l.description || l.unit_price <= 0)) {
      return NextResponse.json({ error: 'Ongeldige factuurregels' }, { status: 400 })
    }

    const total_ex_btw = lines.reduce((sum: number, l: any) => sum + l.quantity * l.unit_price, 0)
    const btw_amount = lines.reduce((sum: number, l: any) => sum + l.quantity * l.unit_price * (l.btw_rate / 100), 0)
    const total_inc_btw = total_ex_btw + btw_amount

    const { error: updateError } = await supabase
      .from('invoices')
      .update({
        client_name, client_email, client_address,
        client_postal_code, client_city, client_btw_number,
        invoice_date, due_date,
        total_ex_btw, btw_amount, total_inc_btw,
        updated_at: new Date().toISOString()
      })
      .eq('id', id)

    if (updateError) return NextResponse.json({ error: 'Bijwerken mislukt' }, { status: 500 })

    await supabase.from('invoice_lines').delete().eq('invoice_id', id)
    await supabase.from('invoice_lines').insert(
      lines.map((l: any) => ({
        invoice_id: id,
        description: l.description,
        quantity: l.quantity,
        unit_price: l.unit_price,
        btw_rate: l.btw_rate,
        line_total: l.quantity * l.unit_price
      }))
    )

    await supabase.from('audit_logs').insert({
      user_id: user.id,
      action: 'invoice.updated',
      entity_type: 'invoice',
      entity_id: id
    })

    return NextResponse.json({ success: true })

  } catch {
    return NextResponse.json({ error: 'Onbekende fout' }, { status: 500 })
  }
}

// ── DELETE: Factuur verwijderen (BOEK-002) ────────────────────────────────────
export async function DELETE(
  request: NextRequest,
{ params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  try {
    const supabase = await createServerSupabaseClient()

    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { invoice, error, status } = await getAuthorizedInvoice(supabase, id, user.id)
    if (error) return NextResponse.json({ error }, { status })

    if (invoice!.status !== 'draft') {
      return NextResponse.json(
        { error: 'Alleen concept-facturen kunnen worden verwijderd' },
        { status: 400 }
      )
    }

    await supabase.from('invoice_lines').delete().eq('invoice_id', id)

    const { error: deleteError } = await supabase
      .from('invoices').delete().eq('id', id)

    if (deleteError) return NextResponse.json({ error: 'Verwijderen mislukt' }, { status: 500 })

    await supabase.from('audit_logs').insert({
      user_id: user.id,
      action: 'invoice.deleted',
      entity_type: 'invoice',
      entity_id: id,
      old_value: JSON.stringify({ invoice_number: invoice!.invoice_number })
    })

    return NextResponse.json({ success: true })

  } catch {
    return NextResponse.json({ error: 'Onbekende fout' }, { status: 500 })
  }
}