// src/app/api/invoice/[id]/supplier/route.ts
// [LEVERANCIER-VASTLEGGEN] The owner names a supplier once, and the app stops guessing.
//
// ── WHAT THIS DOOR IS FOR ──
//
// Reported on an invoice whose leverancier field read "Silifke / Hocaoglu" — a product line
// printed at the top of the page — while the company sending it is OZ&ER FOOD B.V., named further
// down beside its KVK, its BTW number and its IBAN. Next month's paper looks identical, so the
// reader makes the identical mistake, and the owner corrects it again. Forever.
//
// Correcting the NAME on one invoice already teaches the alias ("when a paper reads like this, it
// is that supplier" — supplier-alias.ts). What had no door at all is the rest of the identity:
// the account number, the KVK, the btw number. Those live on the SUPPLIER, they are what the
// registry resolves next month's invoice on, and nothing but the import could write them.
//
// ── WHY IT WRITES IN THIS ORDER ──
//
//   1. the alias first, through the module that already knows when learning would be a lie
//      (a name pointing at a name, a spelling that already belongs to another supplier). It also
//      finds-or-creates the supplier, so step 2 always has one;
//   2. the supplier's own fields, only where they moved;
//   3. this invoice, and its siblings linked to the same supplier, so every screen calls the
//      company what the owner just called it. Linked by supplier_id — never by name-matching,
//      which is the guess this whole feature exists to end.
//
// A failure at 2 or 3 leaves a state that is right, only less complete: the alias stands, so next
// month still resolves. Nothing here can leave the books in a worse position than before the call.

import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase-server'
// [ACTING-FOR] The supplier registry is keyed on the OWNER — an employee acting for them writes
// into the owner's registry, exactly as their invoice lands in the owner's books.
import { getActingFor } from '@/lib/acting-for-server'
import { invoiceOwnerId } from '@/lib/acting-for'
import { planSupplierPin, supplierPinChanges } from '@/lib/supplier-pin'
import { learnSupplierAlias } from '@/lib/supplier-alias-write'
import { logAuditAction, getClientIP } from '@/lib/audit'

export const dynamic = 'force-dynamic'

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const acting = await getActingFor()
  if (!acting) return NextResponse.json({ error: 'Niet ingelogd' }, { status: 401 })
  const ownerId = invoiceOwnerId(acting)

  const { id } = await params
  const supabase = await createServerSupabaseClient()

  let body: { name?: string | null; iban?: string | null; kvk?: string | null; btw?: string | null }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'bad_request' }, { status: 400 })
  }

  // The form, read once. A refusal here writes nothing at all — every value this stores is a key
  // something else decides with, and a mistyped IBAN would make the fraud check cry wolf on every
  // genuine invoice from this supplier.
  const plan = planSupplierPin(body)
  if (!plan.ok) {
    return NextResponse.json({ error: plan.error, field: plan.field }, { status: 400 })
  }

  // The invoice this correction is being made from. Owner-scoped and incoming-only: a supplier is
  // someone we BUY from, and the sales side has customers, which are a different table entirely.
  const { data: invoice, error: invErr } = await supabase
    .from('invoices')
    .select('id, client_name, vendor_iban, supplier_id, direction, receiver_id')
    .eq('id', id)
    .eq('receiver_id', ownerId)
    .eq('direction', 'incoming')
    .maybeSingle()
  if (invErr) return NextResponse.json({ error: 'lookup_failed', detail: invErr.message }, { status: 500 })
  if (!invoice) return NextResponse.json({ error: 'Factuur niet gevonden' }, { status: 404 })

  // ── 1. The alias, and with it the supplier itself ──
  //
  // learnSupplierAlias holds back where learning would be a claim the app cannot make, and it
  // finds-or-creates the supplier row on the way. Its result also carries the sentence the owner
  // reads — which is about the CONSEQUENCE ("next month we recognise this"), not the mechanism.
  const alias = await learnSupplierAlias(supabase, ownerId, {
    printedName: invoice.client_name,
    correctedName: plan.values.name,
    supplierId: invoice.supplier_id,
    // The identity the owner just confirmed is a stronger statement than what the paper printed,
    // so the rename question is answered with it.
    vendorIban: plan.values.iban ?? invoice.vendor_iban,
    kvk: plan.values.kvk,
  })

  // Which supplier are we writing to? The invoice's own link first; otherwise the row the alias
  // step just found or made, looked up by the key it would have used.
  let supplierId: string | null = invoice.supplier_id ?? null
  if (!supplierId) {
    const { data: found } = await supabase
      .from('suppliers')
      .select('id')
      .eq('user_id', ownerId)
      .eq('name_key', plan.values.nameKey)
      .limit(1)
      .maybeSingle()
    supplierId = (found as { id: string } | null)?.id ?? null
  }

  // ── 2. The supplier's own fields ──
  let pinned = false
  let supplierName = plan.values.name
  if (supplierId) {
    const { data: current } = await supabase
      .from('suppliers')
      .select('name, iban, kvk_number, btw_number')
      .eq('id', supplierId)
      .eq('user_id', ownerId)
      .maybeSingle()
    const changes = supplierPinChanges(current ?? {}, plan.values)
    if (Object.keys(changes).length > 0) {
      const { error: upErr } = await supabase
        .from('suppliers')
        .update(changes)
        .eq('id', supplierId)
        .eq('user_id', ownerId)
      // [NO-SILENT-EMPTY] A refused write is reported. The alias above already stands, so the
      // owner is not worse off than before — but telling them "opgeslagen" over a write that did
      // not happen is the one outcome that would make them stop checking.
      if (upErr) {
        return NextResponse.json(
          { error: 'De leverancier kon niet worden bijgewerkt. Probeer het zo meteen opnieuw.', detail: upErr.message },
          { status: 500 },
        )
      }
      pinned = true
    }
    supplierName = changes.name ?? current?.name ?? plan.values.name
  }

  // ── 3. This invoice, and its siblings ──
  //
  // client_name is not a label in this app: it is the identity key the IBAN-change check, the
  // incasso mandate, the creditnota signal and the reading memory all resolve on. Leaving the old
  // spelling on the row while the registry carries the new one is what splits a company's history
  // in two. Siblings by supplier_id only — matching on names is the guess this feature ends.
  const { error: selfErr } = await supabase
    .from('invoices')
    .update({ client_name: supplierName, ...(supplierId ? { supplier_id: supplierId } : {}) })
    .eq('id', id)
    .eq('receiver_id', ownerId)
  if (selfErr) {
    return NextResponse.json(
      { error: 'De naam kon niet op deze factuur worden gezet.', detail: selfErr.message },
      { status: 500 },
    )
  }

  let siblings = 0
  if (supplierId) {
    const { data: touched } = await supabase
      .from('invoices')
      .update({ client_name: supplierName })
      .eq('receiver_id', ownerId)
      .eq('direction', 'incoming')
      .eq('supplier_id', supplierId)
      .neq('client_name', supplierName)
      .select('id')
    siblings = (touched ?? []).length
  }

  await logAuditAction({
    userId: ownerId,
    action: 'invoice.updated',
    entityType: 'invoice',
    entityId: id,
    oldValue: { client_name: invoice.client_name, vendor_iban: invoice.vendor_iban },
    newValue: {
      supplier_id: supplierId,
      name: supplierName,
      iban: plan.values.iban,
      kvk: plan.values.kvk,
      btw: plan.values.btw,
      alias_learned: alias.learned,
      invoices_renamed: siblings,
      via: 'supplier_pinned',
      by: acting.actorId,
    },
    ipAddress: getClientIP(req),
  }).catch(() => {})

  return NextResponse.json({
    ok: true,
    name: supplierName,
    pinned,
    siblings,
    // The alias module's own sentence when there is one — it says what the owner will notice next
    // month. Never invented here: two spellings of the same promise drift.
    message: alias.message,
  })
}
