// src/app/dashboard/settings/team/page.tsx
// [ACTING-FOR] Wie mag er onder MIJN BTW-nummer factureren?
//
// De zwaarste bevoegdheid die een eigenaar kan weggeven, dus krijgt hij zijn eigen scherm in
// plaats van een schakelaartje in een lijst. Wat je hier geeft is niet "toegang tot de app" maar
// het recht om wettelijke stukken uit te geven op naam van je bedrijf.

import { redirect } from 'next/navigation'
import { getActingFor } from '@/lib/acting-for-server'
import { isActingForOther } from '@/lib/acting-for'
import TeamClient from './TeamClient'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Team — BoekBrug' }

export default async function TeamPage() {
  const acting = await getActingFor()
  if (!acting) redirect('/login')
  // Een medewerker beheert geen medewerkers — zie /api/company/members, die het ook weigert.
  if (isActingForOther(acting)) redirect('/dashboard/verkoop')
  return <TeamClient />
}
