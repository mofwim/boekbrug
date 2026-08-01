// src/app/api/invoice/[id]/reminder/route.ts
// [NAMENS] Eén herinnering, met de hand verstuurd.
//
// WAAROM DIT ER MOET ZIJN
// Iemand die facturen maakt, maakt ze om betaald te worden. Zonder deze knop kan een verkoper
// zien dat een factuur te laat is en er niets aan doen — dan is de rol half af en verhuist het
// nabellen alsnog naar WhatsApp, precies waar dit product vandaan komt.
//
// WAAROM HIJ STRENG IS
// Aan de andere kant zit een KLANT van de ondernemer, geen gebruiker van ons. Een herinnering te
// veel kost hem een relatie die hij niet zelf heeft beschadigd. Alle regels staan puur en getest
// in verkoop-overzicht.ts (magHerinneren); hier wordt er alleen naar geluisterd.
//
// DRIE DINGEN DIE DEZE ROUTE BEWUST NIET DOET
//  · geen WIK-aanmaning. Dat is de wettelijke stap die incassokosten mogelijk maakt (art. 6:96
//    BW) en hoort bij de eigenaar, niet bij een medewerker met een knop. De cron blijft de enige
//    die hem verstuurt, op de laatste tier.
//  · geen statuswijziging. Herinneren verandert niets aan de factuur — geen nummer, geen bedrag,
//    geen status. Alleen een regel in invoice_reminders.
//  · geen tweede mail bij twijfel. Lukt het schrijven van het spoor niet, dan gaat er GEEN mail.
//    Liever niet herinnerd dan twee keer herinnerd zonder dat iemand kan zien dat het gebeurde.

import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase-server'
import { createPipelineClient } from '@/lib/supabase-pipeline'
import { sendInvoiceReminder } from '@/lib/email'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { getActingFor } from '@/lib/acting-for-server'
import { factuurEigenaar, isNamens, magFactuur } from '@/lib/acting-for'
import { magHerinneren, volgendeHandmatigeOffset, openstaandBedrag } from '@/lib/verkoop-overzicht'
import { logAuditAction, getClientIP } from '@/lib/audit'

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params
    const acting = await getActingFor()
    if (!acting) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const limit = await checkRateLimit({
      userId: acting.actorId,
      endpoint: '/api/invoice/reminder',
      ...RATE_LIMITS.ACCOUNTANT_INVITE, // 20 per dag — een herinnering is geen bulkactie
    })
    if (!limit.allowed) return rateLimitResponse(limit)

    const ownerId = factuurEigenaar(acting)
    const supabase = await createServerSupabaseClient()
    const pipeline = createPipelineClient()

    const { data: inv } = await supabase
      .from('invoices')
      .select('id, invoice_number, client_name, client_email, due_date, total_inc_btw, amount_paid, status, sender_id')
      .eq('id', id)
      .eq('sender_id', ownerId)
      .maybeSingle()

    if (!inv) return NextResponse.json({ error: 'Factuur niet gevonden' }, { status: 404 })

    // Tweede slot naast RLS — dit is het moment waarop een geraden id binnenkomt, en het gevolg
    // is een mail naar de klant van iemand anders.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if (!magFactuur(acting, inv as any)) {
      return NextResponse.json({ error: 'Factuur niet gevonden' }, { status: 404 })
    }

    // ── Het spoor tot nu toe: hoeveel gingen er al uit, en wanneer de laatste? ──
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: eerder } = await (pipeline as any)
      .from('invoice_reminders')
      .select('day_offset, sent_at, status')
      .eq('invoice_id', id)
      .order('sent_at', { ascending: false })
    const rijen: Array<{ day_offset: number; sent_at: string; status: string }> = eerder ?? []
    const geslaagd = rijen.filter((r) => r.status !== 'failed')

    const oordeel = magHerinneren(
      {
        id: inv.id,
        invoice_number: inv.invoice_number,
        client_name: inv.client_name,
        client_email: inv.client_email,
        invoice_date: null,
        due_date: inv.due_date,
        total_inc_btw: inv.total_inc_btw,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        amount_paid: (inv as any).amount_paid ?? 0,
        status: inv.status,
        laatste_herinnering: geslaagd[0]?.sent_at ?? null,
        herinneringen: geslaagd.length,
      },
      Date.now(),
    )
    if (!oordeel.mag) return NextResponse.json({ error: oordeel.reden }, { status: 409 })

    // ── Claim vóór de mail ──────────────────────────────────────────────────
    // Zelfde volgorde als bij SnelStart: het onomkeerbare (een mail bij een klant) gebeurt pas
    // nadat het spoor vaststaat. Andersom kan een dubbele tik twee mails opleveren waarvan er
    // één nergens staat.
    const offset = volgendeHandmatigeOffset(rijen.map((r) => r.day_offset))
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: claim, error: claimErr } = await (pipeline as any)
      .from('invoice_reminders')
      .insert({
        invoice_id: id,
        user_id: ownerId,
        day_offset: offset,
        email_to: inv.client_email,
        status: 'sent',
      })
      .select('id')
      .single()

    if (claimErr || !claim) {
      // Kon het spoor niet worden vastgelegd, dan gaat er geen mail. Zie de kop.
      console.error('[NAMENS] herinnering claimen mislukt', { claimErr, id })
      return NextResponse.json({ error: 'Herinneren lukte niet — probeer het zo nog eens' }, { status: 503 })
    }

    // De naam die op de mail komt is die van de EIGENAAR — het is zijn factuur.
    const { data: eigenaarProfiel } = await pipeline
      .from('profiles')
      .select('company_name, full_name')
      .eq('id', ownerId)
      .single()

    try {
      await sendInvoiceReminder({
        toEmail: inv.client_email as string,
        clientName: inv.client_name?.trim() || 'klant',
        zzperName: eigenaarProfiel?.company_name || eigenaarProfiel?.full_name || 'BoekBrug',
        invoiceNumber: inv.invoice_number?.trim() || '—',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        openstaand: openstaandBedrag(inv as any),
        dueDate: inv.due_date as string,
        // Nooit 'firm' en nooit een WIK-aanmaning vanaf deze knop — zie de kop.
        firm: false,
        wik: null,
      })
    } catch (e) {
      // [REMINDER-TRUTH] De claim blijft staan met status 'failed', zodat het scherm eerlijk kan
      // zeggen dat er niets is aangekomen — en de volgende poging niet als "tweede herinnering"
      // wordt geteld.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (pipeline as any).from('invoice_reminders').update({ status: 'failed' }).eq('id', claim.id)
      console.error('[NAMENS] herinnering versturen mislukt', { id, error: String(e) })
      return NextResponse.json({ error: 'De herinnering kon niet worden verstuurd — probeer opnieuw' }, { status: 502 })
    }

    await logAuditAction({
      userId: acting.actorId,
      action: 'invoice.reminder_sent',
      entityType: 'invoice',
      entityId: id,
      newValue: { to: inv.client_email, offset, namens: isNamens(acting) ? ownerId : null },
      ipAddress: getClientIP(request),
    }).catch(() => {})

    return NextResponse.json({ ok: true, verstuurd: geslaagd.length + 1 })
  } catch (e) {
    console.error('[NAMENS] /api/invoice/[id]/reminder', e)
    return NextResponse.json({ error: 'Server fout' }, { status: 500 })
  }
}
