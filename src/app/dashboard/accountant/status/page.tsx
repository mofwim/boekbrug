// src/app/dashboard/accountant/status/page.tsx
// [KLAAR-OVERZICHT] Server component: auth + accountant-role guard, fetches the
// lightweight linked-client list, renders the board. Each client's rich readiness
// is fetched client-side from /api/readiness (?clientId=…) — the same endpoint and
// verdict the owner's screen uses. Mirrors src/app/dashboard/accountant/page.tsx.

import { redirect } from 'next/navigation'
import { createServerSupabaseClient } from '@/lib/supabase-server'
import KlantReadinessOverzicht from '@/modules/accountant/pages/KlantReadinessOverzicht'
import { getLinkedClientList } from '@/modules/accountant/accountant.repository'
import { lastCompletedQuarter } from '@/lib/quarter'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Wie is klaar? — BoekBrug' }

export default async function KlaarOverzichtPage() {
  const supabase = await createServerSupabaseClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('id, role, onboarding_done')
    .eq('id', user.id)
    .single()

  if (!profile) redirect('/login')
  if (!profile.onboarding_done) redirect('/onboarding')
  if (profile.role !== 'accountant') redirect('/dashboard')

  const clients = await getLinkedClientList(profile.id)

  // Default to the same quarter the owner's readiness screen defaults to, so the
  // board and the client's own "Ben ik klaar?" show the same period out of the box.
  const { year, quarter } = lastCompletedQuarter()

  return <KlantReadinessOverzicht clients={clients} year={year} quarter={quarter} />
}
