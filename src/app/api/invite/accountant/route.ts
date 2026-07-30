import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase-server'
import { createPipelineClient } from '@/lib/supabase-pipeline'
import { sendAccountantInvite } from '@/lib/email'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { appOrigin } from '@/lib/app-origin'

// إرسال دعوة للمحاسب
export async function POST(request: NextRequest) {
  try {
    const supabase = await createServerSupabaseClient()

    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    // [SEC-INVITE-ABUSE] Rate-limit BEFORE any write/send. This route inserts an invitations row
    // AND fires a real Resend email to an attacker-supplied address; without a limit one account
    // could email-bomb any victim and burn Resend quota / domain reputation (a public-launch risk).
    // Mirrors the sibling /api/invite/client route, which already guards this.
    const limit = await checkRateLimit({
      userId: user.id,
      endpoint: '/api/invite/accountant',
      ...RATE_LIMITS.ACCOUNTANT_INVITE,
    })
    if (!limit.allowed) return rateLimitResponse(limit)

    // Accept both camelCase (settings page) and snake_case (onboarding wizard)
    const body = await request.json()
    const accountantEmail: string = (body.accountantEmail ?? body.accountant_email ?? '').trim().toLowerCase()

    if (!accountantEmail) {
      return NextResponse.json({ error: 'E-mailadres verplicht' }, { status: 400 })
    }

    // [SEC-INVITE-ABUSE] Validate the address before storing + mailing — a garbage/spoofed value
    // must not become a stored row and a real outbound email.
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(accountantEmail)) {
      return NextResponse.json({ error: 'Ongeldig e-mailadres.' }, { status: 400 })
    }

    // تحقق أن الإيميل ليس نفس إيميل المستخدم
    if (accountantEmail === user.email?.toLowerCase()) {
      return NextResponse.json({
        error: 'Je kunt jezelf niet als boekhouder toevoegen'
      }, { status: 400 })
    }

    // [SEC-INVITE-ABUSE] Block a duplicate pending invite from this owner to this address — no DB
    // uniqueness backs it, so a double-click / retry would otherwise create duplicate rows + mails.
    const { data: existingInvites } = await supabase
      .from('invitations')
      .select('id')
      .eq('zzper_id', user.id)
      .eq('accountant_email', accountantEmail)
      .eq('status', 'pending')
      .limit(1)
    if (existingInvites && existingInvites.length > 0) {
      return NextResponse.json({ error: 'Er is al een uitnodiging verstuurd naar dit adres.' }, { status: 400 })
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
    // [ORIGIN] Eén keten; een lege of kapotte waarde valt door naar de verzoek-origin.
    const baseUrl = appOrigin(process.env, new URL(request.url).origin) ?? new URL(request.url).origin
    const acceptUrl = `${baseUrl}/invite/accept?token=${invitation.token}`

    // [TRUST-INVITE] The email IS the invite. On send failure, roll the pending row back — else the
    // duplicate guard above would permanently block a retry ("al verstuurd") while nothing arrived.
    // (Mirrors /api/invite/client.)
    try {
      await sendAccountantInvite({
        toEmail: accountantEmail,
        zzperName,
        acceptUrl
      })
    } catch (emailErr) {
      console.error('[invite/accountant] email failed — rolling back row', emailErr)
      // [TRUST-INVITE] `invitations` has RLS with SELECT+INSERT policies but NO DELETE policy,
      // so a delete on the authenticated session client silently affects 0 rows and the orphaned
      // 'pending' row would then trip the duplicate guard forever. Roll back via service_role.
      await createPipelineClient().from('invitations').delete().eq('id', invitation.id)
      return NextResponse.json(
        { error: 'Uitnodiging versturen mislukt — probeer het opnieuw.' },
        { status: 502 }
      )
    }

    return NextResponse.json({ success: true })

  } catch (error) {
    console.error('Invite error:', error)
    return NextResponse.json({ error: 'Server fout' }, { status: 500 })
  }
}