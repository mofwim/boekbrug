// src/app/api/company/members/accept/route.ts
// [ACTING-FOR] De genodigde accepteert. Dit is de ENIGE plek waar een koppeling ontstaat.
//
// company_members heeft geen INSERT-policy voor ingelogde gebruikers — met opzet. De les staat
// in accountant_clients_insert_consent.sql: daar was de INSERT-policy "je moet jezelf noemen als
// boekhouder", en dat was geen controle maar een achterdeur (iedereen kon zich aan iedereen
// koppelen met één PostgREST-aanroep, want de anon-sleutel staat in de frontend).
//
// Hier geldt hetzelfde, en scherper: een koppeling geeft het recht om facturen uit te geven
// ONDER HET BTW-NUMMER VAN EEN ANDER. De enige weg naar binnen is deze route, met een token dat
// alleen in de mailbox van de genodigde lag, én met de eis dat het e-mailadres van de ingelogde
// gebruiker overeenkomt met het adres waarnaar de uitnodiging ging.

import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase-server'
import { createPipelineClient } from '@/lib/supabase-pipeline'
import { logAuditAction, getClientIP } from '@/lib/audit'

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  try {
    const supabase = await createServerSupabaseClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body = await request.json().catch(() => null)
    const token = typeof body?.token === 'string' ? body.token.trim() : ''
    if (!token) return NextResponse.json({ error: 'Ongeldige uitnodiging' }, { status: 400 })

    const pipeline = createPipelineClient()

    const { data: invite } = await pipeline
      .from('company_member_invites')
      .select('id, owner_id, email, role, status, expires_at')
      .eq('token', token)
      .maybeSingle()

    if (!invite || invite.status !== 'pending') {
      return NextResponse.json({ error: 'Deze uitnodiging is niet (meer) geldig' }, { status: 400 })
    }
    if (Date.parse(invite.expires_at) <= Date.now()) {
      return NextResponse.json(
        { error: 'Deze uitnodiging is verlopen. Vraag je werkgever om een nieuwe.' },
        { status: 410 },
      )
    }

    // HET SLOT. Het token bewijst dat iemand de mail heeft; dit bewijst dat het de JUISTE iemand
    // is. Zonder deze regel zou een doorgestuurde of onderschepte link volstaan — en de mail
    // wordt nu juist naar het adres gestuurd dat de eigenaar zelf intikte.
    if (!user.email || user.email.toLowerCase() !== String(invite.email).toLowerCase()) {
      return NextResponse.json(
        { error: `Deze uitnodiging is voor ${invite.email}. Log in met dat e-mailadres.` },
        { status: 403 },
      )
    }

    // Niemand is lid van zijn eigen bedrijf — de CHECK op de tabel weigert het ook, maar een
    // begrijpelijke zin is beter dan een databasefout.
    if (invite.owner_id === user.id) {
      return NextResponse.json({ error: 'Je kunt niet voor jezelf werken' }, { status: 400 })
    }

    // GEEN KETEN. Is de eigenaar zelf al medewerker bij iemand anders, dan zou er een rij
    // ontstaan waarin niet meer te zeggen is onder wiens BTW-nummer er uiteindelijk wordt
    // gefactureerd. acting-for.ts kiest in zo'n geval de eerste rij die hij vindt — en "de
    // eerste die hij vindt" is geen antwoord op een vraag over andermans boekhouding.
    const { data: eigenaarIsZelfLid } = await pipeline
      .from('company_members')
      .select('id')
      .eq('member_id', invite.owner_id)
      .is('revoked_at', null)
      .limit(1)
      .maybeSingle()
    if (eigenaarIsZelfLid) {
      return NextResponse.json(
        { error: 'Deze uitnodiging kan niet worden aangenomen — vraag je werkgever om contact op te nemen.' },
        { status: 409 },
      )
    }

    // En andersom: wie al ergens medewerker is, kan er niet nóg een bedrijf bij nemen. Eén mens,
    // één boekhouding waarvoor hij handelt — anders is "namens wie?" opnieuw een gok.
    const { data: alLid } = await pipeline
      .from('company_members')
      .select('id, owner_id')
      .eq('member_id', user.id)
      .is('revoked_at', null)
      .limit(1)
      .maybeSingle()
    if (alLid && alLid.owner_id !== invite.owner_id) {
      return NextResponse.json(
        { error: 'Je werkt al voor een ander bedrijf op BoekBrug. Laat die koppeling eerst intrekken.' },
        { status: 409 },
      )
    }

    // [SEC-LINK] Insert via service_role — company_members heeft geen authenticated INSERT-policy.
    // De unieke index op (owner_id, member_id) maakt herhaald klikken onschadelijk.
    const { error: linkErr } = await pipeline
      .from('company_members')
      .upsert(
        { owner_id: invite.owner_id, member_id: user.id, role: invite.role, revoked_at: null },
        { onConflict: 'owner_id,member_id' },
      )
    if (linkErr) {
      console.error('[ACTING-FOR] koppelen mislukt', { linkErr })
      return NextResponse.json({ error: 'Koppelen mislukt — probeer opnieuw' }, { status: 500 })
    }

    await pipeline.from('company_member_invites').update({ status: 'accepted' }).eq('id', invite.id)

    // Het spoor bij de EIGENAAR: het is zijn BTW-nummer waar dit over gaat, dus hij hoort dit in
    // zijn eigen logboek terug te vinden — niet alleen de medewerker in het zijne.
    await logAuditAction({
      userId: invite.owner_id,
      action: 'member.joined',
      entityType: 'company_member',
      entityId: user.id,
      newValue: { email: invite.email, role: invite.role },
      ipAddress: getClientIP(request),
    }).catch(() => {})

    return NextResponse.json({ ok: true })
  } catch (e) {
    console.error('[ACTING-FOR] accept', e)
    return NextResponse.json({ error: 'Server fout' }, { status: 500 })
  }
}
