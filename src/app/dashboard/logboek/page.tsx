// src/app/dashboard/logboek/page.tsx
// [LOGBOEK] The audit trail, finally on a screen — server half.
//
// audit_logs is written from 60 files in 89 distinct actions and no screen has ever rendered a row
// of it. This route is where that changes. The half that MATTERS is the one the owner cannot see
// anywhere else: audit_logs.user_id is the ACTOR, so every action a mandated bookkeeper performs in
// this administration carries the BOOKKEEPER's id, while the owner stays answerable for all of it
// (art. 35a Wet OB, art. 52 AWR).
//
// ── WHY THIS FILE READS NOTHING ──
//
// Every other dashboard page fetches its rows here and hands them to its client. This one
// deliberately does not, and it is not laziness:
//
//   · The trail is PAGED and FILTERED — "load 50 more", "only money" — so the client has to be able
//     to ask for a page on its own no matter what. A server read would then be a second way to get
//     the same rows, with its own error handling, its own empty-versus-failed distinction, and its
//     own chance to disagree with /api/logboek about what a row means. One reader, one rule.
//   · This page hangs under /dashboard, whose layout already awaits the session and the profile.
//     Adding a fifty-row audit read in front of the first paint would make the screen the owner
//     opens to CHECK something the slowest one in the app.
//
// So: session in, redirect out, render the client. The reading is /api/logboek's job and the
// meaning of a row is src/lib/logboek.ts's.

import { redirect } from 'next/navigation'
import { getSessionUser } from '@/lib/session-user'
import LogboekClient from './LogboekClient'

// The session is a cookie read, so this page can never be statically rendered.
export const dynamic = 'force-dynamic'

// Static and in the source language, like every other dashboard page's metadata. The owner's
// language lives in a cookie that only the client hook reads (its server snapshot is Dutch — see
// use-locale.ts), so a title rendered here could not honour it anyway; Dutch is the source
// language, so this tab is true in every case rather than empty in three of them.
export const metadata = { title: 'Logboek — BoekBrug' }

export default async function LogboekPage() {
  // [WATERVAL] Memoised per request (session-user.ts) — the dashboard layout above already asked.
  //
  // Asked here even though /api/logboek asks again and answers 401 without a session: a visitor
  // whose session has expired belongs at the login screen, not on a logbook that renders "we could
  // not read your log". The two answers are both honest and only one of them is useful. This is
  // also the DAL rule this codebase holds to — every server component establishes who is asking
  // itself, and never trusts an earlier link in the chain to have done it.
  const user = await getSessionUser()
  if (!user) redirect('/login')

  return <LogboekClient />
}
