import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase-server'
import { sendAccountantInvite } from '@/lib/email'

// إرسال دعوة للمحاسب
export async function POST(request: NextRequest) {
  try {
    const supabase = await createServerSupabaseClient()

    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    // Accept both camelCase (settings page) and snake_case (onboarding wizard)
    const body = await request.json()
    const accountantEmail: string = body.accountantEmail ?? body.accountant_email ?? ''

    if (!accountantEmail) {
      return NextResponse.json({ error: 'E-mailadres verplicht' }, { status: 400 })
    }

    // تحقق أن الإيميل ليس نفس إيميل المستخدم
    if (accountantEmail.toLowerCase() === user.email?.toLowerCase()) {
      return NextResponse.json({
        error: 'Je kunt jezelf niet als boekhouder toevoegen'
      }, { status: 400 })
    }

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

    if (invError) {
      console.error('[invite/accountant] insert failed:', invError)
      return NextResponse.json({ error: 'Uitnodiging opslaan mislukt' }, { status: 500 })
    }

    // بناء رابط القبول — fallback to request origin if env var missing
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || new URL(request.url).origin
    const acceptUrl = `${baseUrl}/invite/accept?token=${invitation.token}`

    // إرسال الإيميل للمحاسب — best-effort, invitation already saved
    try {
      await sendAccountantInvite({
        toEmail: accountantEmail,
        zzperName,
        acceptUrl
      })
    } catch (emailErr) {
      console.error('[invite/accountant] email failed:', emailErr)
      // Invitation saved — email failure shouldn't 500 the whole request
      return NextResponse.json({ success: true, warning: 'email_failed' })
    }

    return NextResponse.json({ success: true })

  } catch (error) {
    console.error('Invite error:', error)
    return NextResponse.json({ error: 'Server fout' }, { status: 500 })
  }
}