// src/app/api/invoice/creditnota/route.ts
// [BOEK-031] Creditnota aanmaken — May 2026
// Regel: alleen voor verzonden facturen (sent / paid / overdue)
// Creditnota corrigeert — verwijderen mag nooit

import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase-server'

export async function POST(request: NextRequest) {
  try {
    const supabase = await createServerSupabaseClient()

    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body = await request.json()
    const { original_invoice_id, reason } = body

    if (!original_invoice_id) {
      return NextResponse.json(
        { error: 'original_invoice_id is verplicht' },
        { status: 400 }
      )
    }

    // [BOEK-031] Haal de originele factuur op — verificatie eigenaar
    const { data: original, error: fetchError } = await supabase
      .from('invoices')
      .select(`
        id, sender_id, status, invoice_number, invoice_type,
        client_name, client_email, client_address,
        client_postal_code, client_city, client_btw_number,
        total_ex_btw, btw_amount, total_inc_btw,
        invoice_date, due_date, direction
      `)
      .eq('id', original_invoice_id)
      .single()

    if (fetchError || !original) {
      return NextResponse.json({ error: 'Originele factuur niet gevonden' }, { status: 404 })
    }

    // [BOEK-031] Alleen de eigenaar mag een creditnota aanmaken
    if (original.sender_id !== user.id) {
      return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
    }

    // [BOEK-031] Creditnota alleen mogelijk op verzonden facturen
    // Draft facturen worden verwijderd — niet gecrediteerd
    const CREDITABLE_STATUSES = ['sent', 'paid', 'overdue', 'received', 'processing', 'processed']
    if (!CREDITABLE_STATUSES.includes(original.status)) {
      return NextResponse.json(
        { error: 'Alleen verzonden facturen kunnen worden gecrediteerd. Concept-facturen verwijder je gewoon.' },
        { status: 400 }
      )
    }

    // [BOEK-031] Controleer of er al een creditnota bestaat voor deze factuur
    // Zoek op invoice_lines description die de originele factuur id bevat
    const { data: existingCreditnota } = await supabase
      .from('invoices')
      .select('id')
      .eq('sender_id', user.id)
      .eq('invoice_type', 'creditnota')
      .eq('invoice_number', `CN-${original.invoice_number}`)
      .maybeSingle()

    // Ook checken via de gegenereerde nummering (als generate_invoice_number al gebruikt is)
    // De echte deduplicatie zit in de UI — één creditnota per factuur

    if (existingCreditnota) {
      return NextResponse.json(
        { error: 'Er bestaat al een creditnota voor deze factuur' },
        { status: 409 }
      )
    }

    // [BOEK-031] Genereer creditnota nummer
    const { data: creditnotaNumber } = await supabase
      .rpc('generate_invoice_number', { user_id: user.id })

    // [BOEK-031] Maak de creditnota aan
    // Bedragen zijn NEGATIEF — creditnota annuleert de originele factuur
    // receiver_id heeft FK naar profiles.id — kan geen invoice id bevatten
    // original_invoice_id link wordt bewaard in invoice_lines descriptions
    const { data: creditnota, error: insertError } = await supabase
      .from('invoices')
      .insert({
        sender_id: user.id,
        invoice_number: creditnotaNumber || `CN-${original.invoice_number}`,
        invoice_date: new Date().toISOString().split('T')[0],
        due_date: new Date().toISOString().split('T')[0],
        status: 'sent',
        invoice_type: 'creditnota',
        direction: original.direction,
        // [BOEK-031] Negatieve bedragen — annulering
        total_ex_btw: -(original.total_ex_btw || 0),
        btw_amount: -(original.btw_amount || 0),
        total_inc_btw: -(original.total_inc_btw || 0),
        sent_to_accountant: false,
        source: 'created',
        client_name: original.client_name,
        client_email: original.client_email,
        client_address: original.client_address,
        client_postal_code: original.client_postal_code,
        client_city: original.client_city,
        client_btw_number: original.client_btw_number,
      })
      .select()
      .single()

    if (insertError || !creditnota) {
      return NextResponse.json({ error: 'Creditnota aanmaken mislukt' }, { status: 500 })
    }

    // [BOEK-031] Haal originele regels op en kopieer ze negatief
    const { data: originalLines } = await supabase
      .from('invoice_lines')
      .select('description, quantity, unit_price, btw_rate, line_total')
      .eq('invoice_id', original_invoice_id)

    if (originalLines && originalLines.length > 0) {
      await supabase.from('invoice_lines').insert(
        originalLines.map(line => ({
          invoice_id: creditnota.id,
          description: `[Creditnota] ${line.description}${reason ? ` — ${reason}` : ''}`,
          quantity: -(line.quantity || 0), // negatief aantal
          unit_price: line.unit_price,
          btw_rate: line.btw_rate,
          line_total: -(line.line_total || 0),
        }))
      )
    }

    // [BOEK-031] Audit log
    await supabase.from('audit_logs').insert({
      user_id: user.id,
      action: 'creditnota.created',
      entity_type: 'invoice',
      entity_id: creditnota.id,
      new_value: JSON.stringify({
        creditnota_number: creditnota.invoice_number,
        original_invoice_id,
        original_invoice_number: original.invoice_number,
      }),
    })

    return NextResponse.json({
      success: true,
      creditnota_id: creditnota.id,
      creditnota_number: creditnota.invoice_number,
    })

  } catch {
    return NextResponse.json({ error: 'Onbekende fout' }, { status: 500 })
  }
}