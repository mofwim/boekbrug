// src/app/api/notifications/create/route.ts
// Create a notification for the current user — via service role (RLS blocks client insert)

import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase-server'
import { createNotification, isNotificationType } from '@/lib/notifications'

export async function POST(req: NextRequest) {
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const { title, body: notifBody, type, link } = body

  // [CONTROL] The accepted list is the one in notifications.ts, which is the one the
  // table's CHECK constraint enforces. This route used to keep its own copy — two
  // lists that agree today and quietly disagree the day a sixth type is added.
  if (!title || !isNotificationType(type)) {
    return NextResponse.json({ error: 'Ongeldige gegevens' }, { status: 400 })
  }

  const result = await createNotification({
    userId: user.id,   // always the authenticated user — can't spoof others
    title,
    body: notifBody ?? null,
    type,
    link: link ?? null,
  })

  if (!result.ok) {
    console.error('[notifications/create] insert failed:', result.error)
    return NextResponse.json({ error: 'Aanmaken mislukt' }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}
