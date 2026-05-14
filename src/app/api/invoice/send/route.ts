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
    const { clientEmail, clientName, invoiceNumber, totalInc, dueDate } = body
// أضف هذا السطر:
const totalIncNum = typeof totalInc === 'number' ? totalInc : parseFloat(totalInc ?? '0')

    const { data: profile } = await supabase
      .from('profiles')
      .select('full_name, company_name')
      .eq('id', user.id)
      .single()

    const zzperName = profile?.company_name || profile?.full_name || 'Onbekend'
    const { data: accountantLink, error: linkError } = await supabase
      .from('accountant_clients')
      .select('accountant_id')
      .eq('zzper_id', user.id)
      .maybeSingle()

    // مؤقت للتشخيص
    console.log('user.id:', user.id)
    console.log('accountantLink:', accountantLink)
    console.log('linkError:', linkError)


    const accountantId = accountantLink?.accountant_id ?? null
    console.log('accountantId:', accountantId)
    await sendInvoiceToClient({
      toEmail: clientEmail,
      clientName,
      zzperName,
      invoiceNumber,
      totalInc,
      dueDate
    })

        // إشعار للمحاسب
// إشعار للمحاسب عند استلام فاتورة جديدة
if (accountantId) {
  const { error: notifError } = await supabase
    .from('notifications')
    .insert({
      user_id: accountantId,
      title: 'Nieuwe factuur ontvangen',
      body: `${zzperName} heeft factuur ${invoiceNumber} verzonden — €${totalIncNum.toFixed(2)}`,
     // body: `${zzperName} heeft factuur ${invoiceNumber} verzonden — €${totalInc.toFixed(2)}`,
      type: 'invoice',
      read: false,
      link: `/dashboard/clients/${user.id}`
    })

  console.log('notifError:', notifError)
  console.log('notification sent to accountant:', accountantId)
}

console.log('accountantLink:', accountantLink)
console.log('accountantId:', accountantId)
console.log('user.id:', user.id)
    return NextResponse.json({ success: true })

  } catch (error) {
    console.error('Send invoice error:', error)
    return NextResponse.json({ error: 'Verzenden mislukt' }, { status: 500 })
  }
}
