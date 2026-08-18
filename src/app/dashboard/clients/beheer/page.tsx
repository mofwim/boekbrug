// src/app/dashboard/clients/beheer/page.tsx
// [BOEK-028] Klanten beheer page — May 2026

import { redirect } from 'next/navigation'
import { createServerSupabaseClient } from '@/lib/supabase-server'
import { getSessionUser } from '@/lib/session-user'
import KlantenBeheer from '@/modules/accountant/pages/KlantenBeheer'
import { getAccountantClients } from '@/modules/accountant/accountant.repository'

export const dynamic = 'force-dynamic'

export default async function KlantenBeheerPage() {
  const supabase = await createServerSupabaseClient()
  // [WATERVAL] Memoised per request (session-user.ts) — the dashboard layout above already asked.
  const user = await getSessionUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('id, role, onboarding_done')
    .eq('id', user.id)
    .single()

  if (!profile?.onboarding_done) redirect('/onboarding')
  if (profile.role !== 'accountant') redirect('/dashboard')

  const clients = await getAccountantClients(profile.id)

  return <KlantenBeheer initialClients={clients} />
}