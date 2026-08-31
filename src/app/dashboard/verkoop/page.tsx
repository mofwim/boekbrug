// src/app/dashboard/verkoop/page.tsx
// [ACTING-FOR] Het werkbord van de verkoopmedewerker.
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
import { fetchAllRowsForIds } from '@/lib/supabase-paginate'
import { createServerSupabaseClient } from '@/lib/supabase-server'
import { createPipelineClient } from '@/lib/supabase-pipeline'
import { fetchAllRows } from '@/lib/supabase-paginate'
import { getActingFor, loadRevokedMembership } from '@/lib/acting-for-server'
import { serverTranslator } from '@/lib/i18n/server'
import type { Translator } from '@/lib/i18n/t'
import { isActingForOther } from '@/lib/acting-for'
import { FONT, M3, R } from '@/lib/design/tokens'
import type { SalesInvoice } from '@/lib/sales-overview'
import { creditedTotalsFrom } from '@/lib/credited-invoices'
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
// [TAAL] Server component: the translator binds via the request cookie (see i18n/server.ts).
function readClock(): number {
  return new Date().getTime()
}

export default async function VerkoopPage() {
  const acting = await getActingFor()
  if (!acting) redirect('/login')

  if (!isActingForOther(acting)) {
    // [ACTING-FOR] Twee heel verschillende mensen komen hier terecht zonder koppeling.
    //
    // 1) Een EIGENAAR — die hoort op /dashboard/facturen, waar álles staat; dit scherm zou hem
    //    een halve waarheid tonen.
    // 2) Een medewerker van wie de toegang zojuist is INGETROKKEN. Die viel hiervoor onder
    //    dezelfde redirect en belandde op zijn eigen, lege facturenlijst — zonder één woord
    //    uitleg, met de volledige navigatie van een eigenaar eromheen. Hij zou denken dat de app
    //    stuk is of dat zijn facturen zijn verwijderd. Ze zijn niet verwijderd: ze staan bij zijn
    //    werkgever, waar ze horen. Dat is één zin, en die zin hoort er te staan.
    const revoked = await loadRevokedMembership(acting.actorId)
    if (!revoked) redirect('/dashboard/facturen')

    const t = await serverTranslator()
    const pipelineNaam = createPipelineClient()
    const { data: exBaas } = await pipelineNaam
      .from('profiles')
      .select('company_name, full_name')
      .eq('id', revoked.ownerId)
      .single()

    return (
      <GeenToegangMeer
        bedrijf={exBaas?.company_name || exBaas?.full_name || t('vkp.werkgever')}
        sinds={revoked.revokedAt}
        t={t}
      />
    )
  }

  const supabase = await createServerSupabaseClient()

  // Read with the member's SESSION, never service_role: RLS decides unchanged what comes back.
  // The two .eq() calls are the read boundary from acting-for.ts — the owner's series, but only
  // the rows this member created themselves.
  // [CREDITNOTA-NO-CHASE] invoice_type EN original_invoice_id horen in deze select, en het is geen
  // uitbreiding maar een reparatie: canRemind() weigert een creditnota op precies deze kolom, en
  // zonder de kolom leest hij `?? 'factuur'` en weigert dus niets. De medewerker kreeg een levende
  // knop "Herinnering sturen" onder een creditnota — de mail die geld opeist dat de klant juist
  // terugkrijgt. (De route weigert hem alsnog, dus er ging niets de deur uit; er stond een knop
  // die alleen een foutmelding kon geven.) De regel stond er, alleen niet het gegeven waar hij op
  // oordeelt — en een bewaker zonder invoer ziet er precies zo uit als een bewaker.
  // [VOL-GELEZEN] Gepagineerd. Hier stond `.limit(200)` op `created_at` aflopend, en die 200
  // rijen waren niet alleen de LIJST maar ook de bron van de twee bedragen bovenaan: summarise()
  // maakt er "€ … staat open" en "€ … te laat" van, zonder dat er ergens stond dat er meer was.
  // Wat er afviel waren juist de OUDSTE facturen — precies de facturen die te laat zijn. Een
  // medewerker voorbij 200 facturen zag dus een "te laat"-totaal dat structureel te laag stond,
  // en het miste de vorderingen die er het langst op wachten.
  //
  // Ook zonder tweede sorteersleutel: bij gelijke created_at was ONBEPAALD welke rij meekwam.
  // De lezing loopt nu op `id` (stabiel en totaal); het scherm sorteert daarna zelf op datum.
  const leesFacturen = () => fetchAllRows<
    SalesInvoice & { original_invoice_id?: string | null; created_at?: string | null }
  >((from, to) => supabase
    .from('invoices')
    .select('id, invoice_number, client_name, client_email, invoice_date, due_date, total_inc_btw, amount_paid, status, invoice_type, original_invoice_id, created_at')
    .eq('sender_id', acting.ownerId)
    .eq('created_by', acting.actorId)
    .order('id', { ascending: true })
    .range(from, to) as unknown as PromiseLike<{ data: (SalesInvoice & { original_invoice_id?: string | null; created_at?: string | null })[] | null; error: { message: string } | null }>)

  const pipeline = createPipelineClient()

  // ── [WATERVAL] De facturen en de naam van de baas weten niets van elkaar ────────────
  //
  // Allebei hangen ze alleen aan `acting`, dat hierboven al vaststaat, en toch wachtte de naam op
  // de facturenlijst. Het herinneringsspoor verderop hoort er NIET bij: dat vraagt naar precies
  // deze factuur-id's en kan dus per definitie niet eerder.
  //
  // De naam van het bedrijf waarvoor hij werkt. Het profiel van de eigenaar is voor zijn sessie
  // onleesbaar (RLS), dus via service_role — en pas nádat de koppeling is bewezen, wat hierboven
  // is gebeurd: getActingFor() geeft alleen een andere ownerId terug bij een geldige koppeling.
  const [facturenRes, { data: baas }] = await Promise.all([
    // [NO-SILENT-EMPTY] fetchAllRows gooit op een leesfout; hier wordt dat de bestaande derde
    // stand van dit scherm in plaats van een foutpagina — de lijst zegt dan dat ze onleesbaar is.
    leesFacturen().then((rows) => ({ rows, fout: false })).catch(() => ({ rows: null, fout: true })),
    pipeline.from('profiles').select('company_name, full_name').eq('id', acting.ownerId).single(),
  ])

  // [NO-SILENT-EMPTY] Een mislukte lezing werd een bord met "€ 0,00 staat open" en een lege
  // lijst — de verkeerdste twee uitspraken die dit scherm kan doen. De [SPOOR-BEWIJS]-regel
  // hieronder repareerde precies dit voor het herinnerspoor; de hoofdlezing miste hem nog.
  const facturenOnleesbaar = facturenRes.fout
  // Nieuwste eerst, zoals dit scherm altijd toonde — nu in JS, omdat de LEZING op `id` loopt.
  const facturenRuw = facturenRes.rows
    ? [...facturenRes.rows].sort((a, b) => (b.created_at ?? '').localeCompare(a.created_at ?? ''))
    : null
  const facturen: SalesInvoice[] = facturenRuw ?? []

  // [DEEL-CREDIT] Hoeveel er per factuur is gecrediteerd, zodat "openstaand" het RESTANT noemt en
  // niet het volle bedrag. Alleen de creditnota's die deze medewerker zelf heeft gemaakt tellen
  // mee — de leesgrens hierboven (created_by) is een bewuste keuze uit acting-for.ts en wordt hier
  // niet opgerekt. Een creditnota die de eigenaar zelf schreef blijft dus buiten beeld; dat is
  // hetzelfde als wat hij van de rest van de administratie ziet, en het is de veilige kant: het
  // bedrag staat dan te hoog, nooit te laag, en de herinnering zelf gaat langs de route die de
  // volledige controle wél doet.
  const gecrediteerd: Record<string, number> = {}
  for (const [id, bedrag] of creditedTotalsFrom(
    (facturenRuw ?? []).filter((f) => f.invoice_type === 'creditnota'),
  )) {
    gecrediteerd[id] = bedrag
  }

  const vert = await serverTranslator()
  const bedrijf = baas?.company_name || baas?.full_name || vert('vkp.werkgever')

  // Het herinneringsspoor. invoice_reminders heeft geen leespolicy voor een medewerker (de tabel
  // hoort bij de eigenaar), dus service_role — strak gescoopt op de facturen die hierboven al
  // door RLS zijn goedgekeurd. Zonder dit zou de knop "herinner" aanbieden op een factuur waar
  // gisteren al een mail over uitging.
  const ids = facturen.map((f) => f.id)
  if (ids.length) {
    try {
      // [HERINNER-AFKAP] Was een kale `.in()` met een weggegooide `error`, in een try/catch die niet
      // kón afgaan: supabase-js geeft een fout TERUG in plaats van hem te gooien, dus een 414 op een
      // lange id-lijst of de stille afkap op ~1000 rijen kwam hier binnen als `data: null` en werd
      // `?? []`. Elke factuur kreeg dan reminder_count 0 en last_reminder_at null.
      //
      // Wat daarop volgt is geen weergavefout. canRemind leest precies die twee velden, dus de knop
      // "herinner" verschijnt op facturen die het maximum van drie herinneringen al hebben gehad en
      // op facturen die nog in hun afkoelperiode zitten — een tweede mail naar een klant die er
      // gisteren al een kreeg. De regel drie regels hierboven zegt letterlijk dat dat niet mag.
      //
      // fetchAllRowsForIds hakt de id-lijst én paginieert, en gooit bij een fout, zodat een
      // onvolledige lezing niet als "nog nooit herinnerd" kan doorgaan.
      const herinneringen = await fetchAllRowsForIds<{ invoice_id: string; sent_at: string; status: string }, string>(
        ids,
        (chunk, from, to) => pipeline
          .from('invoice_reminders')
          .select('invoice_id, sent_at, status')
          .in('invoice_id', chunk)
          .neq('status', 'failed')
          .order('id', { ascending: true })
          .range(from, to),
      )
      const perFactuur = new Map<string, { laatste: string; aantal: number }>()
      for (const r of [...herinneringen].sort((a, b) => (b.sent_at ?? '').localeCompare(a.sent_at ?? '')) as Array<{ invoice_id: string; sent_at: string }>) {
        const b = perFactuur.get(r.invoice_id)
        if (b) b.aantal++
        else perFactuur.set(r.invoice_id, { laatste: r.sent_at, aantal: 1 })
      }
      for (const f of facturen) {
        const b = perFactuur.get(f.id)
        f.last_reminder_at = b?.laatste ?? null
        f.reminder_count = b?.aantal ?? 0
      }
    } catch {
      // [SPOOR-BEWIJS] Mislukt de lezing, dan blijft het spoor leeg — en een leeg spoor is geen
      // "er ging nog niets uit", maar "we weten het niet". Dat maakt de knop RUIMER dan hij hoort
      // te zijn.
      //
      // Hier stond `f.reminder_count = undefined` met de bedoeling de knop dan helemaal uit te
      // zetten. Dat deed het niet. `undefined` verbergt alleen het chipje "N eerder verstuurd" op
      // de rij; canRemind leest `(f.reminder_count ?? 0)`, dus undefined wordt nul en het plafond
      // van drie herinneringen valt juist wég. De regel eronder — "de route toetst dezelfde regel
      // nog een keer" — klopte ook niet: die route liet de fout van diezelfde lezing vallen, dus
      // hij kreeg exact hetzelfde lege spoor voorgeschoteld. Twee lagen die naar elkaar wezen.
      //
      // Nu wordt de vraag gesteld in plaats van geraden: canRemind weigert op dit veld, met een
      // zin die zegt wat er niet te lezen viel. De route zet hem óók, op zijn eigen lezing.
      for (const f of facturen) {
        f.reminder_count = undefined
        f.reminderTrailKnown = false
      }
    }
  }

  // [BETAALBEWIJS] Deliberately NOT on this screen, and that is a decision rather than an omission.
  //
  // The evidence line under "Betaald" names the bank line that carries the payment — the date, the
  // counterparty and the statement text. Those rows live under `user_id = auth.uid()`, so the
  // reader here often cannot see them at all: this page is the EMPLOYEE's, and their read boundary
  // is `created_by = actorId` on purpose (acting-for.ts). Showing it would mean fetching the
  // OWNER's bank through service_role and handing it to somebody whose view of the administratie
  // was narrowed on purpose — widening a privacy boundary for a nicety.
  //
  // The owner gets the line on their own list (/dashboard/facturen), where their own session reads
  // their own rows and RLS scopes it exactly. If an employee ever needs it, that is a product
  // decision about what a medewerker may see, not a rendering detail.

  // De klok komt van hier: de pagina is force-dynamic, dus de server weet hoe laat het is en
  // client en server komen op dezelfde standen uit. Zie de kop van VerkoopClient.
  // [MEDEWERKER] Zijn EIGEN profielrij, voor de kop van dit bord — niet die van de eigenaar.
  // Zonder deze kop heeft hij geen bel en geen uitlogknop; zie MedewerkerHeader voor wat dat
  // laatste op een gedeelde baliecomputer betekent. Eigen rij, dus zijn eigen sessie mag hem lezen.
  const { data: eigenProfiel } = await supabase
    .from('profiles')
    .select('id, full_name, company_name, email, role')
    .eq('id', acting.actorId)
    .maybeSingle()

  return (
    <VerkoopClient
      facturen={facturen}
      bedrijf={bedrijf}
      nu={readClock()}
      gecrediteerd={gecrediteerd}
      laadFout={facturenOnleesbaar}
      profiel={eigenProfiel ?? { id: acting.actorId, full_name: null, company_name: null, email: null, role: null }}
    />
  )
}

/**
 * Het eerlijke einde van een koppeling.
 *
 * Geen foutmelding — er is niets misgegaan. Zijn werkgever heeft de toegang revoked, en dat
 * mag die op elk moment. Wat deze medewerker moet weten is precies drie dingen: dat het bewust
 * is gebeurd, dat zijn werk niet weg is, en bij wie hij moet zijn.
 */
function GeenToegangMeer({ bedrijf, sinds, t }: { bedrijf: string; sinds: string; t: Translator }) {
  const ms = Date.parse(sinds)
  // Datumnotatie blijft dd-mm-jjjj: zo staat hij op elk Nederlands document dat deze medewerker kent.
  const datum = Number.isFinite(ms) ? new Date(ms).toLocaleDateString('nl-NL') : null
  return (
    <div style={{ minHeight: '100vh', background: M3.bg, fontFamily: FONT, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div style={{ background: M3.surface, border: `1px solid ${M3.hairline}`, borderRadius: R.lg, padding: 28, maxWidth: 460 }}>
        <h1 style={{ fontSize: 19, fontWeight: 700, color: M3.onSurface, margin: '0 0 10px' }}>
          {t('vkp.titel', { bedrijf })}
        </h1>
        <p style={{ fontSize: 14.5, color: M3.neutral, margin: '0 0 12px', lineHeight: 1.6 }}>
          {datum ? t('vkp.uitlegMetDatum', { bedrijf, datum }) : t('vkp.uitleg', { bedrijf })}
        </p>
        <p style={{ fontSize: 14.5, color: M3.neutral, margin: '0 0 12px', lineHeight: 1.6 }}>
          <strong style={{ color: M3.onSurface }}>{t('vkp.nietWegKop')}</strong>
          {t('vkp.nietWegRest', { bedrijf })}
        </p>
        <p style={{ fontSize: 13.5, color: M3.mutedText, margin: 0, lineHeight: 1.6 }}>
          {t('vkp.vraag', { bedrijf })}
        </p>
      </div>
    </div>
  )
}
