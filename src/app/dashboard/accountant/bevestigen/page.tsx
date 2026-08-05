// src/app/dashboard/accountant/bevestigen/page.tsx
// [BEVESTIGEN] De inkoopfacturen die wachten, over alle klanten die de boekhouder daarvoor
// gemachtigd hebben.
//
// WAAROM DE MANDAATGRENS EN NIET DE KOPPELING
// Een gekoppelde boekhouder mag meekijken. Bevestigen is iets anders: het boekt iets in de
// administratie van zijn klant, en die klant blijft er aansprakelijk voor (art. 52 AWR). Dat is
// precies de handeling waarvoor een uitdrukkelijke, intrekbare machtiging bestaat.
//
// De lijst hieronder is optimistisch, zoals elk scherm: de echte controle staat in
// /api/accountant/bevestig en daaronder in de RLS (invoices_mandate_confirm_read/_write) en de
// trigger. Trekt een klant zijn machtiging in terwijl deze pagina openstaat, dan blijft de knop
// staan en antwoordt hij 403.

import { redirect } from 'next/navigation'
import { createServerSupabaseClient } from '@/lib/supabase-server'
import { createPipelineClient } from '@/lib/supabase-pipeline'
import AccountantBevestigen, { type TeBevestigen } from '@/modules/accountant/pages/AccountantBevestigen'

export const dynamic = 'force-dynamic'

/** Wat de lezer niet zeker wist, in gewone woorden. */
function twijfelsVan(veld: unknown): string[] {
  if (!veld || typeof veld !== 'object') return []
  const uit: string[] = []
  const c = veld as Record<string, unknown>
  const laag = (k: string) => typeof c[k] === 'number' && (c[k] as number) < 0.8
  if (laag('total_inc_btw') || laag('btw_amount')) uit.push('het bedrag')
  if (laag('invoice_date')) uit.push('de datum')
  if (laag('client_name')) uit.push('de leverancier')
  if (laag('invoice_number')) uit.push('het factuurnummer')
  return uit
}

export default async function AccountantBevestigenPage() {
  const supabase = await createServerSupabaseClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('role, onboarding_done')
    .eq('id', user.id)
    .maybeSingle()

  if (!profile) redirect('/login')
  if (!profile.onboarding_done) redirect('/onboarding')
  if (profile.role !== 'accountant') redirect('/dashboard')

  // ── Toestemming, met de sessie ─────────────────────────────────────────────
  // [DEPLOY-SAFE] `kind` bestaat pas na accountant_confirm_mandate.sql. Faalt deze query, dan is
  // er niemand gemachtigd en toont het scherm de uitleg — nooit een crash.
  let gemandateerd: string[] = []
  try {
    const { data: mandaten } = await supabase
      .from('accountant_invoice_mandates')
      .select('zzper_id')
      .eq('accountant_id', user.id)
      .eq('kind', 'bevestigen')
      .is('revoked_at', null)
    gemandateerd = Array.from(new Set((mandaten ?? []).map((m) => m.zzper_id).filter(Boolean)))
  } catch {
    gemandateerd = []
  }

  if (gemandateerd.length === 0) {
    return <AccountantBevestigen rijen={[]} geenMandaat />
  }

  // De koppeling moet er óók zijn — de database eist hem hoe dan ook
  // (has_active_confirm_mandate joint op accountant_clients).
  const { data: links } = await supabase
    .from('accountant_clients')
    .select('zzper_id')
    .eq('accountant_id', user.id)
    .in('zzper_id', gemandateerd)
  const klantIds = Array.from(new Set((links ?? []).map((l) => l.zzper_id).filter((v): v is string => !!v)))

  if (klantIds.length === 0) {
    return <AccountantBevestigen rijen={[]} geenMandaat />
  }

  // ── De stapel ──────────────────────────────────────────────────────────────
  // service_role, expliciet beperkt tot de gemachtigde klanten — hetzelfde patroon als
  // accountant-access.ts: de TOESTEMMING is met de sessie vastgesteld, de DATA wordt daarna
  // scoped opgehaald. (invoices_mandate_confirm_read zou dit ook toelaten, maar dan één query per
  // klant; dit is dezelfde grens in één keer.)
  const pipeline = createPipelineClient()
  const [{ data: facturen }, { data: profielen }] = await Promise.all([
    pipeline
      .from('invoices')
      .select('id, receiver_id, client_name, invoice_number, invoice_date, total_inc_btw, btw_amount, field_confidence')
      .in('receiver_id', klantIds)
      .eq('direction', 'incoming')
      .eq('status', 'processing')
      .order('invoice_date', { ascending: true })
      .order('id', { ascending: true })
      .limit(500),
    pipeline.from('profiles').select('id, full_name, company_name').in('id', klantIds),
  ])

  const namen: Record<string, string> = {}
  for (const p of profielen ?? []) namen[p.id] = p.company_name || p.full_name || 'Klant'

  const rijen: TeBevestigen[] = (facturen ?? []).map((f) => ({
    id: f.id,
    clientId: f.receiver_id as string,
    clientNaam: namen[f.receiver_id as string] || 'Klant',
    leverancier: f.client_name || '',
    factuurnummer: f.invoice_number,
    datum: f.invoice_date,
    totaalInc: f.total_inc_btw,
    btw: f.btw_amount,
    twijfels: twijfelsVan(f.field_confidence),
  }))

  return <AccountantBevestigen rijen={rijen} />
}
