// src/app/api/clients/route.ts
// [ACTING-FOR] Klanten aanmaken en bijwerken — de server bepaalt onder wie ze vallen.
//
// Zelfde reden als /api/invoice/draft: de pagina schreef `user_id: profile.id`, oftewel de
// INGELOGDE mens. Dat klopt zolang dat de eigenaar is, en is fout zodra een verkoopmedewerker
// het scherm gebruikt — dan zou zijn klant onder zijn eigen (lege) administratie belanden, of
// door de RLS-policy worden geweigerd met een kale "Opslaan mislukt".
//
// De klant hoort bij het BEDRIJF. Wie hem invoerde staat in created_by, en dat is meteen de
// leesgrens van een medewerker: hij ziet de klanten die hij zelf aanmaakte, niet het
// klantenbestand van zijn baas.

import { NextRequest, NextResponse } from 'next/server'
import { createPipelineClient } from '@/lib/supabase-pipeline'
import { getActingFor } from '@/lib/acting-for-server'
import { invoiceOwnerId, invoiceCreatedBy } from '@/lib/acting-for'
// [ACTING-FOR] created_by bestaat pas ná de migratie — zonder deze terugval kan er op een
// installatie met een openstaande migratie geen klant meer worden toegevoegd.
import { writeWithTrail, isUnknownColumn } from '@/lib/created-by'
// [BESTE] work_items may not exist on an installation behind on migrations — that is no reason to
// refuse a delete, and every other error is.
import { isMissingRelation } from '@/lib/pg-missing'
// [BESTE] The agreed term is a whole number of days within the typo guard, or nothing.
import { parsePaymentTerm } from '@/lib/payment-term'
// [KLANT-LAND] ISO country code, two letters or nothing (client_country.sql).
import { normalizeCountry } from '@/lib/client-country'
// [CENT] One rounding for the whole app — an hourly rate is money on a future invoice line.
import { round2 } from '@/lib/invoice-totals'

export const dynamic = 'force-dynamic'

/** De velden die een klantformulier stuurt. Alles optioneel behalve de naam. */
function velden(body: Record<string, unknown>) {
  const tekst = (v: unknown) => {
    const s = typeof v === 'string' ? v.trim() : ''
    return s === '' ? null : s
  }
  return {
    name: tekst(body.name),
    email: tekst(body.email),
    kvk_number: tekst(body.kvk_number),
    btw_number: tekst(body.btw_number),
    iban: tekst(body.iban),
    address: tekst(body.address),
    postal_code: tekst(body.postal_code),
    city: tekst(body.city),
    // [BESTE] Phone and the payment term agreed with this customer (clients_term_phone.sql).
    phone: tekst(body.phone),
    payment_term_days: parsePaymentTerm(body.payment_term_days),
    // [KLANT-LAND] The country as a code; anything that is not one is refused by landOngeldig below,
    // never stored as a guess.
    country: normalizeCountry(body.country),
    // [TARIEF-KLANT] Het afgesproken uurtarief, ex btw. Onleesbaar of negatief wordt null: een
    // tarief dat de app zelf verzint is erger dan een leeg veld, want het belandt op een factuur.
    default_hourly_rate: uurtarief(body.default_hourly_rate),
  }
}

/** [TARIEF-KLANT] A rate is a number of at least zero, or nothing at all. */
function uurtarief(raw: unknown): number | null {
  if (raw === null || raw === undefined || String(raw).trim() === '') return null
  const n = Number(String(raw).replace(',', '.'))
  // [CENT] The app has one rounding, and a rate that ends up on an invoice line uses it.
  return Number.isFinite(n) && n >= 0 ? round2(n) : null
}

/** Typed a country that is not a two-letter code: say so, do not save a customer without it. */
function landOngeldig(body: Record<string, unknown>, v: { country: string | null }): boolean {
  return typeof body.country === 'string' && body.country.trim() !== '' && v.country === null
}
// Dutch: this sentence goes to the screen.
const LAND_FOUT = 'Land: gebruik de landcode van twee letters (NL, DE, BE)'

/**
 * The columns that only exist after a migration — [BESTE] clients_term_phone.sql and [KLANT-LAND]
 * client_country.sql — dropped together when an installation is behind on either, so the rest of
 * the customer is still saved.
 */
function withoutOptional<T extends { phone?: unknown; payment_term_days?: unknown; country?: unknown; default_hourly_rate?: unknown }>(v: T) {
  const rest = { ...v }
  delete rest.phone
  delete rest.payment_term_days
  delete rest.country
  delete rest.default_hourly_rate
  return rest
}
const OPTIONAL_COLUMNS = ['phone', 'payment_term_days', 'country', 'default_hourly_rate']
const missesOptional = (error: unknown) => OPTIONAL_COLUMNS.some((c) => isUnknownColumn(error, c))

export async function POST(request: NextRequest) {
  try {
    const acting = await getActingFor()
    if (!acting) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body = await request.json().catch(() => null)
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'Ongeldig verzoek' }, { status: 400 })
    }
    const v = velden(body as Record<string, unknown>)
    if (!v.name) return NextResponse.json({ error: 'Een klant heeft een naam nodig' }, { status: 400 })
    if (landOngeldig(body as Record<string, unknown>, v)) return NextResponse.json({ error: LAND_FOUT }, { status: 400 })

    // service_role: user_id en created_by worden door de SERVER gezet, niet door de browser.
    const pipeline = createPipelineClient()
    const insertRow = { ...v, name: v.name as string, user_id: invoiceOwnerId(acting) }
    let { data, error } = await writeWithTrail<{ id: string }>(
      (spoor) => pipeline
        .from('clients')
        .insert({ ...insertRow, ...spoor } as never)
        .select('id')
        .single(),
      { created_by: invoiceCreatedBy(acting) },
    )
    // [BESTE] [KLANT-LAND] Behind on clients_term_phone.sql or client_country.sql: save the customer
    // without the optional fields rather than refuse the customer.
    if (error && missesOptional(error)) {
      ;({ data, error } = await writeWithTrail<{ id: string }>(
        (spoor) => pipeline
          .from('clients')
          .insert({ ...withoutOptional(insertRow), ...spoor } as never)
          .select('id')
          .single(),
        { created_by: invoiceCreatedBy(acting) },
      ))
    }

    if (error || !data) {
      console.error('[ACTING-FOR] klant aanmaken mislukt', { error })
      return NextResponse.json({ error: 'Opslaan mislukt — probeer opnieuw' }, { status: 500 })
    }
    return NextResponse.json({ ok: true, id: data.id })
  } catch (e) {
    console.error('[ACTING-FOR] /api/clients POST', e)
    return NextResponse.json({ error: 'Server fout' }, { status: 500 })
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const acting = await getActingFor()
    if (!acting) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body = await request.json().catch(() => null)
    const id = typeof body?.id === 'string' ? body.id : ''
    if (!id) return NextResponse.json({ error: 'Welke klant?' }, { status: 400 })

    const v = velden(body as Record<string, unknown>)
    if (!v.name) return NextResponse.json({ error: 'Een klant heeft een naam nodig' }, { status: 400 })
    if (landOngeldig(body as Record<string, unknown>, v)) return NextResponse.json({ error: LAND_FOUT }, { status: 400 })
    // clients.name is NOT NULL; de guard hierboven bewijst dat al, TypeScript ziet het niet.
    const patch = { ...v, name: v.name }

    const pipeline = createPipelineClient()

    // De rij MOET van dit bedrijf zijn — en, is de schrijver een medewerker, ook door hem
    // ingevoerd. Zonder deze twee filters zou een geraden id de klantgegevens van een ander
    // bedrijf laten herschrijven; service_role kent geen RLS die dat nog tegenhoudt.
    const run = (row: object) => {
      let q = pipeline.from('clients').update(row as never).eq('id', id).eq('user_id', invoiceOwnerId(acting))
      if (acting.role !== 'eigenaar') {
        q = q.eq('created_by', invoiceCreatedBy(acting))
      }
      return q
    }
    let { error } = await run(patch)
    // [BESTE] Same fallback as POST: an installation behind on clients_term_phone.sql keeps the
    // rest of the card editable.
    if (error && missesOptional(error)) ({ error } = await run(withoutOptional(patch)))

    // Filtert een medewerker op een kolom die nog niet bestaat, dan is dat GEEN reden om het
    // filter te laten vallen: zonder created_by is er geen leesgrens, en dan zou hij de klant van
    // zijn baas kunnen herschrijven. Zonder migratie bestaat een medewerker sowieso niet, dus dit
    // is een onmogelijke toestand — die dan ook als fout terugkomt, niet als stille doorgang.
    if (error && isUnknownColumn(error)) {
      console.error('[ACTING-FOR] klant bijwerken zonder created_by-kolom geweigerd', { id })
      return NextResponse.json({ error: 'Opslaan mislukt — probeer opnieuw' }, { status: 500 })
    }

    if (error) {
      console.error('[ACTING-FOR] klant bijwerken mislukt', { error })
      return NextResponse.json({ error: 'Opslaan mislukt — probeer opnieuw' }, { status: 500 })
    }
    return NextResponse.json({ ok: true })
  } catch (e) {
    console.error('[ACTING-FOR] /api/clients PATCH', e)
    return NextResponse.json({ error: 'Server fout' }, { status: 500 })
  }
}

// [BESTE] Verwijderen — alleen een klant waar niets op staat.
//
// De browser verwijderde de rij rechtstreeks. invoices.client_id heeft geen foreign key, dus de
// facturen van die klant bleven staan met een verwijzing naar een rij die niet meer bestond: de
// klantkaart vanuit zo'n factuur gaf een 404, en de betaalgedrag-meting had geen klant meer om
// op te tellen. work_items.client_id heeft wél een sleutel (ON DELETE SET NULL) — dan verliest
// een werkorder stil zijn klant. Elk pakket weigert dit; nu wij ook, met de reden erbij.
export async function DELETE(request: NextRequest) {
  try {
    const acting = await getActingFor()
    if (!acting) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    // Alleen de eigenaar: een medewerker mag klanten invoeren en bijwerken, niet laten verdwijnen.
    if (acting.role !== 'eigenaar') {
      return NextResponse.json({ error: 'Alleen de eigenaar kan een klant verwijderen' }, { status: 403 })
    }
    const id = request.nextUrl.searchParams.get('id') ?? ''
    if (!id) return NextResponse.json({ error: 'Welke klant?' }, { status: 400 })
    const ownerId = invoiceOwnerId(acting)
    const pipeline = createPipelineClient()

    const [{ count: invoiceCount, error: invErr }, { count: workCount, error: workErr }] = await Promise.all([
      pipeline.from('invoices').select('id', { count: 'exact', head: true }).eq('sender_id', ownerId).eq('client_id', id),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (pipeline as any).from('work_items').select('id', { count: 'exact', head: true }).eq('user_id', ownerId).eq('client_id', id),
    ])
    // [NO-SILENT-EMPTY] Een telling die niet lukte is geen nul: dan weigeren we, niet verwijderen.
    if (invErr || (workErr && !isMissingRelation(String(workErr.message ?? '')))) {
      console.error('[BESTE] klant verwijderen: telling mislukt', { id, invErr, workErr })
      return NextResponse.json({ error: 'Kon niet controleren of deze klant facturen heeft — probeer opnieuw' }, { status: 503 })
    }
    const invoices = invoiceCount ?? 0
    const work = workErr ? 0 : (workCount ?? 0)
    if (invoices > 0 || work > 0) {
      const parts = [
        invoices > 0 ? (invoices === 1 ? '1 factuur' : `${invoices} facturen`) : null,
        work > 0 ? (work === 1 ? '1 werkorder' : `${work} werkorders`) : null,
      ].filter(Boolean)
      return NextResponse.json(
        { error: `Deze klant heeft ${parts.join(' en ')} en kan daarom niet worden verwijderd` },
        { status: 409 },
      )
    }

    const { error } = await pipeline.from('clients').delete().eq('id', id).eq('user_id', ownerId)
    if (error) {
      console.error('[BESTE] klant verwijderen mislukt', { error })
      return NextResponse.json({ error: 'Verwijderen mislukt — probeer opnieuw' }, { status: 500 })
    }
    return NextResponse.json({ ok: true })
  } catch (e) {
    console.error('[BESTE] /api/clients DELETE', e)
    return NextResponse.json({ error: 'Server fout' }, { status: 500 })
  }
}
