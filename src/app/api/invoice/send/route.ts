import { NextRequest, NextResponse } from 'next/server'
import { sendInvoiceToClient } from '@/lib/email'
import { createServerSupabaseClient } from '@/lib/supabase-server'

export async function POST(request: NextRequest) {
  try {
    const supabase = await createServerSupabaseClient()

    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const { invoiceId } = body

    if (!invoiceId) {
      return NextResponse.json({ error: 'invoiceId verplicht' }, { status: 400 })
    }

    // Haal factuurdata op uit DB — vertrouw nooit op de client voor financiële data
    const { data: invoice, error: invoiceError } = await supabase
      .from('invoices')
      .select('invoice_number, client_name, client_email, total_inc_btw, due_date, sender_id')
      .eq('id', invoiceId)
      .eq('sender_id', user.id) // security: alleen eigen facturen
      .single()

    if (invoiceError || !invoice) {
      return NextResponse.json({ error: 'Factuur niet gevonden' }, { status: 404 })
    }

    // [BOEK-FOUNDATION-TYPES] Required fields check before sending email
    if (!invoice.client_email || !invoice.client_name || !invoice.invoice_number || invoice.total_inc_btw === null) {
  return NextResponse.json(
    { error: 'Factuur incompleet — vereiste velden ontbreken' },
    { status: 400 }
  )
}

    const { data: profile } = await supabase
      .from('profiles')
      .select('full_name, company_name')
      .eq('id', user.id)
      .single()

    const zzperName = profile?.company_name || profile?.full_name || 'Onbekend'

    const { data: accountantLink } = await supabase
      .from('accountant_clients')
      .select('accountant_id')
      .eq('zzper_id', user.id)
      .maybeSingle()

    const accountantId = accountantLink?.accountant_id ?? null

    // Stuur factuur e-mail
    await sendInvoiceToClient({
      toEmail: invoice.client_email,
      clientName: invoice.client_name,
      zzperName,
      invoiceNumber: invoice.invoice_number,
      totalInc: invoice.total_inc_btw,
      dueDate: invoice.due_date ?? '',
    })

    // Update status naar 'sent'
    await supabase
      .from('invoices')
      .update({ status: 'sent' })
      .eq('id', invoiceId)

    // Notificatie voor boekhouder
    if (accountantId) {
      await supabase.from('notifications').insert({
        user_id: accountantId,
        title: 'Nieuwe factuur verzonden',
        body: `${zzperName} heeft factuur ${invoice.invoice_number} verzonden — €${invoice.total_inc_btw.toFixed(2)}`,
        type: 'invoice',
        read: false,
        link: `/dashboard/clients/${user.id}`,
      })
    }

    return NextResponse.json({ success: true })

  } catch (error) {
    console.error('Send invoice error:', error)
    return NextResponse.json({ error: 'Verzenden mislukt' }, { status: 500 })
  }
}