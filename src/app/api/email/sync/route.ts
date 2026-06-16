// src/app/api/email/sync/route.ts
// [BOEK-011] Email sync — fetch attachments from Gmail/Outlook, verify with AI, save invoices
// POST /api/email/sync  → run sync, return summary
// GET  /api/email/sync  → return connection status + pending count
// DELETE /api/email/sync → disconnect email

import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase-server'
import { syncUserEmails, deleteEmailConnection } from '@/lib/email-integration'

// ── POST — run sync ───────────────────────────────────────────────────────────

export async function POST(_req: NextRequest) {
  const supabase = await createServerSupabaseClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Niet ingelogd' }, { status: 401 })
  }

  // syncUserEmails handles everything:
  // 1. get connection + refresh token
  // 2. fetch emails after profile.created_at
  // 3. Claude reads each PDF/image — real invoice or not
  // 4. save verified invoices to DB
  const result = await syncUserEmails(user.id)

  if (!result) {
    return NextResponse.json(
      { error: 'Geen e-mailverbinding gevonden. Verbind eerst Gmail of Outlook.' },
      { status: 404 }
    )
  }

  return NextResponse.json(result)
}

// ── GET — connection status ───────────────────────────────────────────────────

export async function GET(_req: NextRequest) {
  const supabase = await createServerSupabaseClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Niet ingelogd' }, { status: 401 })
  }

  const { data: connection } = await supabase
    .from('email_connections')
    .select('provider, email, connected_at')
    .eq('user_id', user.id)
    .limit(1)
    .single()

  const { count: pendingCount } = await supabase
    .from('invoices')
    .select('id', { count: 'exact', head: true })
    .eq('receiver_id', user.id)
    .eq('direction', 'incoming')
    // [BRIDGE-B] pending = awaiting human verification (was 'received')
    .eq('status', 'processing')

  return NextResponse.json({
    connected: !!connection,
    provider: connection?.provider ?? null,
    email: connection?.email ?? null,
    connected_at: connection?.connected_at ?? null,
    pending_count: pendingCount ?? 0,
  })
}

// ── DELETE — disconnect email ─────────────────────────────────────────────────

export async function DELETE(_req: NextRequest) {
  const supabase = await createServerSupabaseClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Niet ingelogd' }, { status: 401 })
  }

  // [BOEK-011 + BOEK-SECURITY] Read the user's connection to know which provider
  // to disconnect — and to ensure we clean up its Vault secrets, not just the row.
  // A raw DELETE FROM email_connections would leave secrets orphaned in Vault.
  const { data: connection } = await supabase
    .from('email_connections')
    .select('provider')
    .eq('user_id', user.id)
    .maybeSingle()

  if (!connection) {
    // Nothing to disconnect — idempotent success
    return NextResponse.json({ ok: true })
  }

  const result = await deleteEmailConnection(
    user.id,
    connection.provider as 'gmail' | 'outlook'
  )

  if (!result.success) {
    return NextResponse.json({ error: 'Disconnect failed' }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}