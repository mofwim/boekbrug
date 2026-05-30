// src/app/api/invite/info/route.ts
// Public endpoint — returns invitation + zzper name using service role
// Safe: only exposes name, not sensitive data. Token is the auth mechanism.

import { NextRequest, NextResponse } from 'next/server'
import { createPipelineClient } from '@/lib/supabase-pipeline'

// Invitations expire after 14 days
const INVITE_VALIDITY_DAYS = 14

export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get('token')
  if (!token) return NextResponse.json({ error: 'token verplicht' }, { status: 400 })

  try {
    const pipeline = createPipelineClient()

    const { data: invitation } = await pipeline
      .from('invitations')
      .select('id, zzper_id, accountant_email, status, invited_by, created_at')
      .eq('token', token)
      .eq('status', 'pending')
      .single()

    if (!invitation) {
      return NextResponse.json({ error: 'Uitnodiging ongeldig of verlopen' }, { status: 404 })
    }

    // Check expiry — 14 days from created_at
    const createdAt = new Date(invitation.created_at!)
    const expiresAt = new Date(createdAt.getTime() + INVITE_VALIDITY_DAYS * 24 * 60 * 60 * 1000)
    if (Date.now() > expiresAt.getTime()) {
      return NextResponse.json({ error: 'Uitnodiging verlopen', expired: true }, { status: 410 })
    }

    const { data: profile } = await pipeline
      .from('profiles')
      .select('full_name, company_name')
      .eq('id', invitation.zzper_id!)
      .single()

    return NextResponse.json({
      zzperName: profile?.company_name || profile?.full_name || 'Onbekend',
      accountantEmail: invitation.accountant_email,
      invitedBy: invitation.invited_by,
    })
  } catch (error) {
    console.error('[invite/info] error:', error)
    return NextResponse.json({ error: 'Server fout' }, { status: 500 })
  }
}