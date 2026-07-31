// src/app/dashboard/page.tsx
// [INTEGRATION] role-based entry routing — May 2026

import { createServerSupabaseClient } from '@/lib/supabase-server'
import { redirect } from 'next/navigation'
import DashboardClient from './DashboardClient'

export const dynamic = 'force-dynamic'

export default async function DashboardPage() {
  const supabase = await createServerSupabaseClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  // Alleen wat dit scherm gebruikt. Hier stond `select('*')`, en die rij ging vervolgens als
  // prop naar een client component — dus élke kolom van profiles kwam in de RSC-payload in de
  // browser terecht: subscription_stripe_id, iban, kvk_number, btw_number, phone, address.
  //
  // Het zijn de eigen gegevens van de gebruiker, dus er lekt niets naar een ander. Maar de
  // home heeft er vier nodig (naam, bedrijfsnaam, e-mail, id) plus twee om te kunnen routeren,
  // en een `*` groeit stil mee met elke kolom die iemand later toevoegt — inclusief een die er
  // niet hoort te staan. De header werkte allang met precies deze smalle vorm.
  const { data: profile } = await supabase
    .from('profiles')
    .select('id, full_name, company_name, email, role, onboarding_done')
    .eq('id', user.id)
    .single()

  // [INTEGRATION] no profile or incomplete onboarding → /onboarding — May 2026
  if (!profile || !profile.onboarding_done) redirect('/onboarding')

  // [INTEGRATION] accountant → accountant hub — May 2026
  if (profile.role === 'accountant') redirect('/dashboard/accountant')

  // ZZP → existing DashboardClient (unchanged)
  return <DashboardClient profile={profile} />
}