import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase-server'
import { sendAccountantInvite } from '@/lib/email'

// إرسال دعوة للمحاسب
export async function POST(request: NextRequest) {
  try {
    const supabase = await createServerSupabaseClient()

    // تحقق من المستخدم
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    // جلب إيميل المحاسب من الطلب
    const { accountantEmail } = await request.json()
    if (!accountantEmail) return NextResponse.json({ error: 'Email verplicht' }, { status: 400 })

    // جلب بيانات ZZP'er
    const { data: profile } = await supabase
      .from('profiles')
      .select('full_name, company_name')
      .eq('id', user.id)
      .single()

    const zzperName = profile?.company_name || profile?.full_name || 'Onbekend'

    // حفظ الدعوة في قاعدة البيانات
    const { data: invitation, error: invError } = await supabase
      .from('invitations')
      .insert({
        zzper_id: user.id,
        accountant_email: accountantEmail,
        status: 'pending'
      })
      .select()
      .single()

    if (invError) return NextResponse.json({ error: 'Uitnodiging opslaan mislukt' }, { status: 500 })

    // بناء رابط القبول
    const acceptUrl = `${process.env.NEXT_PUBLIC_APP_URL}/invite/accept?token=${invitation.token}`

    // إرسال الإيميل للمحاسب
    await sendAccountantInvite({
      toEmail: accountantEmail,
      zzperName,
      acceptUrl
    })

    return NextResponse.json({ success: true })

  } catch (error) {
    console.error('Invite error:', error)
    return NextResponse.json({ error: 'Server fout' }, { status: 500 })
  }
}