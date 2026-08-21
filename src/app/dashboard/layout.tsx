// src/app/dashboard/layout.tsx
// [BOEK-SENTRY] Wraps ALL /dashboard/* pages with Sentry user context — May 2026
// Server component: fetches profile once, passes to SentryUserProvider

import { createServerSupabaseClient } from '@/lib/supabase-server'
import SentryUserProvider from '@/components/providers/SentryUserProvider'
import GlobalSearchLauncher from '@/components/search/GlobalSearchLauncher'
import DashboardChrome from '@/components/nav/DashboardChrome'
import { SubPageHeaderProvider } from '@/components/nav/SubPageHeaderContext'
import { BottomNav } from '@/components/nav/BottomNav'
import { sellsOverCounter } from '@/lib/vak-profile'
import FeedbackButton from '@/components/feedback/FeedbackButton'
import { getActingFor } from '@/lib/acting-for-server'
import { getSessionUser } from '@/lib/session-user'
import { isActingForOther } from '@/lib/acting-for'

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const supabase = await createServerSupabaseClient()
  // [WATERVAL] Memoised per request (session-user.ts): this layout, the page inside it and
  // getActingFor() below render in ONE React pass and all three want the same verified user.
  // They used to ask the auth server three separate times, in sequence, before a byte left.
  const user = await getSessionUser()

  // ── [WATERVAL] Het profiel en "namens wie" hangen niet van elkaar af ────────────────
  //
  // Ze stonden onder elkaar, dus de rol wachtte op het profiel terwijl geen van beide iets van de
  // ander wilde weten — allebei kennen ze alleen user.id. Deze layout draait boven ELKE
  // /dashboard/*-pagina, dus die ene overbodige wachtbeurt zat op elk scherm in de app.
  //
  // getActingFor() staat er ook in als er niemand is ingelogd. Dat kost niets: hij ziet dan zelf
  // geen gebruiker en geeft meteen null terug, zonder één query.
  const [profileRes, acting] = await Promise.all([
    user
      ? supabase.from('profiles').select('id, email, role').eq('id', user.id).single()
      : Promise.resolve({ data: null }),
    // [ACTING-FOR] Een verkoopmedewerker krijgt de navigatie van de eigenaar NIET te zien.
    //
    // Zijn profiles.role is gewoon 'zzper' — hij is een normale gebruiker die toevallig voor
    // iemand anders werkt. Zonder deze regel ziet hij dus de volledige balk: Bank, Kas, Aangifte,
    // Brug. Klikken bounct hem terug (de middleware), en een menu vol links die je terugwerpen is
    // erger dan geen menu: het laat de app kapot lijken terwijl hij precies doet wat hij moet doen.
    //
    // Dit is presentatie, geen grens — de grens is RLS. Verdwijnt deze regel, dan ziet hij weer
    // links die nergens heen gaan, geen gegevens van zijn baas.
    getActingFor(),
  ])
  const profile = profileRes.data as { id: string; email?: string | null; role?: string | null } | null

  // [SUBNAV] Viewer role for the shared sub-page header (resolves role-aware
  // parent/home via src/lib/navigation.ts).
  const subnavRole = profile?.role === 'accountant' ? 'accountant' : 'zzper'
  // [VAK-BRUG] Does this owner take his money at a counter? Decides which second destination the
  // phone bar carries — see OWNER_COUNTER in BottomNav.tsx.
  //
  // ⚠️ Read APART from the profile select above, and that separation is the whole point. Adding
  // `vak` to that select would make the entire read fail on any deployment where profile_vak.sql
  // has not been applied by hand — and `profile` being null does not degrade one feature here, it
  // removes the dashboard shell: every `{profile && …}` below is the chrome, the search launcher,
  // the navigation bar and the Sentry user. A navigation nicety must never be able to take the
  // navigation with it. Same shape as the account_purpose read in /onboarding/page.tsx, for the
  // same reason and at the same cost of one small query.
  //
  // Unknown trade → false → the invoice-shaped bar everyone has had until now, so nothing changes
  // for anyone who has not told us a trade.
  let counterTrade = false
  if (profile) {
    try {
      const { data: vakRow } = await supabase
        .from('profiles').select('vak').eq('id', profile.id).maybeSingle()
      counterTrade = sellsOverCounter((vakRow as { vak?: string | null } | null)?.vak)
    } catch {
      /* no column yet → the bar everyone has always had */
    }
  }

  const isMedewerker = !!acting && isActingForOther(acting)

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
      {profile && !isMedewerker && <BottomNav role={subnavRole} counter={counterTrade} />}
      {/* [FEEDBACK] "Er ging iets mis" — op ELKE /dashboard/*-pagina, hier één keer gemonteerd.
          Per pagina toevoegen betekent na een half jaar op de helft van de pagina's, en dan juist
          niet op het scherm waar iets misging: dat is meestal het minst bezochte.

          Wél voor een verkoopmedewerker, anders dan de navigatie hierboven. Die wordt voor hem
          verborgen omdat de links hem terugwerpen — een menu vol doodlopende wegen. Hier is het
          omgekeerd: hij werkt in dezelfde app en loopt tegen dezelfde dingen aan, en juist bij hem
          is de weg terug naar de eigenaar het langst. Hem als enige het meldkanaal ontzeggen zou
          betekenen dat precies de problemen die hij tegenkomt niemand bereiken. */}
      {profile && <FeedbackButton />}
    </>
  )
}