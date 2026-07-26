// src/app/dashboard/zoeken/page.tsx
// [SEARCH] Server wrapper for the dedicated full-app search results page.
// Auth + role resolution here; the client component (Suspense-wrapped because it
// reads the ?q= query string) does the live searching.

export const dynamic = 'force-dynamic'

import { Suspense } from 'react'
import { redirect } from 'next/navigation'
import { createServerSupabaseClient } from '@/lib/supabase-server'
import type { Role } from '@/lib/navigation'
import ZoekenClient from './ZoekenClient'

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>
}) {
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()

  const role: Role = profile?.role === 'accountant' ? 'accountant' : 'zzper'
  const { q } = await searchParams
  const initialQuery = (q ?? '').slice(0, 100)

  return (
    <Suspense fallback={null}>
      <ZoekenClient initialQuery={initialQuery} role={role} />
    </Suspense>
  )
}
