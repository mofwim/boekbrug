// src/app/dashboard/layout.tsx
// [BOEK-SENTRY] Wraps ALL /dashboard/* pages with Sentry user context — May 2026
// Server component: fetches profile once, passes to SentryUserProvider

import { createServerSupabaseClient } from '@/lib/supabase-server'
import SentryUserProvider from '@/components/providers/SentryUserProvider'
import GlobalSearchLauncher from '@/components/search/GlobalSearchLauncher'

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()

  let profile: { id: string; email?: string | null; role?: string | null } | null = null

  if (user) {
    const { data } = await supabase
      .from('profiles')
      .select('id, email, role')
      .eq('id', user.id)
      .single()
    profile = data
  }

  return (
    <>
      {profile && (
        // [BOEK-SENTRY] user context available on every /dashboard/* page
        <SentryUserProvider
          userId={profile.id}
          email={profile.email}
          role={profile.role}
        />
      )}
      {children}
      {/* [SEARCH] Global search — reachable on every dashboard page (see component
          for where it hides). Only mounts for a logged-in profile. */}
      {profile && <GlobalSearchLauncher />}
    </>
  )
}