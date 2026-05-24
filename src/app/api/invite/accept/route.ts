import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase-server'

// قبول دعوة — يعمل مع نوعين: ZZP'er يدعو محاسب، أو محاسب يدعو ZZP'er
export async function POST(request: NextRequest) {
  try {
    const supabase = await createServerSupabaseClient()

    // تحقق من المستخدم
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { token } = await request.json()

    // جلب الدعوة
    const { data: invitation } = await supabase
      .from('invitations')
      .select('*')
      .eq('token', token)
      .eq('status', 'pending')
      .single()

if (!invitation) return NextResponse.json({ error: 'Ongeldig' }, { status: 400 })

    // [BOEK-FOUNDATION-TYPES] zzper_id is nullable in DB schema
    if (!invitation.zzper_id) {
      return NextResponse.json(
        { error: 'Ongeldige uitnodiging — gebruiker ID ontbreekt' },
        { status: 400 }
      )
    }

    let accountantId: string
    let zzperId: string

    if (invitation.invited_by === 'accountant') {
      // المحاسب دعا العميل — المستخدم الحالي هو ZZP'er
      accountantId = invitation.zzper_id  // zzper_id يحتوي accountant_id هنا
      zzperId = user.id

      // تحديث دور المستخدم إلى ZZP'er إذا لم يكن محدداً
      const { data: profile } = await supabase
        .from('profiles')
        .select('role')
        .eq('id', user.id)
        .single()

      if (!profile?.role || profile.role === 'client') {
        await supabase
          .from('profiles')
          .update({ role: 'zzper' })
          .eq('id', user.id)
      }
    } else {
      // ZZP'er دعا المحاسب — المستخدم الحالي هو المحاسب
      accountantId = user.id
      zzperId = invitation.zzper_id

      // تحديث دور المستخدم إلى محاسب
      await supabase
        .from('profiles')
        .update({ role: 'accountant' })
        .eq('id', user.id)
        .eq('role', 'client')
    }

    // ربط ZZP'er بالمحاسب
    const { error: linkError } = await supabase
      .from('accountant_clients')
      .insert({ accountant_id: accountantId, zzper_id: zzperId })

    if (linkError && !linkError.message.includes('unique')) {
      return NextResponse.json({ error: 'Koppelen mislukt' }, { status: 500 })
    }

    // تحديث حالة الدعوة إلى مقبولة
    await supabase
      .from('invitations')
      .update({ status: 'accepted' })
      .eq('id', invitation.id)

    return NextResponse.json({ success: true })

  } catch (error) {
    console.error('Accept invite error:', error)
    return NextResponse.json({ error: 'Server fout' }, { status: 500 })
  }
}