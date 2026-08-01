// src/app/dashboard/verkoop/page.tsx
// [NAMENS] Het werkbord van de verkoopmedewerker.
//
// Eén scherm, en dat is het hele ontwerp. Hij maakt facturen voor het bedrijf van zijn baas, ziet
// wat hij zelf heeft gemaakt, en kan een te late factuur een herinnering sturen — verder niets:
// geen bank, geen kas, geen omzet, geen facturen van collega's.
//
// WAAROM ER MEER STAAT DAN EEN LIJST
// Iemand die facturen maakt, maakt ze om betaald te worden. Een scherm dat alleen "hier zijn je
// facturen" zegt laat het halve werk liggen; wat hij nodig heeft is wat er OPEN staat, wat TE LAAT
// is, en één knop om daar iets aan te doen. Zonder die knop verhuist het nabellen naar WhatsApp —
// precies waar dit product vandaan komt.
//
// WAAR DE GRENS ECHT LIGT
// Niet hier. De facturenquery draait met de SESSIE van de medewerker, dus RLS beslist:
// invoices_member_read geeft alleen rijen met sender_id = acting_for_owner() EN
// created_by = auth.uid(). Zou dit bestand morgen een filter vergeten, dan krijgt hij nog steeds
// niets extra's terug. Het scherm is de presentatie, niet het slot.

import { redirect } from 'next/navigation'
import { createServerSupabaseClient } from '@/lib/supabase-server'
import { createPipelineClient } from '@/lib/supabase-pipeline'
import { getActingFor, loadIngetrokkenLidmaatschap } from '@/lib/acting-for-server'
import { isNamens } from '@/lib/acting-for'
import { FONT, M3, R } from '@/lib/design/tokens'
import type { VerkoopFactuur } from '@/lib/verkoop-overzicht'
import VerkoopClient from './VerkoopClient'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Verkoop — BoekBrug' }

/**
 * De klok, één keer gelezen, buiten de render om.
 *
 * Zelfde vorm als readClock() in settings/facturering: `Date.now()` in het lichaam van een
 * component wordt door de React-compiler terecht als onzuiver aangemerkt. Hier apart, zodat de
 * renderfunctie puur blijft en er precies één moment is waarop de tijd wordt vastgesteld — dat
 * ene moment gaat als prop naar de client, zodat server en browser op dezelfde standen uitkomen.
 */
function readClock(): number {
  return new Date().getTime()
}

export default async function VerkoopPage() {
  const acting = await getActingFor()
  if (!acting) redirect('/login')

  if (!isNamens(acting)) {
    // [NAMENS] Twee heel verschillende mensen komen hier terecht zonder koppeling.
    //
    // 1) Een EIGENAAR — die hoort op /dashboard/facturen, waar álles staat; dit scherm zou hem
    //    een halve waarheid tonen.
    // 2) Een medewerker van wie de toegang zojuist is INGETROKKEN. Die viel hiervoor onder
    //    dezelfde redirect en belandde op zijn eigen, lege facturenlijst — zonder één woord
    //    uitleg, met de volledige navigatie van een eigenaar eromheen. Hij zou denken dat de app
    //    stuk is of dat zijn facturen zijn verwijderd. Ze zijn niet verwijderd: ze staan bij zijn
    //    werkgever, waar ze horen. Dat is één zin, en die zin hoort er te staan.
    const ingetrokken = await loadIngetrokkenLidmaatschap(acting.actorId)
    if (!ingetrokken) redirect('/dashboard/facturen')

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const pipelineNaam = createPipelineClient() as any
    const { data: exBaas } = await pipelineNaam
      .from('profiles')
      .select('company_name, full_name')
      .eq('id', ingetrokken.ownerId)
      .single()

    return (
      <GeenToegangMeer
        bedrijf={exBaas?.company_name || exBaas?.full_name || 'je werkgever'}
        sinds={ingetrokken.revokedAt}
      />
    )
  }

  const supabase = await createServerSupabaseClient()

  // [DEPLOY-SAFE] `as any` op de SESSIE-client, niet op service_role: invoices.created_by staat
  // nog niet in de gegenereerde types (die worden pas na de migratie bijgewerkt). De cast raakt
  // alleen het typen — de query draait onder de sessie van de medewerker, dus RLS beslist
  // onverminderd wat hij terugkrijgt.
  const { data: facturenRuw } = await (supabase as unknown as {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    from: (t: string) => { select: (c: string) => any }
  })
    .from('invoices')
    .select('id, invoice_number, client_name, client_email, invoice_date, due_date, total_inc_btw, amount_paid, status')
    .eq('sender_id', acting.ownerId)
    .eq('created_by', acting.actorId)
    .order('created_at', { ascending: false })
    .limit(200) as { data: VerkoopFactuur[] | null }

  const facturen: VerkoopFactuur[] = facturenRuw ?? []

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pipeline = createPipelineClient() as any

  // De naam van het bedrijf waarvoor hij werkt. Het profiel van de eigenaar is voor zijn sessie
  // onleesbaar (RLS), dus via service_role — en pas nádat de koppeling is bewezen, wat hierboven
  // is gebeurd: getActingFor() geeft alleen een andere ownerId terug bij een geldige koppeling.
  const { data: baas } = await pipeline
    .from('profiles')
    .select('company_name, full_name')
    .eq('id', acting.ownerId)
    .single()
  const bedrijf = baas?.company_name || baas?.full_name || 'je werkgever'

  // Het herinneringsspoor. invoice_reminders heeft geen leespolicy voor een medewerker (de tabel
  // hoort bij de eigenaar), dus service_role — strak gescoopt op de facturen die hierboven al
  // door RLS zijn goedgekeurd. Zonder dit zou de knop "herinner" aanbieden op een factuur waar
  // gisteren al een mail over uitging.
  const ids = facturen.map((f) => f.id)
  if (ids.length) {
    try {
      const { data: herinneringen } = await pipeline
        .from('invoice_reminders')
        .select('invoice_id, sent_at, status')
        .in('invoice_id', ids)
        .neq('status', 'failed')
        .order('sent_at', { ascending: false })
      const perFactuur = new Map<string, { laatste: string; aantal: number }>()
      for (const r of (herinneringen ?? []) as Array<{ invoice_id: string; sent_at: string }>) {
        const b = perFactuur.get(r.invoice_id)
        if (b) b.aantal++
        else perFactuur.set(r.invoice_id, { laatste: r.sent_at, aantal: 1 })
      }
      for (const f of facturen) {
        const b = perFactuur.get(f.id)
        f.laatste_herinnering = b?.laatste ?? null
        f.herinneringen = b?.aantal ?? 0
      }
    } catch {
      // De tabel bestaat, maar mocht de lezing mislukken dan blijft het spoor leeg. Dat maakt de
      // knop RUIMER dan hij hoort te zijn, dus zetten we hem dan liever helemaal uit: de route
      // toetst dezelfde regel nog een keer en weigert alsnog, met de juiste zin erbij.
      for (const f of facturen) f.herinneringen = undefined
    }
  }

  // De klok komt van hier: de pagina is force-dynamic, dus de server weet hoe laat het is en
  // client en server komen op dezelfde standen uit. Zie de kop van VerkoopClient.
  return <VerkoopClient facturen={facturen} bedrijf={bedrijf} nu={readClock()} />
}

/**
 * Het eerlijke einde van een koppeling.
 *
 * Geen foutmelding — er is niets misgegaan. Zijn werkgever heeft de toegang ingetrokken, en dat
 * mag die op elk moment. Wat deze medewerker moet weten is precies drie dingen: dat het bewust
 * is gebeurd, dat zijn werk niet weg is, en bij wie hij moet zijn.
 */
function GeenToegangMeer({ bedrijf, sinds }: { bedrijf: string; sinds: string }) {
  const ms = Date.parse(sinds)
  const datum = Number.isFinite(ms) ? new Date(ms).toLocaleDateString('nl-NL') : null
  return (
    <div style={{ minHeight: '100vh', background: M3.bg, fontFamily: FONT, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div style={{ background: M3.surface, border: `1px solid ${M3.hairline}`, borderRadius: R.lg, padding: 28, maxWidth: 460 }}>
        <h1 style={{ fontSize: 19, fontWeight: 700, color: M3.onSurface, margin: '0 0 10px' }}>
          Je maakt geen facturen meer voor {bedrijf}
        </h1>
        <p style={{ fontSize: 14.5, color: M3.neutral, margin: '0 0 12px', lineHeight: 1.6 }}>
          {bedrijf} heeft je toegang{datum ? ` op ${datum}` : ''} ingetrokken. Dat is een keuze van
          je werkgever en er is niets misgegaan met je account.
        </p>
        <p style={{ fontSize: 14.5, color: M3.neutral, margin: '0 0 12px', lineHeight: 1.6 }}>
          <strong style={{ color: M3.onSurface }}>Je facturen zijn niet verwijderd.</strong> Ze horen
          bij de boekhouding van {bedrijf} en staan daar gewoon — met de nummers die ze bij het
          versturen hebben gekregen.
        </p>
        <p style={{ fontSize: 13.5, color: M3.mutedText, margin: 0, lineHeight: 1.6 }}>
          Klopt dit niet? Vraag het aan {bedrijf} — alleen zij kunnen de toegang terugzetten.
          Je eigen account blijft van jou en werkt gewoon.
        </p>
      </div>
    </div>
  )
}
