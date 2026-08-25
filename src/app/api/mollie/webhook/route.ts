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
// "Al betaald?"-knop — met het rij-id van de link als p_client_key. Die sleutel maakt elke
// herbezorging (Mollie belt tot 10×) een geregistreerde replay in plaats van een tweede
// boeking, bovenop onze eigen status!='paid'-controle. LEAST() in de RPC klemt bovendien een
// overbetaling af die kan ontstaan als er tussen link en webhook nog een handmatige
// deelbetaling is geboekt.
//
// Antwoordcodes zijn voor MOLLIE, niet voor mensen: 200 = afgehandeld (ook "niets te doen"),
// 5xx = probeer straks opnieuw (transiënt). Nooit een 200 op een mislukte boeking — dan zou
// Mollie stoppen met bellen en de betaling voorgoed ongeboekt blijven.

import { NextRequest, NextResponse } from 'next/server'
import { createPipelineClient } from '@/lib/supabase-pipeline'
import { getMollieConnection } from '@/lib/mollie-connection'
import { getMolliePaymentLink, linkVerdict } from '@/lib/mollie'

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
  if (rowErr) return NextResponse.json({ error: 'lookup failed' }, { status: 503 })
  if (!row) return NextResponse.json({ ok: true })
  const link = row as { id: string; user_id: string; invoice_id: string; link_id: string; amount_value: string; status: string }

  // Al verwerkt → klaar. (De insert-race vangt apply_manual_payment's idempotentiesleutel af;
  // dit bespaart alleen de Mollie-rondreis.)
  if (link.status === 'paid') return NextResponse.json({ ok: true })
  if (link.link_id.startsWith('pending-')) return NextResponse.json({ ok: true })

  const connection = await getMollieConnection(link.user_id)
  if (!connection) return NextResponse.json({ error: 'connection unavailable' }, { status: 503 })

  const fetched = await getMolliePaymentLink(connection.apiKey, link.link_id)
  if ('error' in fetched) return NextResponse.json({ error: 'verify failed' }, { status: 503 })

  const verdict = linkVerdict(fetched, { linkId: link.link_id, amountValue: link.amount_value })
  if (verdict.action === 'not_paid') return NextResponse.json({ ok: true })
  if (verdict.action === 'refuse') {
    // Geverifieerd en NIET in orde (bedrag/valuta wijkt af). Dit is geen transiënt: vastleggen
    // en 200 — de eigenaar ziet de factuur gewoon open staan en het spoor staat op de rij.
    console.error('[MOLLIE] webhook geweigerd', { rowId, invoiceId: link.invoice_id, reason: verdict.reason })
    await pipeline.from('mollie_payment_links').update({ last_error: verdict.reason }).eq('id', link.id).eq('user_id', link.user_id)
    return NextResponse.json({ ok: true })
  }

  // paid → boek door de ene vergrendelde deur. payment_date = Mollie's paidAt-DAG: onder het
  // kasstelsel beslist die datum het BTW-kwartaal. p_method 'bank', want dat is wat een
  // iDEAL-betaling IS (bankgeld, geen la) — en het enige dat bank_tx_invoices_method_check
  // naast 'kas' toestaat.
  const payDate = verdict.paidAt.slice(0, 10)
  const { error: payErr } = await pipeline.rpc('apply_manual_payment', {
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
    // Al (volledig) betaald of al geboekt onder deze sleutel: afgehandeld, geen herhaalbezoek nodig.
    if (msg.includes('already') || msg.includes('idempotency')) {
      await pipeline.from('mollie_payment_links').update({ status: 'paid', paid_at: verdict.paidAt, marked_at: new Date().toISOString() }).eq('id', link.id).eq('user_id', link.user_id)
      return NextResponse.json({ ok: true })
    }
    // 'verwerkt' of 'not payable': de boekhouder heeft dit kwartaal vergrendeld of de factuur is
    // ingetrokken terwijl de link uitstond. Er IS geld ontvangen — dat mag niet geruisloos
    // wegzakken. Spoor op de rij + luid loggen; 200 want opnieuw bellen lost dit niet op.
    console.error('[MOLLIE] betaling ontvangen maar niet boekbaar', { rowId, invoiceId: link.invoice_id, error: payErr.message })
    await pipeline.from('mollie_payment_links').update({ last_error: `betaald bij Mollie, niet geboekt: ${payErr.message}`.slice(0, 500) }).eq('id', link.id).eq('user_id', link.user_id)
    if (msg.includes('verwerkt') || msg.includes('not payable')) return NextResponse.json({ ok: true })
    return NextResponse.json({ error: 'booking failed' }, { status: 503 })
  }

  await pipeline
    .from('mollie_payment_links')
    .update({ status: 'paid', paid_at: verdict.paidAt, marked_at: new Date().toISOString() })
    .eq('id', link.id)
    .eq('user_id', link.user_id)
  return NextResponse.json({ ok: true })
}
