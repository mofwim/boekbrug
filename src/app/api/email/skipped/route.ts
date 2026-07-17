// src/app/api/email/skipped/route.ts
// [OBSERVABILITY] "Overgeslagen bij import (en waarom)" — the one surface that makes the import
// honest: every attachment the pipeline did NOT turn into an invoice, with the reason, so a
// misjudged or unreadable document is never silently lost. Read-only + owner-scoped.
//
// Two sources, both already written by the pipeline:
//   - email_skipped_attachments: rows the classifier registered as "not an invoice" (or a
//     could-not-read placeholder), each with a reason.
//   - documents where ai_doc_type='could_not_read': the FILE was kept in bestanden but we could
//     not read it — counted so the owner is pointed there to check it.

import { NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase-server'

export const dynamic = 'force-dynamic'

export async function GET() {
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  // The skip registry — most recent first, bounded.
  const { data: skippedRows } = await supabase
    .from('email_skipped_attachments')
    .select('filename, reason, created_at')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(100)

  // Could-not-read files kept in bestanden (visible there, counted here so the owner is nudged).
  const { count: couldNotReadCount } = await supabase
    .from('documents')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', user.id)
    .eq('ai_doc_type', 'could_not_read')

  const skipped = (skippedRows ?? []).map((r) => ({
    filename: r.filename ?? '(zonder naam)',
    reason: r.reason ?? 'onbekend',
    createdAt: r.created_at,
  }))

  return NextResponse.json({ skipped, couldNotReadCount: couldNotReadCount ?? 0 })
}
