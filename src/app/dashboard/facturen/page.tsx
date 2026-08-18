// src/app/dashboard/facturen/page.tsx
// [BOEK-029] Server wrapper — fetches profile, passes to client component
// May 2026

export const dynamic = 'force-dynamic'

import { redirect } from 'next/navigation'
import { createServerSupabaseClient } from '@/lib/supabase-server'
import { createPipelineClient } from '@/lib/supabase-pipeline'
import { loadTeamNames } from '@/lib/acting-for-server'
import { getSessionUser } from '@/lib/session-user'
import FacturenClient from './FacturenClient'
// [OPENSTAAND-BEWIJS] Is anything we are chasing already in the bank? See the block below.
import { collectOpenInvoiceProof } from '@/lib/open-invoice-proof-collect'

export default async function Page() {
  const supabase = await createServerSupabaseClient()
  // [WATERVAL] Memoised per request (session-user.ts) — the layout above already asked.
  const user = await getSessionUser()
  if (!user) redirect('/login')

  // ── [WATERVAL] Het profiel en de teamnamen weten niets van elkaar ───────────────────
  //
  // Allebei kennen ze alleen user.id, en toch wachtte de tweede op de eerste. De DERDE lezing
  // hieronder mag daar niet bij: die vraagt wie welke factuur maakte, en dat heeft alleen zin als
  // er een team IS — hij hangt dus wél van teamNames af en blijft waar hij staat.
  const [{ data: profile }, teamNames] = await Promise.all([
    supabase.from('profiles').select('*').eq('id', user.id).single(),
    loadTeamNames(user.id),
  ])

  if (!profile) redirect('/login')

  // [ACTING-FOR] Wie maakte welke factuur?
  //
  // created_by werd geschreven en door niemand gelezen — een spoor dat niemand kan lezen is geen
  // spoor. De eigenaar geeft het recht weg om facturen uit te geven op zijn naam en BTW-nummer,
  // en kon nergens zien wie welke maakte.
  //
  // Deze lus draait ALLEEN als hij een team heeft (of had): geen team ⇒ lege map ⇒ nul queries
  // extra voor de 99% die alleen werkt. En hij is deploy-veilig: bestaat created_by nog niet,
  // dan faalt de select en blijft de map leeg — dan is er ook niets te tonen.
  const makers: Record<string, string> = {}
  if (Object.keys(teamNames).length > 0) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pipeline = createPipelineClient() as any
      const { data } = await pipeline
        .from('invoices')
        .select('id, created_by')
        .eq('sender_id', user.id)
        .not('created_by', 'is', null)
        .neq('created_by', user.id)
        .limit(2000)
      for (const r of (data ?? []) as Array<{ id: string; created_by: string }>) {
        const naam = teamNames[r.created_by]
        // Alleen namen van mensen die (ooit) bij dit bedrijf hoorden — nooit een losse uuid.
        if (naam) makers[r.id] = naam
      }
    } catch { /* kolom bestaat nog niet — dan valt er niets te tonen */ }
  }

  // [OPENSTAAND-BEWIJS] The same question as on Crediteuren, mirrored — and on this side it is
  // sharper. A purchase invoice wrongly marked open costs the owner a second payment; a SALES
  // invoice wrongly marked open costs them a customer. The app chases it: a reminder, then a
  // firmer one, and on the last tier a statutory aanmaning that names collection costs. Sending
  // that to somebody who paid three weeks ago is the most expensive thing this product can do.
  //
  // So the list says what it checked, against what, and until when. Never blocking: a proof that
  // could not run leaves the page exactly as it was and says so.
  const openProof = await collectOpenInvoiceProof({
    pipeline: supabase, ownerId: user.id, direction: 'outgoing',
  }).catch((e) => {
    console.error('[OPENSTAAND-BEWIJS] sales proof failed — the list still renders', {
      userId: user.id, error: e instanceof Error ? e.message : String(e),
    })
    return null
  })

  return <FacturenClient profile={profile} makers={makers} openProof={openProof} />
}
