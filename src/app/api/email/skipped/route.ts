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
import { SKIPPED_DOC_TYPES } from '@/lib/skipped-import'

export const dynamic = 'force-dynamic'

export async function GET() {
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  // The skip registry — most recent first, bounded.
  //
  // [SKIPPED-READ-HONEST] The error is read, and a failed read says so instead of answering "".
  // supabase-js does not throw: `const { data }` on a failed read gives null, `?? []` turns that
  // into an empty list, and this panel then reports "niets overgeslagen" — on the ONE surface whose
  // entire purpose is that nothing is lost silently. An owner looking for an invoice that never
  // arrived would be told, in writing, that nothing was skipped, and stop looking.
  const { data: skippedRows, error: skippedError } = await supabase
    .from('email_skipped_attachments')
    .select('filename, reason, created_at')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(100)
  if (skippedError) {
    return NextResponse.json(
      {
        error: 'We konden de overslag-lijst nu niet ophalen. Probeer het zo meteen opnieuw — dit ' +
          'zegt niets over of er iets is overgeslagen.',
        code: 'skipped_unavailable',
      },
      { status: 503 },
    )
  }

  // Could-not-read files kept in bestanden (visible there, counted here so the owner is nudged).
  // [OBSERVABILITY] .in() over de gedeelde lijst, niet .eq() op één losse string: de camera-weg
  // schrijft 'could_not_read' en de niet-ondersteunde-bestandsweg 'unsupported_type'. Op één
  // waarde tellen liet de andere stil buiten beeld vallen — en dit paneel bestaat juist om niets
  // buiten beeld te laten vallen. De lijst staat in src/lib/skipped-import.ts, samen met de
  // functie die de schrijvers gebruiken, zodat de twee kanten niet opnieuw uit elkaar lopen.
  // [SKIPPED-READ-HONEST] Same rule for the second source. A failed COUNT reads as 0, which on
  // this panel means "no unreadable files" — the other half of the same false reassurance.
  const { count: couldNotReadCount, error: couldNotReadError } = await supabase
    .from('documents')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', user.id)
    .in('ai_doc_type', SKIPPED_DOC_TYPES)
  if (couldNotReadError) {
    return NextResponse.json(
      {
        error: 'We konden de onleesbare bestanden nu niet tellen. Probeer het zo meteen opnieuw — ' +
          'dit zegt niets over of er iets is overgeslagen.',
        code: 'skipped_unavailable',
      },
      { status: 503 },
    )
  }

  const skipped = (skippedRows ?? []).map((r) => ({
    filename: r.filename ?? '(zonder naam)',
    reason: r.reason ?? 'onbekend',
    createdAt: r.created_at,
  }))

  return NextResponse.json({ skipped, couldNotReadCount: couldNotReadCount ?? 0 })
}
