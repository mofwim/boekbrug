// src/app/api/accountant/invoice-mandate/route.ts
// [MANDAAT] De klant geeft — of trekt in — de toestemming aan zijn boekhouder om facturen op zijn
// naam uit te reiken.
//
// WAAROM DIT EEN ROUTE IS EN GEEN RLS-POLICY
// accountant_invoice_mandates geeft de sessie alleen SELECT. Dat is geen strengheid om de
// strengheid: accountant_clients_insert_consent.sql beschrijft wat er gebeurde toen het WEL een
// policy was — de enige eis was dat je jezelf als boekhouder opgaf, en daarmee kon iedereen zich
// aan iedere klant koppelen met één PostgREST-aanroep. Een mandaat is gevaarlijker dan die
// koppeling, want het geeft facturen uit onder andermans BTW-nummer. Dus dezelfde oplossing:
// schrijven kan alleen hier, en hier wordt eerst gecontroleerd.
//
// WIE MAG WAT
//   verlenen (POST)   — ALLEEN de klant. Een boekhouder die zichzelf een mandaat geeft is precies
//                       het gat dat hierboven wordt beschreven.
//   intrekken (DELETE) — allebei. De klant trekt zijn toestemming in; de boekhouder mag de opdracht
//                       teruggeven. Voor geen van beiden is er een wachttijd.

import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase-server'
import { createPipelineClient } from '@/lib/supabase-pipeline'
import { createNotification } from '@/lib/notifications'
import { logAuditAction, getClientIP } from '@/lib/audit'

export const dynamic = 'force-dynamic'

/** Hoe iemand heet in een melding aan de ander. */
async function naamVan(
  pipeline: ReturnType<typeof createPipelineClient>,
  id: string,
  terugval: string,
): Promise<string> {
  const { data } = await pipeline
    .from('profiles')
    .select('full_name, company_name')
    .eq('id', id)
    .maybeSingle()
  return data?.company_name || data?.full_name || terugval
}

// ── Verlenen ─────────────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Niet ingelogd.' }, { status: 401 })

  // De koppeling is de voorwaarde: je kunt alleen iemand machtigen die je zelf hebt uitgenodigd.
  // Meerdere rijen zijn mogelijk (zie unlink-by-client), dus geen maybeSingle().
  const { data: links } = await supabase
    .from('accountant_clients')
    .select('accountant_id')
    .eq('zzper_id', user.id)

  const accountantIds = Array.from(
    new Set((links ?? []).map((l) => l.accountant_id).filter((v): v is string => !!v)),
  )
  if (accountantIds.length === 0) {
    return NextResponse.json({ error: 'Je hebt geen boekhouder gekoppeld.' }, { status: 404 })
  }
  // Bij precies één koppeling hoeft de pagina niets mee te sturen; bij meer moet ze kiezen.
  const gevraagd = await req.json().catch(() => null)

  // [BEVESTIGEN] Welke machtiging. Twee losse besluiten van de klant, nooit één — een onbekende
  // waarde wordt NIET stilzwijgend 'facturen', want dat is de ruimere van de twee.
  const soort = typeof gevraagd?.kind === 'string' ? gevraagd.kind : 'facturen'
  if (soort !== 'facturen' && soort !== 'bevestigen') {
    return NextResponse.json({ error: 'Onbekende machtiging.' }, { status: 400 })
  }
  const doel =
    typeof gevraagd?.accountantId === 'string' && gevraagd.accountantId
      ? gevraagd.accountantId
      : accountantIds.length === 1
        ? accountantIds[0]
        : null
  if (!doel || !accountantIds.includes(doel)) {
    return NextResponse.json({ error: 'Kies welke boekhouder je machtigt.' }, { status: 400 })
  }

  const pipeline = createPipelineClient()

  // Al een levend mandaat? Dan is dit een dubbelklik, geen fout. De unieke index vangt het ook af,
  // maar een 409 op een knop die de gewenste toestand al bereikt heeft is nutteloos nieuws.
  const { data: bestaand } = await pipeline
    .from('accountant_invoice_mandates')
    .select('id')
    .eq('zzper_id', user.id)
    .eq('accountant_id', doel)
    .eq('kind', soort)
    .is('revoked_at', null)
    .maybeSingle()
  if (bestaand) return NextResponse.json({ ok: true, alVerleend: true })

  const { data: mandaat, error } = await pipeline
    .from('accountant_invoice_mandates')
    .insert({ zzper_id: user.id, accountant_id: doel, kind: soort })
    .select('id')
    .single()

  if (error || !mandaat) {
    console.error('[MANDAAT] verlenen mislukt', { error })
    return NextResponse.json({ error: 'Machtigen mislukt. Probeer het opnieuw.' }, { status: 500 })
  }

  // De boekhouder moet het weten — anders staat er morgen een knop in zijn portaal waarvan hij niet
  // weet waar hij vandaan komt. Best-effort: het mandaat staat er al.
  try {
    const klantNaam = await naamVan(pipeline, user.id, 'Een klant')
    const melding = await createNotification({
      userId: doel,
      title:
        soort === 'bevestigen'
          ? 'Je mag inkoopfacturen bevestigen voor een klant'
          : 'Je mag facturen versturen namens een klant',
      body:
        soort === 'bevestigen'
          ? `${klantNaam} heeft je gemachtigd om zijn inkoopfacturen te bevestigen, zodat zijn kwartaal kan sluiten. Hij blijft er zelf verantwoordelijk voor — bij elke bevestiging staat jouw naam.`
          : `${klantNaam} heeft je gemachtigd om facturen op zijn naam uit te reiken. De facturen krijgen zijn nummerreeks en zijn BTW-nummer.`,
      type: 'invoice',
      link: soort === 'bevestigen' ? '/dashboard/accountant/bevestigen' : '/dashboard/accountant/factuur',
    })
    if (!melding.ok) console.error('[MANDAAT] melding aan de boekhouder mislukt', melding.error)
  } catch (e) {
    console.error('[MANDAAT] melding aan de boekhouder mislukt', e)
  }

  await logAuditAction({
    userId: user.id,
    action: 'accountant.invoice_mandate_granted',
    entityType: 'accountant_invoice_mandate',
    entityId: mandaat.id,
    newValue: { accountant_id: doel, zzper_id: user.id, kind: soort, initiated_by: 'client' },
    ipAddress: getClientIP(req),
  })

  return NextResponse.json({ ok: true })
}

// ── Intrekken ────────────────────────────────────────────────────────────────
export async function DELETE(req: NextRequest) {
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Niet ingelogd.' }, { status: 401 })

  const gevraagd = await req.json().catch(() => null)
  const tegenpartij = typeof gevraagd?.otherId === 'string' ? gevraagd.otherId : null
  // [BEVESTIGEN] Eén soort intrekken mag de andere niet meenemen. Zonder `kind` trekt deze route
  // ALLES in — dat is bruikbaar (de knop "haal alles weg"), maar het mag nooit per ongeluk zijn.
  const soort =
    gevraagd?.kind === 'facturen' || gevraagd?.kind === 'bevestigen' ? gevraagd.kind : null

  const pipeline = createPipelineClient()

  // Zoek de levende mandaten waar deze mens partij in is — als klant OF als boekhouder. Wie op de
  // knop drukt bepaalt niet WELKE kant hij is; de rij bepaalt dat.
  let vraag = pipeline
    .from('accountant_invoice_mandates')
    .select('id, zzper_id, accountant_id, kind')
    .is('revoked_at', null)
    .or(`zzper_id.eq.${user.id},accountant_id.eq.${user.id}`)
  if (tegenpartij) {
    vraag = vraag.or(`zzper_id.eq.${tegenpartij},accountant_id.eq.${tegenpartij}`)
  }
  if (soort) vraag = vraag.eq('kind', soort)
  const { data: mandaten } = await vraag

  // De .or() hierboven is een OF over de hele rij, dus een rij tussen twee ANDERE mensen zou er in
  // theorie doorheen kunnen komen. Daarom hier nog een keer expliciet: deze gebruiker moet partij
  // zijn. Filteren in code is hier goedkoper dan een query die dit exact uitdrukt, en het is de
  // controle die telt.
  const van_mij = (mandaten ?? []).filter(
    (m) => m.zzper_id === user.id || m.accountant_id === user.id,
  )
  const doelen = tegenpartij
    ? van_mij.filter((m) => m.zzper_id === tegenpartij || m.accountant_id === tegenpartij)
    : van_mij

  if (doelen.length === 0) {
    // Niets te doen is niet hetzelfde als een fout: de gewenste toestand is al bereikt.
    return NextResponse.json({ ok: true, nietsTeDoen: true })
  }

  const { error } = await pipeline
    .from('accountant_invoice_mandates')
    .update({ revoked_at: new Date().toISOString(), revoked_by: user.id })
    .in('id', doelen.map((m) => m.id))

  if (error) {
    console.error('[MANDAAT] intrekken mislukt', { error })
    return NextResponse.json({ error: 'Intrekken mislukt. Probeer het opnieuw.' }, { status: 500 })
  }

  // De ander waarschuwen, wie dat ook is. Een boekhouder die morgen op 'versturen' drukt en een
  // 403 krijgt zonder ooit iets te hebben gehoord, denkt dat het programma stuk is.
  for (const m of doelen) {
    const anderId = m.zzper_id === user.id ? m.accountant_id : m.zzper_id
    if (!anderId) continue
    try {
      const naam = await naamVan(pipeline, user.id, 'De andere partij')
      const naarKlant = anderId === m.zzper_id
      const melding = await createNotification({
        userId: anderId,
        title: naarKlant ? 'Je boekhouder factureert niet meer namens jou' : 'Machtiging ingetrokken',
        body: naarKlant
          ? `${naam} verstuurt geen facturen meer op jouw naam. Je maakt ze weer zelf.`
          : `${naam} heeft de machtiging om facturen op zijn naam te versturen ingetrokken. Je kunt zijn administratie nog gewoon inzien.`,
        type: 'invoice',
        link: naarKlant ? '/dashboard/settings' : `/dashboard/clients/${m.zzper_id}`,
      })
      if (!melding.ok) console.error('[MANDAAT] melding bij intrekken mislukt', melding.error)
    } catch (e) {
      console.error('[MANDAAT] melding bij intrekken mislukt', e)
    }

    await logAuditAction({
      userId: user.id,
      action: 'accountant.invoice_mandate_revoked',
      entityType: 'accountant_invoice_mandate',
      entityId: m.id,
      oldValue: {
        accountant_id: m.accountant_id,
        zzper_id: m.zzper_id,
        kind: m.kind ?? 'facturen',
        initiated_by: m.zzper_id === user.id ? 'client' : 'accountant',
      },
      ipAddress: getClientIP(req),
    })
  }

  return NextResponse.json({ ok: true })
}
