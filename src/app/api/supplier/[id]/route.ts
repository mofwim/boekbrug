// src/app/api/supplier/[id]/route.ts
// [LEVERANCIER-BEWERKEN] The owner edits a supplier's master record, for the future.
//
// ── WHAT THIS DOOR IS FOR ──
//
// /dashboard/leveranciers showed what the owner owes per supplier and offered nothing to correct
// who those suppliers ARE. The one editor the app had hung off an incoming invoice (the pin modal),
// which is right when a paper was misread and wrong for the ordinary case: "my wholesaler moved
// to a new bank" or "their KVK number is missing" has no invoice to start from. This route edits
// the row itself — the record the registry resolves next month's invoice on.
//
// ── THE RULES IT ENFORCES, AND WHERE THEY COME FROM ──
//
//   · The same validation as the pin route (supplier-pin.ts): a value that would poison a gate
//     is refused with the field named, and nothing is written.
//   · Forward only. Invoices already in the books keep their own printed IBAN and btw number
//     (art. 52 AWR keeps the document as it was). Only the display name follows the rename, on
//     the invoices LINKED to this supplier by id — the pin route's rule, for the same reason.
//   · A replaced IBAN is kept (supplier_iban_history), so a later invoice printing the old
//     number still resolves to this supplier and the IBAN-change gate can warn on it instead of
//     the registry founding a second row in silence.
//   · Every change lands in the audit trail as supplier.updated with old beside new.
//   · A number another supplier already carries is answered as "merge them", with that
//     supplier's name, rather than as a bare unique-violation.
//
// [TAAL] Every sentence comes from the catalogue in the language of whoever is typing.

import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase-server'
// [ACTING-FOR] The registry is keyed on the OWNER; an employee acting for them edits the owner's.
import { getActingFor } from '@/lib/acting-for-server'
import { invoiceOwnerId } from '@/lib/acting-for'
import { planSupplierEdit, duplicateField, supplierEditTrail } from '@/lib/supplier-edit'
import { SUPPLIER_PIN_REFUSAL_KEY } from '@/lib/supplier-pin'
import { serverTranslator } from '@/lib/i18n/server'
import { logAuditAction, getClientIP } from '@/lib/audit'

export const dynamic = 'force-dynamic'

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const t = await serverTranslator()
  const acting = await getActingFor()
  if (!acting) return NextResponse.json({ error: t('lev.fout.nietIngelogd'), code: 'unauthorized' }, { status: 401 })
  const ownerId = invoiceOwnerId(acting)

  const { id } = await params
  const supabase = await createServerSupabaseClient()

  let body: { name?: string | null; iban?: string | null; kvk?: string | null; btw?: string | null }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'bad_request' }, { status: 400 })
  }

  // The row as it stands. Owner-scoped: the id in the URL is only a claim.
  const { data: current, error: readErr } = await supabase
    .from('suppliers')
    .select('id, name, iban, kvk_number, btw_number')
    .eq('id', id)
    .eq('user_id', ownerId)
    .maybeSingle()
  // [NO-SILENT-EMPTY] A failed read is not "this supplier does not exist".
  if (readErr) return NextResponse.json({ error: t('lev.fout.opzoeken'), code: 'lookup_failed', detail: readErr.message }, { status: 503 })
  if (!current) return NextResponse.json({ error: t('lev.fout.nietGevonden'), code: 'not_found' }, { status: 404 })

  const plan = planSupplierEdit(current, body)
  if (!plan.ok) {
    return NextResponse.json(
      { error: t(SUPPLIER_PIN_REFUSAL_KEY[plan.code]), field: plan.field, code: plan.code },
      { status: 400 },
    )
  }

  // Nothing moved → nothing written, nothing logged. The trail never records a change that was not one.
  if (Object.keys(plan.changes).length === 0) {
    return NextResponse.json({ ok: true, changed: false, name: current.name, ibanReplaced: false, invoicesRenamed: 0 })
  }

  // ── 1. Keep the old account number BEFORE it is overwritten ──
  //
  // Order matters: a history row without the update is a harmless extra line; an update without
  // the history row is exactly the silent overwrite this exists to prevent. So the history goes
  // first, and a failure there stops the edit.
  if (plan.iban?.from) {
    const { error: histErr } = await supabase.from('supplier_iban_history').insert({
      user_id: ownerId,
      supplier_id: current.id,
      iban: plan.iban.from,
      replaced_by: plan.iban.to,
      actor_id: acting.actorId,
    })
    if (histErr) {
      return NextResponse.json({ error: t('lev.fout.bijwerken'), code: 'history_failed', detail: histErr.message }, { status: 500 })
    }
  }

  // ── 2. The row itself, only what moved ──
  const { error: upErr } = await supabase
    .from('suppliers')
    .update(plan.changes)
    .eq('id', current.id)
    .eq('user_id', ownerId)
  if (upErr) {
    // A number another supplier of this owner already carries: say WHO, and point at the merge.
    const dup = duplicateField(upErr)
    if (dup) {
      const column = dup === 'iban' ? 'iban' : 'kvk_number'
      const value = dup === 'iban' ? plan.values.iban : plan.values.kvk
      const { data: other } = await supabase
        .from('suppliers')
        .select('id, name')
        .eq('user_id', ownerId)
        .eq(column, value ?? '')
        .neq('id', current.id)
        .limit(1)
        .maybeSingle()
      const ander = (other as { id: string; name: string } | null)?.name ?? '?'
      return NextResponse.json(
        {
          error: t(dup === 'iban' ? 'lev.fout.dubbelIban' : 'lev.fout.dubbelKvk', { ander }),
          field: dup,
          code: 'duplicate',
          otherSupplierId: (other as { id: string } | null)?.id ?? null,
        },
        { status: 409 },
      )
    }
    return NextResponse.json({ error: t('lev.fout.bijwerken'), code: 'update_failed', detail: upErr.message }, { status: 500 })
  }

  // ── 3. The display name on the invoices linked to this supplier ──
  //
  // By supplier_id only, never by name-matching. client_name is the key half the screens group on;
  // leaving the old spelling on the rows while the registry carries the new one splits a company's
  // history in two. The printed IBAN and btw number on those invoices are NOT touched: the document
  // stays what it was.
  let invoicesRenamed = 0
  if (plan.changes.name) {
    const { data: touched } = await supabase
      .from('invoices')
      .update({ client_name: plan.changes.name })
      .eq('receiver_id', ownerId)
      .eq('direction', 'incoming')
      .eq('supplier_id', current.id)
      .neq('client_name', plan.changes.name)
      .select('id')
    invoicesRenamed = (touched ?? []).length
  }

  const trail = supplierEditTrail(current, plan.changes)
  await logAuditAction({
    userId: ownerId,
    action: 'supplier.updated',
    entityType: 'supplier',
    entityId: current.id,
    oldValue: trail.old,
    newValue: { ...trail.new, invoices_renamed: invoicesRenamed, via: 'leveranciers', by: acting.actorId },
    ipAddress: getClientIP(req),
  }).catch(() => {})

  return NextResponse.json({
    ok: true,
    changed: true,
    name: plan.changes.name ?? current.name,
    ibanReplaced: Boolean(plan.iban?.from),
    invoicesRenamed,
  })
}
