// src/app/dashboard/uren/page.tsx
// [UREN] Server wrapper voor de urenregistratie.
//
// De rijen worden HIER gelezen en als props doorgegeven, en niet in een useEffect. Twee redenen,
// en de tweede is de zwaarste:
//
//   1. De ondernemer ziet zijn uren meteen, zonder eerst een leeg scherm.
//   2. Het onderdeel wordt daarmee een functie van zijn props, en dat is precies wat
//      tests/render/ nodig heeft: rijen erin, HTML eruit, geen sessie en geen database. Een scherm
//      dat zijn eigen data ophaalt kan die gate niet aanroepen, en dan dekt niets de takken.
//
// [NO-SILENT-EMPTY] Een leesfout is geen lege urenlijst. `loadFailed` reist mee, zodat het scherm
// "dit is een storing" kan zeggen in plaats van "je hebt niets openstaan" — het ene bericht waarop
// iemand die zijn uren kwijt is nooit had moeten vertrouwen.

import { redirect } from 'next/navigation'

import { createServerSupabaseClient } from '@/lib/supabase-server'
import { getSessionUser } from '@/lib/session-user'
import { fetchAllRows } from '@/lib/supabase-paginate'
// [TZ] De kalender van de ondernemer, nooit de UTC-dag van de server: op 1 januari om 00:30
// Amsterdam is het op een UTC-server nog 31 december, en dan telt dit het verkeerde jaar.
import { amsterdamToday } from '@/lib/format-nl'
import { assessUrencriterium, type UrencriteriumStatus } from '@/lib/urencriterium'
import type { TimeEntry } from '@/lib/uren'
import UrenClient, { type UrenClientCard } from './UrenClient'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Uren — BoekBrug' }

const ENTRY_COLS = 'id, client_id, worked_on, description, hours, hourly_rate, invoice_id'

export default async function UrenPage() {
  const supabase = await createServerSupabaseClient()
  // [WATERVAL] Memoised per request (session-user.ts) — the dashboard layout above already asked.
  const user = await getSessionUser()
  if (!user) redirect('/login')

  // RLS doet het filteren: time_entries_select_own laat alleen `user_id = auth.uid()` door
  // (supabase/migrations/urenregistratie.sql, bewezen in tests/sql/time_entries.test.sql).
  const [entriesRes, clientsRes] = await Promise.all([
    supabase
      .from('time_entries')
      .select(ENTRY_COLS)
      .order('worked_on', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(1000),
    supabase.from('clients').select('id, name').order('name', { ascending: true }).limit(1000),
  ])

  if (entriesRes.error) {
    console.error('[UREN] uren lezen mislukt op het scherm', { error: entriesRes.error })
  }

  const entries = (entriesRes.data ?? []) as TimeEntry[]

  // [URENCRITERIUM] Het jaartotaal wordt APART gelezen, niet uit `entries` opgeteld. Die lijst
  // stopt bij 1000 rijen, en een afgekapte som telt te weinig uren — precies de kant die de
  // ondernemer ten onrechte vertelt dat hij het niet gaat halen. fetchAllRows pagineert door.
  //
  // [NO-SILENT-EMPTY] Een leesfout wordt null en nooit 0: "we konden niet kijken" en "je hebt
  // niets gewerkt" zijn tegengestelde antwoorden, en op dit ene getal hangt de zelfstandigenaftrek.
  const today = amsterdamToday()
  const year = Number(today.slice(0, 4))
  const hoursThisYear = await fetchAllRows<{ hours: number | null }>((lo, hi) =>
    supabase
      .from('time_entries')
      .select('hours')
      .gte('worked_on', `${year}-01-01`)
      .lte('worked_on', `${year}-12-31`)
      .order('id', { ascending: true })
      .range(lo, hi),
  )
    .then((rows) => rows.reduce((sum, r) => sum + (Number(r.hours) || 0), 0))
    .catch((e) => {
      console.error('[URENCRITERIUM] jaartotaal uren lezen mislukt', {
        year, error: e instanceof Error ? e.message : String(e),
      })
      return null
    })
  // [NIET-BIJGEHOUDEN] Heeft deze ondernemer hier ooit een uur geregistreerd, in welk jaar dan ook?
  //
  // Zonder deze vraag kreeg iedereen met een leeg urenregister het volle oordeel: "je hebt nog
  // 1.225 uur te gaan… houd er rekening mee dat de zelfstandigenaftrek kan vervallen." Voor iemand
  // die vast prijs factureert, zijn uren in een spreadsheet bijhoudt of er helemaal geen aanspraak
  // op maakt, is dat een rode waarschuwing over de grootste aftrek die hij heeft, op grond van
  // niets. Toen dit werd geschreven had ELKE eigenaar in de productiedatabase nul uren staan.
  //
  // Over ALLE jaren, niet dit jaar: wie vorig jaar uren bijhield en dit jaar nog niets invulde,
  // gebruikt de functie wél, en voor hem is een lege januari een echt signaal.
  //
  // Een mislukte peiling wordt null en verandert niets: liever een waarschuwing die misschien
  // terecht is dan een storing die er stilletjes een wegneemt.
  let everRegistered: boolean | null = null
  try {
    const probe = await supabase.from('time_entries').select('id').limit(1)
    everRegistered = probe.error ? null : (probe.data?.length ?? 0) > 0
  } catch {
    everRegistered = null
  }
  const urencriterium: UrencriteriumStatus = assessUrencriterium({ hoursSoFar: hoursThisYear, today, year, everRegistered })
  // Een klantenlijst die niet laadt is hinderlijk maar niet gevaarlijk: de keuzelijst is dan leeg
  // en "geen klant" blijft werken. De UREN zijn het enige waarvan een leesfout gemeld moet worden.
  const clients = (clientsRes.data ?? []) as UrenClientCard[]

  return (
    <UrenClient
      initialEntries={entries}
      clients={clients}
      loadFailed={Boolean(entriesRes.error)}
      urencriterium={urencriterium}
    />
  )
}
