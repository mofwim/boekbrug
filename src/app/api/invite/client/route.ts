import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase-server'
import { sendClientInvite } from '@/lib/email'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'

// المحاسب يدعو عميله
export async function POST(request: NextRequest) {
  try {
    const supabase = await createServerSupabaseClient()

    // تحقق من المستخدم
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const limit = await checkRateLimit({
      userId: user.id,
      endpoint: '/api/invite/client',
      ...RATE_LIMITS.ACCOUNTANT_INVITE,
    })
    if (!limit.allowed) return rateLimitResponse(limit)

    const body = await request.json()
    const clientEmail = (body.clientEmail ?? '').trim().toLowerCase()
    if (!clientEmail) return NextResponse.json({ error: 'Email verplicht' }, { status: 400 })

    // [CONTROL] validate format — dropped when KlantenBeheer was rewired here from
    // /api/accountant/invite; without it a garbage address gets stored + mailed.
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clientEmail)) {
      return NextResponse.json({ error: 'Ongeldig e-mailadres.' }, { status: 400 })
    }

    // منع المحاسب من دعوة نفسه
    if (clientEmail === user.email?.toLowerCase()) {
      return NextResponse.json({ error: 'Je kunt jezelf niet uitnodigen' }, { status: 400 })
    }

    // [CONTROL] block a duplicate pending invite — no DB uniqueness on
    // (accountant_email, invited_by), so a double click would otherwise create
    // duplicate rows AND send duplicate emails.
    const { data: existingInvites } = await supabase
      .from('invitations')
      .select('id')
      .eq('accountant_email', clientEmail)
      .eq('invited_by', 'accountant')
      .eq('status', 'pending')
      .limit(1)
    if (existingInvites && existingInvites.length > 0) {
      return NextResponse.json({ error: 'Er is al een uitnodiging verstuurd naar dit adres.' }, { status: 400 })
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