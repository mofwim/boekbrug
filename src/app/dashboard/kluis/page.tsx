// src/app/dashboard/kluis/page.tsx
// [KLUIS] Compliance-kluis (anchor gateway #5). Server-rendered (RLS): fetches the
// owner's invoices + documents, runs the pure retention/completeness math, and hands
// the per-year summaries to the client. The vault is the "never-cancelled" anchor —
// the whole 7-year bewaarplicht history in one place, always exportable.
export const dynamic = 'force-dynamic'

import { redirect } from 'next/navigation'
import { createServerSupabaseClient } from '@/lib/supabase-server'
import { summarizeVault, type VaultInvoice, type VaultDocument } from '@/lib/compliance-vault'
import { fetchAllRows } from '@/lib/supabase-paginate'
import { PURPOSE_PARAM, parsePurpose } from '@/lib/account-purpose'
import KluisClient from './KluisClient'

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ doel?: string; bewaard?: string; geannuleerd?: string }>
}) {
  const params = await searchParams
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  // [KLUIS] Waarvoor dit account is aangemaakt. Bepaalt alleen de begroeting hieronder —
  // nooit wat iemand mag. Ontbreekt de kolom (migratie nog niet toegepast), dan is het
  // antwoord 'boekhouden' en verandert er niets.
  let purpose = 'boekhouden'
  try {
    const { data } = await supabase
      .from('profiles')
      .select('account_purpose')
      .eq('id', user.id)
      .single()
    purpose = parsePurpose(data?.account_purpose)
  } catch {
    /* kolom bestaat nog niet → 'boekhouden' */
  }

  // [KLUIS] Zelfherstel voor de Google-route. Wie zich via /bewaarplicht met Google
  // registreert loopt langs Supabase's OAuth-callback en niet langs onze signUp(), dus de
  // metadata met het doel gaat daar verloren. /register laat het doel daarom meereizen in
  // de bestemmings-URL, en hier zetten wij het alsnog goed.
  //
  // Veilig omdat het strikt beperkt is: alleen de eigen rij, alleen de ene kolom, alleen in
  // de richting boekhouden → archief, en alleen als de gebruiker zelf met ?doel=archief
  // binnenkomt. Het kan dus nooit iemand rechten geven of afnemen — die hangen niet aan
  // deze kolom en dat moet zo blijven.
  //
  // [VANGNET-SPLITSING] Twee aparte schrijfacties, en dat is niet netjesheid maar noodzaak:
  // `account_purpose` komt uit account_purpose_archief.sql — in productie toegepast, maar een
  // verse dev- of stagingdatabase begint zonder. Ontbreekt die kolom, dan weigert
  // PostgREST de HELE rij (PGRST204) — en in één update zou dan ook `onboarding_done` niet
  // geschreven worden. Dan blijft de bezoeker de wizard in gestuurd worden door de middleware,
  // precies in het geval waarvoor dit zelfherstel bestaat. Eerst dus de kolom die er altijd is.
  if (purpose !== 'archief' && parsePurpose(params[PURPOSE_PARAM as 'doel']) === 'archief') {
    const { error: doneError } = await supabase
      .from('profiles')
      .update({ onboarding_done: true })
      .eq('id', user.id)
    if (doneError) {
      console.error('[KLUIS] onboarding_done niet gezet bij zelfherstel:', doneError.message)
    }

    const { error: purposeError } = await supabase
      .from('profiles')
      .update({ account_purpose: 'archief' })
      .eq('id', user.id)
    if (purposeError) {
      // Verwacht zolang de migratie niet is toegepast: hij ziet dan de gewone begroeting.
      // Geen reden om iets te blokkeren — hij is en blijft in zijn kluis.
      console.error('[KLUIS] account_purpose niet gezet (migratie toegepast?):', purposeError.message)
    } else {
      purpose = 'archief'
    }
  }

  // Real records: the owner's own invoices (BOTH directions) and stored documents.
  // [KLUIS-INCOMING] Previously fetched only sender_id=user (OUTGOING) — so every INCOMING
  // supplier invoice (receiver_id=user) was missing from the vault and "Facturen in" was
  // always 0. A retail shop's administration is almost all incoming, so the compliance vault
  // showed an empty bewaarplicht history. Fetch both directions and select receiver_id so a
  // null-direction row can be inferred (owner = receiver ⇒ incoming), matching every other
  // surface (aangifte/result/readiness effDir).
  // [PAGINATION] The vault spans EVERY year (7-yr bewaarplicht) — a multi-year shop can
  // exceed the 1000-row cap, so page past it (else old years silently show fewer records).
  const [invoices, documents] = await Promise.all([
    fetchAllRows((from, to) => supabase
      .from('invoices')
      .select('invoice_date, direction, invoice_type, status, total_inc_btw, receiver_id')
      .or(`sender_id.eq.${user.id},receiver_id.eq.${user.id}`)
      .order('id', { ascending: true }).range(from, to)),
    fetchAllRows((from, to) => supabase
      .from('documents')
      .select('doc_type, year, period, trashed')
      .eq('user_id', user.id)
      .order('id', { ascending: true }).range(from, to)),
  ])

  // [KLUIS-INCOMING] Infer a null direction from ownership before the vault math splits
  // uit/in — so an email-imported incoming invoice with no explicit direction still counts.
  const vaultInvoices: VaultInvoice[] = ((invoices) as Array<VaultInvoice & { receiver_id: string | null }>)
    .map((i) => ({
      invoice_date: i.invoice_date,
      direction: i.direction === 'incoming' || i.direction === 'outgoing'
        ? i.direction
        : (i.receiver_id === user.id ? 'incoming' : 'outgoing'),
      invoice_type: i.invoice_type,
      status: i.status,
      total_inc_btw: i.total_inc_btw,
    }))

  // The current year drives the retention window. We compute it once, on the server,
  // rather than in the client (Date.now() is unavailable in some render contexts and
  // a server value keeps the window stable within one render).
  const currentYear = new Date().getUTCFullYear()

  const summaries = summarizeVault(
    currentYear,
    vaultInvoices,
    documents as VaultDocument[],
  )

  return (
    <KluisClient
      summaries={summaries}
      currentYear={currentYear}
      purpose={purpose === 'archief' ? 'archief' : 'boekhouden'}
      justPaid={params.bewaard === '1'}
    />
  )
}
