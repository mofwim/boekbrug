// src/app/api/notifications/create/route.ts
// Create a notification for the current user — via service role (RLS blocks client insert)

import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase-server'
import { createPipelineClient } from '@/lib/supabase-pipeline'

const VALID_TYPES = ['invoice', 'payment', 'message', 'invite', 'status']

export async function POST(req: NextRequest) {
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const { title, body: notifBody, type, link } = body

  if (!title || !type || !VALID_TYPES.includes(type)) {
    return NextResponse.json({ error: 'Ongeldige gegevens' }, { status: 400 })
  }

  try {
    const pipeline = createPipelineClient()
    const { error } = await pipeline.from('notifications').insert({
      user_id: user.id,   // always the authenticated user — can't spoof others
      title,
      body: notifBody ?? null,
      type,
      read: false,
      link: link ?? null,
    })

    if (error) {
      console.error('[notifications/create] insert failed:', error)
      return NextResponse.json({ error: 'Aanmaken mislukt' }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('[notifications/create] error:', err)
    return NextResponse.json({ error: 'Server fout' }, { status: 500 })
  }
}