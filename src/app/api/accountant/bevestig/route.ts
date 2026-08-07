// src/app/api/accountant/bevestig/route.ts
// [BEVESTIGEN] De boekhouder bevestigt één inkoopfactuur van een klant die hem daarvoor
// gemachtigd heeft.
//
// WAAROM DIT EEN EIGEN ROUTE IS EN GEEN VLAG OP /api/email/confirm/[id]
//
// Die route is van de ONDERNEMER, en dat blijft zo. Ze doet vier dingen (bevestigen, betalen,
// negeren, terugzetten), leest vijftien velden, leert leverancieraliassen aan en herrekent
// bedragen die de mens heeft aangepast. Een `namens_klant_id` erdoorheen vlechten betekent dat
// elk van die takken opnieuw moet worden nagelopen op "en wat als het de boekhouder is" — en één
// vergeten tak is een boekhouder die een betaling verzint of een factuur van zijn klant weggooit.
//
// Deze route doet ÉÉN ding: processing → received. Ze kan niets anders, ook niet per ongeluk.
//
// WAT DE BOEKHOUDER HIER NIET KAN, EN WAAROM DAT GEEN GEBREK IS
//
// Bedragen wijzigen. Bevestigen betekent hier "deze lezing klopt, boek hem" — niet "ik maak er
// iets anders van". Klopt het bedrag niet, dan bevestigt hij niet, en vraagt hij het na bij zijn
// klant (/dashboard/accountant/opvragen). Art. 52 AWR laat de administratieplicht bij de
// ondernemer; een derde die de cijfers mag herschrijven maakt die plicht fictie. De trigger in de
// database zegt hetzelfde: uitzondering 5 laat uitsluitend `status` bewegen.
//
// EN DE ONDERNEMER ZIET HET
//
// `confirmed_by` wordt gevuld en er gaat een melding uit. Dat is de hele afspraak: de
// verantwoordelijkheid verhuist niet — ze wordt zichtbaar. Zonder dat spoor is dit een machtiging
// die niemand kan controleren, en die had ik niet moeten bouwen.

import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase-server'
import { createPipelineClient } from '@/lib/supabase-pipeline'
import { createNotification } from '@/lib/notifications'
import { canConfirmForClientServer } from '@/lib/acting-for-server'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { logAuditAction, getClientIP } from '@/lib/audit'

export const dynamic = 'force-dynamic'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function POST(request: NextRequest) {
  try {
    const supabase = await createServerSupabaseClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Niet ingelogd.' }, { status: 401 })

    const body = await request.json().catch(() => null)
    const klantId = typeof body?.clientId === 'string' ? body.clientId : ''
    const factuurId = typeof body?.invoiceId === 'string' ? body.invoiceId : ''
    if (!UUID.test(klantId) || !UUID.test(factuurId)) {
      return NextResponse.json({ error: 'Ongeldig verzoek' }, { status: 400 })
    }

    const limit = await checkRateLimit({
      userId: user.id,
      endpoint: '/api/accountant/bevestig',
      ...RATE_LIMITS.INVOICE_SEND,
    })
    if (!limit.allowed) return rateLimitResponse(limit)

    // De machtiging, en precies de juiste soort. Een factuurmandaat geeft hier niets —
    // zie canConfirmForClient() in accountant-mandate.ts.
    if (!(await canConfirmForClientServer(klantId))) {
      return NextResponse.json(
        { error: 'Je hebt geen toestemming om namens deze klant te bevestigen' },
        { status: 403 },
      )
    }

    // Lezen met de SESSIE-client. invoices_mandate_confirm_read laat precies dit door: een
    // inkomende factuur in 'processing' van een klant die deze boekhouder heeft gemachtigd. Geen
    // service_role, want dan zou de trigger hieronder worden overgeslagen — en die is het punt.
    const { data: factuur, error: leesErr } = await supabase
      .from('invoices')
      .select('id, receiver_id, direction, status, invoice_number, client_name, total_inc_btw')
      .eq('id', factuurId)
      .maybeSingle()

    if (leesErr) {
      // [NO-SILENT-EMPTY] Een leesfout mag nooit als "bestaat niet" bij de gebruiker aankomen op
      // het scherm waar bevestigen het hele punt is. Zelfde 503 als de route van de ondernemer.
      console.error('[BEVESTIGEN] lezen mislukt — niets gewijzigd', { factuurId, leesErr })
      return NextResponse.json(
        { error: 'We konden deze factuur nu niet ophalen. Er is niets gewijzigd — probeer het zo opnieuw.' },
        { status: 503 },
      )
    }
    if (!factuur || factuur.receiver_id !== klantId) {
      return NextResponse.json({ error: 'Factuur niet gevonden' }, { status: 404 })
    }
    if (factuur.direction !== 'incoming') {
      return NextResponse.json({ error: 'Alleen inkoopfacturen worden hier bevestigd' }, { status: 400 })
    }
    if (factuur.status !== 'processing') {
      // Al bevestigd, al betaald, of genegeerd. Geen fout van de boekhouder — een verouderd scherm.
      return NextResponse.json(
        { error: 'Deze factuur staat niet meer klaar om te bevestigen — ververs het scherm.' },
        { status: 409 },
      )
    }

    // ── De bevestiging ───────────────────────────────────────────────────────
    // Compare-and-swap op de status: twee tabbladen of een dubbele tik mogen niet allebei slagen.
    // De trigger (uitzondering 5) laat hier uitsluitend `status` en `confirmed_by` door; probeert
    // deze route ooit iets anders mee te sturen, dan weigert de database het.
    const { data: bijgewerkt, error: schrijfErr } = await supabase
      .from('invoices')
      .update({
        status: 'received',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        confirmed_by: user.id,
        updated_at: new Date().toISOString(),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any)
      .eq('id', factuurId)
      .eq('status', 'processing')
      .select('id')

    if (schrijfErr) {
      console.error('[BEVESTIGEN] bevestigen mislukt', { factuurId, schrijfErr })
      return NextResponse.json({ error: 'Bevestigen mislukt. Probeer het opnieuw.' }, { status: 500 })
    }
    if (!bijgewerkt || bijgewerkt.length === 0) {
      // De compare-and-swap verloren: iemand anders was net eerder.
      return NextResponse.json(
        { error: 'Deze factuur is zojuist al bevestigd — ververs het scherm.' },
        { status: 409 },
      )
    }

    // ── De ondernemer moet het weten ─────────────────────────────────────────
    // Niet "netjes", maar de voorwaarde waaronder deze machtiging verdedigbaar is. Er is zojuist
    // iets in zijn boeken geboekt waarvoor híj aansprakelijk blijft (art. 52 AWR). Best-effort:
    // de bevestiging staat er al en wordt niet teruggedraaid omdat een melding faalt.
    const pipeline = createPipelineClient()
    try {
      const { data: ik } = await pipeline
        .from('profiles')
        .select('full_name, company_name')
        .eq('id', user.id)
        .maybeSingle()
      const naam = ik?.company_name || ik?.full_name || 'Je boekhouder'
      const bedrag = Number(factuur.total_inc_btw ?? 0).toLocaleString('nl-NL', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })
      const melding = await createNotification({
        userId: klantId,
        title: 'Je boekhouder heeft een inkoopfactuur bevestigd',
        body: `${naam} heeft de factuur van ${factuur.client_name || 'een leverancier'} (€ ${bedrag}) gecontroleerd en geboekt. Je blijft er zelf verantwoordelijk voor — kijk hem gerust na.`,
        type: 'invoice',
        link: '/dashboard/incoming/manage',
      })
      if (!melding.ok) {
        console.error('[BEVESTIGEN] melding aan de ondernemer mislukt', { factuurId, error: melding.error })
      }
    } catch (e) {
      console.error('[BEVESTIGEN] melding aan de ondernemer mislukt', { factuurId, e })
    }

    await logAuditAction({
      userId: user.id,
      action: 'accountant.invoice_confirmed',
      entityType: 'invoice',
      entityId: factuurId,
      oldValue: { status: 'processing' },
      newValue: { status: 'received', confirmed_by: user.id, namens: klantId },
      ipAddress: getClientIP(request),
    }).catch(() => {})

    return NextResponse.json({ ok: true })
  } catch (e) {
    console.error('[BEVESTIGEN] /api/accountant/bevestig', e)
    return NextResponse.json({ error: 'Server fout' }, { status: 500 })
  }
}
