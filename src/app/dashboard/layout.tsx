// src/app/dashboard/layout.tsx
// [BOEK-SENTRY] Wraps ALL /dashboard/* pages with Sentry user context — May 2026
// Server component: fetches profile once, passes to SentryUserProvider

import { createServerSupabaseClient } from '@/lib/supabase-server'
import SentryUserProvider from '@/components/providers/SentryUserProvider'
import GlobalSearchLauncher from '@/components/search/GlobalSearchLauncher'
import DashboardChrome from '@/components/nav/DashboardChrome'
import { SubPageHeaderProvider } from '@/components/nav/SubPageHeaderContext'
import TrialBanner from '@/components/billing/TrialBanner'

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

  // [SUBNAV] Viewer role for the shared sub-page header (resolves role-aware
  // parent/home via src/lib/navigation.ts).
  const subnavRole = profile?.role === 'accountant' ? 'accountant' : 'zzper'

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
      {/* [SUBNAV] Shared sub-page header + the context a page uses to push a
          dynamic title/actions into it. The provider wraps both the bar and
          {children} so a page's useSubPageHeader() registration reaches the bar.
          The bar is placed before {children} so its sticky bar sits at top. */}
      <SubPageHeaderProvider>
        {profile && <DashboardChrome role={subnavRole} />}
        {/* [BILLING] Renders nothing unless a trial is genuinely running out.
            Reads its own data defensively — see the component. */}
        {profile && <TrialBanner />}
        {children}
      </SubPageHeaderProvider>
      {/* [SEARCH] Global search — reachable on every dashboard page (see component
          for where it hides). Only mounts for a logged-in profile. */}
      {profile && <GlobalSearchLauncher />}
    </>
  )
}