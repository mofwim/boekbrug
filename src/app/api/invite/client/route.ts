import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase-server'
import { sendClientInvite } from '@/lib/email'

// المحاسب يدعو عميله
export async function POST(request: NextRequest) {
  try {
    const supabase = await createServerSupabaseClient()

    // تحقق من المستخدم
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { clientEmail } = await request.json()
    if (!clientEmail) return NextResponse.json({ error: 'Email verplicht' }, { status: 400 })

    // منع المحاسب من دعوة نفسه
    if (clientEmail.toLowerCase() === user.email?.toLowerCase()) {
      return NextResponse.json({ error: 'Je kunt jezelf niet uitnodigen' }, { status: 400 })
    }

    // جلب بيانات المحاسب
    const { data: profile } = await supabase
      .from('profiles')
      .select('full_name, company_name')
      .eq('id', user.id)
      .single()

    const accountantName = profile?.company_name || profile?.full_name || 'Boekhouder'

    // حفظ الدعوة — نحفظ accountant_id = المحاسب الحالي
    const { data: invitation, error: invError } = await supabase
      .from('invitations')
      .insert({
        zzper_id: user.id,        // مؤقتاً — سيتم تحديثه عند القبول
        accountant_email: clientEmail,
        status: 'pending',
        invited_by: 'accountant'  // نميز نوع الدعوة
      })
      .select()
      .single()

    if (invError) return NextResponse.json({ error: 'Uitnodiging opslaan mislukt' }, { status: 500 })

    const acceptUrl = `${process.env.NEXT_PUBLIC_APP_URL}/invite/accept?token=${invitation.token}`

    await sendClientInvite({
      toEmail: clientEmail,
      clientName: clientEmail,
      accountantName,
      acceptUrl
    })

    return NextResponse.json({ success: true })

  } catch (error) {
    console.error('Invite client error:', error)
    return NextResponse.json({ error: 'Server fout' }, { status: 500 })
  }
}