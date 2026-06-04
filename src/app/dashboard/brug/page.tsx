// src/app/dashboard/brug/page.tsx
// [BOEK-002] Bridge view — server wrapper.
// Fetches invoices + documents + folders (RLS-filtered), builds the bridge tree
// server-side (rendering logic stays on the server), passes nodes to the client.
//
// Mirrors the project pattern: createServerSupabaseClient, profile fetch,
// redirect guards, force-dynamic. Does NOT touch bestanden.ts (BOEK-033).

import { redirect } from 'next/navigation'
import { createServerSupabaseClient } from '@/lib/supabase-server'
import {
  buildBridgeTree,
  type BridgeInvoice,
  type BridgeDocument,
  type BridgeFolder,
} from '@/lib/bridge-tree'
import { getDocumentUrl } from '@/lib/documents'
import BrugClient from './BrugClient'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Brug — BoekBrug' }

// Exact columns the renderer needs (match BridgeInvoice / BridgeDocument).
const INVOICE_COLS =
  'id, invoice_number, invoice_type, status, direction, invoice_date, payment_method, total_inc_btw, document_id, pdf_url, sender_id, receiver_id'
const DOCUMENT_COLS =
  'id, file_name, file_url, folder_id, doc_type, year, period, invoice_id, user_id, created_at'
const FOLDER_COLS = 'id, name, parent_id, folder_type, user_id'

export default async function BrugServerPage() {
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('onboarding_done, role')
    .eq('id', user.id)
    .single()

  if (!profile?.onboarding_done) redirect('/onboarding')

  const isAccountant = profile.role === 'accountant'

  // RLS does the filtering:
  //  - ZZP'er: owner_all / zzp_select → own invoices; documents_owner_all → own docs.
  //  - Accountant: invoices_accountant_read (shared=true, linked clients);
  //                documents_accountant_read (shared docs of linked clients).
  // So we simply select; the policies scope the rows correctly per role.
  const [invoicesRes, documentsRes, foldersRes] = await Promise.all([
    supabase.from('invoices').select(INVOICE_COLS),
    supabase.from('documents').select(DOCUMENT_COLS).eq('trashed', false),
    supabase.from('folders').select(FOLDER_COLS),
  ])

  // NOTE: cast via `unknown` because database.types.ts may predate the B.1
  // migration (payment_method / shared). The columns DO exist in the DB;
  // BridgeInvoice/BridgeDocument are the source of truth for shape here.
  // Best fix: regenerate types →
  //   npx supabase gen types typescript --project-id <ref> > src/types/database.types.ts
  const invoices = ((invoicesRes.data ?? []) as unknown) as BridgeInvoice[]
  const documents = ((documentsRes.data ?? []) as unknown) as BridgeDocument[]
  const folders = ((foldersRes.data ?? []) as unknown) as BridgeFolder[]

  // [BOEK-005] Accountant view: resolve client UUIDs → display labels
  // ("Naam — Bedrijf") so the Klanten folders show names, not raw ids.
  let clientNames: Map<string, string> | undefined
  if (isAccountant) {
    const { data: links } = await supabase
      .from('accountant_clients')
      .select('zzper_id, profiles:zzper_id (id, full_name, company_name)')
      .eq('accountant_id', user.id)

    clientNames = new Map<string, string>()
    for (const link of links ?? []) {
      const p = (link as any).profiles
      if (!p?.id) continue
      const name = (p.full_name ?? '').trim()
      const company = (p.company_name ?? '').trim()
      const label =
        name && company ? `${name} — ${company}` : (company || name || p.id)
      clientNames.set(p.id, label)
    }
  }

  // Build the tree server-side. Rendering logic never reaches the client.
  const nodes = buildBridgeTree({
    invoices,
    documents,
    folders,
    accountantView: isAccountant,
    clientNames,
  })

  // [BOEK-002] Resolve playable URLs server-side.
  // documents store a raw storage path in file_url → needs a signed URL.
  // invoices may carry a full http(s) url already → leave as-is.
  // RLS already scoped the rows, so signing here is safe (no extra ownership
  // check needed — and notably this works for the accountant opening a linked
  // client's shared file, which /api/files/[id]/url would reject on user_id).
  const signedNodes = await Promise.all(
    nodes.map(async (n) => {
      if (!n.pdfUrl) return n
      // Already a full URL → keep.
      if (/^https?:\/\//i.test(n.pdfUrl)) return n
      // Storage path → sign it (documents bucket).
      const signed = await getDocumentUrl(n.pdfUrl)
      return { ...n, pdfUrl: signed }
    })
  )

  return <BrugClient nodes={signedNodes} role={profile.role} />
}