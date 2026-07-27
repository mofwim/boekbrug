// src/app/dashboard/accountant/page.tsx
// [BOEK-028] Accountant Portal — Phase 2 — May 2026
//
// Server component: fetches profile + all accountant data via repository.
// Passes pre-fetched data as props to AccountantHome (client component).
// No data fetching happens in the client — only UI state.

import { redirect } from 'next/navigation'
import { createServerSupabaseClient } from '@/lib/supabase-server'
import AccountantHome from '@/modules/accountant/pages/AccountantHome'
import {
  getAccountantClients,
  getAccountantOverview,
  getTodoFeed,
} from '@/modules/accountant/accountant.repository'

export const dynamic = 'force-dynamic'

export default async function AccountantPage() {
  const supabase = await createServerSupabaseClient()

  // Auth
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  // Profile
  const { data: profile } = await supabase
    .from('profiles')
    .select('id, full_name, company_name, email, role, onboarding_done')
    .eq('id', user.id)
    .single()

  if (!profile) redirect('/login')
  if (!profile.onboarding_done) redirect('/onboarding')
  if (profile.role !== 'accountant') redirect('/dashboard')

  // All data fetched server-side via repository — no supabase.from() in the client
  // [FAN-OUT] De klantenlijst EERST, dan pas het overzicht dat erop rekent. Deze drie
  // stonden in één Promise.all, en getAccountantOverview haalde de lijst intern nóg een
  // keer op — met de vijf queries per klant eraan vast. Bij 30 klanten was dat 300 queries
  // in plaats van 150 op het traagste scherm dat de boekhouder opent.
  const [clients, todos] = await Promise.all([
    getAccountantClients(profile.id),
    getTodoFeed(profile.id),
  ])
  const overview = await getAccountantOverview(profile.id, clients)

  // Notifications — fetched server-side, passed as initial state to client
  const { data: notifications } = await supabase
    .from('notifications')
    .select('*')
    .eq('user_id', profile.id)
    .order('created_at', { ascending: false })
    .limit(20)

  const { count: unreadMessages } = await supabase
    .from('messages')
    .select('id', { count: 'exact', head: true })
    .eq('receiver_id', profile.id)
    .eq('read', false)

  return (
      <AccountantHome
        profile={{
          id: profile.id,
          full_name: profile.full_name,
          company_name: profile.company_name,
          email: profile.email,
          // Zonder role viel de header terug op de ZZP-variant: het logo linkte vanaf de
          // boekhouderspagina naar /dashboard in plaats van /dashboard/accountant.
          role: profile.role,
        }}
        overview={overview}
        clients={clients}
        todos={todos}
        notifications={notifications ?? []}
        unreadMessages={unreadMessages ?? 0}
      />
    
    )
}



