// src/app/api/invoice/[id]/duplicate/route.ts
// BOEK-003: Invoice Duplicate (POST)

import { NextRequest, NextResponse } from 'next/server'
// [REGEL-KOPIE] One definition of "the content of an invoice line" — see invoice-line-copy.ts.
import { copiedLinesFor } from '@/lib/invoice-line-copy'
import { amsterdamToday, amsterdamMidnightUtc } from '@/lib/format-nl'
import { createServerSupabaseClient } from '@/lib/supabase-server'
import { logAuditAction } from '@/lib/audit'
// [ACTING-FOR] Omgebouwd in plaats van dichtgezet: "maak er nog zo een" is het hart van
// factureerwerk. De kopie wordt een CONCEPT zonder nummer, dus er wordt hier niets uitgegeven —
// het nummer valt pas bij versturen, en dat loopt langs de reeks van de eigenaar.
import { getActingFor } from '@/lib/acting-for-server'
import { invoiceOwnerId, invoiceCreatedBy, canAccessInvoice } from '@/lib/acting-for'
// [ACTING-FOR] created_by bestaat pas ná de migratie — zonder terugval faalt het dupliceren.
import { writeWithTrail } from '@/lib/created-by'
// [KLANT-EXTRA] De twee vrije klantregels reizen mee naar het nieuwe document — in een
// aparte, mislukbare schrijfbeurt. Zie de kop van dat bestand.
import { copyExtraLinesOnto } from '@/lib/client-extra-lines-write'

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
    // [TZ-SERVER] Beide data van dezelfde klok. `today` kwam al van de eigenaar; de vervaldatum
    // rekende vanaf de SERVER, en in het eerste uur van een Nederlandse dag staat die nog op
    // gisteren. Eén rij met twee klokken erin: de factuurdatum van vandaag en een vervaldatum van
    // 30 dagen na gisteren — een verschil dat op geen enkel scherm te zien is, en dat de
    // betaaltermijn is die de klant leest.
    const dueDate = amsterdamMidnightUtc(today)
    dueDate.setUTCDate(dueDate.getUTCDate() + 30)

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
        //
        // [LEVERDATUM] …but not the ORIGINAL's date. Every other date on this row is refreshed —
        // invoice_date is today, due_date is today + 30 — because duplicating means "the same work,
        // again, now". The leverdatum was the one that stayed behind, so a March invoice duplicated
        // in August produced an August invoice stating the goods were delivered in March. It is
        // printed on the PDF and it is a legally required statement, so it was not a stale field
        // but a false one; and until now it could not even be corrected afterwards.
        //
        // Only when there was one at all: an offerte has none and must not acquire one here.
        //
        // And spread rather than assigned, which is not tidiness. `delivery_date: null` puts the
        // KEY in the JSON that goes to PostgREST; on a deployment where the FACTUUR-A migration is
        // still open that column does not exist and the whole INSERT fails (42703) — duplicating
        // any invoice would stop working. The previous line got away with `original.delivery_date`
        // precisely because it was `undefined` there, and JSON drops undefined. `select('*')` above
        // returns the key iff the column exists, so the row itself answers whether to write it.
        ...('delivery_date' in original
          ? { delivery_date: original.delivery_date ? today : null }
          : {}),
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

    // [KLANT-EXTRA] Een kopie zonder de twee klantregels is een kopie die de ondernemer opnieuw
    // moet invullen — precies het werk dat dupliceren bespaart.
    await copyExtraLinesOnto(
      (fields) => supabase.from('invoices').update(fields as never).eq('id', newInvoice.id),
      original,
      { from: id, to: newInvoice.id },
    )

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
      // [REGEL-KOPIE] The line's content comes from the one module that knows which columns a
      // line has. It was typed over by hand here, and [REGEL-KORTING] added discount_type and
      // discount_value to the creditnota mirror and to both write routes — but not here. The copy
      // still carried the DISCOUNTED line_total beside the undiscounted price, so it looked right
      // until it was opened and saved: € 100,00 + € 21,00 where the original said € 90,00 +
      // € 18,90. See invoice-line-copy.ts for the two columns before it that drifted the same way.
      await supabase.from('invoice_lines').insert(
        copiedLinesFor(originalLines as never, newInvoice.id) as never,
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
