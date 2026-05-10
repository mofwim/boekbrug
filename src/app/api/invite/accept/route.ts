import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase-server'

export async function POST(request: NextRequest) {
  try {
    const supabase = await createServerSupabaseClient()

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

    // ربط ZZP'er بالمحاسب
    const { error: linkError } = await supabase
      .from('accountant_clients')
      .insert({
        accountant_id: user.id,
        zzper_id: invitation.zzper_id
      })

    if (linkError) return NextResponse.json({ error: 'Koppelen mislukt' }, { status: 500 })

    // تحديث حالة الدعوة
    await supabase
      .from('invitations')
      .update({ status: 'accepted' })
      .eq('id', invitation.id)

    // تحديث دور المستخدم إذا لم يكن محاسباً
    await supabase
      .from('profiles')
      .update({ role: 'accountant' })
      .eq('id', user.id)
      .eq('role', 'client')

    return NextResponse.json({ success: true })

  } catch (error) {
    console.error('Accept invite error:', error)
    return NextResponse.json({ error: 'Server fout' }, { status: 500 })
  }
}