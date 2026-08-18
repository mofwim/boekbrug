// src/app/dashboard/clients/invite/page.tsx
// [COHERENCE-INVITE] Server-guard the accountant role before rendering the invite UI.
// This page had NO role guard (unlike its accountant siblings clients/beheer, werkplek,
// brug), so a shop owner (role 'zzper') could open it by URL and — since /api/invite/client
// never checked caller role and RLS only requires auth.uid()=zzper_id — successfully create
// an accountant→client invitation with themselves as the 'accountant'. Guard both layers.

import { redirect } from 'next/navigation'
import { createServerSupabaseClient } from '@/lib/supabase-server'
import { getSessionUser } from '@/lib/session-user'
import InviteClient from './InviteClient'

export const dynamic = 'force-dynamic'

export default async function InviteClientPage() {
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

  return <InviteClient />
}
