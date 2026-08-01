// src/app/api/invoice/[id]/duplicate/route.ts
// BOEK-003: Invoice Duplicate (POST)

import { NextRequest, NextResponse } from 'next/server'
import { amsterdamToday } from '@/lib/format-nl'
import { createServerSupabaseClient } from '@/lib/supabase-server'
import { logAuditAction } from '@/lib/audit'
import { vereisEigenaar } from '@/lib/alleen-eigenaar'

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  // [NAMENS] Alleen de eigenaar — zie src/lib/alleen-eigenaar.ts. Een medewerker hier
  // doorlaten zou een tweede nummerreeks onder hetzelfde BTW-nummer openen.
  { const w = await vereisEigenaar('Een factuur dupliceren'); if (w.antwoord) return w.antwoord }

  const { id } = await params
  try {
    const supabase = await createServerSupabaseClient()

    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { data: original, error: fetchError } = await supabase
      .from('invoices')
      .select('*')
      .eq('id', id)
      .eq('sender_id', user.id)
      .single()

    if (fetchError || !original) {
      return NextResponse.json({ error: 'Factuur niet gevonden' }, { status: 404 })
    }

    const today = amsterdamToday()
    const dueDate = new Date()
    dueDate.setDate(dueDate.getDate() + 30)

    const { data: newInvoice, error: insertError } = await supabase
      .from('invoices')
      .insert({
        sender_id: user.id,
        invoice_number: null,
        // [DUP-TYPE] Preserve the document type — otherwise a duplicated
        // creditnota/pro_forma silently became a 'factuur' (DB default) carrying
        // the original's negative amounts, and on send minted a factuur number.
        invoice_type: original.invoice_type,
        invoice_date: today,
        due_date: dueDate.toISOString().split('T')[0],
        // [DUP-TYPE] Carry Leverdatum (Art. 35a sub f) so a duplicated factuur
        // doesn't ship without a delivery date.
        delivery_date: original.delivery_date,
        status: 'draft',
        direction: original.direction,
        total_ex_btw: original.total_ex_btw,
        btw_amount: original.btw_amount,
        total_inc_btw: original.total_inc_btw,
        // [BRIDGE-A] sent_to_accountant removed — sharing is GENERATED from status
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
      .eq('invoice_id', id)

    if (originalLines && originalLines.length > 0) {
      await supabase.from('invoice_lines').insert(
        originalLines.map(l => ({ ...l, invoice_id: newInvoice.id }))
      )
    }

    // [CONTROL] audit_logs has NO authenticated INSERT policy (service_role only)
    // → an anon insert 42501s silently. logAuditAction writes via service_role.
    await logAuditAction({
      userId: user.id,
      action: 'invoice.duplicated',
      entityType: 'invoice',
      entityId: newInvoice.id,
      oldValue: { source_invoice_id: id },
    })

    return NextResponse.json({ success: true, invoiceId: newInvoice.id })

  } catch {
    return NextResponse.json({ error: 'Onbekende fout' }, { status: 500 })
  }
}
