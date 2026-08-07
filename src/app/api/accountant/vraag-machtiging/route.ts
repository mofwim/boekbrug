// src/app/api/accountant/vraag-machtiging/route.ts
// [VRAAG-MACHTIGING] De boekhouder vraagt zijn klant om een machtiging.
//
// DE ONTBREKENDE SCHAKEL
// Er waren vier schermen die op een machtiging wachten en nul manieren om er een te vragen. De
// lege staten zeiden "je klant zet het zelf aan bij Instellingen" — instructies voor een gesprek
// buiten de app. En de klant kwam er niet vanzelf op: het staat onderin een instellingenscherm van
// duizend regels, onder dingen waar hij nooit komt.
//
// WAT DEZE ROUTE WEL EN NIET IS
// Hij VRAAGT. Hij verleent niets. De machtiging blijft een handeling van de klant alleen, op zijn
// eigen scherm, precies zoals /api/accountant/invoice-mandate afdwingt — een boekhouder die
// zichzelf machtigt is het gat dat accountant_clients_insert_consent.sql heeft dichtgemaakt, en
// dat gaat hier niet alsnog open via een omweg.
//
// DE WACHTTIJD IS GEEN TECHNIEK MAAR EEN OMGANGSVORM
// Aan de andere kant zit geen gebruiker van ons maar de klant van deze boekhouder. Twee keer
// vragen is zeuren, en een relatie die daardoor bekoelt is niet iets wat wij mogen veroorzaken.
// Het vorige verzoek staat in het auditspoor — geen nieuwe tabel voor een cooldown.

import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase-server'
import { createPipelineClient } from '@/lib/supabase-pipeline'
import { sendMessageNotification } from '@/lib/email'
import { appUrl } from '@/lib/app-origin'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { canRequestMandate, buildMandateRequest } from '@/lib/mandate-request'
import { logAuditAction, getClientIP } from '@/lib/audit'
import { notifyRow } from '@/lib/notifications'

export const dynamic = 'force-dynamic'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function POST(request: NextRequest) {
  try {
    const supabase = await createServerSupabaseClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Niet ingelogd.' }, { status: 401 })

    const body = await request.json().catch(() => null)
    const klantId = typeof body?.clientId === 'string' ? body.clientId : ''
    const soort = body?.kind === 'bevestigen' ? 'bevestigen' : 'facturen'
    if (!UUID.test(klantId)) {
      return NextResponse.json({ error: 'Ongeldige klant' }, { status: 400 })
    }

    const limit = await checkRateLimit({
      userId: user.id,
      endpoint: '/api/accountant/vraag-machtiging',
      ...RATE_LIMITS.ACCOUNTANT_INVITE,
    })
    if (!limit.allowed) return rateLimitResponse(limit)

    // De koppeling is de grens — je vraagt alleen iets aan iemand die jou al heeft uitgenodigd.
    // In code gecontroleerd, zodat klantId nooit in een PostgREST-filter belandt.
    const { data: links } = await supabase
      .from('accountant_clients')
      .select('zzper_id')
      .eq('accountant_id', user.id)
    if (!(links ?? []).some((l) => l.zzper_id === klantId)) {
      return NextResponse.json(
        { error: 'Je kunt dit alleen vragen aan een gekoppelde klant' },
        { status: 403 },
      )
    }

    const pipeline = createPipelineClient()

    // Heeft hij deze al? Dan is er niets te vragen — en een verzoek om iets wat je al hebt, leest
    // als een systeem dat niet weet waar het het over heeft.
    const { data: bestaand } = await pipeline
      .from('accountant_invoice_mandates')
      .select('id')
      .eq('zzper_id', klantId)
      .eq('accountant_id', user.id)
      .eq('kind', soort)
      .is('revoked_at', null)
      .maybeSingle()
    if (bestaand) {
      return NextResponse.json({ ok: true, alVerleend: true })
    }

    // ── De wachttijd, uit het auditspoor ─────────────────────────────────────
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: eerder } = await (pipeline as any)
      .from('audit_logs')
      .select('created_at, new_value')
      .eq('user_id', user.id)
      .eq('action', 'accountant.mandate_requested')
      .eq('entity_id', klantId)
      .order('created_at', { ascending: false })
      .limit(10)
    const vorige = ((eerder ?? []) as Array<{ created_at: string; new_value: { kind?: string } | null }>)
      .find((r) => (r.new_value?.kind ?? 'facturen') === soort)

    const oordeel = canRequestMandate(vorige?.created_at ?? null, Date.now())
    if (!oordeel.allowed) {
      return NextResponse.json({ error: oordeel.reason }, { status: 409 })
    }

    // ── Het verzoek ──────────────────────────────────────────────────────────
    const { data: ik } = await pipeline
      .from('profiles')
      .select('full_name, company_name')
      .eq('id', user.id)
      .maybeSingle()
    const mijnNaam = ik?.company_name || ik?.full_name || ''
    if (!mijnNaam) {
      return NextResponse.json(
        { error: 'Vul eerst je naam of bedrijfsnaam in bij Instellingen — het verzoek wordt ermee ondertekend.' },
        { status: 409 },
      )
    }

    const tekst = buildMandateRequest(soort, mijnNaam)

    // In zijn inbox, langs dezelfde weg als elk ander bericht: één inbox, geen tweede plek waar
    // dingen kunnen blijven liggen.
    const { error: berichtErr } = await supabase
      .from('messages')
      .insert({ sender_id: user.id, receiver_id: klantId, content: tekst.body, read: false })
    if (berichtErr) {
      console.error('[VRAAG-MACHTIGING] bericht opslaan mislukt', { berichtErr })
      return NextResponse.json({ error: 'Versturen mislukt. Probeer het opnieuw.' }, { status: 500 })
    }

    // De melding wijst NIET naar het gesprek maar rechtstreeks naar de schakelaar. Dat is het hele
    // verschil tussen "hij las het" en "hij deed het": het staat op regel 831 van een scherm van
    // duizend regels, en niemand scrollt daarheen op zoek naar iets waarvan hij net hoorde.
    await notifyRow({
        user_id: klantId,
        title: tekst.title,
        body: tekst.body.slice(0, 160),
        type: 'message',
        read: false,
        link: '/dashboard/settings#boekhouder',
      })
      .then((ok) => {
        if (!ok) console.error('[VRAAG-MACHTIGING] melding mislukt', { klantId })
      })

    const { data: klant } = await pipeline
      .from('profiles')
      .select('email, full_name')
      .eq('id', klantId)
      .maybeSingle()
    if (klant?.email) {
      sendMessageNotification({
        toEmail: klant.email,
        receiverName: klant.full_name || 'Ondernemer',
        senderName: mijnNaam,
        messagePreview: tekst.body.slice(0, 200),
        conversationUrl:
          appUrl(process.env, '/dashboard/settings#boekhouder', new URL(request.url).origin) ?? '',
      }).catch((e) => console.error('[VRAAG-MACHTIGING] e-mail mislukt', e))
    }

    // Het spoor is hier ook de cooldown-bron — zie boven. entity_id is de KLANT, want dat is
    // waar de wachttijd per soort aan hangt.
    await logAuditAction({
      userId: user.id,
      action: 'accountant.mandate_requested',
      entityType: 'profile',
      entityId: klantId,
      newValue: { kind: soort, zzper_id: klantId },
      ipAddress: getClientIP(request),
    }).catch(() => {})

    return NextResponse.json({ ok: true })
  } catch (e) {
    console.error('[VRAAG-MACHTIGING] /api/accountant/vraag-machtiging', e)
    return NextResponse.json({ error: 'Server fout' }, { status: 500 })
  }
}
