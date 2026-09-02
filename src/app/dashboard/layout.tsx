// src/app/dashboard/layout.tsx
// [BOEK-SENTRY] Wraps ALL /dashboard/* pages with Sentry user context — May 2026
// Server component: fetches profile once, passes to SentryUserProvider

import { createServerSupabaseClient } from '@/lib/supabase-server'
import SentryUserProvider from '@/components/providers/SentryUserProvider'
import GlobalSearchLauncher from '@/components/search/GlobalSearchLauncher'
import DashboardChrome from '@/components/nav/DashboardChrome'
import { SubPageHeaderProvider } from '@/components/nav/SubPageHeaderContext'
import { BottomNav } from '@/components/nav/BottomNav'
// [ZIJBALK] The desktop counterpart to BottomNav — same destinations, down the side.
import { DashboardRail } from '@/components/nav/DashboardRail'
import { sellsOverCounter } from '@/lib/vak-profile'
import FeedbackButton from '@/components/feedback/FeedbackButton'
import { getActingFor } from '@/lib/acting-for-server'
import { getSessionUser } from '@/lib/session-user'
import { isActingForOther } from '@/lib/acting-for'
import LocaleRestore from '@/components/i18n/LocaleRestore'

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
  // [MEDEWERKER] Een verkoopmedewerker heeft profiles.role = 'zzper' — hij is een gewone
  // gebruiker die voor iemand anders werkt. Voor de NAVIGATIE is dat wel een eigen geval: zijn
  // thuis is het verkoopbord. Zie het type Role in navigation.ts.
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
  // [TAAL-VOLGT-MEE] The language the owner chose, as their ACCOUNT remembers it. Read here for the
  // same reason and in the same shape as `vak` above: apart from the profile select, in a try, so a
  // deployment where the column is not there yet loses a nicety instead of the whole dashboard.
  let accountLocale: string | null = null
  if (profile) {
    try {
      const { data: vakRow } = await supabase
        .from('profiles').select('vak').eq('id', profile.id).maybeSingle()
      counterTrade = sellsOverCounter((vakRow as { vak?: string | null } | null)?.vak)
    } catch {
      /* no column yet → the bar everyone has always had */
    }
    try {
      const { data: taalRow } = await supabase
        .from('profiles').select('preferred_language').eq('id', profile.id).maybeSingle()
      accountLocale = (taalRow as { preferred_language?: string | null } | null)?.preferred_language ?? null
    } catch {
      /* no column yet → the cookie is the only answer, exactly as before */
    }
  }

  const isMedewerker = !!acting && isActingForOther(acting)

  return (
    <>
      {/* [TAAL-VOLGT-MEE] Renders nothing. On a device that has never been told which language the
          owner reads, it hands over the one their account remembers — see the component. */}
      {profile && <LocaleRestore accountLocale={accountLocale} />}
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
      {/* [ZIJBALK] The desktop navigation rail. Fixed, so it is mounted OUTSIDE the shell that
          pads for it — a fixed element inside its own padding would sit 240px in from the edge.
          Same visibility rule as the phone bar: hidden for a verkoopmedewerker, whose
          destinations would bounce him back (see the note on DashboardChrome below). */}
      {profile && !isMedewerker && <DashboardRail role={subnavRole} counter={counterTrade} />}
      <SubPageHeaderProvider>
        {/* [MEDEWERKER] De balk rendert nu WEL voor hem, met zijn eigen thuis.
            Hij werd verborgen om een goede reden — een menu vol links die je terugwerpen is erger
            dan geen menu — maar er kwam niets voor in de plaats, en deze balk is geen menu: het is
            de titel van het scherm en de weg terug. Zonder haar opende hij "Nieuwe factuur" en
            stond vast: die pagina heeft geen eigen terugknop, ze leunt volledig op deze balk. In
            een geïnstalleerde PWA is er ook geen browserknop. De enige uitweg was de app afsluiten.
            De onderbalk en de zoekknop blijven verborgen: díe zijn wél menu's, en hun bestemmingen
            werpen hem terug. */}
        {/* [ZIJBALK] The shell clears the rail's width, so the sub-page header and the page
            below it both centre in what is LEFT of the screen rather than sliding under the
            rail. It wraps BOTH: the header is sticky and lives outside .dash-content, so padding
            only the content would have left that one bar running behind the rail. --rail-w is 0px
            below 1024px, which makes this a no-op at every width the rail is not shown at. */}
        <div className="dash-shell">
          {profile && <DashboardChrome role={isMedewerker ? 'medewerker' : subnavRole} />}
          {/* [MOBILE] .dash-content reserves room for the bottom bar below 640px,
              so the last row of a list is not left sitting behind it. */}
          <div className="dash-content">{children}</div>
        </div>
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