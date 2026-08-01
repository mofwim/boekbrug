// src/app/api/company/members/route.ts
// [NAMENS] De eigenaar nodigt een verkoopmedewerker uit, en trekt hem weer in.
//
// GET    → wie hoort er bij mijn bedrijf, en welke uitnodigingen staan open
// POST   → nodig een e-mailadres uit
// PATCH  → trek een koppeling of een openstaande uitnodiging in
//
// DE REGEL DIE HIER GELDT
// Alleen een EIGENAAR beheert leden. Een medewerker kan geen medewerkers uitnodigen — anders
// ontstaat er een keten waarin niemand meer kan zeggen wie er precies onder zijn BTW-nummer
// factureert. acting-for.ts weigert een geketende koppeling ook al bij het oplossen; dit is de
// tweede, expliciete grendel op de plek waar de keten zou ontstaan.

import { NextRequest, NextResponse } from 'next/server'
import { createPipelineClient } from '@/lib/supabase-pipeline'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { sendMemberInvite } from '@/lib/email'
import { appOrigin } from '@/lib/app-origin'
import { getActingFor, loadCompanyMembers } from '@/lib/acting-for-server'
import { isNamens } from '@/lib/acting-for'
import { logAuditAction, getClientIP } from '@/lib/audit'

export const dynamic = 'force-dynamic'

/** Alleen een eigenaar beheert zijn team. Geeft de eigenaar-id terug, of een antwoord. */
async function alleenEigenaar() {
  const acting = await getActingFor()
  if (!acting) return { fout: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  if (isNamens(acting)) {
    // Een medewerker die medewerkers uitnodigt = een keten. Zie de kop.
    return { fout: NextResponse.json({ error: 'Alleen de eigenaar beheert het team' }, { status: 403 }) }
  }
  return { ownerId: acting.ownerId }
}

export async function GET() {
  const wacht = await alleenEigenaar()
  if (wacht.fout) return wacht.fout
  const ownerId = wacht.ownerId!

  const { beschikbaar, leden } = await loadCompanyMembers(ownerId)

  // De namen erbij — een lijst met uuid's is geen lijst.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pipeline = createPipelineClient() as any
  const ids = leden.map((l) => l.member_id)
  const namen = new Map<string, { naam: string; email: string | null }>()
  if (ids.length) {
    const { data } = await pipeline.from('profiles').select('id, full_name, company_name, email').in('id', ids)
    for (const p of data ?? []) {
      namen.set(p.id, { naam: p.company_name || p.full_name || 'Naamloos', email: p.email ?? null })
    }
  }

  let open: Array<{ id: string; email: string; created_at: string; expires_at: string }> = []
  try {
    const { data } = await pipeline
      .from('company_member_invites')
      .select('id, email, created_at, expires_at')
      .eq('owner_id', ownerId)
      .eq('status', 'pending')
      .order('created_at', { ascending: false })
    open = data ?? []
  } catch { /* de tabel bestaat pas na de migratie */ }

  return NextResponse.json({
    ok: true,
    // false ⇒ de migratie staat nog open. Het scherm zegt dat dan met zoveel woorden in plaats
    // van een leeg team te tonen en een uitnodigingsknop aan te bieden die niet kán werken.
    beschikbaar,
    leden: leden.map((l) => ({
      id: l.id,
      // [NAMENS] Het PROFIEL-id, niet het rij-id: de factuurpagina heeft dit nodig om
      // created_by aan een naam te koppelen.
      member_id: l.member_id,
      naam: namen.get(l.member_id)?.naam ?? 'Onbekend',
      email: namen.get(l.member_id)?.email ?? null,
      sinds: l.created_at,
      ingetrokken: l.revoked_at,
    })),
    uitnodigingen: open,
  })
}

export async function POST(request: NextRequest) {
  const wacht = await alleenEigenaar()
  if (wacht.fout) return wacht.fout
  const ownerId = wacht.ownerId!

  const limit = await checkRateLimit({
    userId: ownerId,
    endpoint: '/api/company/members',
    ...RATE_LIMITS.ACCOUNTANT_INVITE,
  })
  if (!limit.allowed) return rateLimitResponse(limit)

  const { beschikbaar } = await loadCompanyMembers(ownerId)
  if (!beschikbaar) {
    // Liever één eerlijke zin dan een 500 met "Uitnodigen mislukt": de oorzaak ligt niet bij
    // wat de eigenaar deed, en hij kan er zelf iets aan doen.
    return NextResponse.json(
      { error: 'De teamfunctie staat nog niet aan op deze installatie — de databasemigratie moet nog worden toegepast.' },
      { status: 503 },
    )
  }

  const body = await request.json().catch(() => null)
  const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : ''
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return NextResponse.json({ error: 'Vul een geldig e-mailadres in' }, { status: 400 })
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pipeline = createPipelineClient() as any

  const { data: eigenProfiel } = await pipeline
    .from('profiles')
    .select('company_name, full_name, email')
    .eq('id', ownerId)
    .single()

  // Jezelf uitnodigen kan niet: de CHECK op de tabel weigert het straks toch, en hier is de
  // melding begrijpelijk in plaats van een databasefout.
  if (eigenProfiel?.email && String(eigenProfiel.email).toLowerCase() === email) {
    return NextResponse.json({ error: 'Dat ben jij zelf' }, { status: 400 })
  }

  const origin = appOrigin(process.env, request.headers.get('origin') || request.nextUrl.origin)
  if (!origin) {
    // Zonder een betrouwbare origin zou de mail een link naar niets bevatten. Dan liever niets
    // versturen dan een uitnodiging die doodloopt.
    return NextResponse.json({ error: 'Kon de link niet opbouwen — probeer het later opnieuw' }, { status: 503 })
  }

  const { data: invite, error } = await pipeline
    .from('company_member_invites')
    .insert({ owner_id: ownerId, email, role: 'verkoop' })
    .select('id, token')
    .single()

  if (error || !invite) {
    console.error('[NAMENS] uitnodiging aanmaken mislukt', { error })
    return NextResponse.json({ error: 'Uitnodigen mislukt — probeer opnieuw' }, { status: 500 })
  }

  try {
    await sendMemberInvite({
      toEmail: email,
      companyName: eigenProfiel?.company_name || eigenProfiel?.full_name || 'Je werkgever',
      acceptUrl: `${origin}/team/accepteren?token=${invite.token}`,
    })
  } catch (e) {
    // [TRUST-DELIVERY] De mail is de enige weg naar binnen. Vertrekt hij niet, dan moet de
    // openstaande rij weg — anders staat er een uitnodiging in het scherm die niemand ooit heeft
    // gekregen, en wacht de eigenaar op iets wat nooit komt.
    await pipeline.from('company_member_invites').delete().eq('id', invite.id)
    console.error('[NAMENS] uitnodiging versturen mislukt', { error: String(e) })
    return NextResponse.json({ error: 'De uitnodiging kon niet worden verstuurd — probeer opnieuw' }, { status: 502 })
  }

  await logAuditAction({
    userId: ownerId,
    action: 'member.invited',
    entityType: 'company_member_invite',
    entityId: invite.id,
    newValue: { email, role: 'verkoop' },
    ipAddress: getClientIP(request),
  }).catch(() => {})

  return NextResponse.json({ ok: true })
}

export async function PATCH(request: NextRequest) {
  const wacht = await alleenEigenaar()
  if (wacht.fout) return wacht.fout
  const ownerId = wacht.ownerId!

  const body = await request.json().catch(() => null)
  const memberRowId = typeof body?.memberRowId === 'string' ? body.memberRowId : null
  const inviteId = typeof body?.inviteId === 'string' ? body.inviteId : null
  if (!memberRowId && !inviteId) {
    return NextResponse.json({ error: 'Niets om in te trekken' }, { status: 400 })
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pipeline = createPipelineClient() as any

  if (memberRowId) {
    // Intrekken is een tijdstip, geen DELETE: de facturen die dit lid maakte moeten toewijsbaar
    // blijven aan een mens. Weggooien van de koppeling zou dat spoor breken.
    const { error } = await pipeline
      .from('company_members')
      .update({ revoked_at: new Date().toISOString() })
      .eq('id', memberRowId)
      .eq('owner_id', ownerId)
    if (error) return NextResponse.json({ error: 'Intrekken mislukt' }, { status: 500 })

    await logAuditAction({
      userId: ownerId,
      action: 'member.revoked',
      entityType: 'company_member',
      entityId: memberRowId,
      ipAddress: getClientIP(request),
    }).catch(() => {})
  }

  if (inviteId) {
    const { error } = await pipeline
      .from('company_member_invites')
      .update({ status: 'revoked' })
      .eq('id', inviteId)
      .eq('owner_id', ownerId)
      .eq('status', 'pending')
    if (error) return NextResponse.json({ error: 'Intrekken mislukt' }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
