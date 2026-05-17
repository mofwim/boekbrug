// src/app/dashboard/facturen/page.tsx
// [BOEK-029] Server wrapper — fetches profile, passes to client component
// May 2026

export const dynamic = 'force-dynamic'

import { redirect } from 'next/navigation'
import { createServerSupabaseClient } from '@/lib/supabase-server'
import FacturenClient from './FacturenClient'

export default async function Page() {
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .single()

  if (!profile) redirect('/login')

  return <FacturenClient profile={profile} />
}