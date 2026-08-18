// src/app/dashboard/artikelen/page.tsx
// [ARTIKELEN] Server wrapper for the line-item catalog (gateway #1).
export const dynamic = 'force-dynamic'

import { redirect } from 'next/navigation'
import { getSessionUser } from '@/lib/session-user'
import ArtikelenClient from './ArtikelenClient'

export default async function Page() {
  // [WATERVAL] Memoised per request (session-user.ts) — the dashboard layout above already asked.
  const user = await getSessionUser()
  if (!user) redirect('/login')
  return <ArtikelenClient />
}
