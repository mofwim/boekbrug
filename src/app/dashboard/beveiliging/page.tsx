// src/app/dashboard/beveiliging/page.tsx
// [BEVEILIGING] Server half. Session in, redirect out, render the client.
//
// It reads no rows, for the same reason /dashboard/logboek does not: /api/beveiliging is the one
// reader, and a second read here would be a second place where "we could not establish this" gets
// decided — with its own chance to disagree with the route about whether a list is complete. On a
// screen whose whole subject is whether an answer can be trusted, two answers is one too many.

import { redirect } from 'next/navigation'
import { getSessionUser } from '@/lib/session-user'
import BeveiligingClient from './BeveiligingClient'

// The session is a cookie read, so this page can never be statically rendered.
export const dynamic = 'force-dynamic'

// Static and in the source language, like every other dashboard page's metadata — the owner's
// language lives in a cookie only the client hook reads (see use-locale.ts).
export const metadata = { title: 'Beveiliging — BoekBrug' }

export default async function BeveiligingPage() {
  // [WATERVAL] Memoised per request (session-user.ts) — the dashboard layout above already asked.
  //
  // Asked here anyway, and not left to the route: someone whose session has expired belongs at the
  // login screen, not on a security page rendering "we could not read this". Both answers are
  // honest and only one of them is useful.
  const user = await getSessionUser()
  if (!user) redirect('/login')

  return <BeveiligingClient />
}
