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
  // Een klantenlijst die niet laadt is hinderlijk maar niet gevaarlijk: de keuzelijst is dan leeg
  // en "geen klant" blijft werken. De UREN zijn het enige waarvan een leesfout gemeld moet worden.
  const clients = (clientsRes.data ?? []) as UrenClientCard[]

  return <UrenClient initialEntries={entries} clients={clients} loadFailed={Boolean(entriesRes.error)} />
}
