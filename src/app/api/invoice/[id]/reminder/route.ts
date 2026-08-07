// src/app/api/invoice/[id]/reminder/route.ts
// [ACTING-FOR] Eén herinnering, met de hand verstuurd.
//
// WAAROM DIT ER MOET ZIJN
// Iemand die facturen maakt, maakt ze om betaald te worden. Zonder deze knop kan een verkoper
// zien dat een factuur te laat is en er niets aan doen — dan is de rol half af en verhuist het
// nabellen alsnog naar WhatsApp, precies waar dit product vandaan komt.
//
// WAAROM HIJ STRENG IS
// Aan de andere kant zit een KLANT van de ondernemer, geen gebruiker van ons. Een herinnering te
// veel kost hem een relatie die hij niet zelf heeft beschadigd. Alle regels staan puur en getest
// in sales-overview.ts (canRemind); hier wordt er alleen naar geluisterd.
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
import { getActingFor, getActingForClient } from '@/lib/acting-for-server'
import { invoiceOwnerId, isActingForOther, canRemindInvoice } from '@/lib/acting-for'
import { canRemind, nextManualOffset, outstandingAmount } from '@/lib/sales-overview'
import { logAuditAction, getClientIP } from '@/lib/audit'
import { notifyRow } from '@/lib/notifications'

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params

    // [DEBITEUREN] Zonder `namens_klant_id` is dit letterlijk de oude route. Mét dat veld moet de
    // beller een boekhouder zijn met een levend mandaat van precies die klant — anders 403, nooit
    // een terugval op "dan maar voor jezelf" (zie accountant-mandate.ts).
    const body = await request.json().catch(() => null)
    const namensKlantId =
      typeof body?.namens_klant_id === 'string' && body.namens_klant_id ? body.namens_klant_id : null

    const acting = namensKlantId ? await getActingForClient(namensKlantId) : await getActingFor()
    if (!acting) {
      return namensKlantId
        ? NextResponse.json(
            { error: 'Je hebt geen toestemming om namens deze klant te herinneren' },
            { status: 403 },
          )
        : NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const limit = await checkRateLimit({
      userId: acting.actorId,
      endpoint: '/api/invoice/reminder',
      ...RATE_LIMITS.ACCOUNTANT_INVITE, // 20 per dag — een herinnering is geen bulkactie
    })
    if (!limit.allowed) return rateLimitResponse(limit)

    const ownerId = invoiceOwnerId(acting)
    const supabase = await createServerSupabaseClient()
    const pipeline = createPipelineClient()

    // [DEBITEUREN] Een boekhouder leest de factuur van zijn klant niet via RLS op de sessie —
    // invoices_accountant_read geeft hem alleen GEDEELDE facturen, en een openstaande verkoop-
    // factuur hoeft niet gedeeld te zijn om te laat te zijn. Vandaar de service_role-client, met
    // sender_id expliciet op ownerId: hetzelfde patroon als accountant-access.ts, waar de
    // TOESTEMMING op de sessie is bepaald en de DATA daarna scoped wordt opgehaald.
    const leesClient = acting.role === 'boekhouder' ? pipeline : supabase
    const { data: inv } = await leesClient
      .from('invoices')
      .select('id, invoice_number, client_name, client_email, due_date, total_inc_btw, amount_paid, status, sender_id, created_by, reminders_paused, invoice_type')
      .eq('id', id)
      .eq('sender_id', ownerId)
      .maybeSingle()

    if (!inv) return NextResponse.json({ error: 'Factuur niet gevonden' }, { status: 404 })

    // Tweede slot naast RLS — dit is het moment waarop een geraden id binnenkomt, en het gevolg
    // is een mail naar de klant van iemand anders.
    //
    // canRemindInvoice en NIET canAccessInvoice: herinneren en uitgeven zijn twee verschillende
    // handelingen, en de boekhouder mag bij de eerste breder dan bij de tweede. De reden staat
    // voluit in acting-for.ts — kort: uitgeven maakt een document onder andermans BTW-nummer,
    // herinneren verandert helemaal niets. Deze functie bewaakt óók reminders_paused, de vlag
    // waarmee de ondernemer "deze niet" zegt.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mag = canRemindInvoice(acting, inv as any)
    if (!mag.allowed) {
      // 404 wanneer het niet zijn administratie is (een geraden id mag niet bevestigd worden),
      // 409 wanneer het wél zijn administratie is maar deze factuur niet mag — dan is de reden
      // nuttige informatie in plaats van een lek.
      return inv.sender_id === ownerId
        ? NextResponse.json({ error: mag.reason }, { status: 409 })
        : NextResponse.json({ error: 'Factuur niet gevonden' }, { status: 404 })
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

    const oordeel = canRemind(
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
        // [CREDITNOTA-NO-CHASE] canRemind weigert alles wat geen 'factuur' is. Zonder dit veld zou
        // hij een creditnota als gewone factuur beoordelen — en die haalt élke controle: status
        // 'sent', vervaldatum vandaag, en een openstaand bedrag omdat outstandingAmount() de
        // absolute waarde van het negatieve totaal neemt.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        invoice_type: (inv as any).invoice_type ?? 'factuur',
        last_reminder_at: geslaagd[0]?.sent_at ?? null,
        reminder_count: geslaagd.length,
      },
      Date.now(),
    )
    if (!oordeel.allowed) return NextResponse.json({ error: oordeel.reason }, { status: 409 })

    // [CREDITNOTA-NO-CHASE] De andere helft van het paar: deze factuur IS geen creditnota, maar er
    // kan er een tegenaan staan. Dan is het geld teruggedraaid en is er niets meer te vorderen —
    // en nergens in dit product wordt de status van het origineel op 'credited' gezet, dus geen
    // enkele eerdere controle ziet dat.
    //
    // De vraag staat hier, vlak vóór de claim: een weigering mag geen herinneringsregel verbruiken.
    // Faalt de query, dan gaat er GEEN mail — hetzelfde 'bij twijfel niets' dat de rest van deze
    // route al aanhoudt, want de fout die wij hier kunnen maken zit bij de klant van de ondernemer.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: tegenCreditnota, error: creditErr } = await (pipeline as any)
      .from('invoices')
      .select('id')
      .eq('sender_id', ownerId)
      .eq('invoice_type', 'creditnota')
      .eq('original_invoice_id', id)
      .limit(1)
      .maybeSingle()
    if (creditErr) {
      console.error('[CREDITNOTA-NO-CHASE] creditnota-controle mislukt — niets verstuurd', { id, creditErr })
      return NextResponse.json({ error: 'Herinneren lukte niet — probeer het zo nog eens' }, { status: 503 })
    }
    if (tegenCreditnota) {
      return NextResponse.json(
        { error: 'Er staat een creditnota tegenover deze factuur — er valt niets meer te vorderen.' },
        { status: 409 },
      )
    }

    // ── Claim vóór de mail ──────────────────────────────────────────────────
    // Zelfde volgorde als bij SnelStart: het onomkeerbare (een mail bij een klant) gebeurt pas
    // nadat het spoor vaststaat. Andersom kan een dubbele tik twee mails opleveren waarvan er
    // één nergens staat.
    const offset = nextManualOffset(rijen.map((r) => r.day_offset))
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
      console.error('[ACTING-FOR] herinnering claimen mislukt', { claimErr, id })
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
        openstaand: outstandingAmount(inv as any),
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
      console.error('[ACTING-FOR] herinnering versturen mislukt', { id, error: String(e) })
      return NextResponse.json({ error: 'De herinnering kon niet worden verstuurd — probeer opnieuw' }, { status: 502 })
    }

    // [DEBITEUREN] Stuurde de BOEKHOUDER hem, dan moet de ondernemer het weten. Aan de andere kant
    // van die mail zit ZIJN klant, en de relatie die eronder lijdt is de zijne. Hij hoort niet pas
    // bij het volgende telefoontje te horen dat er is aangedrongen — dan is het zijn probleem
    // geworden zonder dat hij erbij was. Best-effort: de mail is al weg.
    if (acting.role === 'boekhouder') {
      try {
        await notifyRow({
          user_id: ownerId,
          title: 'Je boekhouder heeft een herinnering gestuurd',
          body: `${inv.client_name?.trim() || 'Je klant'} is herinnerd aan factuur ${inv.invoice_number?.trim() || '—'}. Dit was herinnering ${geslaagd.length + 1}.`,
          type: 'invoice',
          read: false,
          link: '/dashboard/facturen',
        })
      } catch (e) {
        console.error('[DEBITEUREN] melding aan de ondernemer mislukt', { id, error: String(e) })
      }
    }

    await logAuditAction({
      userId: acting.actorId,
      action: 'invoice.reminder_sent',
      entityType: 'invoice',
      entityId: id,
      newValue: { to: inv.client_email, offset, namens: isActingForOther(acting) ? ownerId : null },
      ipAddress: getClientIP(request),
    }).catch(() => {})

    return NextResponse.json({ ok: true, verstuurd: geslaagd.length + 1 })
  } catch (e) {
    console.error('[ACTING-FOR] /api/invoice/[id]/reminder', e)
    return NextResponse.json({ error: 'Server fout' }, { status: 500 })
  }
}
