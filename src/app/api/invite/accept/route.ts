import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase-server'
import { createPipelineClient } from '@/lib/supabase-pipeline'
import { createNotification } from '@/lib/notifications'

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

    // [SEC-INVITE] De uitnodiging afvinken MOET op de pipeline-client.
    //
    // Dit stond op `supabase` (de RLS-sessieclient), en public.invitations heeft precies
    // twee policies: SELECT en INSERT. Er is GEEN update-policy, dus dit was een stille
    // 0-rij-write — geen fout, geen effect. Gevolgen, allebei bevestigd:
    //   · de uitnodiging bleef 'pending' en het accepteertoken bleef zijn volle 14 dagen
    //     herbruikbaar, óók na een unlink — waardoor AV §7.1/§7.4 ("je kunt de koppeling
    //     op elk moment verbreken", "accountant verliest direct toegang") niet afdwingbaar
    //     was;
    //   · de dubbelcheck in accountant.repository.inviteClient blokkeert op status
    //     'pending', dus hetzelfde adres opnieuw uitnodigen werd 14 dagen geweigerd.
    //
    // Voeg GEEN authenticated UPDATE-policy toe aan invitations: dan mag de uitgenodigde
    // zijn eigen uitnodiging herschrijven. De service-role weg is de juiste.
    const { error: acceptError } = await linkPipeline
      .from('invitations')
      .update({ status: 'accepted' })
      .eq('id', invitation.id)

    if (acceptError) {
      // Niet fataal: de koppeling staat er al en dát is wat de gebruiker wilde. Wel luid,
      // want een token dat blijft leven is een beveiligingsfeit.
      console.error('[SEC-INVITE] uitnodiging niet als geaccepteerd kunnen markeren — token blijft leven:', acceptError.message)
    }

    // [UITNODIGING] Het bericht gaat naar wie WACHTTE — niet naar wie zojuist zelf klikte.
    //
    // Dit blok kende maar één richting en stuurde daardoor bij een kantoor-uitnodiging het
    // bericht naar de KLANT ("X heeft jouw uitnodiging geaccepteerd" — over een uitnodiging die
    // hij nooit verstuurde), terwijl de boekhouder — de enige die zat te wachten, en het
    // distributiekanaal van dit product — helemaal niets hoorde. Een kantoor dat vijftig klanten
    // uitnodigt hoort elke acceptatie binnen zien komen; dat is het moment waarop het portaal
    // zijn belofte waarmaakt.
    try {
      const pipeline = createPipelineClient()

      if (invitation.invited_by === 'accountant') {
        // De klant accepteerde — vertel het het kantoor, met de klantnaam erbij.
        const { data: klantProfiel } = await pipeline
          .from('profiles')
          .select('full_name, company_name')
          .eq('id', zzperId)
          .single()
        const klantNaam = klantProfiel?.company_name || klantProfiel?.full_name || user.email || 'Je klant'
        const melding = await createNotification({
          userId: accountantId,
          // [TAAL-DB] Op het scherm van de boekhouder, als opgeslagen berichttekst.
          title: 'Klant heeft je uitnodiging geaccepteerd',
          body: `${klantNaam} is nu aan je kantoor gekoppeld.`,
          type: 'invite',
          link: '/dashboard/clients/beheer',
        })
        if (!melding.ok) console.error('[invite/accept] notification failed:', melding.error)
      } else {
        // De boekhouder accepteerde — vertel het de ondernemer, zoals altijd.
        const { data: accountantProfile } = await pipeline
          .from('profiles')
          .select('full_name, company_name')
          .eq('id', accountantId)
          .single()
        const accountantName = accountantProfile?.company_name
          || accountantProfile?.full_name
          || invitation.accountant_email
        const melding = await createNotification({
          userId: zzperId,
          title: 'Boekhouder heeft uitnodiging geaccepteerd',
          body: `${accountantName} heeft jouw uitnodiging geaccepteerd en is nu jouw boekhouder.`,
          type: 'invite',
          link: '/dashboard/settings',
        })
        if (!melding.ok) console.error('[invite/accept] notification failed:', melding.error)
      }
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