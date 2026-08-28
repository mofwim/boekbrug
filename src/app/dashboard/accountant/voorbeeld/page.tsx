// src/app/dashboard/accountant/voorbeeld/page.tsx
// [PROEFDOSSIER] Het voorbeelddossier — dezelfde rolwacht als elke boekhouderspagina.
//
// Het scherm haalt NIETS op: de cijfers zijn constanten (voorbeeld-dossier.ts, puur en getest)
// en er bestaat geen schrijfpad. De wacht staat er om dezelfde reden als op de andere
// boekhouderspagina's: dit is de taal en het gezichtspunt van een kantoor, en een ondernemer
// die de URL raadt hoort in zijn eigen dashboard uit te komen, niet in andermans verkooppraatje.

import { redirect } from 'next/navigation'
import { createServerSupabaseClient } from '@/lib/supabase-server'
import { getSessionUser } from '@/lib/session-user'
import VoorbeeldDossier from '@/modules/accountant/pages/VoorbeeldDossier'

export const dynamic = 'force-dynamic'

export default async function VoorbeeldDossierPage() {
  const supabase = await createServerSupabaseClient()
  const user = await getSessionUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('role, onboarding_done')
    .eq('id', user.id)
    .maybeSingle()

  if (!profile?.onboarding_done) redirect('/onboarding')
  if (profile.role !== 'accountant') redirect('/dashboard')

  return <VoorbeeldDossier />
}
