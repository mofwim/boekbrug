// src/app/dashboard/accountant/agenda/page.tsx
// [WERKBOARD] Server component: auth + accountant-role guard, fetches the
// lightweight linked-client list, renders the unified board (deadline + readiness
// + reminder). Each client's rich readiness is fetched client-side from
// /api/readiness. Mirrors src/app/dashboard/accountant/page.tsx.

import { redirect } from 'next/navigation'
import { createServerSupabaseClient } from '@/lib/supabase-server'
import AccountantWerkboard from '@/modules/accountant/pages/AccountantWerkboard'
import { getLinkedClientList } from '@/modules/accountant/accountant.repository'
import { getActiveAangifte } from '@/modules/accountant/accountant.service'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Aangifte & status — BoekBrug' }

export default async function WerkboardPage() {
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

  // Default to the quarter currently being filed (previous quarter) — the same
  // period the deadline hero counts down to and the client's own readiness screen
  // defaults to, so board and client agree out of the box.
  const { year, quarter } = getActiveAangifte()

  return <AccountantWerkboard clients={clients} year={year} quarter={quarter} />
}
