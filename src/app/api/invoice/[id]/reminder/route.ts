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
import { createNotification } from '@/lib/notifications'
import { sendInvoiceReminder } from '@/lib/email'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { getActingFor, getActingForClient } from '@/lib/acting-for-server'
import { invoiceOwnerId, isActingForOther, canRemindInvoice } from '@/lib/acting-for'
import { canRemind, nextManualOffset } from '@/lib/sales-overview'
// [DEEL-CREDIT] Bedragen in plaats van ja/nee — zie de creditnota-controle verderop.
import { creditedTotalsFrom, openAfterCredit } from '@/lib/credited-invoices'
import { logAuditAction, getClientIP } from '@/lib/audit'
// [HERINNER-BEWIJS] Is the money already in the bank? Same engine, same rule, same sentence as the
// panel on the sales list — see the block just before the claim below.
import { collectOpenInvoiceProof } from '@/lib/open-invoice-proof-collect'
import { describeChaseBlock } from '@/lib/open-invoice-proof-text'
import { getServerLocale, serverTranslator } from '@/lib/i18n/server'

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
    //
    // [SPOOR-BEWIJS] De fout wordt gelezen, en dat is de hele reparatie. supabase-js geeft bij een
    // mislukte query { data: null, error } terug in plaats van te gooien, dus `eerder ?? []`
    // maakte van een databasehapering een LEEG spoor — en een leeg spoor is een toestemming:
    // canRemind telt dan nul herinneringen (het plafond van drie valt weg) en heeft geen datum om
    // de wachttijd vanaf te meten (die valt óók weg). Beide bewakers zetten zichzelf uit.
    //
    // Dat is niet theoretisch, en de UNIQUE-index vangt het maar half op. Staat er al een
    // handmatige herinnering, dan botst nextManualOffset op -1 en gaat er niets uit. Kwamen de
    // eerdere herinneringen van de CRON (offsets 14, 30), dan is -1 nog vrij: de wachttijd is
    // omzeild, de claim slaagt, en de klant die gisteren de 14-dagenherinnering kreeg krijgt er
    // vandaag nog een. Eén mail te veel bij iemand anders in de inbox, door een leesfout.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: eerder, error: spoorErr } = await (pipeline as any)
      .from('invoice_reminders')
      .select('day_offset, sent_at, status')
      .eq('invoice_id', id)
      .order('sent_at', { ascending: false })
    if (spoorErr) {
      console.error('[SPOOR-BEWIJS] herinneringsspoor onleesbaar — geen mail, geen aanname', {
        id, ownerId, error: spoorErr.message,
      })
    }
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
        // [SPOOR-BEWIJS] De twee velden hierboven zijn alleen te vertrouwen als de lezing lukte.
        // De regel weigert zelf als dat niet zo is — hier staat geen tweede versie van die regel,
        // want twee plekken die "mag dit" beantwoorden zijn er één te veel.
        reminderTrailKnown: !spoorErr,
      },
      Date.now(),
    )
    if (!oordeel.allowed) return NextResponse.json({ error: oordeel.reason }, { status: 409 })

    // [CREDITNOTA-NO-CHASE] De andere helft van het paar: deze factuur IS geen creditnota, maar er
    // kan er een tegenaan staan. Dan is het geld teruggedraaid en is er niets meer te vorderen —
    // en nergens in dit product wordt de status van het origineel op 'credited' gezet, dus geen
    // enkele eerdere controle ziet dat.
    //
    // [DEEL-CREDIT] Maar "er staat er een tegenaan" betekent niet meer "er valt niets meer te
    // vorderen". Crediteer één betwiste regel van vijf, en de andere vier zijn gewoon nog
    // verschuldigd. Deze knop weigerde daar categorisch op, terwijl de AUTOMATISCHE herinnering
    // (api/cron/reminders) al met bedragen rekent — dus stopte de ondernemer met vorderen op het
    // moment dat hij zijn klant tegemoetkwam, op een factuur die haar status en haar volle totaal
    // houdt, en zei geen enkel scherm waarom.
    //
    // De vraag staat hier, vlak vóór de claim: een weigering mag geen herinneringsregel verbruiken.
    // Faalt de query, dan gaat er GEEN mail — hetzelfde 'bij twijfel niets' dat de rest van deze
    // route al aanhoudt, want de fout die wij hier kunnen maken zit bij de klant van de ondernemer.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: creditRijen, error: creditErr } = await (pipeline as any)
      .from('invoices')
      .select('total_inc_btw')
      .eq('sender_id', ownerId)
      .eq('invoice_type', 'creditnota')
      .eq('original_invoice_id', id)
    if (creditErr) {
      console.error('[CREDITNOTA-NO-CHASE] creditnota-controle mislukt — niets verstuurd', { id, creditErr })
      return NextResponse.json({ error: 'Herinneren lukte niet — probeer het zo nog eens' }, { status: 503 })
    }
    const gecrediteerd = creditedTotalsFrom(
      ((creditRijen ?? []) as { total_inc_btw: number | null }[]).map((r) => ({
        original_invoice_id: id,
        total_inc_btw: r.total_inc_btw,
      })),
    ).get(id) ?? 0
    // Wat er ná de creditnota's én de deelbetalingen nog openstaat. Eén berekening voor twee
    // dingen: de weigering hieronder en het bedrag dat straks in de mail komt. Twee aparte
    // berekeningen zouden uit elkaar kunnen lopen, en dan vraagt de mail iets anders dan de app
    // dacht toe te staan.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const nogOpen = openAfterCredit(inv.total_inc_btw, (inv as any).amount_paid, gecrediteerd)
    if (gecrediteerd > 0 && nogOpen <= 0) {
      return NextResponse.json(
        { error: 'Er staat een creditnota tegenover deze factuur — er valt niets meer te vorderen.' },
        { status: 409 },
      )
    }

    // ── [HERINNER-BEWIJS] Is the money already sitting in the bank? ─────────
    //
    // Everything above this line asks the BOOKS whether the invoice is open — the status, the
    // amount_paid, the creditnota's. All three say "open" for the case that costs the most: the
    // customer paid, the bank line came in, and nobody has attached it to the invoice yet. The
    // books cannot see it, so no arithmetic here can, and the mail goes out to somebody who paid.
    //
    // What that costs is not a wrong number on a screen. It is the owner's relationship with the
    // person who pays them — and on the cron's last tier it is a statutory aanmaning naming
    // incassokosten, sent to a customer who owes nothing.
    //
    // So the same engine the bank screen runs is asked the reverse question, scoped to this one
    // invoice. Not a verdict: the answer comes back as a sentence with the bank line in it, and
    // the owner decides. `confirmDespiteBankMatch` is that decision, arriving on a second,
    // deliberate press — an owner who knows the payment is for something else must not be stuck.
    //
    // [NO-SILENT-EMPTY] A check that could not RUN does not block: the owner pressed the button
    // and the app has no ground to refuse them. But it may not pretend it looked either, so the
    // answer carries a warning and the screen says the comparison did not happen.
    let bankCheckFailed = false
    if (body?.confirmDespiteBankMatch !== true) {
      const bewijs = await collectOpenInvoiceProof({
        pipeline, ownerId, direction: 'outgoing', invoiceIds: [id],
      }).catch((e) => {
        console.error('[HERINNER-BEWIJS] bankcontrole mislukt — er is niets geblokkeerd', {
          id, error: e instanceof Error ? e.message : String(e),
        })
        return null
      })
      if (!bewijs || bewijs.readFailed) {
        bankCheckFailed = true
      } else if (bewijs.hits.length > 0) {
        // A refusal may not consume a reminder tier — the claim is written below this block on
        // purpose, so nothing about this invoice's trail has changed when we answer.
        return NextResponse.json(
          { error: describeChaseBlock(bewijs.hits[0], await getServerLocale()), code: 'bank_payment_found' },
          { status: 409 },
        )
      }
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
      // [ANTWOORD-ADRES] `email` erbij: een kolom die niet wordt gelezen is een reply-to die nergens
      // heen wijst — en juist op een herinnering schrijft de klant terug.
      .select('company_name, full_name, email')
      .eq('id', ownerId)
      .single()

    // [REMINDER-TRUTH] The RESULT is read, and that is the whole fix. sendInvoiceReminder returns
    // { delivered } precisely because a provider REJECTION is not an exception: deliverEmail logs
    // it, reports it, and returns false. This route awaited it and threw the answer away, so a
    // rejected address ended here — claim still on 'sent', 200 back to the screen, "verstuurd N".
    //
    // What that costs the owner is worse than a lost mail. `geslaagd` counts every row that is not
    // 'failed', and it feeds canRemind: the phantom send sets last_reminder_at to now and pushes
    // reminder_count up, so the button then REFUSES the next attempt for the whole cooling-off
    // period. Told it went out, and then blocked from sending it. Meanwhile the invoice ages toward
    // the WIK term on a letter the customer never received.
    let delivery: { delivered: boolean }
    try {
      delivery = await sendInvoiceReminder({
        toEmail: inv.client_email as string,
        clientName: inv.client_name?.trim() || 'klant',
        zzperName: eigenaarProfiel?.company_name || eigenaarProfiel?.full_name || 'BoekBrug',
        senderEmail: eigenaarProfiel?.email ?? null,
        invoiceNumber: inv.invoice_number?.trim() || '—',
        // [DEEL-CREDIT] Het bedrag dat hierboven al is uitgerekend, minus wat er is teruggegeven.
        // Het volle totaal noemen op een deels gecrediteerde factuur vraagt de klant om geld dat
        // hij zwart-op-wit heeft teruggekregen — precies het vertrouwen dat een herinnering nodig
        // heeft om te werken. Zonder creditnota is dit exact wat outstandingAmount teruggaf.
        openstaand: nogOpen,
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

    // [REMINDER-TRUTH] A REJECTION is not the ambiguous case a throw is. The provider refused the
    // message, so it demonstrably did not go out and a second attempt cannot become a second letter
    // at the customer. The claim is therefore RELEASED rather than marked 'failed' — same reasoning
    // as the cron, and here it also matters that releasing restores the button: a row left behind
    // would keep canRemind refusing on a reminder that never happened.
    if (!delivery.delivered) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error: releaseErr } = await (pipeline as any)
        .from('invoice_reminders').delete().eq('id', claim.id)
      if (releaseErr) {
        // Read, never discarded: supabase-js reports a query error in the RESULT. A release that
        // silently did not happen leaves the phantom send standing — the exact state this branch
        // exists to undo — so it has to be visible even though the answer below stays the same.
        console.error('[REMINDER-TRUTH] afgewezen herinnering NIET vrijgegeven — de knop blijft geblokkeerd', {
          id, error: releaseErr.message,
        })
      }
      console.error('[REMINDER-TRUTH] herinnering geweigerd door de mailprovider', { id })
      return NextResponse.json(
        { error: 'De herinnering is niet aangekomen — controleer het e-mailadres van je klant en probeer opnieuw' },
        { status: 502 },
      )
    }

    // [DEBITEUREN] Stuurde de BOEKHOUDER hem, dan moet de ondernemer het weten. Aan de andere kant
    // van die mail zit ZIJN klant, en de relatie die eronder lijdt is de zijne. Hij hoort niet pas
    // bij het volgende telefoontje te horen dat er is aangedrongen — dan is het zijn probleem
    // geworden zonder dat hij erbij was. Best-effort: de mail is al weg.
    if (acting.role === 'boekhouder') {
      const melding = await createNotification({
        userId: ownerId,
        title: 'Je boekhouder heeft een herinnering gestuurd',
        body: `${inv.client_name?.trim() || 'Je klant'} is herinnerd aan factuur ${inv.invoice_number?.trim() || '—'}. Dit was herinnering ${geslaagd.length + 1}.`,
        type: 'invoice',
        link: '/dashboard/facturen',
      })
      if (!melding.ok) {
        console.error('[DEBITEUREN] melding aan de ondernemer mislukt', { id, error: melding.error })
      }
    }

    await logAuditAction({
      userId: acting.actorId,
      action: 'invoice.reminder_sent',
      entityType: 'invoice',
      entityId: id,
      newValue: {
        to: inv.client_email, offset, namens: isActingForOther(acting) ? ownerId : null,
        // [HERINNER-BEWIJS] Two facts an accountant would want months later, and neither is
        // reconstructable from the invoice: that the owner overrode a found bank payment, and that
        // the comparison could not be made at all. Both are ordinary, defensible choices — which
        // is exactly why they belong in the trail rather than in nobody's memory.
        ...(body?.confirmDespiteBankMatch === true ? { despiteBankMatch: true } : {}),
        ...(bankCheckFailed ? { bankCheckFailed: true } : {}),
      },
      ipAddress: getClientIP(request),
    }).catch(() => {})

    // [NO-SILENT-EMPTY] The reminder went out; whether it SHOULD have was not fully checked.
    // Saying so is the difference between a product that is careful and one that looks careful.
    return NextResponse.json({
      ok: true,
      verstuurd: geslaagd.length + 1,
      ...(bankCheckFailed ? { warning: (await serverTranslator())('bewijs.herinner.nietGecontroleerd') } : {}),
    })
  } catch (e) {
    console.error('[ACTING-FOR] /api/invoice/[id]/reminder', e)
    return NextResponse.json({ error: 'Server fout' }, { status: 500 })
  }
}
