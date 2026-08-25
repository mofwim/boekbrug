// src/app/dashboard/bank/verdelen/[txId]/page.tsx
// [BETAALPLAN] Server component: auth, de bankregel, en de facturen die deze betaling MAG raken.
//
// De richtingsgrens valt hier, niet op het scherm. Geld dat wegging betaalt inkoopfacturen; geld
// dat binnenkwam betaalt verkoopfacturen. Een lijst die de verkeerde kant toont, nodigt uit tot een
// fout die daarna nergens meer opvalt — een afschrijving geboekt op een verkoopfactuur meldt omzet
// die nooit is binnengekomen, en geen enkel scherm verderop kan zien dat dat niet zo is.
//
// De server stuurt dus alleen wat mag. payment-plan.ts weigert het bovendien nóg een keer, en de
// route weigert het een derde keer: dit is geen dubbelop maar de volgorde waarin geld hoort te
// worden bewaakt — het scherm helpt, de server beslist.

import { redirect } from 'next/navigation'
import { getSessionUser } from '@/lib/session-user'
import { createPipelineClient } from '@/lib/supabase-pipeline'
import { settleableDirection } from '@/lib/payment-plan'
import { allocatedOnLine } from '@/lib/bank-line-budget'
import VerdeelClient, { type VerdeelFactuur } from './VerdeelClient'
import { round2 } from '@/lib/invoice-totals'

export const dynamic = 'force-dynamic'

export default async function VerdeelPage({ params }: { params: Promise<{ txId: string }> }) {
  const { txId } = await params

  // [WATERVAL] Memoised per request (session-user.ts) — the dashboard layout above already asked.
  const user = await getSessionUser()
  if (!user) redirect('/login')

  const pipeline = createPipelineClient()

  // ── [WATERVAL] De regel zelf en wat er al aan hangt ─────────────────────────
  //
  // De koppelingslezing hieronder vraagt naar transaction_id — dat is txId, en dat staat al in de
  // URL. Ze wachtte dus op de bankregel zonder er iets van nodig te hebben. Wat er WEL van afhangt
  // staat in de tweede golf: de facturen áchter die koppelingen, en de lijst om uit te kiezen (die
  // hangt aan het teken van het bedrag).
  //
  // allSettled voor de tweede: die telling mág mislukken — zie de try eronder — en met Promise.all
  // zou een mislukte koppelingslezing de bankregel meesleuren en dit scherm onbereikbaar maken.
  const [txS, linksS] = await Promise.allSettled([
    pipeline
      .from('bank_transactions')
      .select('id, amount, date, description, counterpart_name, user_id, status')
      .eq('id', txId)
      .eq('user_id', user.id)
      .maybeSingle(),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (pipeline as any)
      .from('bank_tx_invoices')
      .select('invoice_id, amount_applied')
      .eq('transaction_id', txId)
      .eq('user_id', user.id) as Promise<{ data: Array<{ invoice_id: string; amount_applied: number | null }> | null }>,
  ])

  if (txS.status === 'rejected') throw txS.reason
  const { data: tx } = txS.value
  if (!tx) redirect('/dashboard/bank')
  // [CIRKEL-P3] Alleen een 'pending' regel is hier verdeelbaar. Een genegeerde of al geboekte
  // regel toonde een normaal verdeelscherm waarvan de submit pas bij de server strandde — de
  // eigenaar koos facturen voor niets. allocate_bank_payment weigert het toch; dit zegt het vooraf.
  if ((tx as { status?: string | null }).status !== 'pending') redirect('/dashboard/bank?tab=done&quarter=all')

  // Wat eerdere koppelingen al van deze regel namen. De optelling zelf staat onder de tweede golf,
  // bij het getal dat eruit komt.
  const rows = linksS.status === 'fulfilled'
    ? ((linksS.value.data ?? []) as Array<{ invoice_id: string; amount_applied: number | null }>)
    : []

  const richting = settleableDirection(Number(tx.amount) || 0)

  // ── [WATERVAL] Tweede golf: de facturen achter de koppelingen, en de keuzelijst ──
  const [linkedS, { data: invRows }] = await Promise.all([
    rows.length > 0
      ? pipeline
          .from('invoices')
          .select('id, direction, invoice_type, total_inc_btw')
          .in('id', rows.map((r) => r.invoice_id))
          .or(`sender_id.eq.${user.id},receiver_id.eq.${user.id}`)
          .then((r) => r, () => ({ data: null }))
      : Promise.resolve({ data: null }),
    pipeline
      .from('invoices')
      .select('id, direction, invoice_type, invoice_number, client_name, invoice_date, total_inc_btw, amount_paid, accountant_status')
      .or(`sender_id.eq.${user.id},receiver_id.eq.${user.id}`)
      .eq('direction', richting)
      // [BETAALPLAN] UITSLUITEN, niet opsommen — en dat verschil is hier een fout waard.
      //
      // Hier stond een lijst met toegestane statussen, waaronder 'partial'. Die status bestaat niet:
      // de CHECK op invoices.status kent draft, sent, paid, overdue, received, processing, processed,
      // unclear en archived, en een deels betaalde factuur HOUDT gewoon zijn status — alleen
      // amount_paid verschuift (apply_bank_payment zet pas 'paid' als het bedrag rond is). De lijst
      // beschreef dus een toestand die niet kan bestaan, en dat viel niet op omdat een IN-filter met
      // een onbekende waarde niet klaagt: hij vindt hem gewoon nooit.
      //
      // Erger is wat een opsomming stilzwijgend WEGLAAT. Elke status die iemand later toevoegt valt
      // er buiten, en het gevolg is geen foutmelding maar een factuur die de eigenaar niet kan
      // aanwijzen terwijl hij hem wel moet betalen. Uitsluiten faalt de andere kant op: een nieuwe
      // status verschijnt in de lijst en valt op, in plaats van te verdwijnen en niet op te vallen.
      //
      // Wat hier NIET thuishoort is precies te benoemen: een concept is nog geen schuld, betaald is
      // geen schuld meer, gearchiveerd is uit beeld, en 'processing'/'unclear' zijn stukken die de
      // eigenaar nog moet bevestigen — daar geld op boeken zou een bedrag vastleggen dat nog niet
      // eens is nagekeken.
      .not('status', 'in', '(draft,paid,archived,processing,unclear)')
      .order('invoice_date', { ascending: true })
      .limit(300),
  ])

  // De som via allocatedOnLine — dezelfde als in /api/bank/allocate en in allocate_bank_payment
  // onder zijn lock. Ontbreekt ze (mislukte lezing), dan is het scherm ruimer dan nodig en weigert
  // de route alsnog: precies dezelfde uitkomst als toen deze lezing hier nog stond.
  //
  // [CREDITNOTA] Deze telling stond hier uitgeschreven, met Math.abs eromheen, en dat is precies
  // waar hij misging: een creditnota van € 150 die al aan deze regel hing NAM geen € 150, hij GAF
  // € 150. Als magnitude geteld verdween er € 300 uit het budget en toonde dit scherm een betaling
  // die al "helemaal verdeeld" was terwijl er nog € 1.000 te verdelen viel. Drie kopieën van
  // dezelfde som is hoe dat kon: één ervan wist het, twee niet. Nu is het er één.
  const linked = linkedS.data
  const alreadyAllocated = rows.length > 0 && linked
    ? allocatedOnLine(rows, linked, Number(tx.amount) || 0).allocated
    : 0

  const facturen: VerdeelFactuur[] = (invRows ?? [])
    // Een factuur die de boekhouder al verwerkte is dicht voor nieuw geld — hem tonen zou een
    // keuze aanbieden die de server een klik later weigert.
    .filter((r) => r.accountant_status !== 'verwerkt')
    .map((r) => {
      const total = Math.abs(Number(r.total_inc_btw) || 0)
      const paid = Math.abs(Number(r.amount_paid) || 0)
      return {
        id: r.id,
        direction: richting,
        invoiceType: r.invoice_type,
        totalIncBtw: r.total_inc_btw,
        amountPaid: r.amount_paid,
        invoiceNumber: r.invoice_number,
        partyName: r.client_name,
        invoiceDate: r.invoice_date,
        open: round2(Math.max(0, total - paid)),
      }
    })
    .filter((f) => f.open > 0.005)

  return (
    <VerdeelClient
      transactie={{
        id: tx.id,
        amount: Number(tx.amount) || 0,
        date: tx.date,
        description: tx.description,
        counterpartName: tx.counterpart_name,
        alreadyAllocated,
      }}
      facturen={facturen}
    />
  )
}
