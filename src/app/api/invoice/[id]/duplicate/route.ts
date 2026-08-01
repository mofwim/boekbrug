// src/app/api/invoice/[id]/duplicate/route.ts
// BOEK-003: Invoice Duplicate (POST)

import { NextRequest, NextResponse } from 'next/server'
import { amsterdamToday } from '@/lib/format-nl'
import { createServerSupabaseClient } from '@/lib/supabase-server'
import { logAuditAction } from '@/lib/audit'
// [ACTING-FOR] Omgebouwd in plaats van dichtgezet: "maak er nog zo een" is het hart van
// factureerwerk. De kopie wordt een CONCEPT zonder nummer, dus er wordt hier niets uitgegeven —
// het nummer valt pas bij versturen, en dat loopt langs de reeks van de eigenaar.
import { getActingFor } from '@/lib/acting-for-server'
import { invoiceOwnerId, invoiceCreatedBy, canAccessInvoice } from '@/lib/acting-for'
// [ACTING-FOR] created_by bestaat pas ná de migratie — zonder terugval faalt het dupliceren.
import { writeWithTrail } from '@/lib/created-by'

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  // [ACTING-FOR] Wie handelt hier, namens wie? Voor een eigenaar verandert er niets.
  const acting = await getActingFor()
  if (!acting) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const ownerId = invoiceOwnerId(acting)

  const { id } = await params
  try {
    const supabase = await createServerSupabaseClient()

    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { data: original, error: fetchError } = await supabase
      .from('invoices')
      .select('*')
      .eq('id', id)
      .eq('sender_id', ownerId)
      .single()

    if (fetchError || !original) {
      return NextResponse.json({ error: 'Factuur niet gevonden' }, { status: 404 })
    }
    // [ACTING-FOR] Een medewerker dupliceert alleen wat hij zelf maakte — niet de factuur van zijn
    // baas, waarmee hij anders diens bedragen en klantgegevens zou kunnen inzien.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if (!canAccessInvoice(acting, original as any)) {
      return NextResponse.json({ error: 'Factuur niet gevonden' }, { status: 404 })
    }

    const today = amsterdamToday()
    const dueDate = new Date()
    dueDate.setDate(dueDate.getDate() + 30)

    const { data: newInvoice, error: insertError } = await writeWithTrail<{ id: string }>(
      (spoor) => supabase
      .from('invoices')
      .insert({
        sender_id: ownerId,
        // De kopie is van wie hem maakt, niet van wie het origineel maakte.
        ...spoor,
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
      .single(),
      { created_by: invoiceCreatedBy(acting) },
    )

    if (insertError || !newInvoice) {
      return NextResponse.json({ error: 'Dupliceren mislukt' }, { status: 500 })
    }

    const { data: originalLines } = await supabase
      .from('invoice_lines')
      .select('*')  // [UNIT] '*' zodat de eenheid meekomt zonder een tweede kolommenlijst die kan verouderen
      .eq('invoice_id', id)

    if (originalLines && originalLines.length > 0) {
      // [UNIT] Expliciet overtypen, NIET `{ ...l }` spreiden.
      //
      // Ik had hier eerst select('*') met een spread staan, en dat was fout: dan gaat het `id`
      // van de ORIGINELE regel mee de INSERT in — een primaire sleutel die al bestaat. Wat er
      // gekopieerd moet worden is de INHOUD van een regel, niet haar identiteit.
      //
      // `unit` komt uit migratie invoice_line_unit.sql en is undefined zolang die niet is
      // toegepast; dan wordt hij niet meegestuurd en blijft de INSERT geldig.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (supabase as any).from('invoice_lines').insert(
        originalLines.map((l) => {
          const bron = l as unknown as { unit?: string | null }
          const regel: Record<string, unknown> = {
            invoice_id: newInvoice.id,
            description: l.description,
            quantity: l.quantity,
            unit_price: l.unit_price,
            btw_rate: l.btw_rate,
            line_total: l.line_total,
          }
          if (bron.unit !== undefined) regel.unit = bron.unit ?? null
          return regel
        }),
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
