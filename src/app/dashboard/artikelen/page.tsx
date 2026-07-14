// src/app/dashboard/artikelen/page.tsx
// [ARTIKELEN] Server wrapper for the line-item catalog (gateway #1).
export const dynamic = 'force-dynamic'

import { redirect } from 'next/navigation'
import { createServerSupabaseClient } from '@/lib/supabase-server'
import ArtikelenClient from './ArtikelenClient'

export default async function Page() {
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  return <ArtikelenClient />
}
