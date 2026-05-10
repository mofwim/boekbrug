import { NextRequest, NextResponse } from 'next/server'
import { sendInvoiceToClient } from '@/lib/email'
import { createServerSupabaseClient } from '@/lib/supabase-server'

export async function POST(request: NextRequest) {
  try {
    const supabase = await createServerSupabaseClient()

    // تحقق من المستخدم
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const {
      clientEmail,
      clientName,
      invoiceNumber,
      totalInc,
      dueDate
    } = body

    // جلب بيانات المرسل
    const { data: profile } = await supabase
      .from('profiles')
      .select('full_name, company_name')
      .eq('id', user.id)
      .single()

    const zzperName = profile?.company_name || profile?.full_name || 'Onbekend'

    // إرسال للعميل
    await sendInvoiceToClient({
      toEmail: clientEmail,
      clientName,
      zzperName,
      invoiceNumber,
      totalInc,
      dueDate
    })

    return NextResponse.json({ success: true })

  } catch (error) {
    console.error('Send invoice error:', error)
    return NextResponse.json({ error: 'Verzenden mislukt' }, { status: 500 })
  }
}