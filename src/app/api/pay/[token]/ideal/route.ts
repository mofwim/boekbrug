// src/app/api/pay/[token]/ideal/route.ts
// [MOLLIE] POST — de klant drukt op "Betaal met iDEAL" op de publieke betaalpagina.
//
// LAZY, met opzet: de Mollie-betaallink ontstaat pas op deze klik, nooit bij het versturen van
// de factuur. Dat houdt de wettelijke bezorging volledig los van Mollie, en het betekent dat de
// link altijd het OPEN bedrag van dít moment vraagt — dezelfde openAmount-waarheid als de QR en
// het betaalverzoek (toPublicPayView), nooit een eigen som. Is er sinds een eerdere klik een
// deelbetaling of creditering geweest, dan is de oude link 'stale' (linkIsStale) en wordt hij
// vervangen (status 'superseded'), niet stilzwijgend hergebruikt.
//
// Faalrichting: elke twijfel antwoordt 404/409 met een Nederlandse zin — er wordt dan géén link
// aangemaakt. Een klant zonder iDEAL-knop kan altijd nog gewoon overmaken (de pagina toont IBAN
// en QR); een verkeerd bedrag in een betaallink is de onherstelbare kant.

import { NextRequest, NextResponse } from 'next/server'
import { createPipelineClient } from '@/lib/supabase-pipeline'
import { toPublicPayView, type BetaalverzoekInvoice } from '@/lib/betaalverzoek'
import { creditedOnInvoice } from '@/lib/credited-invoices'
import { getMollieConnection } from '@/lib/mollie-connection'
import { createMolliePaymentLink, mollieAmountValue, linkIsStale, placeholderVerdict } from '@/lib/mollie'
import { checkRateLimitByKey, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { SITE_URL } from '@/lib/site'

export const dynamic = 'force-dynamic'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params
  if (!UUID_RE.test(token)) {
    return NextResponse.json({ error: 'Onbekende betaallink' }, { status: 404 })
  }

  // Strakker dan de leespagina, en NIET failOpen: deze route maakt iets aan bij een externe
  // partij. Een database-blip mag een lezing doorlaten, geen aanmaak.
  const limit = await checkRateLimitByKey({
    bucketKey: `pay-ideal:${token}`,
    endpoint: '/api/pay/ideal',
    ...RATE_LIMITS.PUBLIC_PAY,
  })
  if (!limit.allowed) return rateLimitResponse(limit)

  const pipeline = createPipelineClient()
  // mollie_payment_links staat niet in de gegenereerde typen (mollie.sql wordt met de hand
  // toegepast) — zelfde ontspannen client als intake_claims, alleen voor die tabel.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const linkPipe = createPipelineClient() as any

  // Zelfde leesketen als GET /api/pay/[token]: factuur → creditering → toPublicPayView.
  // De autoriteiten (creditedOnInvoice, toPublicPayView) zijn gedeeld; alleen de lijm staat hier.
  const { data: invoice, error: invoiceErr } = await pipeline
    .from('invoices')
    .select('id, sender_id, direction, invoice_type, status, invoice_number, payment_reference, total_inc_btw, amount_paid, client_name, pay_token, due_date')
    .eq('pay_token', token)
    .maybeSingle()
  if (invoiceErr || !invoice) {
    return NextResponse.json({ error: 'Onbekende betaallink' }, { status: 404 })
  }
  const invoiceId = (invoice as { id: string }).id
  const ownerId = (invoice as { sender_id: string }).sender_id

  const credited = await creditedOnInvoice(pipeline as never, invoiceId)
  if (credited === null) {
    return NextResponse.json({ error: 'Onbekende betaallink' }, { status: 404 })
  }

  const { data: owner } = await pipeline
    .from('profiles')
    .select('iban, company_name, full_name')
    .eq('id', ownerId)
    .single()
  const view = toPublicPayView(
    { ...(invoice as BetaalverzoekInvoice), credited_inc_btw: credited },
    owner ?? { iban: null, company_name: null, full_name: null }
  )
  if (!view) return NextResponse.json({ error: 'Onbekende betaallink' }, { status: 404 })
  if (view.alreadyPaid) {
    return NextResponse.json({ error: 'Deze factuur is al betaald.' }, { status: 409 })
  }

  const amountValue = mollieAmountValue(view.amount)
  if (!amountValue) {
    return NextResponse.json({ error: 'Er staat geen bedrag open op deze factuur.' }, { status: 409 })
  }

  const connection = await getMollieConnection(ownerId)
  if (!connection) {
    // De knop hoort dan al niet zichtbaar te zijn (idealAvailable=false) — maar een oude tab
    // kan hem nog tonen. Zeg het gewoon.
    return NextResponse.json({ error: 'Online betalen is voor deze factuur niet beschikbaar. Gebruik de overschrijfgegevens op de pagina.' }, { status: 409 })
  }

  // Bestaande open link: hergebruiken zolang het bedrag nog klopt, anders vervangen.
  // [DEPLOY-SAFE] Een 42P01 (mollie.sql nog niet toegepast) antwoordt "niet beschikbaar" —
  // nooit een halve boeking.
  const { data: existing, error: linkErr } = await linkPipe
    .from('mollie_payment_links')
    .select('id, link_id, checkout_url, amount_value, status, created_at')
    .eq('user_id', ownerId)
    .eq('invoice_id', invoiceId)
    .eq('status', 'open')
    .maybeSingle()
  if (linkErr) {
    return NextResponse.json({ error: 'Online betalen is nu niet beschikbaar. Gebruik de overschrijfgegevens op de pagina.' }, { status: 503 })
  }
  const existingRow = existing as { id: string; link_id: string; checkout_url: string; amount_value: string; status: string; created_at: string | null } | null
  // [MOLLIE-C7] Een placeholder-rij (aanmaak halverwege gestrand: pending-linkid, lege URL) mag
  // NOOIT worden hergebruikt — hij gaf { url: '' } met een 200 terug en blokkeerde iDEAL op deze
  // factuur voorgoed, want de unieke open-index hield elke nieuwe aanmaak tegen. Zo'n rij wordt
  // hier opgeruimd en de aanmaak begint opnieuw.
  //
  // [MOLLIE-C7-RACE] …maar alleen als hij ECHT gestrand is. Een placeholder is precies wat deze
  // route zelf neerzet vlak vóór de aanroep naar Mollie, dus tijdens die netwerkronde is de rij
  // niet stuk maar in gebruik. Hem dan verwijderen laat de andere aanvraag zijn checkout-URL
  // uitdelen voor een rij die niet meer bestaat — de klant betaalt en de webhook boekt niets, want
  // op een onbekende rij antwoordt hij `ok: true` en stopt Mollie met opnieuw proberen. Zie
  // placeholderVerdict voor de hele keten.
  if (existingRow && (existingRow.checkout_url === '' || existingRow.link_id.startsWith('pending-'))) {
    if (placeholderVerdict(existingRow.created_at, new Date()) === 'in_flight') {
      // Dezelfde uitkomst die de 23505-tak hieronder al koos voor exact deze toestand: er is nu
      // iemand mee bezig, dus even opnieuw proberen is het eerlijke antwoord. De pagina toont
      // intussen gewoon IBAN en QR, dus de klant staat nooit stil.
      return NextResponse.json(
        { error: 'We zijn deze betaling net aan het klaarzetten. Probeer het over een halve minuut nog eens, of maak het bedrag over met de gegevens op deze pagina.' },
        { status: 409 },
      )
    }
    await linkPipe.from('mollie_payment_links').delete().eq('id', existingRow.id).eq('user_id', ownerId)
  } else if (existingRow && !linkIsStale(existingRow.amount_value, view.amount)) {
    return NextResponse.json({ url: existingRow.checkout_url })
  } else if (existingRow) {
    await linkPipe
      .from('mollie_payment_links')
      .update({ status: 'superseded' })
      .eq('id', existingRow.id)
      .eq('user_id', ownerId)
  }

  // Nieuwe rij EERST (met een placeholder-linkid), zodat de webhook-URL het rij-id kan dragen
  // vóórdat Mollie hem te zien krijgt; daarna de echte link erin. Mislukt Mollie, dan wordt de
  // rij weer opgeruimd — er blijft nooit een open rij zonder echte link staan.
  const { data: inserted, error: insErr } = await linkPipe
    .from('mollie_payment_links')
    .insert({
      user_id: ownerId,
      invoice_id: invoiceId,
      link_id: `pending-${crypto.randomUUID()}`,
      checkout_url: '',
      amount_value: amountValue,
      status: 'open',
    })
    .select('id')
    .single()
  if (insErr || !inserted) {
    // [MOLLIE-C8] 23505 = twee klanten/tabbladen klikten tegelijk en de ander won de unieke
    // open-index. Er BESTAAT dan een perfect bruikbare link — geef die terug in plaats van een
    // 503 tegen iemand die net besloot te betalen. (Lege checkout_url = de winnaar is zelf nog
    // bezig; dan is even opnieuw proberen het eerlijke antwoord.)
    if ((insErr as { code?: string } | null)?.code === '23505') {
      const { data: winner } = await linkPipe
        .from('mollie_payment_links')
        .select('checkout_url')
        .eq('user_id', ownerId)
        .eq('invoice_id', invoiceId)
        .eq('status', 'open')
        .maybeSingle()
      const url = (winner as { checkout_url?: string } | null)?.checkout_url
      if (url) return NextResponse.json({ url })
    }
    return NextResponse.json({ error: 'Online betalen is nu niet beschikbaar. Gebruik de overschrijfgegevens op de pagina.' }, { status: 503 })
  }
  const rowId = (inserted as { id: string }).id

  const created = await createMolliePaymentLink(connection.apiKey, {
    amountValue,
    description: `Factuur ${view.invoiceNumber ?? invoiceId}`,
    // Terug naar de betaalpagina zelf: na verwerking zegt die "al betaald"; de ?ideal=terug
    // hint laat de pagina intussen "we verwerken je betaling" tonen.
    redirectUrl: `${SITE_URL}/pay/${token}?ideal=terug`,
    webhookUrl: `${SITE_URL}/api/mollie/webhook?link=${rowId}`,
  })
  if ('error' in created) {
    await linkPipe.from('mollie_payment_links').delete().eq('id', rowId).eq('user_id', ownerId)
    console.error('[MOLLIE] link aanmaken mislukt', { invoiceId, error: created.error })
    return NextResponse.json({ error: 'Online betalen is nu niet beschikbaar. Gebruik de overschrijfgegevens op de pagina.' }, { status: 503 })
  }

  // [MOLLIE-C7-RACE] `.select('id')` erbij, en dat is niet cosmetisch: een UPDATE die NUL rijen
  // raakt is in PostgREST geen fout. Zonder deze telling deelde de route haar checkout-URL uit
  // nadat een gelijktijdige aanvraag haar rij had verwijderd — en die rij is precies wat de
  // webhook nodig heeft om de betaling te kunnen boeken. Eén regel geraakt, of geen URL.
  const { data: updated, error: updErr } = await linkPipe
    .from('mollie_payment_links')
    .update({ link_id: created.id, checkout_url: created.checkoutUrl })
    .eq('id', rowId)
    .eq('user_id', ownerId)
    .select('id')
  if (!updErr && (updated?.length ?? 0) === 0) {
    // De rij is onder ons weggehaald. De link bestaat wel bij Mollie, dus hem NIET uitdelen is het
    // enige wat een onboekbare betaling nog voorkomt: een link die niemand krijgt, betaalt niemand.
    console.error('[MOLLIE] linkrij verdween tijdens aanmaak', { invoiceId, rowId })
    return NextResponse.json(
      { error: 'We zijn deze betaling net aan het klaarzetten. Probeer het over een halve minuut nog eens, of maak het bedrag over met de gegevens op deze pagina.' },
      { status: 409 },
    )
  }
  if (updErr) {
    // De link bestaat bij Mollie maar onze rij kent hem niet → de webhook zou hem nooit kunnen
    // verifiëren. Niet uitdelen — en de placeholder-rij WEG, anders bezet hij de unieke
    // open-index voorgoed (de kop belooft: nooit een open rij zonder echte link).
    await linkPipe.from('mollie_payment_links').delete().eq('id', rowId).eq('user_id', ownerId)
    console.error('[MOLLIE] linkrij bijwerken mislukt', { invoiceId, rowId, error: updErr.message })
    return NextResponse.json({ error: 'Online betalen is nu niet beschikbaar. Gebruik de overschrijfgegevens op de pagina.' }, { status: 503 })
  }

  return NextResponse.json({ url: created.checkoutUrl })
}
