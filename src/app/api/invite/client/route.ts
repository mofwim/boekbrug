import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase-server'
import { createPipelineClient } from '@/lib/supabase-pipeline'
import { sendClientInvite } from '@/lib/email'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { appOrigin } from '@/lib/app-origin'

// المحاسب يدعو عميله
export async function POST(request: NextRequest) {
  try {
    const supabase = await createServerSupabaseClient()

    // تحقق من المستخدم
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    // [COHERENCE-INVITE] Only an accountant may create an accountant→client invitation.
    // Without this, a shop owner (role 'zzper') could POST here (RLS only requires
    // auth.uid()=zzper_id, which passes for any role) and turn themselves into an
    // 'accountant' inviting clients — a role-confusion / data-integrity path. The page
    // is now role-guarded too; this is the authoritative server-side check.
    const { data: callerProfile } = await supabase
      .from('profiles')
      .select('role, full_name, company_name')
      .eq('id', user.id)
      .single()
    if (callerProfile?.role !== 'accountant') {
      return NextResponse.json({ error: 'Alleen een boekhouder kan een klant uitnodigen.' }, { status: 403 })
    }

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
    //
    // [UITNODIGING] Twee grenzen die er niet stonden, en allebei blokkeerden ze het kanaal:
    //   · VAN WIE — zonder .eq('zzper_id') telde de pending van kantoor A ook voor kantoor B,
    //     dus wie van boekhouder wisselde kon door de vorige nooit meer worden uitgenodigd.
    //   · HOE OUD — een uitnodiging verloopt na veertien dagen (accept weigert hem dan), maar de
    //     rij bleef eeuwig 'pending' en blokkeerde dit adres voorgoed. Een klant die de mail één
    //     keer miste, was daarmee permanent onbereikbaar — en niemand kon zien waarom.
    // De grens is nu: alleen een NOG GELDIGE pending van DIT kantoor telt als duplicaat.
    const versGrens = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString()
    const { data: existingInvites } = await supabase
      .from('invitations')
      .select('id')
      .eq('zzper_id', user.id)
      .eq('accountant_email', clientEmail)
      .eq('invited_by', 'accountant')
      .eq('status', 'pending')
      .gte('created_at', versGrens)
      .limit(1)
    if (existingInvites && existingInvites.length > 0) {
      return NextResponse.json({ error: 'Er is al een uitnodiging verstuurd naar dit adres.' }, { status: 400 })
    }

    // Naam van de boekhouder — al opgehaald bij de rolcontrole hierboven.
    const accountantName = callerProfile?.company_name || callerProfile?.full_name || 'Boekhouder'

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

    // [TRUST-INVITE] Fall back to the request origin when NEXT_PUBLIC_APP_URL is
    // unset — otherwise the client is mailed "undefined/invite/accept?..." (a dead
    // link) while the route still reports success. Mirrors the accountant route.
    const baseUrl = appOrigin(process.env, new URL(request.url).origin) ?? new URL(request.url).origin
    const acceptUrl = `${baseUrl}/invite/accept?token=${invitation.token}`

    // [TRUST-INVITE] The email is the WHOLE point of an invite. If the send fails we
    // must NOT leave a 'pending' row behind — otherwise the retry hits the duplicate
    // guard ("al verstuurd") and the client is permanently unreachable while nothing
    // ever arrived. Roll the row back and return an honest, retryable error.
    try {
      await sendClientInvite({
        toEmail: clientEmail,
        clientName: clientEmail,
        accountantName,
        acceptUrl,
      })
    } catch (sendErr) {
      console.error('[TRUST-INVITE] Client invite email failed — rolling back row', sendErr)
      // [TRUST-INVITE] `invitations` has RLS with SELECT+INSERT policies but NO DELETE policy, so a
      // delete on the authenticated session client silently affects 0 rows and the orphaned 'pending'
      // row would then trip the duplicate guard forever. Roll back via service_role.
      await createPipelineClient().from('invitations').delete().eq('id', invitation.id)
      return NextResponse.json(
        { error: 'Uitnodiging versturen mislukt — probeer het opnieuw.' },
        { status: 502 }
      )
    }

    // [UITNODIGING] Het scherm toont de openstaande uitnodigingen; geef de verse rij terug zodat
    // hij er direct bij staat in plaats van pas na een herlaad.
    return NextResponse.json({
      success: true,
      invitation: { id: invitation.id, email: clientEmail, sentAt: invitation.created_at ?? null },
    })

  } catch (error) {
    console.error('Invite client error:', error)
    return NextResponse.json({ error: 'Server fout' }, { status: 500 })
  }
}