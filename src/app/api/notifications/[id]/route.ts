// src/app/api/notifications/[id]/route.ts
// [BOEK-028] PATCH → mark notification as read — May 2026
// createServerSupabaseClient وليس createServerClient
// Next.js 15: params هو Promise

import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase-server'

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
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (err) {
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}