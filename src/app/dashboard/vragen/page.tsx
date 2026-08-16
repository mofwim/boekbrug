// src/app/dashboard/vragen/page.tsx
// [BRUG-RETOUR] "Je boekhouder heeft een vraag" — de terugweg van de brug.
//
// De brug liep één kant op. De boekhouder kon een document op status 'vraag' zetten
// (/api/accountant/subject-status), de klant kreeg één notificatie naar /dashboard/bestanden
// — een map met bestanden zonder vraag, zonder tekst, zonder antwoordknop — en het gesprek
// verhuisde naar WhatsApp. Dit scherm is de ontbrekende helft: de vraag, het document waar
// hij over gaat, en één veld om te antwoorden.
//
// GRENZEN DIE HIER GELDEN
//  · De statusrijen komen binnen via RLS-policy acc_status_client_read_document: alleen
//    subject_type='document' en alleen documenten van auth.uid(). Wij filteren dus niet op
//    eigenaarschap — de policy doet dat, en dat is de enige echte grens.
//  · Die policy is SELECT-only. De klant kan een vraag niet afvinken; dat blijft een
//    bewering van de boekhouder. Antwoorden loopt via /api/messages.
//  · De naam van de boekhouder is voor de klant NIET leesbaar (profiles heeft alleen
//    profiles_select_accountant_clients, één richting). Wij lezen die daarom met
//    service_role, en uitsluitend nádat accountant_clients de koppeling heeft bewezen —
//    net als de ondertekende bestands-URL's hieronder.

import { redirect } from 'next/navigation'
import { createServerSupabaseClient } from '@/lib/supabase-server'
import { createPipelineClient } from '@/lib/supabase-pipeline'
// [SEC-STORAGE-PATH] A row check is not a path check — see the header of storage-path.ts.
import { toStoragePath, pathBelongsToOwner } from '@/lib/storage-path'
import {
  buildOpenVragen, buildOpenInvoiceVragen, VRAAG_STATUS,
  type VraagStatusRow, type VraagInvoiceRow,
} from '@/lib/vragen'
import VragenClient, { type VraagView } from './VragenClient'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Vragen van je boekhouder — BoekBrug' }

export default async function VragenPage() {
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('role, onboarding_done')
    .eq('id', user.id)
    .single()

  if (!profile?.onboarding_done) redirect('/onboarding')
  // Dit is het scherm van de ondernemer. De boekhouder stelt zijn vragen op /dashboard/brug.
  if (profile.role === 'accountant') redirect('/dashboard/accountant')

  // ── De openstaande vragen ────────────────────────────────────────────────────
  // Geen .eq('user_id', …) — die kolom bestaat hier niet; de policy koppelt de rij aan
  // het document en het document aan de eigenaar. Faalt de lezing, dan tonen wij géén
  // lege lijst maar een eerlijke foutmelding (zie loadFailed): "geen vragen" is een
  // bewering, en die mag nooit uit een mislukte query komen.
  const { data: statusData, error: statusErr } = await supabase
    .from('accountant_subject_status')
    .select('subject_id, status, vraag_text, updated_at')
    .eq('subject_type', 'document')
    .eq('status', VRAAG_STATUS)

  let loadFailed = Boolean(statusErr)
  const statusRows = (statusData ?? []) as VraagStatusRow[]

  // ── De documenten erbij ──────────────────────────────────────────────────────
  // Zonder trashed-filter: een vraag over een weggegooid bestand blijft een openstaande
  // vraag, en het scherm zegt dat het in de prullenbak ligt.
  const docIds = statusRows.map((r) => r.subject_id)
  const { data: docs } = docIds.length
    ? await supabase
        .from('documents')
        .select('id, file_name, file_url, trashed')
        .in('id', docIds)
    : { data: [] as Array<{ id: string; file_name: string | null; file_url: string | null; trashed: boolean | null }> }

  const docRows = (docs ?? []) as Array<{
    id: string; file_name: string | null; file_url: string | null; trashed: boolean | null
  }>

  const documentVragen = buildOpenVragen(statusRows, docRows)

  // ── [FACTUURVRAAG] En de vragen over FACTUREN ────────────────────────────────
  // De boekhouder kon een factuur al op 'vraag' zetten in de zin dat drie van zijn schermen die
  // status TELDEN — hij had alleen geen route om hem te schrijven, en dit scherm filterde op
  // subject_type='document', dus zo'n vraag kon hier nooit verschijnen.
  //
  // Aparte lezing, geen OR op subject_type: de twee rijen komen langs verschillende RLS-policies
  // binnen (acc_status_client_read_document en acc_status_client_read_invoice), en één query die
  // beide moet halen faalt geheel zodra de tweede policy nog niet is uitgerold. Zo blijven de
  // documentvragen staan en komen de factuurvragen erbij zodra de migratie draait.
  //
  // [NO-SILENT-EMPTY] invoiceLoadFailed telt apart mee in loadFailed: "geen vragen" mag nooit uit
  // een mislukte lezing komen, en dat geldt voor deze helft net zo goed als voor de andere.
  const { data: invStatusData, error: invStatusErr } = await supabase
    .from('accountant_subject_status')
    .select('subject_id, status, vraag_text, updated_at')
    .eq('subject_type', 'invoice')
    .eq('status', VRAAG_STATUS)

  const invStatusRows = (invStatusData ?? []) as VraagStatusRow[]
  const invIds = invStatusRows.map((r) => r.subject_id)
  const { data: invData } = invIds.length
    ? await supabase
        .from('invoices')
        .select('id, invoice_number, client_name, total_inc_btw, invoice_date')
        .in('id', invIds)
    : { data: [] as VraagInvoiceRow[] }

  // Een mislukte lezing van deze helft is óók een reden om niet 'geen vragen' te zeggen.
  if (invStatusErr) loadFailed = true

  const invoiceVragen = buildOpenInvoiceVragen(invStatusRows, (invData ?? []) as VraagInvoiceRow[])

  // Samengevoegd en opnieuw op ouderdom gesorteerd: voor de klant is dit één lijst "wat wil mijn
  // boekhouder van mij", niet twee lijstjes per tabel waar de vraag toevallig in staat.
  const vragen = [...documentVragen, ...invoiceVragen].sort((a, b) => {
    if (a.askedAt && b.askedAt) return a.askedAt.localeCompare(b.askedAt)
    if (a.askedAt) return -1
    if (b.askedAt) return 1
    return 0
  })

  // ── De boekhouder ────────────────────────────────────────────────────────────
  const { data: link } = await supabase
    .from('accountant_clients')
    .select('accountant_id')
    .eq('zzper_id', user.id)
    .maybeSingle()

  const accountantId: string | null = link?.accountant_id ?? null

  let accountantNaam: string | null = null
  const pipeline = createPipelineClient()
  if (accountantId) {
    // service_role — uitsluitend voor de wéérgave van de naam, en pas nadat de koppeling
    // hierboven is bewezen. Nooit om te bepalen wát iemand mag zien.
    const { data: accProfile } = await pipeline
      .from('profiles')
      .select('full_name, company_name')
      .eq('id', accountantId)
      .maybeSingle()
    const naam = (accProfile?.full_name ?? '').trim()
    const bedrijf = (accProfile?.company_name ?? '').trim()
    accountantNaam = naam || bedrijf || null
  }

  // ── Ondertekende bestands-URL's ──────────────────────────────────────────────
  // Zelfde reden als op /dashboard/brug: de bucket-policy staat los van de tabel-RLS.
  // De rijen zijn hierboven via de gebruikerssessie gelezen, dus er wordt nooit een pad
  // ondertekend dat deze gebruiker niet mocht zien.
  const urlByDoc = new Map<string, string>()
  await Promise.all(
    docRows.map(async (d) => {
      if (!d.file_url) return
      if (/^https?:\/\//i.test(d.file_url)) { urlByDoc.set(d.id, d.file_url); return }
      // [SEC-STORAGE-PATH] The document rows are this owner's; that says nothing about where their
      // file_url POINTS. `pipeline` is service_role and bypasses the bucket policy, so an
      // unattributable key would be signed into a working one-hour URL. A path we cannot prove
      // belongs to this owner simply gets no link — the question still renders without one.
      const pad = toStoragePath(d.file_url)
      if (!pathBelongsToOwner(pad, user.id)) return
      const { data } = await pipeline.storage.from('documents').createSignedUrl(pad, 3600)
      if (data?.signedUrl) urlByDoc.set(d.id, data.signedUrl)
    }),
  )

  const views: VraagView[] = vragen.map((v) => ({
    ...v,
    fileUrl: urlByDoc.get(v.documentId) ?? null,
  }))

  return (
    <VragenClient
      vragen={views}
      accountantId={accountantId}
      accountantNaam={accountantNaam}
      loadFailed={loadFailed}
    />
  )
}
