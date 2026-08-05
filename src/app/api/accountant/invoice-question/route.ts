// src/app/api/accountant/invoice-question/route.ts
// [FACTUURVRAAG] De boekhouder stelt een vraag over ÉÉN factuur van zijn klant.
//
// ── WAT ER ONTBRAK, EN HOE ZICHTBAAR DAT WAS ──
// Dit is de meest gestelde vraag van een boekhouder over een administratie: "die ene regel, wat is
// dat?" — privé of zakelijk, welk project, waarom 21% en niet 9%. Ze had geen plek in de app.
//
// Ze was wel overal INGETEKEND. `invoices.accountant_status = 'vraag'` wordt op drie plekken
// GELEZEN: de KPI "Open vraag" op de boekhouderhome, de rode stip bij een klant in Klantenbeheer,
// en het ❓-punt op het werkboard. Geschreven werd hij door geen enkele route. De databasetrigger
// (accountant_write_guard_fix) staat een boekhouder uitdrukkelijk toe accountant_status en
// accountant_note te verzetten — de toestemming was verleend, het pad nooit gebouwd. En de chip
// "? Vraag" staat in InvoiceRow.tsx achter `isAccountantMode`, dat nergens waar is.
//
// Drie tellers die eeuwig nul aanwijzen, en een gesprek dat daarom via WhatsApp liep.
//
// ── WAAROM DIT GEEN MANDAAT VEREIST ──
// Dezelfde grens als /api/accountant/vraag-stukken: de koppeling, niet de machtiging. Een vraag
// stellen boekt niets, wijzigt geen bedrag en gaat niet uit onder het BTW-nummer van de klant. De
// boekhouder praat met zijn eigen klant. Bevestigen is iets anders en houdt daarom zijn mandaat.
//
// Wat er wél verandert is `accountant_status`, en dat is precies wat die kolom is: een BEWERING VAN
// DE BOEKHOUDER over een factuur. De klant kan hem lezen en beantwoorden; afvinken doet de
// boekhouder zelf. Daarom zet het antwoord van de klant de status níét terug — dat zou de bewering
// van de één in het vakje van de ander schrijven.
//
// ── TWEE SCHRIJFACTIES, EN WAAROM DE VOLGORDE ZO IS ──
// De status staat op de factuur (daar kijken de drie tellers), de TEKST staat in
// accountant_subject_status (daar staat vraag_text al voor documenten, en de CHECK van die tabel
// noemt 'invoice' sinds dag één). De tekst gaat eerst: een status 'vraag' zonder tekst is de
// situatie die dit hele bestand komt oplossen — de klant ziet dat er iets is en niet wat.

import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase-server'
import { createPipelineClient } from '@/lib/supabase-pipeline'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { logAuditAction } from '@/lib/audit'
import { VRAAG_STATUS, vraagTekst } from '@/lib/vragen'

export const dynamic = 'force-dynamic'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
/** Genoeg voor een echte vraag, kort genoeg om een notificatie niet te laten ontsporen. */
const MAX_TEXT = 500

export async function POST(request: NextRequest) {
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Niet ingelogd.' }, { status: 401 })

  const body = await request.json().catch(() => null)
  const clientId = typeof body?.clientId === 'string' ? body.clientId : ''
  const invoiceId = typeof body?.invoiceId === 'string' ? body.invoiceId : ''
  if (!UUID.test(clientId) || !UUID.test(invoiceId)) {
    return NextResponse.json({ error: 'Ongeldig verzoek' }, { status: 400 })
  }
  // Een lege vraag is geen vraag. Weigeren is eerlijker dan een status zetten waar de klant niets
  // mee kan — dat is exact de toestand die deze route komt opheffen.
  const question = vraagTekst(typeof body?.question === 'string' ? body.question.slice(0, MAX_TEXT) : null)
  if (!question) return NextResponse.json({ error: 'Vraag is leeg' }, { status: 400 })

  const limit = await checkRateLimit({
    userId: user.id,
    endpoint: '/api/accountant/invoice-question',
    ...RATE_LIMITS.INVOICE_SEND,
  })
  if (!limit.allowed) return rateLimitResponse(limit)

  // De koppeling is de grens, en zij wordt IN CODE gecontroleerd — niet met clientId in een
  // PostgREST-filter, waar hij extra syntax kan injecteren. Zelfde vorm als /api/messages en
  // /api/accountant/vraag-stukken.
  const { data: links, error: linkErr } = await supabase
    .from('accountant_clients')
    .select('accountant_id, zzper_id')
    .eq('accountant_id', user.id)
  if (linkErr) {
    // [NO-SILENT-EMPTY] Een mislukte lezing mag nooit als "niet gekoppeld" aankomen: dat leest als
    // een ingetrokken machtiging, en dat is een heel ander bericht dan "probeer het opnieuw".
    console.error('[FACTUURVRAAG] koppelingslezing mislukt', { accountantId: user.id, error: linkErr.message })
    return NextResponse.json({ error: 'De koppeling kon niet worden gecontroleerd — probeer het opnieuw.' }, { status: 503 })
  }
  if (!(links ?? []).some((l) => l.zzper_id === clientId)) {
    return NextResponse.json({ error: 'Je kunt alleen een vraag stellen bij een gekoppelde klant' }, { status: 403 })
  }

  // De factuur, met de SESSIE-client: de boekhouder mag hem zien via de deel-policies, en zo blijft
  // "wat mag deze boekhouder lezen" één antwoord in de database in plaats van twee in de code.
  const { data: invRow, error: invErr } = await supabase
    .from('invoices')
    .select('id, sender_id, receiver_id, invoice_number, client_name, total_inc_btw, accountant_status')
    .eq('id', invoiceId)
    .maybeSingle()
  if (invErr) {
    console.error('[FACTUURVRAAG] factuurlezing mislukt', { accountantId: user.id, invoiceId, error: invErr.message })
    return NextResponse.json({ error: 'De factuur kon niet worden gelezen — probeer het opnieuw.' }, { status: 503 })
  }
  if (!invRow) return NextResponse.json({ error: 'Factuur niet gevonden' }, { status: 404 })

  const inv = invRow as {
    id: string; sender_id: string | null; receiver_id: string | null
    invoice_number: string | null; client_name: string | null; total_inc_btw: number | null
    accountant_status: string | null
  }
  // De factuur moet van DEZE klant zijn. Zichtbaar zijn is niet genoeg: een boekhouder met tien
  // klanten ziet tien administraties, en een vraag die bij de verkeerde klant landt zet een status
  // in boeken waar deze vraag niet over gaat.
  if (inv.sender_id !== clientId && inv.receiver_id !== clientId) {
    return NextResponse.json({ error: 'Deze factuur hoort niet bij deze klant' }, { status: 403 })
  }

  const pipeline = createPipelineClient()

  // ── (1) De TEKST eerst ───────────────────────────────────────────────────────
  // Als deze faalt gaat de status niet om, en dat is de goede volgorde: een 'vraag' zonder tekst is
  // precies het probleem dat deze route oplost. Geschreven met de SESSIE-client — RLS-policy
  // acc_status_owner_write bindt de rij aan accountant_id = auth.uid(), dus service_role zou hier
  // alleen de grens omzeilen die het punt is.
  const { error: textErr } = await (supabase as unknown as {
    from: (t: string) => {
      upsert: (v: Record<string, unknown>, o: { onConflict: string }) => PromiseLike<{ error: { message: string } | null }>
    }
  })
    .from('accountant_subject_status')
    .upsert({
      accountant_id: user.id,
      subject_type: 'invoice',
      subject_id: invoiceId,
      status: VRAAG_STATUS,
      vraag_text: question,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'accountant_id,subject_type,subject_id' })
  if (textErr) {
    console.error('[FACTUURVRAAG] vraagtekst opslaan mislukt', { accountantId: user.id, invoiceId, error: textErr.message })
    return NextResponse.json({ error: 'De vraag kon niet worden opgeslagen — probeer het opnieuw.' }, { status: 500 })
  }

  // ── (2) De STATUS op de factuur ──────────────────────────────────────────────
  // Met de sessie-client, zodat de trigger draait die zegt wat een boekhouder mag verzetten. Slaagt
  // dit niet, dan staat de tekst er wel en de status niet: de klant ziet de vraag dan op
  // /dashboard/vragen (die leest de statusrij), alleen tellen de boekhouderstellers hem nog niet.
  // Dat is de goede kant om op te falen — de vraag bereikt de klant, en wij zeggen het eerlijk.
  const { error: statusErr } = await supabase
    .from('invoices')
    .update({ accountant_status: VRAAG_STATUS })
    .eq('id', invoiceId)
  const statusApplied = !statusErr
  if (statusErr) {
    console.error('[FACTUURVRAAG] status op de factuur zetten mislukt', { accountantId: user.id, invoiceId, error: statusErr.message })
  }

  // ── (3) De klant weten ───────────────────────────────────────────────────────
  // Best-effort: een mislukte melding mag een opgeslagen vraag nooit terugdraaien. De link wijst
  // naar /dashboard/vragen — het scherm met de vraag, de factuur erbij en één veld om te antwoorden
  // — en niet naar een lijst waar de klant zelf mag zoeken wat er bedoeld werd.
  try {
    const label = [inv.client_name?.trim(), inv.invoice_number ? `factuur ${inv.invoice_number}` : null]
      .filter(Boolean).join(' · ')
    await pipeline.from('notifications').insert({
      user_id: clientId,
      title: 'Vraag van je boekhouder',
      body: `${label ? `${label} — ` : ''}${question.slice(0, 120)}`,
      type: 'status',
      read: false,
      link: '/dashboard/vragen',
    })
  } catch (e) {
    console.error('[FACTUURVRAAG] melding mislukt', { clientId, error: e instanceof Error ? e.message : String(e) })
  }

  await logAuditAction({
    userId: user.id,
    action: 'accountant.invoice_question',
    entityType: 'invoice',
    entityId: invoiceId,
    newValue: { client_id: clientId, invoice_number: inv.invoice_number, status_applied: statusApplied },
  }).catch((e) => {
    console.error('[FACTUURVRAAG] audit mislukt', { error: e instanceof Error ? e.message : String(e) })
  })

  return NextResponse.json({ ok: true, statusApplied })
}
