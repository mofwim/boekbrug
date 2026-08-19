// src/app/dashboard/accountant/page.tsx
// [BOEK-028] Accountant Portal — Phase 2 — May 2026
//
// Server component: fetches profile + all accountant data via repository.
// Passes pre-fetched data as props to AccountantHome (client component).
// No data fetching happens in the client — only UI state.

import { redirect } from 'next/navigation'
import { createServerSupabaseClient } from '@/lib/supabase-server'
import { getSessionUser } from '@/lib/session-user'
import AccountantHome from '@/modules/accountant/pages/AccountantHome'
import {
  getAccountantClients,
  getAccountantOverview,
  getTodoFeed,
} from '@/modules/accountant/accountant.repository'
// [WERKVOORRAAD] De cijfers achter de vier tegels. Zie work-queues.ts voor waarom een tegel
// zonder getal een deur is waar niets op staat.
import { getAccountantWorkQueues } from '@/modules/accountant/work-queues'

export const dynamic = 'force-dynamic'

/**
 * De klok, één keer gelezen, buiten de render om.
 *
 * Zelfde vorm als in /dashboard/accountant/debiteuren: `Date.now()` in het lichaam van een
 * component wordt door de React-compiler terecht als onzuiver aangemerkt, en "te laat" hoort voor
 * elke factuur tegen dezelfde klok te worden bepaald.
 */
function readClock(): number {
  return new Date().getTime()
}

export default async function AccountantPage() {
  const supabase = await createServerSupabaseClient()

  // Auth
  // [WATERVAL] Memoised per request (session-user.ts) — the dashboard layout above already asked.
  const user = await getSessionUser()
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
  // [WERKVOORRAAD] Naast de klantenlijst en de to-do's, want hij hangt van geen van beide af: hij
  // leest de mandaten en telt in twee query's. Faalt hij, dan komt hij leeg terug en toont de home
  // de werkregel niet — nooit een foutpagina voor een getal.
  // [WATERVAL] De bel en de ongelezen berichten horen in deze golf en stonden eronder. Ze kennen
  // alleen profile.id — niet de klantenlijst, niet de to-do's, niet de werkvoorraad — en toch
  // wachtten ze op alle drie. Op het traagste scherm van de boekhouder waren dat twee volle ritten
  // die nergens op wachtten behalve op de volgorde waarin ze waren opgeschreven.
  const [
    clientResult,
    todoResult,
    workQueues,
    { data: notifications, error: notifErr },
    { count: unreadMessages },
  ] = await Promise.all([
    getAccountantClients(profile.id),
    getTodoFeed(profile.id),
    getAccountantWorkQueues(supabase, profile.id, readClock()),

    // Notifications — fetched server-side, passed as initial state to client
    // [NO-SILENT-EMPTY] `?? []` op een mislukte lezing zet "Geen meldingen" in de bel. Dat is een
    // uitspraak over wat er voor deze boekhouder klaarstaat, en een gefaalde lezing weet dat niet.
    supabase
      .from('notifications')
      .select('*')
      .eq('user_id', profile.id)
      .order('created_at', { ascending: false })
      .limit(20),

    supabase
      .from('messages')
      .select('id', { count: 'exact', head: true })
      .eq('receiver_id', profile.id)
      .eq('read', false),
  ])

  // En dit blijft er WEL achter: het overzicht rekent op de klantenlijst hierboven. Zie [FAN-OUT] —
  // hem meesturen zou betekenen dat hij de lijst zelf nog een keer ophaalt, met vijf query's per
  // klant eraan vast.
  // [BOEKHOUDER-LEEG] Unwrapped here, and the failure travels on to the screen. A failed read used
  // to arrive as an empty array and the landing page rendered the FIRST-RUN onboarding state —
  // "Voeg je eerste klant toe" — to an accountant who may have forty. The bell beside it already
  // knew the difference (notifErr, below); these two did not.
  const clients = clientResult.clients
  const todos = todoResult.todos
  const clientsUnreadable = clientResult.readFailed
  const todosUnreadable = todoResult.readFailed

  const overview = await getAccountantOverview(profile.id, clients)

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
        clientsUnreadable={clientsUnreadable}
        todosUnreadable={todosUnreadable}
        workQueues={workQueues}
        clients={clients}
        todos={todos}
        notifications={notifications ?? []}
        notificationsError={
          notifErr
            ? 'We konden je meldingen nu niet ophalen. Probeer het zo meteen opnieuw — dit zegt niets over of er meldingen voor je zijn.'
            : null
        }
        unreadMessages={unreadMessages ?? 0}
      />
    
    )
}



