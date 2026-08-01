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
  }
}

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

    // service_role: user_id en created_by worden door de SERVER gezet, niet door de browser.
    const pipeline = createPipelineClient()
    const { data, error } = await writeWithTrail<{ id: string }>(
      (spoor) => pipeline
        .from('clients')
        .insert({ ...v, name: v.name as string, user_id: invoiceOwnerId(acting), ...spoor })
        .select('id')
        .single(),
      { created_by: invoiceCreatedBy(acting) },
    )

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
    // clients.name is NOT NULL; de guard hierboven bewijst dat al, TypeScript ziet het niet.
    const patch = { ...v, name: v.name }

    const pipeline = createPipelineClient()

    // De rij MOET van dit bedrijf zijn — en, is de schrijver een medewerker, ook door hem
    // ingevoerd. Zonder deze twee filters zou een geraden id de klantgegevens van een ander
    // bedrijf laten herschrijven; service_role kent geen RLS die dat nog tegenhoudt.
    let q = pipeline.from('clients').update(patch).eq('id', id).eq('user_id', invoiceOwnerId(acting))
    if (acting.role !== 'eigenaar') {
      q = q.eq('created_by', invoiceCreatedBy(acting))
    }
    const { error } = await q

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
