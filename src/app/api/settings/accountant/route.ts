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

    const accountantId = links[0].accountant_id

    // [MANDAAT] Mag deze boekhouder facturen op naam van deze klant uitreiken? Het antwoord hoort
    // bij de boekhouder zelf: de klant moet op één scherm kunnen zien wie hij heeft, en wat die
    // persoon mag. Een toestemming die je alleen terugvindt in een menu dat je niet opent, is een
    // toestemming die je niet meer intrekt.
    const [{ data: accountantData }, { data: mandaat }] = await Promise.all([
      pipeline
        .from('profiles')
        .select('full_name, company_name, email')
        .eq('id', accountantId)
        .single(),
      // [BEVESTIGEN] Beide soorten in één query — de klant moet op één scherm zien wat hij
      // precies heeft weggegeven, en dat zijn twee losse dingen.
      pipeline
        .from('accountant_invoice_mandates')
        .select('kind')
        .eq('zzper_id', user.id)
        .eq('accountant_id', accountantId)
        .is('revoked_at', null),
    ])

    const soorten = new Set((mandaat ?? []).map((m) => (m as { kind?: string }).kind ?? 'facturen'))

    return NextResponse.json({
      accountant: accountantData ? { ...accountantData, id: accountantId } : null,
      mayInvoice: soorten.has('facturen'),
      mayConfirm: soorten.has('bevestigen'),
    })
  } catch (error) {
    console.error('[settings/accountant] error:', error)
    return NextResponse.json({ error: 'Server fout' }, { status: 500 })
  }
}