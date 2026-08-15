// src/app/dashboard/accountant/debiteuren/page.tsx
// [DEBITEUREN] Waar staat het geld van mijn klanten? Eén lijst over alle klanten die de boekhouder
// gemachtigd hebben.
//
// WAAROM DE MANDAAT-GRENS OOK HIER GELDT
// Een boekhouder mag de administratie van iedere gekoppelde klant INZIEN. Maar dit scherm is geen
// inzage — het is een lijst met knoppen die mail sturen naar de klanten van zijn klant. De grens
// hoort dus bij het mandaat te liggen en niet bij de koppeling, want dat is precies de toestemming
// die de ondernemer bewust heeft gegeven.
//
// WAAROM SERVICE_ROLE VOOR DE DATA
// Dezelfde reden als in accountant-access.ts, en hetzelfde patroon: de TOESTEMMING wordt met de
// sessie-client vastgesteld (RLS geeft een boekhouder alleen zijn eigen mandaten), en pas dáárna
// worden de gegevens opgehaald met sender_id expliciet beperkt tot die klanten. Een openstaande
// verkoopfactuur hoeft niet gedeeld te zijn om te laat te zijn, dus invoices_accountant_read is
// hier te smal — dat zou een chase-lijst opleveren die de helft van het geld niet ziet.

import { redirect } from 'next/navigation'
import { createServerSupabaseClient } from '@/lib/supabase-server'
import { createPipelineClient } from '@/lib/supabase-pipeline'
import { buildDebtorBoard, type DebtorInput } from '@/lib/accountant-debtors'
// [CREDITNOTA-NO-CHASE] De gedeelde regel "is dit nog geld dat ik krijg" — beide helften van een
// gecrediteerd paar moeten samen uit de vorderingenlijst (src/lib/credited-invoices.ts).
import { fullyCreditedIdsFrom, filterOpenReceivables, creditedTotalsFrom } from '@/lib/credited-invoices'
import AccountantDebiteuren from '@/modules/accountant/pages/AccountantDebiteuren'

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
  const { data: links } = await supabase
    .from('accountant_clients')
    .select('zzper_id')
    .eq('accountant_id', accountantId)
  const ids = Array.from(
    new Set((links ?? []).map((l: { zzper_id: string | null }) => l.zzper_id).filter(Boolean)),
  ) as string[]
  if (ids.length === 0) return []
  const { data: profielen } = await supabase
    .from('profiles').select('id, full_name, company_name').in('id', ids)
  return ((profielen ?? []) as Array<{ id: string; full_name: string | null; company_name: string | null }>)
    .map((p) => ({ id: p.id, naam: p.company_name || p.full_name || 'Klant' }))
    .sort((a, b) => a.naam.localeCompare(b.naam, 'nl'))
}


/**
 * De klok, één keer gelezen, buiten de render om.
 *
 * Zelfde vorm als readClock() in /dashboard/verkoop: `Date.now()` in het lichaam van een component
 * wordt door de React-compiler terecht als onzuiver aangemerkt. Hier apart, zodat de renderfunctie
 * puur blijft en "te laat" voor elke rij op hetzelfde moment wordt bepaald — een lijst waarin de
 * ene factuur tegen een andere klok is gemeten dan de volgende, sorteert zichzelf verkeerd.
 */
function readClock(): number {
  return new Date().getTime()
}

export default async function AccountantDebiteurenPage() {
  const supabase = await createServerSupabaseClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('role, onboarding_done')
    .eq('id', user.id)
    .maybeSingle()

  if (!profile) redirect('/login')
  if (!profile.onboarding_done) redirect('/onboarding')
  if (profile.role !== 'accountant') redirect('/dashboard')

  // ── Toestemming, met de sessie ─────────────────────────────────────────────
  const { data: mandaten } = await supabase
    .from('accountant_invoice_mandates')
    .select('zzper_id')
    .eq('accountant_id', user.id)
    .is('revoked_at', null)

  const gemandateerd = Array.from(new Set((mandaten ?? []).map((m) => m.zzper_id).filter(Boolean)))

  if (gemandateerd.length === 0) {
    return <AccountantDebiteuren groepen={[]} geenMandaat gekoppeld={await gekoppeldeKlanten(supabase, user.id)} />
  }

  // De koppeling moet er óók zijn — een mandaat zonder koppeling is een mandaat van een vreemde,
  // en de database eist hem hoe dan ook (has_active_invoice_mandate).
  const { data: links } = await supabase
    .from('accountant_clients')
    .select('zzper_id')
    .eq('accountant_id', user.id)
    .in('zzper_id', gemandateerd)
  const klantIds = Array.from(new Set((links ?? []).map((l) => l.zzper_id).filter((v): v is string => !!v)))

  if (klantIds.length === 0) {
    return <AccountantDebiteuren groepen={[]} geenMandaat gekoppeld={await gekoppeldeKlanten(supabase, user.id)} />
  }

  // ── Data, met service_role en expliciet beperkt tot die klanten ────────────
  const pipeline = createPipelineClient()

  const [{ data: facturen }, { data: profielen }] = await Promise.all([
    pipeline
      .from('invoices')
      .select('id, invoice_number, client_name, client_email, invoice_date, due_date, total_inc_btw, amount_paid, status, sender_id, created_by, reminders_paused, invoice_type, original_invoice_id')
      .in('sender_id', klantIds)
      .eq('direction', 'outgoing')
      // Alleen wat nog geld kan opleveren. 'draft' is geen schuld, 'paid' en 'archived' evenmin —
      // buildDebtorBoard gooit ze er ook uit, maar niet ophalen is goedkoper dan wegfilteren.
      .in('status', ['sent', 'overdue', 'partial'])
      .limit(2000),
    pipeline.from('profiles').select('id, full_name, company_name').in('id', klantIds),
  ])

  const namen: Record<string, string> = {}
  for (const p of profielen ?? []) {
    namen[p.id] = p.company_name || p.full_name || 'Klant'
  }

  // [CREDITNOTA-NO-CHASE] Een creditnota komt hier als PAAR binnen: de creditnota zelf (negatief
  // totaal, status 'sent', vervaldatum vandaag) én de oorspronkelijke factuur, waarvan de status
  // nergens in dit product op 'credited' wordt gezet. Zonder deze filter telt de eerste als een te
  // late vordering van hetzelfde bedrag — outstandingAmount() neemt de absolute waarde — en blijft
  // de tweede staan als geld dat allang is teruggedraaid. Twee keer fout, in dezelfde richting.
  //
  // filterOpenReceivables haalt ze allebei weg; ze horen samen te vertrekken, want alleen het
  // origineel verwijderen maakt het totaal juist negatief.
  const alle = (facturen ?? []) as unknown as Array<
    DebtorInput & { sender_id: string; reminders_paused: boolean | null; invoice_type?: string | null; original_invoice_id?: string | null }
  >
  // [DEEL-CREDIT] Alleen een creditnota die de factuur DEKT haalt hem van de lijst. Een deel
  // gecrediteerd betekent dat de rest nog openstaat, en een debiteurenlijst die dat weglaat laat
  // geld liggen zonder dat er iets rood wordt.
  const creditnotas = alle.filter((r) => r.invoice_type === 'creditnota')
  const rijen = filterOpenReceivables(alle, fullyCreditedIdsFrom(creditnotas, alle))
  // [DEEL-CREDIT] En hoevéél er per factuur is gecrediteerd. De regel hierboven haalt alleen de
  // volledig gecrediteerde facturen van de lijst; zonder deze regel bleef een deels gecrediteerde
  // factuur op haar VOLLE bedrag staan. Dat bedrag is precies wat de boekhouder aan de telefoon
  // opnoemt, terwijl de klant de creditnota in handen heeft.
  const gecrediteerd = creditedTotalsFrom(creditnotas)

  // Het herinneringsspoor. invoice_reminders is per RLS alleen voor de eigenaar leesbaar, dus ook
  // dit gaat via service_role — beperkt tot de facturen die we net zelf hebben opgehaald.
  const factuurIds = rijen.map((r) => r.id)
  const spoor: Record<string, { count: number; last: string | null }> = {}
  if (factuurIds.length > 0) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: herinneringen } = await (pipeline as any)
      .from('invoice_reminders')
      .select('invoice_id, sent_at, status')
      .in('invoice_id', factuurIds)
      .order('sent_at', { ascending: false })
    for (const h of (herinneringen ?? []) as Array<{ invoice_id: string; sent_at: string; status: string }>) {
      // Een mislukte poging telt niet als herinnering — de klant heeft niets ontvangen, en hem
      // daarvoor een beurt laten overslaan zou de fout van ons bij hem neerleggen.
      if (h.status === 'failed') continue
      const bestaand = spoor[h.invoice_id]
      if (bestaand) bestaand.count += 1
      else spoor[h.invoice_id] = { count: 1, last: h.sent_at }
    }
  }

  const invoer: DebtorInput[] = rijen.map((r) => ({
    ...r,
    ownerId: r.sender_id,
    last_reminder_at: spoor[r.id]?.last ?? null,
    reminder_count: spoor[r.id]?.count ?? 0,
  }))

  const groepen = buildDebtorBoard(invoer, namen, readClock(), gecrediteerd)

  return (
    <AccountantDebiteuren
      groepen={groepen.map((g) => ({
        ...g,
        rows: g.rows.map((r) => ({
          ...r,
          // reminders_paused reist mee zodat de rij kan zeggen WAAROM hij grijs is. Het oordeel
          // zelf is al geveld — hier alleen de uitleg.
          paused: Boolean((r.invoice as { reminders_paused?: boolean | null }).reminders_paused),
        })),
      }))}
    />
  )
}
