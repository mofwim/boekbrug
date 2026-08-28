// src/app/api/email/webhook/route.ts
// [BOUNCE] POST — Resend belt aan als een verstuurde mail is teruggekomen.
//
// ── WAT DIT DICHT ──
// Een adres dat er goed uitziet maar fout is, wordt door Resend geaccepteerd en bounct daarna.
// Niemand luisterde. De factuur bleef "verstuurd", elke herinneringstrap ging naar dezelfde dode
// bus — en sinds die herinneringen een betaallink dragen, gaat er nu ook een betaalpagina naar een
// adres dat niet bestaat. De ondernemer merkte het pas maanden later aan het uitblijven van geld,
// en kon op dat moment niet meer zien of de klant NIET WILDE of NOOIT IETS KREEG.
//
// ── WAT HET DOET, EN WAT NADRUKKELIJK NIET ──
// Twee dingen, allebei met bestaande middelen en zonder één kolom erbij:
//
//   1. Het zet `reminders_paused` op de openstaande facturen aan dat adres. Dat is de schade die
//      NU doorloopt: dagelijks een aanmaning naar een bus die hem weggooit, tot en met de
//      wettelijke tekst die incassokosten aankondigt.
//   2. Het maakt een melding voor de ondernemer, met het adres en de factuurnummers erin. Hij is
//      de enige die het adres kan corrigeren; wij mogen dat niet raden.
//
// Het verandert NIETS aan de status van de factuur. "Verstuurd" is waar — hij is verstuurd. Wat
// niet waar was, is dat hij is aangekomen, en daar had de app nooit een woord voor. Een factuur
// stilletjes terugzetten naar concept zou bovendien een wettelijk vastgelegd nummer losmaken.
//
// ── VEILIGHEID ──
// Fail-closed op een ontbrekend RESEND_WEBHOOK_SECRET, en elke body wordt geverifieerd tegen de
// Svix-handtekening vóór er iets wordt gelezen (zie email-bounce.ts, waar dat getest is). Zonder
// die controle kan iedereen die dit adres kent de betalingsherinneringen van een willekeurige
// ondernemer stilzetten met één POST.

import { NextRequest, NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'

import { createPipelineClient } from '@/lib/supabase-pipeline'
import { createNotification } from '@/lib/notifications'
import { classifyEmailEvent, recipientOf, verifySvixSignature } from '@/lib/email-bounce'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const secret = process.env.RESEND_WEBHOOK_SECRET
  if (!secret) {
    console.error('[BOUNCE] RESEND_WEBHOOK_SECRET is not configured — the bounce listener is DISABLED.')
    return NextResponse.json({ error: 'webhook_secret_not_configured' }, { status: 401 })
  }

  // De RUWE tekst, vóór JSON.parse: de handtekening dekt de bytes, en een geparste-en-weer-
  // geserialiseerde body is niet dezelfde bytes.
  const body = await req.text()
  const geldig = verifySvixSignature({
    body,
    headers: {
      id: req.headers.get('svix-id'),
      timestamp: req.headers.get('svix-timestamp'),
      signature: req.headers.get('svix-signature'),
    },
    secret,
    nowMs: Date.now(),
  })
  if (!geldig) return NextResponse.json({ error: 'invalid_signature' }, { status: 401 })

  let event: { type?: unknown; data?: unknown }
  try {
    event = JSON.parse(body)
  } catch {
    // Ondertekend maar onleesbaar. 400, want opnieuw sturen helpt niet.
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 })
  }

  const data = event.data as { bounce?: { type?: unknown } } | undefined
  const verdict = classifyEmailEvent(event.type, data?.bounce?.type)
  if (verdict !== 'stop') {
    // 200: afgehandeld. Een 'transient' is geen fout en mag niet opnieuw worden aangeboden.
    return NextResponse.json({ ok: true, verdict })
  }

  const adres = recipientOf(event.data)
  if (!adres) return NextResponse.json({ ok: true, verdict, note: 'no_recipient' })

  try {
    const pipeline = createPipelineClient()

    // Alleen wat er NU nog uit gaat. Een betaalde of vervallen factuur stuurt niets meer, en
    // "gepauzeerd" op zo'n rij zou een stand zijn die nergens over gaat.
    const { data: facturen, error } = await pipeline
      .from('invoices')
      .select('id, invoice_number, sender_id')
      .eq('direction', 'outgoing')
      .eq('client_email', adres)
      .in('status', ['sent', 'overdue'])
      .eq('reminders_paused', false)

    if (error) {
      // Een mislukte lezing is GEEN "niets gevonden": dan zou de bounce stil verdwijnen en gaan de
      // herinneringen gewoon door. 500 → Resend biedt hem opnieuw aan.
      Sentry.captureException(new Error(error.message), { tags: { feature: 'email-bounce', phase: 'lookup' } })
      return NextResponse.json({ error: 'lookup_failed' }, { status: 500 })
    }
    if (!facturen || facturen.length === 0) {
      return NextResponse.json({ ok: true, verdict, paused: 0 })
    }

    const ids = facturen.map((f) => f.id as string)
    const { error: pauzeFout } = await pipeline
      .from('invoices')
      .update({ reminders_paused: true })
      .in('id', ids)
    if (pauzeFout) {
      Sentry.captureException(new Error(pauzeFout.message), { tags: { feature: 'email-bounce', phase: 'pause' } })
      return NextResponse.json({ error: 'pause_failed' }, { status: 500 })
    }

    // Eén melding per ondernemer, met de nummers erin. Twee facturen aan hetzelfde dode adres is
    // één probleem, niet twee meldingen.
    const perEigenaar = new Map<string, string[]>()
    for (const f of facturen) {
      const eigenaar = f.sender_id as string | null
      if (!eigenaar) continue
      const nummer = (f.invoice_number as string | null)?.trim()
      perEigenaar.set(eigenaar, [...(perEigenaar.get(eigenaar) ?? []), nummer || '—'])
    }

    for (const [eigenaar, nummers] of perEigenaar) {
      // [TAAL-DB] Een melding wordt als één string opgeslagen en in de brontaal geschreven, zoals
      // elke andere melding in deze app.
      await createNotification({
        userId: eigenaar,
        title: nummers.length === 1
          ? `Factuur ${nummers[0]} is niet aangekomen`
          : `${nummers.length} facturen zijn niet aangekomen`,
        body: `De mail naar ${adres} kwam terug. Herinneringen voor ${nummers.length === 1 ? 'deze factuur' : 'deze facturen'} (${nummers.join(', ')}) staan nu uit — corrigeer het e-mailadres bij de klant en verstuur opnieuw.`,
        type: 'status',
        link: '/dashboard/facturen',
      })
    }

    return NextResponse.json({ ok: true, verdict, paused: ids.length, owners: perEigenaar.size })
  } catch (e) {
    Sentry.captureException(e instanceof Error ? e : new Error(String(e)), { tags: { feature: 'email-bounce' } })
    return NextResponse.json({ error: 'handler_failed' }, { status: 500 })
  }
}
