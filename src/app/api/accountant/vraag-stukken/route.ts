// src/app/api/accountant/vraag-stukken/route.ts
// [OPVRAGEN] De boekhouder vraagt zijn klant om de stukken die nog ontbreken.
//
// WAAROM HIER GEEN MANDAAT VOOR NODIG IS
// Dit is de ene handeling in het portaal die NIET namens de klant gebeurt. De boekhouder praat
// hier met zijn eigen klant, onder zijn eigen naam — er gaat niets uit onder diens BTW-nummer en
// er wordt niets aan diens boeken veranderd. De grens is dus de KOPPELING, precies zoals bij een
// gewoon bericht (/api/messages). Het factuurmandaat er alsnog voor eisen zou de nuttigste en
// onschuldigste functie in het portaal achter de zwaarste toestemming zetten.
//
// WAAROM DIT GEEN TWEEDE BERICHTENSYSTEEM IS
// Het bericht landt in dezelfde `messages`-tabel, met dezelfde melding en dezelfde e-mail als een
// handmatig bericht. De klant heeft één inbox, en een "verzoek" dat ergens anders terechtkomt is
// een verzoek dat hij mist. Wat deze route toevoegt is uitsluitend de TEKST: specifiek, met de
// gaten erin die de app al kent (document-request.ts).
//
// WAT DE ROUTE NIET DOET
// Hij controleert niet of de gevraagde punten "echt" ontbreken. Dat is met opzet: het bericht is
// van de BOEKHOUDER, niet van BoekBrug — hij ondertekent het en hij is er verantwoordelijk voor,
// net als bij elk ander bericht dat hij typt. De tekst zegt daarom "dit is wat ik in BoekBrug zie
// ontbreken" en nergens "BoekBrug heeft vastgesteld dat". Zou de app het namens zichzelf beweren,
// dan moest het hier opnieuw worden berekend — en dan nog kon het niet waar zijn, want een bon die
// nooit is geüpload is voor ons onzichtbaar.

import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase-server'
import { createPipelineClient } from '@/lib/supabase-pipeline'
import { createNotification } from '@/lib/notifications'
import { sendMessageNotification } from '@/lib/email'
import { appUrl } from '@/lib/app-origin'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { buildDocumentRequest, requestSummary, type RequestItem } from '@/lib/document-request'
import { logAuditAction, getClientIP } from '@/lib/audit'

export const dynamic = 'force-dynamic'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function POST(request: NextRequest) {
  try {
    const supabase = await createServerSupabaseClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Niet ingelogd.' }, { status: 401 })

    // Op de MENS: dit hek gaat over snelheid. Een boekhouder met acht klanten hoort er acht op
    // een ochtend te kunnen sturen, en daarna niet meer honderd.
    const limit = await checkRateLimit({
      userId: user.id,
      endpoint: '/api/accountant/vraag-stukken',
      ...RATE_LIMITS.ACCOUNTANT_INVITE,
    })
    if (!limit.allowed) return rateLimitResponse(limit)

    const body = await request.json().catch(() => null)
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'Ongeldig verzoek' }, { status: 400 })
    }

    const klantId = typeof body.clientId === 'string' ? body.clientId : ''
    if (!UUID.test(klantId)) {
      return NextResponse.json({ error: 'Ongeldige klant' }, { status: 400 })
    }

    // De koppeling is de grens. Zelfde controle als /api/messages, en om dezelfde reden IN CODE:
    // klantId belandt zo nooit in een PostgREST-filter waar hij extra syntax kan injecteren.
    const { data: mijnLinks } = await supabase
      .from('accountant_clients')
      .select('accountant_id, zzper_id')
      .eq('accountant_id', user.id)
    const gekoppeld = (mijnLinks ?? []).some((l) => l.zzper_id === klantId)
    if (!gekoppeld) {
      return NextResponse.json(
        { error: 'Je kunt alleen stukken opvragen bij een gekoppelde klant' },
        { status: 403 },
      )
    }

    // ── De tekst ─────────────────────────────────────────────────────────────
    const ruw: unknown = body.items
    const items: RequestItem[] = Array.isArray(ruw)
      ? ruw
          .filter((i): i is Record<string, unknown> => !!i && typeof i === 'object')
          .map((i) => ({
            title: typeof i.title === 'string' ? i.title : '',
            detail: typeof i.detail === 'string' ? i.detail : null,
          }))
          // Harde bovengrens vóór de pure module, zodat een verzoek met tienduizend punten niet
          // eerst helemaal wordt opgebouwd om daarna te worden geweigerd.
          .slice(0, 50)
      : []

    const pipeline = createPipelineClient()
    const { data: ikProfiel } = await pipeline
      .from('profiles')
      .select('full_name, company_name, email')
      .eq('id', user.id)
      .maybeSingle()

    const mijnNaam = ikProfiel?.company_name || ikProfiel?.full_name || ''
    if (!mijnNaam) {
      // Een verzoek ondertekend door niemand is een verzoek dat de klant niet vertrouwt.
      return NextResponse.json(
        { error: 'Vul eerst je naam of bedrijfsnaam in bij Instellingen — het bericht wordt ermee ondertekend.' },
        { status: 409 },
      )
    }

    const opgebouwd = buildDocumentRequest({
      items,
      quarterLabel: typeof body.quarterLabel === 'string' ? body.quarterLabel : '',
      accountantName: mijnNaam,
      extra: typeof body.extra === 'string' ? body.extra : null,
    })
    if (!opgebouwd.ok) {
      return NextResponse.json({ error: opgebouwd.reason }, { status: 400 })
    }

    // ── Versturen, langs precies dezelfde weg als een gewoon bericht ──────────
    const { data: bericht, error: berichtErr } = await supabase
      .from('messages')
      .insert({ sender_id: user.id, receiver_id: klantId, content: opgebouwd.text, read: false })
      .select('id')
      .single()

    if (berichtErr || !bericht) {
      console.error('[OPVRAGEN] bericht opslaan mislukt', { berichtErr })
      return NextResponse.json({ error: 'Versturen mislukt. Probeer het opnieuw.' }, { status: 500 })
    }

    const kop = requestSummary(items.length, typeof body.quarterLabel === 'string' ? body.quarterLabel : '')

    // notifications heeft geen INSERT-policy voor een sessie — via service_role, zoals overal.
    const melding = await createNotification({
      userId: klantId,
      title: kop,
      // De eerste regels van het bericht zelf: de klant ziet meteen waar het over gaat in plaats
      // van "Nieuw bericht".
      body: opgebouwd.text.slice(0, 140),
      type: 'message',
      link: `/dashboard/messages/${user.id}`,
    })
    if (!melding.ok) console.error('[OPVRAGEN] melding mislukt', { error: melding.error })

    // De e-mail is niet blokkerend: het bericht staat al in zijn inbox in de app.
    const { data: klantProfiel } = await pipeline
      .from('profiles')
      .select('email, full_name')
      .eq('id', klantId)
      .maybeSingle()

    if (klantProfiel?.email) {
      sendMessageNotification({
        toEmail: klantProfiel.email,
        receiverName: klantProfiel.full_name || 'Ondernemer',
        senderName: mijnNaam,
        messagePreview: opgebouwd.text.slice(0, 200),
        conversationUrl:
          appUrl(process.env, `/dashboard/messages/${user.id}`, new URL(request.url).origin) ?? '',
      }).catch((e) => console.error('[OPVRAGEN] e-mail mislukt', e))
    }

    await logAuditAction({
      userId: user.id,
      action: 'accountant.documents_requested',
      entityType: 'message',
      entityId: bericht.id,
      newValue: {
        client_id: klantId,
        quarter: typeof body.quarterLabel === 'string' ? body.quarterLabel : null,
        item_count: items.length,
      },
      ipAddress: getClientIP(request),
    }).catch(() => {})

    return NextResponse.json({ ok: true, itemCount: items.length })
  } catch (e) {
    console.error('[OPVRAGEN] /api/accountant/vraag-stukken', e)
    return NextResponse.json({ error: 'Server fout' }, { status: 500 })
  }
}
