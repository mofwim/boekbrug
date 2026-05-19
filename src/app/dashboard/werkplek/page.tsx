// src/app/dashboard/werkplek/page.tsx
// [BOEK-028] Role-based werkplek routing — May 2026
//
// Server component: checks role, renders the correct werkplek view.
// ZZP  → ZzpWerkplek  (Material You, BOEK-029)
// Accountant → AccountantWerkplek (Google Workspace, BOEK-028)

import { redirect } from 'next/navigation'
import { createServerSupabaseClient } from '@/lib/supabase-server'
import AccountantWerkplek from '@/modules/accountant/pages/AccountantWerkplek'
import ZzpWerkplek from './ZzpWerkplek'

export const dynamic = 'force-dynamic'

export default async function WerkplekPage() {
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('role, onboarding_done')
    .eq('id', user.id)
    .single()

  if (!profile?.onboarding_done) redirect('/onboarding')

  if (profile.role === 'accountant') return <AccountantWerkplek />
  return <ZzpWerkplek />
}