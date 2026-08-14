// src/app/api/offerte/[token]/route.ts
// [OFFERTE-AKKOORD] PUBLIC, login-free: de offerte lezen en erop antwoorden.
//
// De klant heeft geen sessie, dus dit gaat langs de service-role client — en dat betekent dat de
// projectie strak moet zijn. toPublicQuoteView (offerte-akkoord.ts) is de ENIGE allowlist: hij
// geeft het document terug dat de klant al heeft gekregen, en niets erbuiten. Geen id's, geen
// tokens, geen btw-nummer, geen andere offertes.
//
// Wat deze route NIET kan, en dat is met opzet de belangrijkste zin van dit bestand: er ontstaat
// hier nooit een factuur. Een akkoord legt een feit vast; nummeren blijft de tik van de
// ondernemer (Art. 35 Wet OB — zie de kop van offerte-akkoord.ts).

import { NextRequest, NextResponse } from 'next/server'
import { createPipelineClient } from '@/lib/supabase-pipeline'
import { checkRateLimitByKey, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { reportHandledFailure } from '@/lib/report-handled'
import { logAuditAction, getClientIP } from '@/lib/audit'
import { createNotification } from '@/lib/notifications'
import { amsterdamToday } from '@/lib/format-nl'
import {
  toPublicQuoteView,
  answerRefusal,
  isQuoteAnswer,
  cleanResponderName,
  type AnswerableQuote,
} from '@/lib/offerte-akkoord'

export const dynamic = 'force-dynamic'

/** Een offerte_token is een uuid. Alles anders wordt geweigerd vóór de database wordt geraakt. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** De kolommen die de publieke weergave nodig heeft, en geen enkele meer. */
const QUOTE_SELECT =
  'id, sender_id, invoice_type, status, invoice_number, invoice_date, due_date, client_name, total_inc_btw, offerte_response, offerte_responded_at, offerte_response_name'

const onbekend = () => NextResponse.json({ error: 'Onbekende offertelink' }, { status: 404 })

/** Alleen de staart van het token in een rapport — de link zelf is de sleutel. */
const tokenTail = (token: string) => `…${token.slice(-6)}`

/**
 * [PAY-READ-HONEST] "We kunnen even niet kijken" is iets anders dan "deze link bestaat niet".
 *
 * Dezelfde regel als op de betaalpagina, en om dezelfde reden: dit is een van de twee schermen in
 * het product zonder login, gelezen door iemand buiten het bedrijf. Krijgt die te horen dat de
 * link onbekend is terwijl hij een echte offerte in handen heeft, dan sluit hij het tabblad — en
 * de ondernemer hoort nooit waarom er geen antwoord kwam.
 */
function offerteOnbeschikbaar(wat: string, context: Record<string, unknown>) {
  reportHandledFailure({
    tag: 'OFFERTE-AKKOORD',
    message: `public quote page: ${wat} — customer told to retry, not that the link is unknown`,
    severity: 'gate-unavailable',
    context,
  })
  return NextResponse.json(
    { error: 'We kunnen deze offerte nu even niet laden. Probeer het over een minuut opnieuw — je link blijft geldig.' },
    { status: 503 },
  )
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  if (!UUID_RE.test(token)) return onbekend()

  // failOpen: deze weg kost niets en aan de andere kant staat een klant die ja wil zeggen. Een
  // database-hik mag daar niet tussen komen te staan.
  const limit = await checkRateLimitByKey({
    bucketKey: `offerte:${token}`,
    endpoint: '/api/offerte',
    ...RATE_LIMITS.PUBLIC_PAY,
    failOpen: true,
  })
  if (!limit.allowed) return rateLimitResponse(limit)

  const pipeline = createPipelineClient()

  const { data: quote, error: quoteErr } = await pipeline
    .from('invoices')
    .select(QUOTE_SELECT)
    .eq('offerte_token', token)
    .maybeSingle()
  if (quoteErr) return offerteOnbeschikbaar('quote lookup failed', { token: tokenTail(token), error: quoteErr.message })
  if (!quote) return onbekend()
  const rij = quote as unknown as AnswerableQuote & { id: string; sender_id: string }

  const { data: lines, error: linesErr } = await pipeline
    .from('invoice_lines')
    .select('description, quantity, unit, line_total')
    .eq('invoice_id', rij.id)
  if (linesErr) return offerteOnbeschikbaar('quote lines lookup failed', { token: tokenTail(token), error: linesErr.message })

  const { data: profile, error: profileErr } = await pipeline
    .from('profiles')
    .select('company_name, full_name')
    .eq('id', rij.sender_id)
    .maybeSingle()
  if (profileErr) return offerteOnbeschikbaar('sender lookup failed', { token: tokenTail(token), error: profileErr.message })

  const view = toPublicQuoteView({
    quote: rij,
    lines: lines ?? [],
    senderName: profile?.company_name || profile?.full_name || null,
    todayIso: amsterdamToday(),
  })
  // Niet-toonbaar (geen offerte, of nog een concept) → dezelfde 404, zonder te zeggen waarom.
  if (!view) return onbekend()

  return NextResponse.json(view)
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  if (!UUID_RE.test(token)) return onbekend()

  // Antwoorden SCHRIJFT, dus hier niet fail-open: bij een kapotte limiter wordt er geweigerd in
  // plaats van doorgelaten. Het verschil met de GET hierboven is precies dat verschil.
  const limit = await checkRateLimitByKey({
    bucketKey: `offerte-antwoord:${token}`,
    endpoint: '/api/offerte/antwoord',
    ...RATE_LIMITS.PUBLIC_PAY,
  })
  if (!limit.allowed) return rateLimitResponse(limit)

  const body = await req.json().catch(() => null)
  const antwoord = (body ?? {})?.answer
  if (!isQuoteAnswer(antwoord)) {
    return NextResponse.json({ error: 'Kies of je akkoord gaat of niet.' }, { status: 400 })
  }
  const naam = cleanResponderName((body ?? {})?.name)

  const pipeline = createPipelineClient()

  const { data: quote, error: quoteErr } = await pipeline
    .from('invoices')
    .select(QUOTE_SELECT)
    .eq('offerte_token', token)
    .maybeSingle()
  if (quoteErr) return offerteOnbeschikbaar('quote lookup failed', { token: tokenTail(token), error: quoteErr.message })
  if (!quote) return onbekend()

  const weigering = answerRefusal(quote as unknown as AnswerableQuote)
  if (weigering === 'already_answered') {
    // Het eerste antwoord staat. Geen stille overschrijving, en ook geen 404 — de klant mag zien
    // dat zijn antwoord er al is, want anders klikt hij nog eens en denkt hij dat het niet werkte.
    return NextResponse.json(
      { error: 'Op deze offerte is al geantwoord. Neem contact op als er iets moet veranderen.' },
      { status: 409 },
    )
  }
  if (weigering) return onbekend()

  const nu = new Date().toISOString()

  // De schrijfactie is zelf de grendel tegen twee gelijktijdige klikken: hij eist dat het antwoord
  // nog LEEG is. Verliest deze de race, dan raakt hij nul rijen en is het eerste antwoord dat van
  // de ander — precies wat de regel hierboven belooft, ook zonder dat de twee elkaar zien.
  const { data: bijgewerkt, error: schrijfErr } = await pipeline
    .from('invoices')
    .update({
      offerte_response: antwoord,
      offerte_responded_at: nu,
      offerte_response_name: naam,
    } as never)
    .eq('offerte_token', token)
    .is('offerte_response', null)
    .select('id')

  if (schrijfErr) {
    return offerteOnbeschikbaar('answer write failed', { token: tokenTail(token), error: schrijfErr.message })
  }
  if (!bijgewerkt || bijgewerkt.length === 0) {
    return NextResponse.json(
      { error: 'Op deze offerte is al geantwoord. Neem contact op als er iets moet veranderen.' },
      { status: 409 },
    )
  }

  const rij = quote as unknown as { id: string; sender_id: string; invoice_number: string | null; client_name: string | null }

  // [ALARM-VRIJ] Vanaf hier is het antwoord vastgelegd. Alles hieronder is bericht en spoor, en
  // niets ervan mag het antwoord ongedaan maken of de klant een fout tonen: hij heeft gedaan wat
  // hem gevraagd werd, en dat is gelukt.
  try {
    await logAuditAction({
      userId: rij.sender_id,
      action: 'offerte.answered',
      entityType: 'invoice',
      entityId: rij.id,
      newValue: { answer: antwoord, answered_at: nu, answered_by: naam },
      ipAddress: getClientIP(req),
    })
  } catch (e) {
    console.error('[OFFERTE-AKKOORD] audit write failed (non-fatal)', { invoiceId: rij.id, error: e })
  }

  try {
    const wie = rij.client_name?.trim() || 'Je klant'
    const nummer = rij.invoice_number ? ` ${rij.invoice_number}` : ''
    await createNotification({
      userId: rij.sender_id,
      // [TAAL-DB] stored notification content — Dutch by design
      title: antwoord === 'accepted' ? 'Offerte geaccepteerd' : 'Offerte afgewezen',
      body: antwoord === 'accepted'
        // [TAAL-DB] stored notification content — Dutch by design
        ? `${wie} gaat akkoord met offerte${nummer}. Zet hem om in een factuur wanneer je wilt.`
        // [TAAL-DB] stored notification content — Dutch by design
        : `${wie} gaat niet akkoord met offerte${nummer}.`,
      type: 'invoice',
      link: `/dashboard/invoice/${rij.id}`,
    })
  } catch (e) {
    console.error('[OFFERTE-AKKOORD] notification failed (non-fatal)', { invoiceId: rij.id, error: e })
  }

  return NextResponse.json({ ok: true, answer: antwoord, answeredAt: nu })
}
