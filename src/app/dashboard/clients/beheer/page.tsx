// src/app/dashboard/clients/beheer/page.tsx
// [BOEK-028] Klanten beheer page — May 2026

import { redirect } from 'next/navigation'
import { createServerSupabaseClient } from '@/lib/supabase-server'
import { getSessionUser } from '@/lib/session-user'
import KlantenBeheer from '@/modules/accountant/pages/KlantenBeheer'
import { getAccountantClients } from '@/modules/accountant/accountant.repository'

export const dynamic = 'force-dynamic'

/**
 * De klok, één keer gelezen, buiten de render om — zelfde vorm en zelfde reden als readClock()
 * in /dashboard/accountant: de React-compiler merkt `Date.now()` in een componentlichaam terecht
 * als onzuiver aan, en de geldigheidsgrens hoort voor alle rijen tegen dezelfde klok te staan.
 */
function readClock(): number {
  return new Date().getTime()
}

export default async function KlantenBeheerPage() {
  const supabase = await createServerSupabaseClient()
  // [WATERVAL] Memoised per request (session-user.ts) — the dashboard layout above already asked.
  const user = await getSessionUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('id, role, onboarding_done')
    .eq('id', user.id)
    .single()

  if (!profile?.onboarding_done) redirect('/onboarding')
  if (profile.role !== 'accountant') redirect('/dashboard')

  // [BOEKHOUDER-LEEG] This screen manages the links themselves, so an empty list here is read as
  // "no clients to manage". Same distinction as the landing page: the failure is carried, not
  // flattened into a zero.
  const { clients, readFailed: clientsUnreadable } = await getAccountantClients(profile.id)

  // [UITNODIGING] De verstuurde uitnodigingen die nog openstaan. Tot nu toe was het enige spoor
  // van een uitnodiging de FOUT bij opnieuw proberen ("er is al een verstuurd") — het kantoor
  // dat er veertig de deur uit deed, had daarna geen enkel overzicht. RLS dekt deze lezing:
  // invitations.zzper_id is bij een kantoor-uitnodiging de boekhouder zelf. Alleen nog geldige
  // rijen (veertien dagen — dezelfde grens als de acceptatie); best-effort, want een haperende
  // lijst mag het klantenbeheer niet meenemen.
  const versGrens = new Date(readClock() - 14 * 24 * 60 * 60 * 1000).toISOString()
  const { data: openInvites } = await supabase
    .from('invitations')
    .select('id, accountant_email, created_at')
    .eq('zzper_id', profile.id)
    .eq('invited_by', 'accountant')
    .eq('status', 'pending')
    .gte('created_at', versGrens)
    .order('created_at', { ascending: false })
    .limit(100)

  return (
    <KlantenBeheer
      initialClients={clients}
      clientsUnreadable={clientsUnreadable}
      openInvites={(openInvites ?? []).map((i) => ({
        id: i.id,
        email: i.accountant_email,
        sentAt: i.created_at ?? null,
      }))}
    />
  )
}