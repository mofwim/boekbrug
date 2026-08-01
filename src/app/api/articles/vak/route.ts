// src/app/api/articles/vak/route.ts
// [VAK] "Ik ben schilder" → de regels van je vak in je catalogus, met het juiste BTW-tarief.
//
// GET  → welke vakken zijn er, en wat zit erin (zodat het scherm kan tonen wat je krijgt vóór je
//        op de knop drukt — een lijst die pas ná de klik zichtbaar wordt, is een verrassing)
// POST → voeg de regels toe die je nog niet hebt
//
// WAT DEZE ROUTE NADRUKKELIJK NIET DOET
//  · geen prijzen zetten. Wat het kost bepaalt de ondernemer; zie de kop van vaksjablonen.ts.
//  · niets overschrijven. Regels die er al staan blijven ONGEWIJZIGD, ook als hun tarief afwijkt
//    van het onze. Zijn aanpassing wint altijd — misschien wéét hij dat zijn klus 21% is.
//  · niets verwijderen. Een startbundel voegt toe, nooit iets anders.

import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase-server'
import { VAKKEN, vakVan, nieuweRegels } from '@/lib/vaksjablonen'
import { vereisEigenaar } from '@/lib/alleen-eigenaar'

export const dynamic = 'force-dynamic'

export async function GET() {
  // Alleen de lijst — geen gebruikersgegevens, dus geen reden om de sessie te raadplegen buiten
  // de gebruikelijke auth. De inhoud is voor iedereen hetzelfde.
  return NextResponse.json({
    ok: true,
    vakken: VAKKEN.map((v) => ({
      key: v.key,
      naam: v.naam,
      regels: v.regels.map((r) => ({
        description: r.description,
        unit: r.unit,
        btw_rate: r.btw_rate,
        let_op: r.let_op ?? null,
      })),
    })),
  })
}

export async function POST(request: NextRequest) {
  // [NAMENS] LEZEN uit de catalogus mag een medewerker (zie /api/articles — hij factureert uit
  // dezelfde lijst). Maar er ZEVEN REGELS INZETTEN is iets anders: dat verandert de gedeelde
  // lijst van zijn werkgever, zonder dat die erom vroeg, en met tarieven die diens aangifte
  // raken. Dat hoort een keuze van de eigenaar te zijn.
  const w = await vereisEigenaar('De regels van een vak toevoegen')
  if (w.antwoord) return w.antwoord
  const ownerId = w.acting!.ownerId

  const body = await request.json().catch(() => null)
  const key = typeof body?.vak === 'string' ? body.vak : ''
  const vak = vakVan(key)
  if (!vak) return NextResponse.json({ error: 'Onbekend vak' }, { status: 400 })

  const supabase = await createServerSupabaseClient()

  // Wat staat er al? De vergelijking gebeurt op omschrijving (zie nieuweRegels), zodat twee keer
  // op de knop drukken geen dubbele catalogus oplevert.
  const { data: bestaand, error: leesFout } = await supabase
    .from('articles')
    .select('description')
    .eq('user_id', ownerId)
  if (leesFout) {
    // Zonder te weten wat er al staat kunnen we niet veilig toevoegen: dan zouden we dubbelen
    // maken. Liever eerlijk falen dan een rommelige catalogus achterlaten.
    console.error('[VAK] bestaande artikelen lezen mislukt', { leesFout })
    return NextResponse.json({ error: 'Kon je catalogus niet lezen — probeer opnieuw' }, { status: 503 })
  }

  const toeTeVoegen = nieuweRegels(key, (bestaand ?? []).map((a) => a.description ?? ''))
  if (toeTeVoegen.length === 0) {
    return NextResponse.json({ ok: true, toegevoegd: 0, bestondAl: vak.regels.length })
  }

  const { data, error } = await supabase
    .from('articles')
    .insert(toeTeVoegen.map((r) => ({ user_id: ownerId, ...r })))
    .select('id')

  if (error) {
    console.error('[VAK] startbundel opslaan mislukt', { error, key })
    return NextResponse.json({ error: 'Kon de regels niet toevoegen — probeer opnieuw' }, { status: 500 })
  }

  return NextResponse.json({
    ok: true,
    toegevoegd: data?.length ?? toeTeVoegen.length,
    bestondAl: vak.regels.length - toeTeVoegen.length,
  })
}
