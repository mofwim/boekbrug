// src/app/api/mollie/webhook/route.ts
// [MOLLIE] POST — Mollie belt aan als er iets met een betaallink gebeurde.
//
// HET POST-LICHAAM IS EEN DEURBEL, NOOIT EEN BEWIJS. Mollie-webhooks dragen geen handtekening;
// het verificatiemodel (Mollie's eigen) is: haal de bron zelf op, geauthenticeerd, en geloof
// alleen dat. Deze route leest dus uitsluitend zijn EIGEN opgeslagen pl_-id na bij Mollie, met
// de sleutel van de eigenaar, en legt dat antwoord aan linkVerdict voor. Wat een aanvaller die
// dit adres kent maximaal kan bereiken is dat wij iets NAKIJKEN.
//
// De boeking zelf gaat door apply_manual_payment — dezelfde vergrendelde RPC als de
// "Al betaald?"-knop — met het rij-id van de link als p_client_key. Onder gelijktijdigheid
// dedupliceert niet de pre-lock SELECT maar de partiële unieke index
// bank_tx_invoices_client_key_unique ONDER het rijslot: de verliezer van een race krijgt een
// 23505 (→ 503 hier), en de eerstvolgende herbezorging vindt de boeking en krijgt
// duplicate=true. Zelfherstellend. LEAST() in de RPC klemt een overbetaling af die kan ontstaan
// als er tussen link en webhook nog een handmatige deelbetaling is geboekt — en dat afklemmen
// is een GEBEURTENIS (de klant heeft recht op teruggave), dus het retourrecord wordt GELEZEN en
// een afgeklemd bedrag slaat alarm in plaats van te verdampen.
//
// [MOLLIE-TRIAGE] De foutafhandeling volgt de leer van invoice_manual_payment_idempotency_scope
// .sql regel 135: een REPLAY van dezelfde boeking gooit NIETS (duplicate=true, error=null), dus
// ELKE exception uit de RPC betekent "de boeking is NIET gebeurd" — terwijl Mollie het geld wél
// heeft. "already fully paid"/"already covered" is daarom nooit een onschuldig "klaar": het is
// een klant die mogelijk twee links op één factuur betaalde. Zulke uitkomsten krijgen een
// data-integrity-alarm (reportHandledFailure), een leesbare zin op mollie_connections.last_error
// (de regel die MollieCard de eigenaar toont) én een spoor op de linkrij — nooit een stille 200.
//
// Antwoordcodes zijn voor MOLLIE, niet voor mensen: 200 = afgehandeld (ook "vastgelegd en
// gealarmeerd"), 5xx = probeer straks opnieuw (transiënt). Elke 5xx slaat zelf ook alarm: Mollie
// belt ~10 keer en zwijgt daarna voorgoed, en een betaling die dan nog niet geboekt is mag niet
// alleen in een gestopte retrylus bestaan.

import { NextRequest, NextResponse } from 'next/server'
import { createPipelineClient } from '@/lib/supabase-pipeline'
import { getMollieConnection, setMollieConnectionError } from '@/lib/mollie-connection'
import { getMolliePaymentLink, linkVerdict } from '@/lib/mollie'
import { reportHandledFailure } from '@/lib/report-handled'
// [TZ] De betaaldag komt uit een klok van een DERDE — Mollie serialiseert met offset (in de
// praktijk +00:00). Een kale slice(0,10) dateert een betaling van 00:30 Amsterdam op de dag
// ervóór, en onder het kasstelsel is dat een BTW-kwartaal dat al ingediend kan zijn — precies
// het faalpatroon dat format-nl.ts:91 beschrijft. Dus: de Amsterdamse dag van dat moment.
import { amsterdamToday } from '@/lib/format-nl'

export const dynamic = 'force-dynamic'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function POST(req: NextRequest) {
  // Het rij-id reist in de query van de webhook-URL die WIJ registreerden. Zonder geldig id is
  // er niets om na te kijken — 200, want opnieuw bellen verandert daar niets aan.
  const rowId = req.nextUrl.searchParams.get('link')
  if (!rowId || !UUID_RE.test(rowId)) return NextResponse.json({ ok: true })

  // mollie_payment_links komt uit mollie.sql (met de hand toegepast) en staat niet in de
  // gegenereerde typen — zelfde ontspannen client als intake_claims, om dezelfde reden.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pipeline = createPipelineClient() as any
  const { data: row, error: rowErr } = await pipeline
    .from('mollie_payment_links')
    .select('id, user_id, invoice_id, link_id, amount_value, status')
    .eq('id', rowId)
    .maybeSingle()
  if (rowErr) {
    reportHandledFailure({
      tag: 'MOLLIE', severity: 'gate-unavailable',
      message: 'Mollie-webhook kon de linkrij niet lezen — betaling mogelijk nog niet geboekt, Mollie belt opnieuw.',
      context: { rowId },
    })
    return NextResponse.json({ error: 'lookup failed' }, { status: 503 })
  }
  if (!row) return NextResponse.json({ ok: true })
  const link = row as { id: string; user_id: string; invoice_id: string; link_id: string; amount_value: string; status: string }

  // Al verwerkt → klaar. Een 'superseded' rij slaat deze poort BEWUST niet over: de oude link
  // leeft bij Mollie door (niets annuleert hem daar) en kan echt betaald zijn — dat geld moet
  // geboekt of luid gemeld, nooit genegeerd omdat wíj de rij al vervangen hadden.
  if (link.status === 'paid') return NextResponse.json({ ok: true })
  if (link.link_id.startsWith('pending-')) return NextResponse.json({ ok: true })

  const connection = await getMollieConnection(link.user_id)
  if (!connection) {
    // De eigenaar ontkoppelde Mollie terwijl er nog een betaalronde liep. Na ~10 retries zwijgt
    // Mollie voorgoed: zonder dit alarm bestond die betaling daarna NERGENS meer.
    reportHandledFailure({
      tag: 'MOLLIE', severity: 'gate-unavailable',
      message: 'Mollie-webhook zonder koppeling: eigenaar ontkoppelde terwijl een betaallink uitstond — betaling kan onboekbaar worden.',
      context: { rowId, invoiceId: link.invoice_id, userId: link.user_id },
    })
    return NextResponse.json({ error: 'connection unavailable' }, { status: 503 })
  }

  const fetched = await getMolliePaymentLink(connection.apiKey, link.link_id)
  if ('error' in fetched) {
    reportHandledFailure({
      tag: 'MOLLIE', severity: 'gate-unavailable',
      message: 'Mollie-webhook kon de link niet nalezen (sleutel ingetrokken of Mollie onbereikbaar) — betaling mogelijk nog niet geboekt.',
      context: { rowId, invoiceId: link.invoice_id, detail: fetched.error },
    })
    return NextResponse.json({ error: 'verify failed' }, { status: 503 })
  }

  const verdict = linkVerdict(fetched, { linkId: link.link_id, amountValue: link.amount_value })
  if (verdict.action === 'not_paid') return NextResponse.json({ ok: true })
  if (verdict.action === 'refuse') {
    // Geverifieerd en NIET in orde (bedrag/valuta wijkt af). Dit is geen transiënt: vastleggen,
    // alarmeren en 200 — de eigenaar ziet de factuur gewoon open staan.
    console.error('[MOLLIE] webhook geweigerd', { rowId, invoiceId: link.invoice_id, reason: verdict.reason })
    reportHandledFailure({
      tag: 'MOLLIE', severity: 'data-integrity',
      message: `Mollie-antwoord geweigerd bij verificatie: ${verdict.reason}`,
      context: { rowId, invoiceId: link.invoice_id },
    })
    await pipeline.from('mollie_payment_links').update({ last_error: verdict.reason }).eq('id', link.id).eq('user_id', link.user_id)
    await setMollieConnectionError(link.user_id, `Een iDEAL-betaling kon niet worden gecontroleerd (${verdict.reason}). De factuur staat nog open.`)
    return NextResponse.json({ ok: true })
  }

  // paid → boek door de ene vergrendelde deur. p_method 'bank', want dat is wat een
  // iDEAL-betaling IS (bankgeld, geen la) — en het enige dat bank_tx_invoices_method_check
  // naast 'kas' toestaat.
  const payDate = amsterdamToday(new Date(verdict.paidAt))
  const { data: applyRows, error: payErr } = await pipeline.rpc('apply_manual_payment', {
    p_user_id: link.user_id,
    p_invoice_id: link.invoice_id,
    p_amount: Number(link.amount_value),
    p_pay_date: payDate,
    p_method: 'bank',
    p_payable_statuses: ['sent', 'overdue'],
    p_client_key: link.id,
  })

  if (payErr) {
    const msg = (payErr.message ?? '').toLowerCase()
    console.error('[MOLLIE] betaling ontvangen maar niet geboekt', { rowId, invoiceId: link.invoice_id, error: payErr.message })

    // [MOLLIE-TRIAGE] "already fully paid"/"already covered": de RPC gooit dit alléén als de
    // boeking NIET gebeurde (een echte replay antwoordt duplicate=true zonder exception). Mollie
    // heeft het geld dus wél — de klant betaalde vermoedelijk twee links op één factuur (een
    // vervangen link blijft bij Mollie betaalbaar). Rij op 'paid' (de Mollie-kant IS betaald,
    // en dat stopt herverwerking) mét de weigering als spoor, alarm, en de zin op de kaart.
    if (msg.includes('already fully paid') || msg.includes('already covered')) {
      const { data: sibling } = await pipeline
        .from('mollie_payment_links')
        .select('id, amount_value')
        .eq('user_id', link.user_id)
        .eq('invoice_id', link.invoice_id)
        .eq('status', 'paid')
        .neq('id', link.id)
        .limit(1)
        .maybeSingle()
      const dubbel = sibling
        ? ` Er is al een eerdere iDEAL-betaling van € ${(sibling as { amount_value: string }).amount_value} op deze factuur geboekt — de klant lijkt dubbel betaald te hebben en heeft recht op teruggave.`
        : ''
      const zin = `Een iDEAL-betaling van € ${link.amount_value} is bij Mollie ontvangen maar NIET geboekt: de factuur was al volledig gedekt.${dubbel} Controleer je Mollie-saldo en betaal zo nodig terug.`
      reportHandledFailure({
        tag: 'MOLLIE', severity: 'data-integrity',
        message: 'iDEAL-betaling ontvangen op een al gedekte factuur — mogelijk dubbel betaald, teruggave nodig.',
        context: { rowId, invoiceId: link.invoice_id, userId: link.user_id },
      })
      await pipeline.from('mollie_payment_links')
        .update({ status: 'paid', paid_at: verdict.paidAt, marked_at: new Date().toISOString(), last_error: zin })
        .eq('id', link.id).eq('user_id', link.user_id)
      await setMollieConnectionError(link.user_id, zin)
      return NextResponse.json({ ok: true })
    }

    // Idempotentiesleutel op een ANDERE boeking uitgegeven: een anomalie die opnieuw bellen niet
    // oplost. Vastleggen + alarm, rij NIET op 'paid' (er is hier niets geboekt en niets bewezen).
    if (msg.includes('idempotency')) {
      reportHandledFailure({
        tag: 'MOLLIE', severity: 'data-integrity',
        message: 'Mollie-boeking geweigerd: idempotentiesleutel hoort bij een andere boeking.',
        context: { rowId, invoiceId: link.invoice_id },
      })
      await pipeline.from('mollie_payment_links')
        .update({ last_error: `betaald bij Mollie, niet geboekt: ${payErr.message}`.slice(0, 500) })
        .eq('id', link.id).eq('user_id', link.user_id)
      return NextResponse.json({ ok: true })
    }

    // 'verwerkt' of 'not payable': de boekhouder vergrendelde het kwartaal of de factuur is
    // ingetrokken terwijl de link uitstond. Er IS geld ontvangen — zeg het overal.
    await pipeline.from('mollie_payment_links')
      .update({ last_error: `betaald bij Mollie, niet geboekt: ${payErr.message}`.slice(0, 500) })
      .eq('id', link.id).eq('user_id', link.user_id)
    if (msg.includes('verwerkt') || msg.includes('not payable')) {
      reportHandledFailure({
        tag: 'MOLLIE', severity: 'data-integrity',
        message: 'iDEAL-betaling ontvangen maar de factuur is niet meer boekbaar (verwerkt/ingetrokken).',
        context: { rowId, invoiceId: link.invoice_id, detail: payErr.message },
      })
      await setMollieConnectionError(link.user_id, `Een iDEAL-betaling van € ${link.amount_value} is ontvangen maar kon niet op de factuur worden geboekt (${payErr.message}). Boek hem handmatig of overleg met je boekhouder.`)
      return NextResponse.json({ ok: true })
    }
    // Onbekend/transiënt (waaronder de 23505 van een gelijktijdige bezorging): 503, Mollie belt
    // opnieuw en de volgende ronde vindt de boeking (duplicate=true). Toch alarm — als de retry-
    // reeks uitdooft, mag dit niet alleen in een gestopte lus hebben bestaan.
    reportHandledFailure({
      tag: 'MOLLIE', severity: 'gate-unavailable',
      message: 'Mollie-boeking tijdelijk mislukt — Mollie belt opnieuw.',
      context: { rowId, invoiceId: link.invoice_id, detail: payErr.message },
    })
    return NextResponse.json({ error: 'booking failed' }, { status: 503 })
  }

  // Geboekt. Lees wat de RPC ECHT toepaste: LEAST() kan een overbetaling hebben afgeklemd
  // (tussentijdse deelbetaling), en dat verschil is klantgeld dat terug moet — een feit, geen
  // voetnoot. applied < gevraagd ⇒ alarm + zin op de kaart; de rij wordt gewoon 'paid'.
  const applied = Array.isArray(applyRows) && applyRows[0] ? Number((applyRows[0] as { applied: unknown }).applied) : null
  let overpayNote: string | null = null
  if (applied != null && Number.isFinite(applied) && applied < Number(link.amount_value) - 0.005) {
    const teveel = (Number(link.amount_value) - applied).toFixed(2)
    overpayNote = `iDEAL-betaling van € ${link.amount_value} deels afgeklemd: € ${applied.toFixed(2)} geboekt, € ${teveel} was meer dan er open stond. De klant heeft recht op € ${teveel} teruggave.`
    reportHandledFailure({
      tag: 'MOLLIE', severity: 'data-integrity',
      message: 'iDEAL-overbetaling afgeklemd — klant heeft recht op teruggave.',
      context: { rowId, invoiceId: link.invoice_id },
    })
    await setMollieConnectionError(link.user_id, overpayNote)
  }

  await pipeline
    .from('mollie_payment_links')
    .update({ status: 'paid', paid_at: verdict.paidAt, marked_at: new Date().toISOString(), ...(overpayNote ? { last_error: overpayNote } : {}) })
    .eq('id', link.id)
    .eq('user_id', link.user_id)
  return NextResponse.json({ ok: true })
}
