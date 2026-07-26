// src/app/api/email/backfill/route.ts
// [BACKFILL] Owner-triggered RE-SCAN of the mailbox over an explicit date range.
//
// Why this exists: the daily sync fetches forward from a high-water mark. Once that mark has
// advanced past an email, that email falls outside every future incremental window — so an
// invoice that was missed at the time (a classifier misjudgement, a fetch cap, a provider
// hiccup) can never come back on its own, even after the bug that dropped it is fixed. This
// endpoint re-lists the mailbox from a chosen date so the (now-fixed) pipeline gets a second
// look and imports anything still missing.
//
// Safe by construction:
//   - fromMs bypasses the watermark clamp, but holdWatermark:true keeps the incremental mark
//     untouched — a re-scan is purely ADDITIVE and never rewinds or advances the daily window.
//   - PHASE-0 dedup (byte-hash + message-id + semantic) means a re-scan imports ONLY the gaps;
//     nothing already imported is duplicated.
//   - Same batch cap as a normal sync ⇒ `remaining` drives the client's continue loop, so a
//     multi-month re-scan drains in bounded chunks instead of one giant request.
//   - No disconnect/reconnect needed (which would wipe the mark and re-scan everything blindly).

import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase-server'
import { syncUserEmails } from '@/lib/email-integration'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'

export const dynamic = 'force-dynamic'
// [SYNC-DURATION] Same reasoning as the sync route: a backfill batch can run past the default
// function ceiling (text read + visual re-read per invoice); without a raised limit it is killed
// before any save and makes no progress. Cap still depends on the hosting plan.
export const maxDuration = 300

// Sanity bounds: a re-scan can reach back at most ~3 years and never into the future.
const MAX_LOOKBACK_MS = 3 * 365 * 24 * 60 * 60 * 1000

export async function POST(req: NextRequest) {
  const supabase = await createServerSupabaseClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Niet ingelogd' }, { status: 401 })
  }

  const limit = await checkRateLimit({
    userId: user.id,
    endpoint: '/api/email/backfill',
    ...RATE_LIMITS.EMAIL_SYNC,
  })
  if (!limit.allowed) return rateLimitResponse(limit)

  let body: { sinceDate?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'bad_request' }, { status: 400 })
  }

  // Parse and validate the "since" date. Accept an ISO date ("2026-02-01") or datetime.
  const raw = (body.sinceDate ?? '').trim()
  const fromMs = raw ? new Date(raw).getTime() : NaN
  if (!Number.isFinite(fromMs)) {
    return NextResponse.json({ error: 'invalid_date' }, { status: 400 })
  }
  const now = Date.now()
  if (fromMs > now) {
    return NextResponse.json({ error: 'date_in_future' }, { status: 400 })
  }
  // Clamp an over-eager lookback rather than scanning years of mail.
  const clampedFromMs = Math.max(fromMs, now - MAX_LOOKBACK_MS)

  const result = await syncUserEmails(user.id, { fromMs: clampedFromMs, holdWatermark: true })

  if (!result) {
    return NextResponse.json(
      { error: 'Geen e-mailverbinding gevonden. Verbind eerst Gmail of Outlook.' },
      { status: 404 }
    )
  }

  return NextResponse.json({ ...result, backfillFrom: new Date(clampedFromMs).toISOString() })
}
