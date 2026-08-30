// src/app/dashboard/accountant/bevestigen/page.tsx
// [BEVESTIGEN] De inkoopfacturen die wachten, over alle klanten die de boekhouder daarvoor
// gemachtigd hebben.
//
// WAAROM DE MANDAATGRENS EN NIET DE KOPPELING
// Een gekoppelde boekhouder mag meekijken. Bevestigen is iets anders: het boekt iets in de
// administratie van zijn klant, en die klant blijft er aansprakelijk voor (art. 52 AWR). Dat is
// precies de handeling waarvoor een uitdrukkelijke, intrekbare machtiging bestaat.
//
// De lijst hieronder is optimistisch, zoals elk scherm: de echte controle staat in
// /api/accountant/bevestig en daaronder in de RLS (invoices_mandate_confirm_read/_write) en de
// trigger. Trekt een klant zijn machtiging in terwijl deze pagina openstaat, dan blijft de knop
// staan en antwoordt hij 403.

import { redirect } from 'next/navigation'
import { createServerSupabaseClient } from '@/lib/supabase-server'
import { getSessionUser } from '@/lib/session-user'
import { createPipelineClient } from '@/lib/supabase-pipeline'
// [IN-CHUNK] Een id-lijst die met het kantoor meegroeit, gaat gechunkt de URL in — zie
// supabase-paginate.ts voor waarom een kale .in() hier stil als 'geen rijen' terugkomt.
import { fetchAllRowsForIds } from '@/lib/supabase-paginate'
import AccountantBevestigen, { type TeBevestigen } from '@/modules/accountant/pages/AccountantBevestigen'

export const dynamic = 'force-dynamic'

/**
 * [VRAAG-MACHTIGING] Alle GEKOPPELDE klanten, ook (juist) die zonder machtiging.
 *
 * Zonder deze lijst is de lege staat een doodlopende weg: hij legt uit dat de klant het moet
 * aanzetten, en biedt geen manier om het hem te vragen. Sessie-client, dus RLS geeft een
 * boekhouder alleen zijn eigen koppelingen.
 */
async function gekoppeldeKlanten(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  accountantId: string,
): Promise<{ id: string; naam: string }[]> {
  const { data: links, error: linksFout } = await supabase
    .from('accountant_clients')
    .select('zzper_id')
    .eq('accountant_id', accountantId)
  // [NO-SILENT-EMPTY] Deze lijst IS de uitweg uit de lege staat — zonder hem legt dat scherm uit
  // dat de klant iets moet aanzetten en biedt het geen enkele manier om het hem te vragen. Een
  // mislukte lezing die als "geen klanten" doorging, maakte van die uitweg een muur.
  if (linksFout) {
    console.error('[BEVESTIGEN] gekoppelde klanten lezen mislukt', { accountantId, linksFout })
    return []
  }
  const ids = Array.from(
    new Set((links ?? []).map((l: { zzper_id: string | null }) => l.zzper_id).filter(Boolean)),
  ) as string[]
  if (ids.length === 0) return []
  // [IN-CHUNK] Gechunkt: een kantoor met een paar honderd klanten laat de id-lijst de URL
  // overgroeien, en die 414 komt terug als een gewone `error` — dus als "geen klanten".
  let profielen: Array<{ id: string; full_name: string | null; company_name: string | null }> = []
  try {
    profielen = await fetchAllRowsForIds<{ id: string; full_name: string | null; company_name: string | null }, string>(
      ids,
      (chunk, from, to) =>
        supabase
          .from('profiles').select('id, full_name, company_name')
          .in('id', chunk).order('id', { ascending: true }).range(from, to),
    )
  } catch (e) {
    console.error('[BEVESTIGEN] namen van gekoppelde klanten lezen mislukt', { accountantId, e })
    return []
  }
  return profielen
    .map((p) => ({ id: p.id, naam: p.company_name || p.full_name || 'Klant' }))
    .sort((a, b) => a.naam.localeCompare(b.naam, 'nl'))
}


/** Wat de lezer niet zeker wist, in gewone woorden. */
function twijfelsVan(veld: unknown): string[] {
  if (!veld || typeof veld !== 'object') return []
  const uit: string[] = []
  const c = veld as Record<string, unknown>
  const laag = (k: string) => typeof c[k] === 'number' && (c[k] as number) < 0.8
  if (laag('total_inc_btw') || laag('btw_amount')) uit.push('het bedrag')
  if (laag('invoice_date')) uit.push('de datum')
  if (laag('client_name')) uit.push('de leverancier')
  if (laag('invoice_number')) uit.push('het factuurnummer')
  return uit
}

export default async function AccountantBevestigenPage() {
  const supabase = await createServerSupabaseClient()

  // [WATERVAL] Memoised per request (session-user.ts) — the dashboard layout above already asked.
  const user = await getSessionUser()
  if (!user) redirect('/login')

  // ── [WATERVAL] Het profiel en het mandaat kennen elkaar niet ────────────────
  //
  // Ze hangen allebei alleen aan user.id, en toch wachtte het mandaat op het profiel. De lezingen
  // eronder wachten wél ergens op — de koppeling op de gemandateerde klanten, de facturen op die
  // koppeling — en die volgorde is echt en blijft dus staan.
  //
  // De rolcontroles blijven onder de golf: dat is een grens, geen volgorde. Wie hier niet hoort
  // wordt weggestuurd voordat er ook maar iets van dit antwoord op een scherm belandt.
  //
  // allSettled, niet all: de mandaatlezing mág mislukken — zie [DEPLOY-SAFE] hieronder — en met
  // Promise.all zou die toegestane mislukking het profiel meesleuren en de pagina omvertrekken.
  const [profileS, mandatenS] = await Promise.allSettled([
    supabase.from('profiles').select('role, onboarding_done').eq('id', user.id).maybeSingle(),
    // ── Toestemming, met de sessie ───────────────────────────────────────────
    supabase
      .from('accountant_invoice_mandates')
      .select('zzper_id')
      .eq('accountant_id', user.id)
      .eq('kind', 'bevestigen')
      .is('revoked_at', null),
  ])

  if (profileS.status === 'rejected') throw profileS.reason
  const { data: profile } = profileS.value

  if (!profile) redirect('/login')
  if (!profile.onboarding_done) redirect('/onboarding')
  if (profile.role !== 'accountant') redirect('/dashboard')

  // [DEPLOY-SAFE] `kind` bestaat pas na accountant_confirm_mandate.sql. Faalt deze query, dan is
  // er niemand gemachtigd en toont het scherm de uitleg — nooit een crash.
  let gemandateerd: string[] = []
  try {
    if (mandatenS.status === 'rejected') throw mandatenS.reason
    const { data: mandaten } = mandatenS.value
    gemandateerd = Array.from(new Set((mandaten ?? []).map((m) => m.zzper_id).filter(Boolean)))
  } catch {
    gemandateerd = []
  }

  if (gemandateerd.length === 0) {
    return <AccountantBevestigen rijen={[]} geenMandaat gekoppeld={await gekoppeldeKlanten(supabase, user.id)} />
  }

  // De koppeling moet er óók zijn — de database eist hem hoe dan ook
  // (has_active_confirm_mandate joint op accountant_clients).
  //
  // [NO-SILENT-EMPTY] En het resultaat van DEZE lezing werd een uitspraak over machtigingen. Ging
  // ze mis, dan bleef klantIds leeg en kreeg de boekhouder het scherm "nog geen enkele klant heeft
  // je gemachtigd" te zien — over klanten die hem wél gemachtigd hadden. Hij gaat dan zijn klant
  // vragen iets aan te zetten dat al aan staat, en de inkoopfacturen blijven ondertussen wachten.
  // Een mislukte lezing zegt nu dat ze mislukt is, en niets anders.
  //
  // [IN-CHUNK] Gechunkt om diezelfde reden: bij een kantoor met genoeg klanten IS de kale `.in()`
  // de manier waarop deze lezing mislukt.
  let links: Array<{ zzper_id: string | null }>
  try {
    links = await fetchAllRowsForIds<{ zzper_id: string | null }, string>(
      gemandateerd,
      (chunk, from, to) =>
        supabase
          .from('accountant_clients')
          .select('zzper_id')
          .eq('accountant_id', user.id)
          .in('zzper_id', chunk)
          .order('zzper_id', { ascending: true })
          .range(from, to),
    )
  } catch (e) {
    console.error('[BEVESTIGEN] koppelingen lezen mislukt', { accountantId: user.id, e })
    return <AccountantBevestigen rijen={[]} leesfout />
  }
  const klantIds = Array.from(new Set(links.map((l) => l.zzper_id).filter((v): v is string => !!v)))

  if (klantIds.length === 0) {
    return <AccountantBevestigen rijen={[]} geenMandaat gekoppeld={await gekoppeldeKlanten(supabase, user.id)} />
  }

  // ── De stapel ──────────────────────────────────────────────────────────────
  // service_role, expliciet beperkt tot de gemachtigde klanten — hetzelfde patroon als
  // accountant-access.ts: de TOESTEMMING is met de sessie vastgesteld, de DATA wordt daarna
  // scoped opgehaald. (invoices_mandate_confirm_read zou dit ook toelaten, maar dan één query per
  // klant; dit is dezelfde grens in één keer.)
  const pipeline = createPipelineClient()

  // [NO-SILENT-EMPTY] Twee lezingen die allebei alleen `data` uitpakten, en allebei op een manier
  // die op het scherm niet als storing te herkennen was:
  //
  //   · de facturen — een mislukte lezing gaf een LEGE stapel, dus "bij je gemachtigde klanten is
  //     elke inkoopfactuur bevestigd", terwijl er stukken wachtten die het kwartaal tegenhouden;
  //   · de namen — een mislukte lezing gaf overal 'Klant', dus een lijst waarin de boekhouder niet
  //     meer kan zien in WIENS administratie hij op het punt staat te boeken. Dat is de ene fout
  //     die hij op dit scherm niet mag kunnen maken.
  //
  // [IN-CHUNK] En beide gechunkt: klantIds groeit met het kantoor, en dat is precies de lijst die
  // de URL laat overlopen.
  let facturenAlle: Array<{
    id: string; receiver_id: string | null; client_name: string | null; invoice_number: string | null
    invoice_date: string | null; total_inc_btw: number | null; btw_amount: number | null
    field_confidence: unknown
  }>
  let profielen: Array<{ id: string; full_name: string | null; company_name: string | null }>
  try {
    ;[facturenAlle, profielen] = await Promise.all([
      fetchAllRowsForIds(klantIds, (chunk, from, to) =>
        pipeline
          .from('invoices')
          .select('id, receiver_id, client_name, invoice_number, invoice_date, total_inc_btw, btw_amount, field_confidence')
          .in('receiver_id', chunk)
          .eq('direction', 'incoming')
          .eq('status', 'processing')
          .order('id', { ascending: true })
          .range(from, to),
      ),
      fetchAllRowsForIds<{ id: string; full_name: string | null; company_name: string | null }, string>(
        klantIds,
        (chunk, from, to) =>
          pipeline.from('profiles').select('id, full_name, company_name')
            .in('id', chunk).order('id', { ascending: true }).range(from, to),
      ),
    ])
  } catch (e) {
    console.error('[BEVESTIGEN] stapel lezen mislukt', { accountantId: user.id, e })
    return <AccountantBevestigen rijen={[]} leesfout />
  }

  // De volgorde die het scherm toont — oudste eerst, want die houden het langst een kwartaal op.
  // Hij wordt hier gelegd in plaats van door de database, omdat de lezing per klant-chunk komt en
  // een sortering per chunk geen sortering over het geheel is.
  // Een factuur ZONDER datum sorteert achteraan, niet vooraan. Postgres zet NULL bij ASC achteraan
  // en dat deed de oude `.order('invoice_date')` dus ook; een lege string in JS sorteert juist
  // vóór alles. Zonder deze tak zou het omzetten van de sortering naar hier stilletjes de kop van
  // de stapel veranderen — en de kop van deze stapel is wat een boekhouder als eerste bevestigt.
  facturenAlle.sort((a, b) => {
    const da = a.invoice_date
    const db = b.invoice_date
    if (da !== db) {
      if (!da) return 1
      if (!db) return -1
      return da < db ? -1 : 1
    }
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
  })
  // De begrenzing blijft — duizenden rijen zijn geen bruikbaar scherm — maar ze noemt zichzelf nu.
  const TOON = 500
  const facturen = facturenAlle.slice(0, TOON)
  const meer = Math.max(0, facturenAlle.length - facturen.length)

  const namen: Record<string, string> = {}
  for (const p of profielen) namen[p.id] = p.company_name || p.full_name || 'Klant'

  const rijen: TeBevestigen[] = facturen.map((f) => ({
    id: f.id,
    clientId: f.receiver_id as string,
    clientNaam: namen[f.receiver_id as string] || 'Klant',
    leverancier: f.client_name || '',
    factuurnummer: f.invoice_number,
    datum: f.invoice_date,
    totaalInc: f.total_inc_btw,
    btw: f.btw_amount,
    twijfels: twijfelsVan(f.field_confidence),
  }))

  return <AccountantBevestigen rijen={rijen} meer={meer} />
}
