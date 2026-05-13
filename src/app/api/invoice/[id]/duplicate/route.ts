// src/app/api/invoice/[id]/duplicate/route.ts
// BOEK-003: Invoice Duplicate (POST)

import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase-server'

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const supabase = await createServerSupabaseClient()

    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { data: original, error: fetchError } = await supabase
      .from('invoices')
      .select('*')
      .eq('id', params.id)
      .eq('sender_id', user.id)
      .single()

    if (fetchError || !original) {
      return NextResponse.json({ error: 'Factuur niet gevonden' }, { status: 404 })
    }

    const { data: newNumber } = await supabase
      .rpc('generate_invoice_number', { user_id: user.id })

    const today = new Date().toISOString().split('T')[0]
    const dueDate = new Date()
    dueDate.setDate(dueDate.getDate() + 30)

    const { data: newInvoice, error: insertError } = await supabase
      .from('invoices')
      .insert({
        sender_id: user.id,
        invoice_number: newNumber,
        invoice_date: today,
        due_date: dueDate.toISOString().split('T')[0],
        status: 'draft',
        direction: original.direction,
        total_ex_btw: original.total_ex_btw,
        btw_amount: original.btw_amount,
        total_inc_btw: original.total_inc_btw,
        sent_to_accountant: false,
        client_name: original.client_name,
        client_email: original.client_email,
        client_address: original.client_address,
        client_postal_code: original.client_postal_code,
        client_city: original.client_city,
        client_btw_number: original.client_btw_number
      })
      .select()
      .single()

    if (insertError || !newInvoice) {
      return NextResponse.json({ error: 'Dupliceren mislukt' }, { status: 500 })
    }

    const { data: originalLines } = await supabase
      .from('invoice_lines')
      .select('description, quantity, unit_price, btw_rate, line_total')
      .eq('invoice_id', params.id)

    if (originalLines && originalLines.length > 0) {
      await supabase.from('invoice_lines').insert(
        originalLines.map(l => ({ ...l, invoice_id: newInvoice.id }))
      )
    }

    await supabase.from('audit_logs').insert({
      user_id: user.id,
      action: 'invoice.duplicated',
      entity_type: 'invoice',
      entity_id: newInvoice.id,
      old_value: JSON.stringify({ source_invoice_id: params.id })
    })

    return NextResponse.json({ success: true, invoiceId: newInvoice.id })

  } catch {
    return NextResponse.json({ error: 'Onbekende fout' }, { status: 500 })
  }
}
