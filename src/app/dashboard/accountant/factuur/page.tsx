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
import AccountantFactuur, { type GemachtigdeKlant } from '@/modules/accountant/pages/AccountantFactuur'

export const dynamic = 'force-dynamic'

export default async function AccountantFactuurPage() {
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

  // De levende mandaten. RLS geeft een boekhouder alleen zijn eigen rijen, dus dit kan met de
  // sessie-client — en dat is hier het punt: een fout in deze query kan geen vreemde klant tonen.
  const { data: mandaten } = await supabase
    .from('accountant_invoice_mandates')
    .select('zzper_id')
    .eq('accountant_id', user.id)
    .is('revoked_at', null)

  const ids = Array.from(new Set((mandaten ?? []).map((m) => m.zzper_id).filter(Boolean)))

  // De koppeling moet er óók zijn. has_active_invoice_mandate() eist hem in de database, dus een
  // mandaat zonder koppeling zou hier een naam in de lijst zetten waarvoor elke verzending faalt.
  let klanten: GemachtigdeKlant[] = []
  if (ids.length > 0) {
    const [{ data: links }, { data: profielen }] = await Promise.all([
      supabase
        .from('accountant_clients')
        .select('zzper_id')
        .eq('accountant_id', user.id)
        .in('zzper_id', ids),
      supabase
        .from('profiles')
        .select('id, full_name, company_name, btw_number')
        .in('id', ids),
    ])
    const gekoppeld = new Set((links ?? []).map((l) => l.zzper_id).filter(Boolean))
    klanten = (profielen ?? [])
      .filter((p) => gekoppeld.has(p.id))
      .map((p) => ({
        id: p.id,
        naam: p.company_name || p.full_name || 'Klant',
        btwNummer: p.btw_number ?? null,
      }))
      .sort((a, b) => a.naam.localeCompare(b.naam, 'nl'))
  }

  return <AccountantFactuur klanten={klanten} />
}
