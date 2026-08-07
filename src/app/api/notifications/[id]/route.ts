// src/app/api/notifications/[id]/route.ts
// [BOEK-028] PATCH → mark notification as read — May 2026
// createServerSupabaseClient, not createServerClient
// Next.js 15: params is a Promise

import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase-server'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params  // [BOEK-028] Next.js 15: params is a Promise
    const supabase = await createServerSupabaseClient()

    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // A non-UUID id makes Postgres raise 22P02, which used to come back as a 500 carrying the
    // database's own message. Refuse it here: it is a bad request, not a server failure.
    if (!UUID.test(id)) {
      return NextResponse.json({ error: 'Ongeldige melding' }, { status: 400 })
    }

    const body = await req.json()
    const { read } = body

    if (typeof read !== 'boolean') {
      return NextResponse.json({ error: 'read must be boolean' }, { status: 400 })
    }

    // Only allow updating own notifications
    const { error } = await supabase
      .from('notifications')
      .update({ read })
      .eq('id', id)
      .eq('user_id', user.id)  // security: user can only update their own

    if (error) {
      // The raw Postgres message was returned to the browser here. It says nothing a user can act
      // on and everything an attacker would like about the schema.
      console.error('[notifications/:id] update failed', { id, error: error.message })
      return NextResponse.json({ error: 'Bijwerken mislukt' }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch {
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
