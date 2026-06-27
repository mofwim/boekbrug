// src/app/dashboard/brug/page.tsx
// [BOEK-002] Bridge view — server wrapper.
// Fetches invoices + documents + folders (RLS-filtered), builds the bridge tree
// server-side (rendering logic stays on the server), passes nodes to the client.
//
// Mirrors the project pattern: createServerSupabaseClient, profile fetch,
// redirect guards, force-dynamic. Does NOT touch bestanden.ts (BOEK-033).

import { redirect } from 'next/navigation'
import { createServerSupabaseClient } from '@/lib/supabase-server'
import { createPipelineClient } from '@/lib/supabase-pipeline'
import {
  buildBridgeTree,
  type BridgeInvoice,
  type BridgeDocument,
  type BridgeFolder,
} from '@/lib/bridge-tree'
import BrugClient from './BrugClient'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Brug — BoekBrug' }

// Exact columns the renderer needs (match BridgeInvoice / BridgeDocument).
// Exact columns the renderer needs (match BridgeInvoice / BridgeDocument).
// [BRIDGE-A] + due_date (computed 'Verlopen' badge), accountant_status ('Verwerkt'/'Vraag' badges)
const INVOICE_COLS =
  'id, invoice_number, invoice_type, status, direction, invoice_date, due_date, payment_method, accountant_status, total_inc_btw, document_id, pdf_url, sender_id, receiver_id, client_name'
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
  //
  // ⚠️ Why service_role here (despite the pipeline-client warning):
  // Storage bucket policies are SEPARATE from table RLS. Table RLS let the
  // accountant READ the row metadata, but the storage bucket only lets a user
  // sign their OWN files — so the accountant can't sign a linked client's file
  // via the user session (returns null → no link, the bug we saw).
  // We sign with service_role, but ONLY for nodes that already passed table RLS
  // (the rows were fetched under the user session + the clientNames filter), so
  // no unauthorized path is ever signed. service_role is used here strictly to
  // bypass STORAGE rls, not to widen which rows are visible.
  const pipeline = createPipelineClient()
  const signUrl = async (path: string): Promise<string | null> => {
    const { data } = await pipeline.storage.from('documents').createSignedUrl(path, 3600)
    return data?.signedUrl ?? null
  }

  const signedNodes = await Promise.all(
    nodes.map(async (n) => {
      if (!n.pdfUrl) return n
      // Already a full URL → keep.
      if (/^https?:\/\//i.test(n.pdfUrl)) return n
      // Storage path → sign it (documents bucket) via service_role.
      const signed = await signUrl(n.pdfUrl)
      return { ...n, pdfUrl: signed }
    })
  )

  // [BRIDGE-HUB] Layer 1 — per-client summaries for the accountant's overview.
  // Computed from the invoices already fetched (no extra query). For each linked
  // client: how many verified invoices this quarter, and whether anything is
  // still pending (status 'processing') — which sets the readiness status.
  //   Klaar          → has verified invoices, nothing pending
  //   Te controleren → has pending (processing) invoices to confirm
  //   Leeg           → no invoices this quarter
  let clientSummaries: ClientSummary[] | undefined
  if (isAccountant && clientNames) {
    const now = new Date()
    const q = (Math.floor(now.getMonth() / 3) + 1)
    const qStart = new Date(now.getFullYear(), (q - 1) * 3, 1)
    const qEnd = new Date(now.getFullYear(), q * 3, 0, 23, 59, 59)
    const VERIFIED = new Set(['sent', 'paid', 'overdue', 'received'])

    const acc = new Map<string, { verified: number; pending: number; total: number }>()
    for (const id of clientNames.keys()) acc.set(id, { verified: 0, pending: 0, total: 0 })

    for (const inv of invoices) {
      const d = inv.invoice_date ? new Date(inv.invoice_date) : null
      if (!d || d < qStart || d > qEnd) continue
      // The invoice belongs to whichever linked client is sender or receiver.
      const owner = (inv.sender_id && acc.has(inv.sender_id)) ? inv.sender_id
                  : (inv.receiver_id && acc.has(inv.receiver_id)) ? inv.receiver_id
                  : null
      if (!owner) continue
      const bucket = acc.get(owner)!
      bucket.total++
      const s = inv.status ?? ''
      if (VERIFIED.has(s)) bucket.verified++
      else if (s === 'processing') bucket.pending++
    }

    clientSummaries = [...clientNames.entries()].map(([id, label]) => {
      const b = acc.get(id) ?? { verified: 0, pending: 0, total: 0 }
      const status: ClientSummary['status'] =
        b.pending > 0 ? 'review' : b.verified > 0 ? 'ready' : 'empty'
      return { id, label, verified: b.verified, pending: b.pending, status }
    }).sort((a, b) => a.label.localeCompare(b.label, 'nl'))
  }

  return <BrugClient nodes={signedNodes} role={profile.role} clientSummaries={clientSummaries} />
}

// [BRIDGE-HUB] Per-client readiness summary for the accountant overview (Layer 1).
export interface ClientSummary {
  id: string
  label: string
  verified: number
  pending: number
  status: 'ready' | 'review' | 'empty'
}