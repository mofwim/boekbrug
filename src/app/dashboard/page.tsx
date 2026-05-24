// src/app/dashboard/page.tsx
// [INTEGRATION] role-based entry routing — May 2026

import { createServerSupabaseClient } from '@/lib/supabase-server'
import { redirect } from 'next/navigation'
import DashboardClient from './DashboardClient'

export const dynamic = 'force-dynamic'

export default async function DashboardPage() {
  const supabase = await createServerSupabaseClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .single()

  // [INTEGRATION] no profile or incomplete onboarding → /onboarding — May 2026
  if (!profile || !profile.onboarding_done) redirect('/onboarding')

  // [INTEGRATION] accountant → accountant hub — May 2026
  if (profile.role === 'accountant') redirect('/dashboard/accountant')

  // ZZP → existing DashboardClient (unchanged)
  return <DashboardClient profile={profile} />
}