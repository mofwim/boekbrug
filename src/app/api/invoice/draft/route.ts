// src/app/api/invoice/draft/route.ts
// [ACTING-FOR] De ENIGE plek waar een conceptfactuur ontstaat.
//
// WAAROM DEZE ROUTE BESTAAT
// Tot nu toe schreef de browser de factuur zelf: `supabase.from('invoices').insert({ sender_id:
// user.id, ... })`, met de totalen die de pagina had uitgerekend. Zolang er één mens per
// boekhouding was, kon je daarmee hooguit jezelf voorliegen.
//
// Met een verkoopmedewerker erbij klopt dat niet meer. Zijn `user.id` is NIET de eigenaar van de
// boekhouding, en zou hij onder zijn eigen id boeken dan liepen er twee nummerreeksen onder één
// BTW-nummer — Art. 35 Wet OB eist doorlopende nummering zonder gaten, en een uitgegeven nummer
// is niet terug te draaien. De server moet dus bepalen wie de eigenaar is, niet de pagina.
//
// WAT ER VOOR EEN EIGENAAR VERANDERT: NIETS.
// Voor iemand zonder koppeling is ownerId gelijk aan zijn eigen id, en de rekensom in
// draft-totals.ts is letterlijk dezelfde als die in de pagina stond — inclusief het niet
// afronden. Dezelfde rij, dezelfde centen.

import { NextRequest, NextResponse } from 'next/server'
// [REGEL-AFRONDING] Dezelfde afronding als de PUT-route — zie de regel hieronder.
import { round2 } from '@/lib/invoice-totals'
import { createPipelineClient } from '@/lib/supabase-pipeline'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { getActingFor, getActingForClient } from '@/lib/acting-for-server'
import { invoiceOwnerId, invoiceCreatedBy, isActingForOther } from '@/lib/acting-for'
import { computeDraftTotals, validateDraftLines } from '@/lib/draft-totals'
import { checkInvoiceDates } from '@/lib/invoice-dates'
import { parseDiscount } from '@/lib/invoice-discount'
// [UNIT] Alleen eenheden die de app kent belanden in de database. Vrije tekst uit een
// gemanipuleerd verzoek hoort niet op een factuurregel die straks een e-factuur wordt.
import { isKnownUnit } from '@/lib/units'
// [ACTING-FOR] created_by bestaat pas ná company_members_sales_role.sql. Zonder deze terugval faalt
// de INSERT hieronder met PGRST204 op een installatie waar de migratie nog open staat — en dan
// kan er GEEN FACTUUR MEER WORDEN AANGEMAAKT. Zie de kop van created-by.ts.
import { writeWithTrail } from '@/lib/created-by'
// [ARTIKEL-LEREN] Eén module voor beide deuren (deze en het bewerkscherm) — twee kopieën van
// dezelfde regel lopen uit elkaar zonder dat er iets rood wordt.
import { learnFromLines } from '@/lib/article-learning-store'
// [KLANT-EXTRA] Twee vrije klantregels onder de klantnaam — zie de kop van dat bestand.
import { extraLineFields } from '@/lib/client-extra-lines-write'
import { CLIENT_EXTRA_LINE_COLUMNS } from '@/lib/client-extra-lines'

export const dynamic = 'force-dynamic'

type Soort = 'factuur' | 'creditnota' | 'offerte'


/**
 * De eenheid van één regel, of null.
 *
 * Alleen wat de app KENT komt erdoor. Een onbekend woord wordt null in plaats van te worden
 * opgeslagen: het zou bij de UBL-export toch op C62 uitkomen, en dan staat er in de database een
 * eenheid die nergens iets doet — precies het soort veld waarvan later niemand meer weet of het
 * betekenis heeft.
 */
function schoonEenheid(v: unknown): string | null {
  const s = typeof v === 'string' ? v.trim() : ''
  return s && isKnownUnit(s) ? s : null
}

const DB_TYPE: Record<Soort, string> = {
  factuur: 'factuur',
  creditnota: 'creditnota',
  // Een offerte is nog geen factuur: hij leeft als pro_forma tot hij wordt omgezet.
  offerte: 'pro_forma',
}

export async function POST(request: NextRequest) {
  try {
    // [MANDAAT] `namensKlantId` in de body is het ENIGE verschil met vroeger: staat hij er niet,
    // dan is dit letterlijk de oude route. Staat hij er wel, dan moet de beller een boekhouder zijn
    // met een levend mandaat van precies die klant — anders 403, nooit een terugval op "dan maar
    // voor jezelf". Zie accountant-mandate.ts.
    const voorbody = await request.json().catch(() => null)
    if (!voorbody || typeof voorbody !== 'object') {
      return NextResponse.json({ error: 'Ongeldig verzoek' }, { status: 400 })
    }
    const namensKlantId =
      typeof voorbody.namens_klant_id === 'string' && voorbody.namens_klant_id
        ? voorbody.namens_klant_id
        : null

    const acting = namensKlantId ? await getActingForClient(namensKlantId) : await getActingFor()
    if (!acting) {
      return namensKlantId
        ? NextResponse.json(
            { error: 'Je hebt geen toestemming om namens deze klant te factureren' },
            { status: 403 },
          )
        : NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const limit = await checkRateLimit({
      userId: acting.actorId,
      endpoint: '/api/invoice/draft',
      ...RATE_LIMITS.INVOICE_SEND,
    })
    if (!limit.allowed) return rateLimitResponse(limit)

    const body = voorbody

    const soort: Soort =
      body.invoiceType === 'creditnota' ? 'creditnota' : body.invoiceType === 'offerte' ? 'offerte' : 'factuur'

    // ── De regels, gecontroleerd vóór ze de database raken ───────────────────
    // [MIN-REGEL] `soort` comes with them: a creditnota's lines are sent POSITIVE here and the sign
    // is applied below, so on this route the exemption changes nothing today — it is passed because
    // the rule is about which document this is, and a route that answers that question by accident
    // is one refactor away from answering it wrong.
    const gecontroleerd = validateDraftLines(body.lines, soort)
    if (!gecontroleerd.ok) {
      // The reason travelled in `fouten` and no screen reads that array, so every rejection here
      // said "De regels kloppen niet" and stopped — the owner was told the lines were wrong and
      // never which line, or why. Both facts are already in the error; this only says one out loud.
      const eerste = gecontroleerd.errors[0]
      const waar = eerste.index >= 0 ? `Regel ${eerste.index + 1}: ` : ''
      return NextResponse.json(
        { error: `${waar}${eerste.reason}.`, fouten: gecontroleerd.errors },
        { status: 400 }
      )
    }
    const sign = soort === 'creditnota' ? -1 : 1
    // [KORTING] De korting komt uit het verzoek en wordt hier GEVALIDEERD, niet vertrouwd. Een
    // browser die "150%" of een negatief bedrag stuurt, hoort geen factuur op te leveren waarvan
    // het totaal nergens op slaat — parseDiscount geeft dan null en de factuur is er gewoon zonder.
    const korting = parseDiscount(body.discount_type, body.discount_value)
    const totalen = computeDraftTotals(gecontroleerd.lines, sign, korting)

    // [FACTUUR-DATUMS] Een vervaldatum vóór de factuurdatum maakt een factuur die al verlopen is op
    // het moment dat hij wordt verstuurd — de herinneringscron leidt zijn trap af van due_date, dus
    // de klant krijgt de factuur en de aanmaning zo ongeveer tegelijk.
    const datums = checkInvoiceDates({
      invoiceDate: typeof body.invoice_date === 'string' ? body.invoice_date : null,
      dueDate: typeof body.due_date === 'string' ? body.due_date : null,
    })
    if (!datums.ok) {
      return NextResponse.json({ error: datums.error, code: datums.code }, { status: 400 })
    }

    const klantNaam = typeof body.client_name === 'string' ? body.client_name.trim() : ''
    if (!klantNaam) {
      return NextResponse.json({ error: 'Een factuur zonder klant kan niet' }, { status: 400 })
    }

    const ownerId = invoiceOwnerId(acting)
    const createdBy = invoiceCreatedBy(acting)

    // service_role: de browser mag sender_id en created_by niet kiezen. Dat is het hele punt van
    // deze route — RLS zou een INSERT met een zelfgekozen sender_id namelijk gewoon toestaan als
    // die gelijk is aan auth.uid(), en dat is precies de verkeerde eigenaar.
    const pipeline = createPipelineClient()

    // ── De klant ─────────────────────────────────────────────────────────────
    // Een klant die inline is ingetikt (geen keuze uit de lijst) wordt hier aangemaakt, onder de
    // eigenaar. created_by houdt bij wie hem invoerde — dat is de leesgrens van een medewerker.
    let clientId: string | null = typeof body.client_id === 'string' && body.client_id ? body.client_id : null
    if (clientId) {
      // Een meegestuurd id moet wél van dit bedrijf zijn. Zonder deze controle kon een geraden
      // uuid een factuur aan de klant van een ander koppelen.
      const { data: bestaand } = await pipeline
        .from('clients')
        .select('id')
        .eq('id', clientId)
        .eq('user_id', ownerId)
        .maybeSingle()
      if (!bestaand) clientId = null
    }
    if (!clientId) {
      const { data: nieuw } = await writeWithTrail<{ id: string }>(
        (spoor) => pipeline
          .from('clients')
          .insert({
            user_id: ownerId,
            name: klantNaam,
            email: body.client_email || null,
            address: body.client_address || null,
            postal_code: body.client_postal_code || null,
            city: body.client_city || null,
            btw_number: body.client_btw_number || null,
            ...spoor,
          })
          .select('id')
          .single(),
        { created_by: createdBy },
      )
      clientId = nieuw?.id ?? null
    }

    // ── De factuur ───────────────────────────────────────────────────────────
    // [KORTING] De kortingskolommen bestaan pas ná invoice_discount.sql. Meesturen op een database
    // zonder die kolommen laat de HELE insert falen (PGRST204) — en dat is het aanmaken van elke
    // factuur, voor iedereen, precies de ramp die created-by.ts in zijn kop beschrijft.
    //
    // Dus: mét korting proberen, en zonder als de kolommen er niet zijn. Maar dan MOETEN de totalen
    // mee terug. Een factuur met verlaagde bedragen en geen opgeslagen korting is een document dat
    // niet optelt tegen zijn eigen regels — erger dan geen korting. In de terugval staat de factuur
    // er dus voor de VOLLE prijs, en het antwoord zegt dat, zodat de ondernemer het weet in plaats
    // van het te ontdekken op de PDF die zijn klant al heeft.
    const zonderKorting = computeDraftTotals(gecontroleerd.lines, sign, null)
    const { data: factuur, error: insertErr, trailWritten } = await writeWithTrail<{ id: string }>(
      (spoor) => pipeline
      .from('invoices')
      .insert({
        sender_id: ownerId,
        // [FACTUUR-A] Altijd null bij het aanmaken — het nummer wordt op de send-route geslagen
        // (Art. 35). Een browser heeft nooit een factuurnummer mogen bedenken, en nu ook een
        // medewerker niet.
        invoice_number: null,
        invoice_date: body.invoice_date || null,
        due_date: body.due_date || null,
        delivery_date: soort === 'factuur' ? (body.delivery_date || body.invoice_date || null) : null,
        status: 'draft',
        invoice_type: DB_TYPE[soort],
        direction: 'outgoing',
        // [KORTING] De totalen en de korting reizen SAMEN. `spoor` is leeg zodra de terugval van
        // writeWithTrail heeft toegeslagen, en dan hoort ook de verlaging van tafel.
        ...(korting && Object.keys(spoor).length ? totalen : zonderKorting),
        source: 'created',
        // Wat de ondernemer AFSPRAK, niet wat het toevallig opleverde. "10%" en "€ 200" zijn op
        // deze factuur hetzelfde bedrag en op de volgende niet; alleen het bedrag bewaren maakt
        // het document onreproduceerbaar zodra er een regel bij komt.
        ...(korting && Object.keys(spoor).length
          ? { discount_type: korting.type, discount_value: korting.value }
          : {}),
        client_name: klantNaam,
        client_id: clientId,
        client_email: body.client_email || null,
        client_address: body.client_address || null,
        client_postal_code: body.client_postal_code || null,
        client_city: body.client_city || null,
        client_btw_number: body.client_btw_number || null,
        original_invoice_id: soort === 'creditnota' ? null : (body.replaces_id || null),
        ...spoor,
        // [KORTING] De rij-brede `as any` die hier stond is weg: invoice_discount.sql is gedraaid en
        // discount_type/discount_value staan in de types. Die cast dekte de HELE rij, niet alleen
        // de twee nieuwe kolommen — op een insert waar bedragen, eigenaar en factuursoort in staan.
        // Zolang een kolom nog niet bestond was dat de prijs; nu niet meer, dus hij gaat eraf.
        //
        // De terugval eromheen blijft wél staan: hij is gedeeld met created_by en beschermt elke
        // installatie waar een migratie nog open staat.
      })
      .select('id')
      .single(),
      // [KORTING] De kortingskolommen reizen mee in dezelfde terugval als created_by: mist één
      // van de drie, dan wordt de rij zonder alle drie geschreven. Grover dan nodig, en met opzet —
      // één terugval die je kunt navertellen is veiliger dan drie die elkaar kruisen. `trailWritten`
      // is precies het signaal: false betekent dat de tweede poging is gebruikt.
      { created_by: createdBy },
    )

    if (insertErr || !factuur) {
      console.error('[ACTING-FOR] concept aanmaken mislukt', { insertErr, ownerId, namens: isActingForOther(acting) })
      return NextResponse.json({ error: 'Aanmaken mislukt — probeer opnieuw' }, { status: 500 })
    }

    // ── [KLANT-EXTRA] De twee vrije klantregels, in een EIGEN schrijfbeurt ───
    //
    // Bewust NIET in de insert hierboven en ook niet in het spoor ernaast. Zou een onbekende kolom
    // die insert laten mislukken, dan valt writeWithTrail terug op een poging ZONDER spoor — en
    // dan verliest deze factuur ook created_by, de vastlegging van wie hem namens wie heeft
    // aangemaakt. Twee adresregels mogen dat spoor niet meenemen in hun val.
    //
    // Dus: de factuur staat er al, en dit is een aparte update die mag mislukken. Kost één extra
    // rondje, en alleen wanneer de ondernemer de velden ook echt heeft ingevuld.
    const extraLines = extraLineFields(...CLIENT_EXTRA_LINE_COLUMNS.map((c) => body[c]))
    if (CLIENT_EXTRA_LINE_COLUMNS.some((c) => extraLines[c])) {
      const { error: extraErr } = await pipeline
        .from('invoices')
        .update(extraLines as never)
        .eq('id', factuur.id)
        .eq('sender_id', ownerId)
      if (extraErr) {
        // Luid, want dit is tijdelijk: het betekent dat de migratie nog open staat. Het concept
        // zelf staat er, met alle bedragen — wat ontbreekt zijn de twee regels onder de klantnaam.
        console.warn('[KLANT-EXTRA] de twee klantregels konden niet worden opgeslagen — pas ' +
          'supabase/migrations/client_extra_lines.sql toe', { invoiceId: factuur.id, error: extraErr.message })
      }
    }

    // ── De regels ────────────────────────────────────────────────────────────
    const bron = body.lines as Array<Record<string, unknown>>
    // [UNIT] `unit` komt uit migratie invoice_line_unit.sql en gaat via dezelfde terugval
    // als created_by: bestaat de kolom nog niet, dan worden de regels ZONDER eenheid geschreven
    // in plaats van dat het aanmaken van de factuur helemaal faalt (PGRST204). Wat je dan mist is
    // de juiste eenheidscode in de e-factuur, niet de factuur zelf.
    const { error: lineErr } = await writeWithTrail(
      (spoor) => pipeline.from('invoice_lines').insert(
        gecontroleerd.lines.map((l, i) => ({
          invoice_id: factuur.id,
          description: String(bron[i]?.description ?? '').trim(),
          quantity: sign * l.quantity,
          unit_price: l.unit_price,
          btw_rate: l.btw_rate,
          // [REGEL-AFRONDING] Afgerond, net als de PUT-route en de gratis generator.
          //
          // Zonder dit staat 1,5 uur x EUR 33,33 als 49,995 in de kolom (invoice_lines.line_total
          // is numeric ZONDER schaal, dus het wordt letterlijk zo bewaard). De PDF drukt dan twee
          // regels van EUR 50,00 met een subtotaal van EUR 99,99: de klant telt 50 + 50 op en de
          // factuur zegt iets anders.
          //
          // In de UBL-export is het erger dan lelijk. Elke InvoiceLine krijgt round2(line_total) =
          // 50,00 terwijl LegalMonetaryTotal de som van de RUWE waarden afrondt tot 99,99. Peppol
          // BIS 3.0 regel BR-CO-10 eist dat die twee gelijk zijn, dus het e-factuurbestand wordt
          // bij het ontvangende access point geweigerd — de factuur komt niet aan.
          //
          // En het bedrag hing af van de route: dezelfde factuur via het bewerkscherm opgeslagen
          // kwam er wél op EUR 121,00 uit, omdat de PUT per regel afrondt. Twee wegen naar hetzelfde
          // document met twee verschillende totalen is precies wat een boekhouder niet kan uitleggen.
          line_total: round2(sign * l.quantity * l.unit_price),
          // De eenheid hoort bij de regel, dus per regel — niet één keer voor de hele factuur.
          ...(Object.keys(spoor).length
            ? {
                unit: schoonEenheid(bron[i]?.unit),
                // [VRIJGESTELD] Alleen de letterlijke waarde 'exempt' telt; al het andere is
                // NULL = gewoon belast. Zo kan een oude of vreemde client deze kolom niet
                // gebruiken om omzet uit de aangifte te laten verdwijnen.
                vat_treatment: bron[i]?.vat_treatment === 'exempt' ? 'exempt' : null,
              }
            : {}),
        })),
      ),
      // De sleutel is een vlag: is hij aanwezig, dan worden `unit` en `vat_treatment` per regel
      // meegeschreven. Ze reizen samen omdat writeWithTrail één terugval kent: mist één van de
      // twee kolommen, dan worden de regels zonder allebei geschreven — een factuur zonder
      // eenheid of zonder vrijstellingsvlag, nooit helemaal geen factuur.
      { unit: true },
    )
    if (lineErr) {
      // Een factuurkop zonder regels is erger dan geen factuur: hij telt mee in overzichten en
      // is leeg als je hem opent. Terugdraaien, en eerlijk melden dat het niet lukte.
      await pipeline.from('invoices').delete().eq('id', factuur.id)
      console.error('[ACTING-FOR] regels wegschrijven mislukt — concept teruggedraaid', { lineErr })
      return NextResponse.json({ error: 'Aanmaken mislukt — probeer opnieuw' }, { status: 500 })
    }

    // [ARTIKEL-LEREN] Wat de ondernemer hier typt, onthoudt de catalogus — vanaf de EERSTE factuur.
    // Tot nu toe vulde die catalogus zich alleen als je hem al kende: via /dashboard/artikelen, of
    // via het kleine "bewaar in catalogus"-knopje naast een regel. Wie dat niet wist, typte regel
    // twintig nog steeds met de hand en trof een lege suggestielijst aan.
    //
    // Nooit een reden om de factuur te laten mislukken: de factuur en haar regels staan hier al, en
    // de catalogus is een hulplijst ernaast. Vandaar de eigen try/catch en de log in plaats van een
    // foutmelding — er is op dit punt niets meer aan de factuur dat nog kan misgaan.
    await learnFromLines({
      db: pipeline, ownerId, documentKind: soort,
      lines: gecontroleerd.lines.map((l, i) => ({
        description: String(bron[i]?.description ?? '').trim(),
        unit_price: l.unit_price,
        btw_rate: l.btw_rate,
        unit: schoonEenheid(bron[i]?.unit),
      })),
    })

    return NextResponse.json({
      ok: true, invoiceId: factuur.id, clientId,
      // [KORTING] Gezegd, niet verzwegen. De factuur staat er dan voor de volle prijs.
      ...(korting && !trailWritten ? { warning: 'discount_not_stored' } : {}),
    })
  } catch (e) {
    console.error('[ACTING-FOR] /api/invoice/draft', e)
    return NextResponse.json({ error: 'Server fout' }, { status: 500 })
  }
}
