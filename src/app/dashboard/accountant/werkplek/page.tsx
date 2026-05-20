// src/app/dashboard/accountant/werkplek/page.tsx
// [BOEK-028] Accountant werkplek route — May 2026
// Separate path from /dashboard/werkplek (ZZP) to avoid cross-import issues.

import { redirect } from 'next/navigation'
import { createServerSupabaseClient } from '@/lib/supabase-server'
import AccountantWerkplek from '@/modules/accountant/pages/AccountantWerkplek'

export const dynamic = 'force-dynamic'

export default async function AccountantWerkplekPage() {
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('role, onboarding_done')
    .eq('id', user.id)
    .single()

  if (!profile?.onboarding_done) redirect('/onboarding')
  if (profile.role !== 'accountant') redirect('/dashboard/werkplek')

  return <AccountantWerkplek />
}