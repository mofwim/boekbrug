import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase-server'
import { createPipelineClient } from '@/lib/supabase-pipeline'

// قبول دعوة — يعمل مع نوعين: ZZP'er يدعو محاسب، أو محاسب يدعو ZZP'er
export async function POST(request: NextRequest) {
  try {
    const supabase = await createServerSupabaseClient()

    // تحقق من المستخدم
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { token } = await request.json()

    // جلب الدعوة — read via service_role. The invitations SELECT RLS policy is now
    // scoped to the two parties (inviter OR invitee e-mail), so a session-client read
    // by a user logged into the WRONG account would return 0 rows and collapse the
    // precise "wrong e-mail" message below into a generic "Ongeldig". Reading by token
    // with service_role lets us always find the row and then enforce the invitee check
    // ourselves (below), preserving both the guard AND the helpful message.
    const invitePipeline = createPipelineClient()
    const { data: invitation } = await invitePipeline
      .from('invitations')
      .select('*')
      .eq('token', token)
      .eq('status', 'pending')
      .single()

if (!invitation) return NextResponse.json({ error: 'Ongeldig' }, { status: 400 })

    // Check expiry — invitations valid for 14 days from created_at
    const INVITE_VALIDITY_DAYS = 14
    const createdAt = new Date(invitation.created_at!)
    const expiresAt = new Date(createdAt.getTime() + INVITE_VALIDITY_DAYS * 24 * 60 * 60 * 1000)
    if (Date.now() > expiresAt.getTime()) {
      return NextResponse.json(
        { error: 'Uitnodiging verlopen — vraag een nieuwe aan', expired: true },
        { status: 410 }
      )
    }

    // [SEC-INVITE] Verify the accepting user IS the invitee. Possessing the token is
    // NOT enough — this route reads the invitation via service_role (to keep the precise
    // wrong-account message), so it must enforce the invitee match itself: without it any
    // logged-in user holding a token could accept and — in the zzper→accountant direction —
    // become another ZZP'er's accountant, gaining RLS read-access to their invoices
    // (horizontal privilege escalation). The DB SELECT policy is scoped as defence-in-depth.
    // `accountant_email` holds the invitee's e-mail in BOTH directions (the accountant for
    // zzper→accountant, the client for accountant→client), so one case-insensitive match
    // is correct for both.
    const inviteeEmail = (invitation.accountant_email ?? '').trim().toLowerCase()
    const userEmail = (user.email ?? '').trim().toLowerCase()
    if (!userEmail || userEmail !== inviteeEmail) {
      return NextResponse.json(
        { error: 'Deze uitnodiging is voor een ander e-mailadres. Log in met het uitgenodigde adres om te accepteren.' },
        { status: 403 }
      )
    }

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
    // [SEC-INVITE] Insert via service_role. accountant_clients has NO authenticated INSERT policy
    // (deliberately dropped — see database.sql [SEC-LINK]); linking is service-role-only so no user
    // can self-link outside an accepted invite. By this point the user is authenticated, verified as
    // the invitee (e-mail match above), and the invitation is valid + unexpired, so this
    // service_role insert of the (accountant, client) pair is the authorized link path.
    const linkPipeline = createPipelineClient()
    const { error: linkError } = await linkPipeline
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

    // إشعار ZZP'er بأن المحاسب قبل الدعوة (via service role — bypasses RLS)
    try {
      const pipeline = createPipelineClient()

      const { data: accountantProfile } = await pipeline
        .from('profiles')
        .select('full_name, company_name')
        .eq('id', accountantId)
        .single()

      const accountantName = accountantProfile?.company_name
        || accountantProfile?.full_name
        || invitation.accountant_email

      await pipeline
        .from('notifications')
        .insert({
          user_id: zzperId,
          title: 'Boekhouder heeft uitnodiging geaccepteerd',
          body: `${accountantName} heeft jouw uitnodiging geaccepteerd en is nu jouw boekhouder.`,
          type: 'invite',
          read: false,
          link: '/dashboard/settings',
        })
    } catch (notifErr) {
      console.error('[invite/accept] notification failed:', notifErr)
      // non-blocking — don't fail the accept
    }

    return NextResponse.json({ success: true })

  } catch (error) {
    console.error('Accept invite error:', error)
    return NextResponse.json({ error: 'Server fout' }, { status: 500 })
  }
}