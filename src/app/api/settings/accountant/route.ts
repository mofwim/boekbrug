// src/app/api/settings/accountant/route.ts
// Returns linked accountant info using service role — bypasses RLS on profiles

import { NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase-server'
import { createPipelineClient } from '@/lib/supabase-pipeline'

export async function GET() {
  try {
    const supabase = await createServerSupabaseClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const pipeline = createPipelineClient()

    const { data: links } = await pipeline
      .from('accountant_clients')
      .select('accountant_id')
      .eq('zzper_id', user.id)
      .limit(1)

    if (!links || links.length === 0 || !links[0].accountant_id) {
      return NextResponse.json({ accountant: null })
    }

    const { data: accountantData } = await pipeline
      .from('profiles')
      .select('full_name, company_name, email')
      .eq('id', links[0].accountant_id)
      .single()

    return NextResponse.json({ accountant: accountantData ?? null })
  } catch (error) {
    console.error('[settings/accountant] error:', error)
    return NextResponse.json({ error: 'Server fout' }, { status: 500 })
  }
}