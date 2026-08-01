// src/app/dashboard/layout.tsx
// [BOEK-SENTRY] Wraps ALL /dashboard/* pages with Sentry user context — May 2026
// Server component: fetches profile once, passes to SentryUserProvider

import { createServerSupabaseClient } from '@/lib/supabase-server'
import SentryUserProvider from '@/components/providers/SentryUserProvider'
import GlobalSearchLauncher from '@/components/search/GlobalSearchLauncher'
import DashboardChrome from '@/components/nav/DashboardChrome'
import { SubPageHeaderProvider } from '@/components/nav/SubPageHeaderContext'
import { BottomNav } from '@/components/nav/BottomNav'
import { getActingFor } from '@/lib/acting-for-server'
import { isNamens } from '@/lib/acting-for'

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

  // [NAMENS] Een verkoopmedewerker krijgt de navigatie van de eigenaar NIET te zien.
  //
  // Zijn profiles.role is gewoon 'zzper' — hij is een normale gebruiker die toevallig voor
  // iemand anders werkt. Zonder deze regel ziet hij dus de volledige balk: Bank, Kas, Aangifte,
  // Brug. Klikken bounct hem terug (de middleware), en een menu vol links die je terugwerpen is
  // erger dan geen menu: het laat de app kapot lijken terwijl hij precies doet wat hij moet doen.
  //
  // Dit is presentatie, geen grens — de grens is RLS. Verdwijnt deze regel, dan ziet hij weer
  // links die nergens heen gaan, geen gegevens van zijn baas.
  const acting = await getActingFor()
  const isMedewerker = !!acting && isNamens(acting)

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
        {profile && !isMedewerker && <DashboardChrome role={subnavRole} />}
        {/* [MOBILE] .dash-content reserves room for the bottom bar below 640px,
            so the last row of a list is not left sitting behind it. */}
        <div className="dash-content">{children}</div>
      </SubPageHeaderProvider>
      {/* [SEARCH] Global search — reachable on every dashboard page (see component
          for where it hides). Only mounts for a logged-in profile. */}
      {profile && !isMedewerker && <GlobalSearchLauncher />}
      {/* [MOBILE] Phone-only global navigation — the counterpart to the top-bar
          links that hide below 640px. Role-aware destinations; see the component. */}
      {profile && !isMedewerker && <BottomNav role={subnavRole} />}
    </>
  )
}