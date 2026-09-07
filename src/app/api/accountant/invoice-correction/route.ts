// src/app/api/accountant/invoice-correction/route.ts
// [VOORSTEL] POST — the accountant proposes a correction on a client's purchase invoice.
//
// Writes ONE row in invoice_corrections and nothing on the invoice. The proposal is validated with
// the same arithmetic the client's own correction door enforces (correction-proposal.ts), so the
// client never sees a proposal the app would refuse at Akkoord. Same authorization shape as
// invoice-question: a linked client, an invoice that belongs to them.

import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase-server'
import { createPipelineClient } from '@/lib/supabase-pipeline'
import { createNotification } from '@/lib/notifications'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { logAuditAction, getClientIP } from '@/lib/audit'
import { hasSettledMoney } from '@/lib/invoice-removal'
import { buildProposal, type ProposableValues } from '@/lib/correction-proposal'

export const dynamic = 'force-dynamic'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const MAX_REASON = 500

export async function POST(request: NextRequest) {
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Niet ingelogd.' }, { status: 401 })

  const body = await request.json().catch(() => null)
  const clientId = typeof body?.clientId === 'string' ? body.clientId : ''
  const invoiceId = typeof body?.invoiceId === 'string' ? body.invoiceId : ''
  if (!UUID.test(clientId) || !UUID.test(invoiceId)) {
    return NextResponse.json({ error: 'Ongeldig verzoek' }, { status: 400 })
  }
  const reason = typeof body?.reason === 'string' ? body.reason.trim().slice(0, MAX_REASON) : ''

  const limit = await checkRateLimit({ userId: user.id, endpoint: '/api/accountant/invoice-correction', ...RATE_LIMITS.INVOICE_SEND })
  if (!limit.allowed) return rateLimitResponse(limit)

  const { data: links, error: linkErr } = await supabase
    .from('accountant_clients').select('zzper_id').eq('accountant_id', user.id)
  if (linkErr) {
    console.error('[VOORSTEL] koppelingslezing mislukt', { accountantId: user.id, error: linkErr.message })
    return NextResponse.json({ error: 'De koppeling kon niet worden gecontroleerd — probeer het opnieuw.' }, { status: 503 })
  }
  if (!(links ?? []).some((l) => l.zzper_id === clientId)) {
    return NextResponse.json({ error: 'Je kunt alleen een voorstel doen bij een gekoppelde klant' }, { status: 403 })
  }

  const { data: inv, error: invErr } = await supabase
    .from('invoices')
    .select('id, receiver_id, direction, status, amount_paid, invoice_number, client_name, total_ex_btw, btw_amount, total_inc_btw, invoice_date, due_date')
    .eq('id', invoiceId)
    .maybeSingle()
  if (invErr) {
    console.error('[VOORSTEL] factuurlezing mislukt', { accountantId: user.id, invoiceId, error: invErr.message })
    return NextResponse.json({ error: 'De factuur kon niet worden gelezen — probeer het opnieuw.' }, { status: 503 })
  }
  if (!inv || inv.receiver_id !== clientId || inv.direction !== 'incoming') {
    return NextResponse.json({ error: 'Deze inkoopfactuur hoort niet bij deze klant' }, { status: 404 })
  }
  // The client's door only opens on a booked, unpaid invoice — a proposal on anything else would
  // be accepted and then refused, which is worse than refusing it here.
  if (inv.status !== 'received' || hasSettledMoney({ status: inv.status, amount_paid: inv.amount_paid })) {
    return NextResponse.json({ error: 'Alleen een geboekte, nog niet betaalde inkoopfactuur kan gecorrigeerd worden.', code: 'not_correctable' }, { status: 409 })
  }

  const before: ProposableValues = {
    total_ex_btw: inv.total_ex_btw, btw_amount: inv.btw_amount, total_inc_btw: inv.total_inc_btw,
    invoice_date: inv.invoice_date, due_date: inv.due_date,
  }
  const verdict = buildProposal(before, {
    total_ex_btw: body?.total_ex_btw, btw_amount: body?.btw_amount, total_inc_btw: body?.total_inc_btw,
    invoice_date: body?.invoice_date, due_date: body?.due_date,
  })
  if (!verdict.ok) return NextResponse.json({ error: verdict.reason, code: verdict.code }, { status: 400 })

  // Service role: the table has no INSERT policy on purpose (see the migration).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pipeline = createPipelineClient() as any
  const { data: row, error: insErr } = await pipeline
    .from('invoice_corrections')
    .insert({
      accountant_id: user.id, client_id: clientId, invoice_id: invoiceId,
      before, proposed: verdict.proposed, changes: verdict.changes, reason: reason || null, status: 'open',
    })
    .select('id')
    .single()
  if (insErr) {
    if (/invoice_corrections_open_uidx|duplicate key/i.test(insErr.message ?? '')) {
      return NextResponse.json({ error: 'Er staat al een voorstel open op deze factuur. Wacht op het antwoord van de klant.', code: 'already_open' }, { status: 409 })
    }
    console.error('[VOORSTEL] schrijven mislukt', { accountantId: user.id, invoiceId, error: insErr.message })
    return NextResponse.json({ error: 'Het voorstel kon niet worden opgeslagen — probeer het opnieuw.' }, { status: 503 })
  }

  const nr = inv.invoice_number ? `factuur ${inv.invoice_number}` : 'een inkoopfactuur'
  const party = inv.client_name ? ` van ${inv.client_name}` : ''
  await createNotification({
    userId: clientId,
    type: 'status',
    title: 'Correctievoorstel van je boekhouder', // [TAAL-DB] stored notification — the client's screen
    body: `Je boekhouder stelt een correctie voor op ${nr}${party}. Bekijk het en tik op Akkoord of Niet akkoord.`, // [TAAL-DB]
    link: '/dashboard/vragen',
  })
  await logAuditAction({
    userId: user.id, action: 'invoice.correction_proposed', entityType: 'invoice', entityId: invoiceId,
    newValue: { proposal_id: row.id, client_id: clientId, changes: verdict.changes, reason: reason || null },
    ipAddress: getClientIP(request),
  })
  return NextResponse.json({ ok: true, id: row.id, changes: verdict.changes })
}
