// src/app/dashboard/accountant/factuur/page.tsx
// [MANDAAT] De boekhouder factureert namens een klant die hem daarvoor gemachtigd heeft.
//
// Deze pagina haalt ALLEEN de lijst op waaruit hij mag kiezen. Ze is geen grens: de echte controle
// staat in getActingForClient() en wordt bij elke POST opnieuw gedaan, en daarónder nog eens in de
// database (next_invoice_seq + prevent_accountant_amount_changes). Zo hoort het volgens de Next-
// documentatie over de Data Access Layer: wat een scherm toont is optimistisch, wat een route doet
// is de waarheid. Een klant die zijn machtiging intrekt terwijl deze pagina openstaat, krijgt geen
// factuur meer — de knop is er nog, het antwoord is 403.

import { redirect } from 'next/navigation'
import { createServerSupabaseClient } from '@/lib/supabase-server'
import { getSessionUser } from '@/lib/session-user'
import AccountantFactuur, { type GemachtigdeKlant } from '@/modules/accountant/pages/AccountantFactuur'

export const dynamic = 'force-dynamic'

export default async function AccountantFactuurPage() {
  const supabase = await createServerSupabaseClient()

  // [WATERVAL] Memoised per request (session-user.ts) — the dashboard layout above already asked.
  const user = await getSessionUser()
  if (!user) redirect('/login')

  // ── [WATERVAL] Drie lezingen die alleen user.id kennen ──────────────────────
  //
  // Het profiel, de mandaten en de koppelingen stonden onder elkaar met een `await` ervoor. Geen
  // van drieën wachtte op een van de andere twee; ze wachtten alleen op de regel erboven.
  const [{ data: profile }, { data: mandaten }, { data: alleLinks }] = await Promise.all([
    supabase.from('profiles').select('role, onboarding_done').eq('id', user.id).maybeSingle(),

    // De levende mandaten. RLS geeft een boekhouder alleen zijn eigen rijen, dus dit kan met de
    // sessie-client — en dat is hier het punt: een fout in deze query kan geen vreemde klant tonen.
    supabase
      .from('accountant_invoice_mandates')
      .select('zzper_id')
      .eq('accountant_id', user.id)
      .is('revoked_at', null),

    // [VRAAG-MACHTIGING] Alle GEKOPPELDE klanten, ook (juist) die zonder machtiging. Zonder deze
    // lijst is de lege staat een doodlopende weg: hij legt uit dat de klant het moet aanzetten, en
    // biedt geen manier om het hem te vragen.
    supabase.from('accountant_clients').select('zzper_id').eq('accountant_id', user.id),
  ])

  if (!profile) redirect('/login')
  if (!profile.onboarding_done) redirect('/onboarding')
  if (profile.role !== 'accountant') redirect('/dashboard')

  const ids = Array.from(new Set((mandaten ?? []).map((m) => m.zzper_id).filter(Boolean)))
  const alleIds = Array.from(new Set((alleLinks ?? []).map((l) => l.zzper_id).filter((v): v is string => !!v)))

  // ── [WATERVAL] Tweede golf: de drie die de id's van hierboven nodig hadden ───
  //
  // De namenlijst hangt aan alleIds, de koppelingscontrole en de profielen aan ids. Van elkáár
  // hangen ze niet af, en zo stonden ze wel: drie ritten waar één rit volstaat.
  //
  // De koppeling moet er óók zijn. has_active_invoice_mandate() eist hem in de database, dus een
  // mandaat zonder koppeling zou hier een naam in de lijst zetten waarvoor elke verzending faalt.
  //
  // (`links` is per definitie de doorsnede van `alleLinks` met `ids`, dus in theorie kan hij uit
  // het geheugen. Niet gedaan: alleLinks is ONGEFILTERD en loopt daarmee tegen PostgREST's stille
  // ~1000-rijenplafond aan waar de gefilterde versie dat nooit doet. Een boekhouder met meer dan
  // duizend koppelingen zou dan klanten kwijtraken uit een lijst die hij nooit ziet krimpen — en
  // dat is precies het soort stille afkapping waar deze codebase elders paginering voor heeft.)
  const [{ data: alleProfielen }, { data: links }, { data: profielen }] = await Promise.all([
    alleIds.length > 0
      ? supabase.from('profiles').select('id, full_name, company_name').in('id', alleIds)
      : Promise.resolve({ data: [] as Array<{ id: string; full_name: string | null; company_name: string | null }> }),
    ids.length > 0
      ? supabase.from('accountant_clients').select('zzper_id').eq('accountant_id', user.id).in('zzper_id', ids)
      : Promise.resolve({ data: [] as Array<{ zzper_id: string | null }> }),
    ids.length > 0
      ? supabase.from('profiles').select('id, full_name, company_name, btw_number').in('id', ids)
      : Promise.resolve({ data: [] as Array<{ id: string; full_name: string | null; company_name: string | null; btw_number: string | null }> }),
  ])

  const gekoppeld: { id: string; naam: string }[] = (alleProfielen ?? [])
    .map((p) => ({ id: p.id, naam: p.company_name || p.full_name || 'Klant' }))
    .sort((a, b) => a.naam.localeCompare(b.naam, 'nl'))

  let klanten: GemachtigdeKlant[] = []
  if (ids.length > 0) {
    const gekoppeldeIds = new Set((links ?? []).map((l) => l.zzper_id).filter(Boolean))
    klanten = (profielen ?? [])
      .filter((p) => gekoppeldeIds.has(p.id))
      .map((p) => ({
        id: p.id,
        naam: p.company_name || p.full_name || 'Klant',
        btwNummer: p.btw_number ?? null,
      }))
      .sort((a, b) => a.naam.localeCompare(b.naam, 'nl'))
  }

  return <AccountantFactuur klanten={klanten} gekoppeld={gekoppeld} />
}
