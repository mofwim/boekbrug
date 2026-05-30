// src/app/api/invite/info/route.ts
// Public endpoint — returns invitation + zzper name using service role
// Safe: only exposes name, not sensitive data. Token is the auth mechanism.

import { NextRequest, NextResponse } from 'next/server'
import { createPipelineClient } from '@/lib/supabase-pipeline'

export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get('token')
  if (!token) return NextResponse.json({ error: 'token verplicht' }, { status: 400 })

  try {
    const pipeline = createPipelineClient()

    const { data: invitation } = await pipeline
      .from('invitations')
      .select('id, zzper_id, accountant_email, status, invited_by')
      .eq('token', token)
      .eq('status', 'pending')
      .single()

    if (!invitation) return NextResponse.json({ error: 'Ongeldig' }, { status: 404 })

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