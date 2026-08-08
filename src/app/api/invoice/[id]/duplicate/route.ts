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
        // [KORTING-KOPIE] De korting reist mee met de bedragen. Deze route kopieert de TOTALEN van
        // het origineel maar bouwt de REGELS opnieuw op — en zonder de korting spraken die twee
        // elkaar tegen: de kop droeg het verlaagde bedrag, de regels het volle. Elke afgeleide
        // (de PDF en de UBL-export rekenen uit de regels) drukte dan een ander bedrag dan er in de
        // boeken staat. Gemeten op een factuur van EUR 1.000 met 10%: EUR 121 verschil.
        discount_type: original.discount_type ?? null,
        discount_value: original.discount_value ?? null,
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
      // [UNIT] Copy the fields explicitly, do NOT spread `{ ...l }`.
      //
      // This first had select('*') with a spread, and that was wrong: then the `id` of the
      // ORIGINAL line travels into the INSERT — a primary key that already exists. What has to
      // be copied is the CONTENT of a line, not its identity.
      await supabase.from('invoice_lines').insert(
        originalLines.map((l) => ({
          invoice_id: newInvoice.id,
          description: l.description,
          quantity: l.quantity,
          unit_price: l.unit_price,
          btw_rate: l.btw_rate,
          line_total: l.line_total,
          // A database where invoice_line_unit.sql has not been applied returns rows without
          // this key; then it is not sent either, and the INSERT stays valid.
          ...(l.unit !== undefined ? { unit: l.unit ?? null } : {}),
          // [VRIJGESTELD-KOPIE] En de vrijstellingsvlag reist mee, om precies dezelfde reden als
          // de eenheid — maar met een duurder gevolg als hij dat niet doet.
          //
          // Zonder haar wordt een gekopieerde vrijgestelde regel geclassificeerd als BELASTE omzet
          // tegen 0%. Bij een creditnota betekent dat dat de correctie het origineel niet opheft:
          // het origineel blijft +EUR 1.000 vrijgestelde omzet en de creditnota landt als -EUR 1.000
          // in de 0%/verlegd-rubriek. Twee rubrieken tegelijk fout, en 5a/5b blijven kloppen — dus
          // geen enkel scherm laat het zien.
          //
          // Dezelfde harding als overal waar deze vlag wordt geschreven: alleen de letterlijke
          // waarde 'exempt' telt. Een onbekende waarde wordt NULL, nooit een vrijstelling.
          ...(l.vat_treatment !== undefined ? { vat_treatment: l.vat_treatment === 'exempt' ? 'exempt' : null } : {}),
        })),
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
