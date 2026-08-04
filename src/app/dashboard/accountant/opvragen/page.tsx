// src/app/dashboard/accountant/opvragen/page.tsx
// [OPVRAGEN] De boekhouder vraagt bij een klant de ontbrekende stukken op.
//
// GEEN MANDAAT NODIG — zie de kop van /api/accountant/vraag-stukken. Dit is de ene handeling in
// het portaal die de boekhouder onder zijn EIGEN naam doet: hij praat met zijn eigen klant, er
// gaat niets uit onder diens BTW-nummer en er verandert niets aan diens boeken. De grens is dus de
// koppeling, precies zoals bij een gewoon bericht.
//
// Deze pagina haalt alleen de keuzelijsten op. De gaten zelf komen uit /api/readiness, dat zijn
// eigen autorisatie doet (resolveQuarterOwner) — dus ook als deze lijst ooit te ruim zou zijn,
// krijgt de boekhouder nog steeds geen kwartaal te zien van iemand aan wie hij niet gekoppeld is.

import { redirect } from 'next/navigation'
import { createServerSupabaseClient } from '@/lib/supabase-server'
import { lastCompletedQuarter } from '@/lib/quarter'
import AccountantOpvragen, { type OpvraagKlant } from '@/modules/accountant/pages/AccountantOpvragen'

export const dynamic = 'force-dynamic'

/**
 * De klok, één keer gelezen, buiten de render om — zelfde reden als in /dashboard/verkoop:
 * `new Date()` in het lichaam van een component is onzuiver, en de React-compiler zegt dat terecht.
 */
function readClock(): Date {
  return new Date()
}

/** De vier kwartalen die een boekhouder in de praktijk nog opvraagt, nieuwste eerst. */
function recenteKwartalen(now: Date): { year: number; quarter: number; label: string }[] {
  const { year, quarter } = lastCompletedQuarter(now)
  const uit: { year: number; quarter: number; label: string }[] = []
  let j = year
  let k = quarter
  for (let i = 0; i < 4; i++) {
    uit.push({ year: j, quarter: k, label: `Q${k} ${j}` })
    k -= 1
    if (k === 0) {
      k = 4
      j -= 1
    }
  }
  return uit
}

export default async function AccountantOpvragenPage() {
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

  // Sessie-client: RLS geeft een boekhouder alleen zijn eigen koppelingen, dus een fout in deze
  // query kan geen vreemde klant in de lijst zetten.
  const { data: links } = await supabase
    .from('accountant_clients')
    .select('zzper_id')
    .eq('accountant_id', user.id)

  const ids = Array.from(new Set((links ?? []).map((l) => l.zzper_id).filter((v): v is string => !!v)))

  let klanten: OpvraagKlant[] = []
  if (ids.length > 0) {
    const { data: profielen } = await supabase
      .from('profiles')
      .select('id, full_name, company_name')
      .in('id', ids)
    klanten = (profielen ?? [])
      .map((p) => ({ id: p.id, naam: p.company_name || p.full_name || 'Klant' }))
      .sort((a, b) => a.naam.localeCompare(b.naam, 'nl'))
  }

  return <AccountantOpvragen klanten={klanten} kwartalen={recenteKwartalen(readClock())} />
}
