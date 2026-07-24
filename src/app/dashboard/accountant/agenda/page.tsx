// src/app/dashboard/accountant/agenda/page.tsx
// [AANGIFTE-AGENDA] Server component: auth + accountant-role guard, fetches the
// BTW filing agenda via the repository, renders the client component. No data
// fetching in the client — mirrors src/app/dashboard/accountant/page.tsx.

import { redirect } from 'next/navigation'
import { createServerSupabaseClient } from '@/lib/supabase-server'
import AangifteAgendaPage from '@/modules/accountant/pages/AangifteAgenda'
import { getAangifteAgenda } from '@/modules/accountant/accountant.repository'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Aangifte-agenda — BoekBrug' }

export default async function AgendaPage() {
  const supabase = await createServerSupabaseClient()

  // Auth
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  // Accountant-only, onboarding-complete (same guard as the accountant home)
  const { data: profile } = await supabase
    .from('profiles')
    .select('id, role, onboarding_done')
    .eq('id', user.id)
    .single()

  if (!profile) redirect('/login')
  if (!profile.onboarding_done) redirect('/onboarding')
  if (profile.role !== 'accountant') redirect('/dashboard')

  const agenda = await getAangifteAgenda(profile.id)

  return <AangifteAgendaPage agenda={agenda} />
}
