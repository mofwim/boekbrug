// src/app/api/invoice-corrections/[id]/route.ts
// [VOORSTEL] POST { action: "accept" | "decline" } — the client decides on a proposal.
//
// ── THE ONE DOOR ──
// Akkoord does not update the invoice here. It builds the exact request the client's own editor
// sends and calls the PATCH handler of /api/invoice/[id]/amounts — in THIS request, with THIS
// session — so every check that door makes (owner-only, status, settled money, arithmetic, the
// duplicate-number check, the filed-quarter impact, the audit row) runs unchanged. If that door
// refuses, the proposal stays open and the client sees the door's own sentence.
//
// A proposal is refused as STALE when the invoice no longer matches the snapshot on the fields it
// names: someone corrected it in between, and applying an old proposal on top of the newer truth
// is the one thing this feature must never do.

import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase-server'
import { createPipelineClient } from '@/lib/supabase-pipeline'
import { requireOwner } from '@/lib/owner-only'
import { createNotification } from '@/lib/notifications'
import { logAuditAction, getClientIP } from '@/lib/audit'
import { isStale, proposalPatchBody, type ProposableValues, type ProposedChange } from '@/lib/correction-proposal'
import { PATCH as correctInvoiceAmounts } from '@/app/api/invoice/[id]/amounts/route'

export const dynamic = 'force-dynamic'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

type ProposalRow = {
  id: string; accountant_id: string; client_id: string; invoice_id: string; status: string
  before: ProposableValues; proposed: ProposableValues; changes: ProposedChange[]
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!UUID.test(id)) return NextResponse.json({ error: 'Ongeldig verzoek' }, { status: 400 })
  const supabase = await createServerSupabaseClient()
  { const w = await requireOwner('Een correctievoorstel van je boekhouder beantwoorden'); if (w.response) return w.response }
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Niet ingelogd' }, { status: 401 })

  const body = await request.json().catch(() => null)
  const action = body?.action === 'accept' ? 'accept' : body?.action === 'decline' ? 'decline' : null
  if (!action) return NextResponse.json({ error: 'Ongeldig verzoek' }, { status: 400 })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pipeline = createPipelineClient() as any
  const { data: p, error: readErr } = await pipeline
    .from('invoice_corrections')
    .select('id, accountant_id, client_id, invoice_id, status, before, proposed, changes')
    .eq('id', id)
    .eq('client_id', user.id)
    .maybeSingle()
  if (readErr) {
    console.error('[VOORSTEL] voorstel lezen mislukt', { userId: user.id, id, error: readErr.message })
    return NextResponse.json({ error: 'Het voorstel kon niet worden gelezen — probeer het opnieuw.' }, { status: 503 })
  }
  const proposal = p as ProposalRow | null
  if (!proposal) return NextResponse.json({ error: 'Voorstel niet gevonden' }, { status: 404 })
  if (proposal.status !== 'open') return NextResponse.json({ error: 'Dit voorstel is al beantwoord.', code: 'decided' }, { status: 409 })

  const decide = async (status: 'accepted' | 'declined' | 'stale') => {
    await pipeline.from('invoice_corrections')
      .update({ status, decided_at: new Date().toISOString() })
      .eq('id', proposal.id).eq('status', 'open')
  }

  if (action === 'decline') {
    await decide('declined')
    await createNotification({
      userId: proposal.accountant_id, type: 'status',
      title: 'Correctievoorstel afgewezen', // [TAAL-DB]
      body: 'Je klant ging niet akkoord met je correctievoorstel. De factuur is ongewijzigd.', // [TAAL-DB]
      link: `/dashboard/clients/${proposal.client_id}/kwartaal`,
    })
    await logAuditAction({ userId: user.id, action: 'invoice.correction_declined', entityType: 'invoice', entityId: proposal.invoice_id, newValue: { proposal_id: proposal.id }, ipAddress: getClientIP(request) })
    return NextResponse.json({ ok: true, status: 'declined' })
  }

  // ── accept ──
  const { data: inv, error: invErr } = await supabase
    .from('invoices')
    .select('id, total_ex_btw, btw_amount, total_inc_btw, invoice_date, due_date')
    .eq('id', proposal.invoice_id)
    .eq('receiver_id', user.id)
    .maybeSingle()
  if (invErr) return NextResponse.json({ error: 'De factuur kon niet worden gelezen — probeer het opnieuw.' }, { status: 503 })
  if (!inv) return NextResponse.json({ error: 'Factuur niet gevonden' }, { status: 404 })
  const current: ProposableValues = {
    total_ex_btw: inv.total_ex_btw, btw_amount: inv.btw_amount, total_inc_btw: inv.total_inc_btw,
    invoice_date: inv.invoice_date, due_date: inv.due_date,
  }
  if (isStale(proposal.before, current, proposal.changes)) {
    await decide('stale')
    return NextResponse.json({ error: 'De factuur is intussen veranderd; dit voorstel vervalt. Vraag je boekhouder om een nieuw voorstel.', code: 'stale' }, { status: 409 })
  }

  // The client's own door, in the client's own session. Nothing else writes the invoice.
  const patchBody = proposalPatchBody(proposal.proposed, proposal.changes)
  const doorRequest = new NextRequest(new URL(`/api/invoice/${proposal.invoice_id}/amounts`, request.url), {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': request.headers.get('x-forwarded-for') ?? '' },
    body: JSON.stringify(patchBody),
  })
  const doorResponse = await correctInvoiceAmounts(doorRequest, { params: Promise.resolve({ id: proposal.invoice_id }) })
  if (!doorResponse.ok) {
    const doorJson = await doorResponse.json().catch(() => ({}))
    // The door's own sentence, the door's own status: the proposal stays open for a second try.
    return NextResponse.json({ error: doorJson.error ?? 'De correctie kon niet worden toegepast.', code: doorJson.code ?? 'door_refused' }, { status: doorResponse.status })
  }

  await decide('accepted')
  await createNotification({
    userId: proposal.accountant_id, type: 'status',
    title: 'Correctievoorstel overgenomen', // [TAAL-DB]
    body: 'Je klant ging akkoord; de factuur is aangepast zoals je voorstelde.', // [TAAL-DB]
    link: `/dashboard/clients/${proposal.client_id}/kwartaal`,
  })
  await logAuditAction({ userId: user.id, action: 'invoice.correction_accepted', entityType: 'invoice', entityId: proposal.invoice_id, newValue: { proposal_id: proposal.id, changes: proposal.changes }, ipAddress: getClientIP(request) })
  return NextResponse.json({ ok: true, status: 'accepted' })
}
