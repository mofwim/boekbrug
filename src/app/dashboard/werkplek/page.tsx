// src/app/dashboard/werkplek/page.tsx
// [CONTROL] Server guard — this is the ZZP werkplek. Accountants were leaking in
// via the header nav and got served a wrong-role screen with no redirect. The UI
// lives in WerkplekClient.tsx; this wrapper enforces the role.

import { redirect } from 'next/navigation'
import { createServerSupabaseClient } from '@/lib/supabase-server'
import { getSessionUser } from '@/lib/session-user'
import WerkplekClient from './WerkplekClient'

export const dynamic = 'force-dynamic'

export default async function WerkplekPage() {
  const supabase = await createServerSupabaseClient()
  // [WATERVAL] Memoised per request (session-user.ts) — the dashboard layout above already asked.
  const user = await getSessionUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('role, onboarding_done')
    .eq('id', user.id)
    .single()

  if (!profile?.onboarding_done) redirect('/onboarding')
  // [ROLE-PARITY] accountant werkplek merged into the accountant home; send there.
  if (profile.role === 'accountant') redirect('/dashboard/accountant')

  return <WerkplekClient />
}
