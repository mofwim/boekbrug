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
import { createPipelineClient } from '@/lib/supabase-pipeline'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { getActingFor, getActingForClient } from '@/lib/acting-for-server'
import { invoiceOwnerId, invoiceCreatedBy, isActingForOther } from '@/lib/acting-for'
import { computeDraftTotals, validateDraftLines } from '@/lib/draft-totals'
// [UNIT] Alleen eenheden die de app kent belanden in de database. Vrije tekst uit een
// gemanipuleerd verzoek hoort niet op een factuurregel die straks een e-factuur wordt.
import { isKnownUnit } from '@/lib/units'
// [ACTING-FOR] created_by bestaat pas ná company_members_sales_role.sql. Zonder deze terugval faalt
// de INSERT hieronder met PGRST204 op een installatie waar de migratie nog open staat — en dan
// kan er GEEN FACTUUR MEER WORDEN AANGEMAAKT. Zie de kop van created-by.ts.
import { writeWithTrail } from '@/lib/created-by'

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
    const gecontroleerd = validateDraftLines(body.lines)
    if (!gecontroleerd.ok) {
      return NextResponse.json({ error: 'De regels kloppen niet', fouten: gecontroleerd.errors }, { status: 400 })
    }
    const sign = soort === 'creditnota' ? -1 : 1
    const totalen = computeDraftTotals(gecontroleerd.lines, sign)

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
    const { data: factuur, error: insertErr } = await writeWithTrail<{ id: string }>(
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
        ...totalen,
        source: 'created',
        client_name: klantNaam,
        client_id: clientId,
        client_email: body.client_email || null,
        client_address: body.client_address || null,
        client_postal_code: body.client_postal_code || null,
        client_city: body.client_city || null,
        client_btw_number: body.client_btw_number || null,
        original_invoice_id: soort === 'creditnota' ? null : (body.replaces_id || null),
        ...spoor,
      })
      .select('id')
      .single(),
      { created_by: createdBy },
    )

    if (insertErr || !factuur) {
      console.error('[ACTING-FOR] concept aanmaken mislukt', { insertErr, ownerId, namens: isActingForOther(acting) })
      return NextResponse.json({ error: 'Aanmaken mislukt — probeer opnieuw' }, { status: 500 })
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
          line_total: sign * l.quantity * l.unit_price,
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

    return NextResponse.json({ ok: true, invoiceId: factuur.id, clientId })
  } catch (e) {
    console.error('[ACTING-FOR] /api/invoice/draft', e)
    return NextResponse.json({ error: 'Server fout' }, { status: 500 })
  }
}
