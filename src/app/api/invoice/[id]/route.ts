// src/app/api/invoice/[id]/route.ts
// Invoice item route — GET (fetch one), PUT (edit a draft), DELETE (remove a draft).
// =====================================================
// [INVOICE-ROUTE-RESTORE] This file previously held a stray copy of the BOEK-010
// *files* route (GET on `documents`, DELETE → 410), so it exposed no PUT. The
// edit page (PUT save + edit→send) and InvoiceActions (DELETE) both hit
// /api/invoice/[id] and got 405/410 → editing and deleting were fully broken.
// Restored here with the real handlers.
//
// Legal guard (Art. 35 Wet OB 1968): a document that carries a NUMBER is immutable — it sits in
// a gapless, forward-only series and is corrected with a creditnota, never rewritten. DELETE stays
// draft-only. EDIT follows isInvoiceEditable (src/lib/invoice-editable.ts): a draft, or a quote
// that has not become an invoice yet. An offerte has no number and is not a legal invoice, so it
// was inheriting a restriction nobody had chosen for it. All access is via the session client and
// scoped by sender_id, so RLS is enforced.
// =====================================================

import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase-server'
// [BTW-ROUND] De totalen komen uit één module, dezelfde die /api/invoice/send gebruikt bij
// uitgifte. Hier stond een eigen berekening die de BTW PER REGEL optelde en één keer afrondde;
// send groepeert per TARIEF en rondt per tarief af (de methode van de PDF en de UBL-export).
// Op een factuur met gemengde tarieven scheelde dat een cent, dus het bedrag dat de ondernemer
// opsloeg was niet het bedrag dat hij verstuurde. Zie invoice-totals.ts.
import { computeInvoiceTotals, isValidBtwRate, round2 } from '@/lib/invoice-totals'
// [ACTING-FOR] Deze route is OMGEBOUWD in plaats van dichtgezet: een verkoopmedewerker moet zijn
// eigen concept kunnen openen, bijwerken en weggooien — anders is "facturen maken" half werk en
// blijft er een concept staan dat niemand meer aanraakt. Alles wordt gescoopt op de EIGENAAR, en
// canAccessInvoice() eist daarbovenop dat een medewerker het zelf heeft aangemaakt.
import { getActingFor } from '@/lib/acting-for-server'
import { invoiceOwnerId, canAccessInvoice, isActingForOther } from '@/lib/acting-for'
import { createPipelineClient } from '@/lib/supabase-pipeline'
// [ARTIKEL-LEREN] Deze PUT vervangt de regels VOLLEDIG, dus alles wat hier langskomt is getypte
// tekst — ook de regels die op dit scherm zijn toegevoegd. Eén module, gedeeld met /api/invoice/draft.
import { learnFromLines } from '@/lib/article-learning-store'
import { readWithTrail } from '@/lib/created-by'
// [OFFERTE-BEWERKBAAR] Eén regel, gedeeld met de schermen — zie invoice-editable.ts.
import { isInvoiceEditable, editRefusalText } from '@/lib/invoice-editable'
// [UNIT] Alleen bekende eenheden komen de database in — zie de normalisatie hieronder.
import { isKnownUnit } from '@/lib/units'

/**
 * Eén regel klaarmaken voor de database.
 *
 * `unit` bestaat pas na migratie invoice_line_unit.sql. Meesturen op een database zonder die
 * kolom laat de HELE insert falen (PGRST204) — en dat is hier het opslaan van een concept.
 * Daarom: alleen meesturen als er iets te sturen is, en anders precies de oude vorm.
 */
type NormLine = {
  description: string
  quantity: number
  unit_price: number
  btw_rate: number
  line_total: number
  /** [VRIJGESTELD-ROUNDTRIP] Meegedragen zodat een bewerking hem niet wist. */
  vat_treatment?: string | null
  /** [UNIT] Alleen een eenheid die de app kent, of null. */
  unit: string | null
}

function schoonRegel(invoiceId: string, l: NormLine): Record<string, unknown> {
  const regel: Record<string, unknown> = {
    invoice_id: invoiceId,
    description: l.description,
    quantity: l.quantity,
    unit_price: l.unit_price,
    btw_rate: l.btw_rate,
    line_total: l.line_total,
  }
  if (l.unit) regel.unit = l.unit
  // [VRIJGESTELD-ROUNDTRIP] De vrijstellingsvlag hoort bij de regel, niet bij het scherm.
  //
  // Zonder deze regel wiste elke bewerking hem. Het bewerkscherm leest maar vier kolommen
  // (description, quantity, unit_price, btw_rate) en stuurt die terug; de PUT verwijdert ALLE
  // regels en zet ze opnieuw. Wie een vrijgestelde factuur opende om de vervaldatum te wijzigen,
  // sloeg hem op als btw_rate 0 met vat_treatment NULL.
  //
  // Dat is geen cosmetisch verlies. fetchRateShares herkent een vrijgestelde regel aan die vlag;
  // zonder haar verhuist de omzet uit de vrijgestelde pot naar de 0%/verlegd-rubriek van de
  // aangifte — EUR 1.000 in de verkeerde rubriek van een ingediende aangifte, en de vrijgestelde
  // share verdwijnt uit het pro-rata beeld van de voorbelasting.
  //
  // Dezelfde harding als bij het schrijven elders: alleen de letterlijke waarde 'exempt' telt,
  // al het andere wordt NULL. Een onbekende waarde mag nooit als vrijstelling gelden.
  if (l.vat_treatment !== undefined) {
    regel.vat_treatment = l.vat_treatment === 'exempt' ? 'exempt' : null
  }
  return regel
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function ownedInvoice(supabase: any, id: string, userId: string) {
  // [EDIT-LINES-SAFE] The stored totals come along as the PRE-IMAGE: if the line swap below
  // fails after the header is already written, restoring the old lines is only half the undo —
  // the header would still carry the new amounts. Both go back, or neither.
  //
  // [ACTING-FOR] created_by komt mee: dat is de grens waarop canAccessInvoice() een medewerker toetst.
  // Maar die kolom bestaat pas ná company_members_sales_role.sql, en een SELECT op een kolom die
  // er niet is faalt HELEMAAL — dan zou een eigenaar zijn eigen concept niet meer kunnen
  // bewerken of verwijderen op een installatie waar de migratie nog open staat. Vandaar de
  // terugval; zonder created_by rekent canAccessInvoice() de rij nooit aan een medewerker toe, en dat
  // is de veilige kant (zonder migratie bestaat er sowieso geen medewerker).
  return readWithTrail<{
    id: string
    status: string | null
    sender_id: string | null
    created_by?: string | null
    total_ex_btw: number | null
    btw_amount: number | null
    total_inc_btw: number | null
    /** [ARTIKEL-LEREN] Bepaalt of dit document de catalogus iets mag leren. Staat in BEIDE
     *  kolomlijsten hieronder: hij hoort bij de basistabel (database.sql), niet bij een migratie,
     *  dus de terugval mag hem niet kwijtraken — dan leerde een installatie zonder created_by
     *  stilletjes niets. */
    invoice_type?: string | null
    /** [OFFERTE-BEWERKBAAR] The thing that makes a document legally issued. The edit guard below
     *  needs it, and it may not be lost by the fallback: it belongs to the base schema. */
    invoice_number?: string | null
  }>(

    (kolommen: string) => supabase
      .from('invoices')
      .select(kolommen)
      .eq('id', id)
      .eq('sender_id', userId)
      .single(),
    'id, status, sender_id, created_by, invoice_type, invoice_number, total_ex_btw, btw_amount, total_inc_btw',
    'id, status, sender_id, invoice_type, invoice_number, total_ex_btw, btw_amount, total_inc_btw',
  )
}

// GET /api/invoice/[id] — the invoice + its lines (owner only).
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  // [ACTING-FOR] Wie handelt hier, namens wie? Voor een eigenaar verandert er niets.
  const acting = await getActingFor()
  if (!acting) return NextResponse.json({ error: 'Niet ingelogd' }, { status: 401 })
  const ownerId = invoiceOwnerId(acting)

  const { id } = await params
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Niet ingelogd' }, { status: 401 })

  const { data: invoice, error } = await supabase
    .from('invoices')
    .select('*')
    .eq('id', id)
    .eq('sender_id', ownerId)
    .single()
  if (error || !invoice) return NextResponse.json({ error: 'Factuur niet gevonden' }, { status: 404 })
  // [ACTING-FOR] Tweede slot naast RLS: dit is waar een geraden id binnenkomt.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if (!canAccessInvoice(acting, invoice as any)) {
    return NextResponse.json({ error: 'Factuur niet gevonden' }, { status: 404 })
  }

  const { data: lines } = await supabase
    .from('invoice_lines')
    .select('*')
    .eq('invoice_id', id)

  return NextResponse.json({ invoice, lines: lines ?? [] })
}

// PUT /api/invoice/[id] — update a DRAFT's client fields, dates and lines, and
// recompute the stored totals from those lines.
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  // [ACTING-FOR] Wie handelt hier, namens wie? Voor een eigenaar verandert er niets.
  const acting = await getActingFor()
  if (!acting) return NextResponse.json({ error: 'Niet ingelogd' }, { status: 401 })
  const ownerId = invoiceOwnerId(acting)

  const { id } = await params
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Niet ingelogd' }, { status: 401 })

  const { data: existing } = await ownedInvoice(supabase, id, ownerId)
  if (!existing) return NextResponse.json({ error: 'Factuur niet gevonden' }, { status: 404 })
  // [ACTING-FOR] Een medewerker raakt alleen zijn eigen concept aan — niet dat van zijn baas of van
  // een collega. RLS zegt dat ook, maar dit is de plek waar een geraden id langskomt.
  if (!canAccessInvoice(acting, existing)) {
    return NextResponse.json({ error: 'Factuur niet gevonden' }, { status: 404 })
  }
  // [OFFERTE-BEWERKBAAR] `status !== 'draft'` was the right rule for a FACTUUR and the wrong one
  // for an OFFERTE. A sent factuur carries a legal number from a gapless series (Art. 35 Wet OB,
  // forward-only) and may never be rewritten — that is what a creditnota is for. A quote carries
  // no number, sits in no series and is not a legal invoice; a customer asking "kan het goedkoper?"
  // is ordinary business, and the owner's only route was a second offerte and the hope that the
  // customer looked at the right one.
  //
  // The rule lives in invoice-editable.ts, shared with the screens, so the button and the door can
  // never disagree about what may be opened. It refuses ANY numbered document, whatever its type
  // column says — two conditions, so no single wrong field unlocks one.
  if (!isInvoiceEditable({
    status: existing.status,
    invoiceType: existing.invoice_type,
    invoiceNumber: existing.invoice_number,
  })) {
    return NextResponse.json(
      { error: editRefusalText({
          status: existing.status,
          invoiceType: existing.invoice_type,
          invoiceNumber: existing.invoice_number,
        }) },
      { status: 409 }
    )
  }

  const body = await request.json().catch(() => ({}))
  const rawLines = Array.isArray(body.lines) ? body.lines : []
  if (rawLines.length === 0) {
    return NextResponse.json({ error: 'Minstens één factuurregel is vereist.' }, { status: 400 })
  }

  // Normalize lines and recompute totals (line sign is preserved, so a
  // creditnota draft keeps its negative amounts).
  // [BTW-TARIEF] Only a rate a Dutch invoice may actually carry. `Number(l.btw_rate) || 0`
  // silently turned anything unparseable — and a MISSING rate — into 0%, which is a real tariff
  // with a real meaning (vrijgesteld/verlegd). A draft saved that way looks perfect and books
  // zero BTW. Both editors offer exactly 21/9/0, so this can only reject a hand-made request.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const badRate = rawLines.findIndex((l: any) => !isValidBtwRate(l?.btw_rate))
  if (badRate !== -1) {
    return NextResponse.json(
      { error: `Regel ${badRate + 1} heeft een ongeldig BTW-tarief — kies 21%, 9% of 0%.` },
      { status: 400 }
    )
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const lines: NormLine[] = rawLines.map((l: any): NormLine => {
    const quantity = Number(l.quantity) || 0
    const unit_price = Number(l.unit_price) || 0
    return {
      description: String(l.description ?? ''),
      quantity,
      unit_price,
      btw_rate: Number(l.btw_rate),
      line_total: round2(quantity * unit_price),
      // [UNIT] Alleen een eenheid die de app KENT. Vrije tekst uit een verzoek hoort niet op
      // een regel die straks een e-factuur wordt; onbekend wordt null, en dat komt in de export
      // neer op C62 — precies het gedrag van vóór dit veld.
      unit: typeof l.unit === 'string' && isKnownUnit(l.unit) ? l.unit.trim() : null,
    }
  })
  const { total_ex_btw, btw_amount, total_inc_btw } = computeInvoiceTotals(lines)

  // Header patch — only the client/date fields the edit form sends, plus totals.
  const patch: Record<string, unknown> = {
    total_ex_btw,
    btw_amount,
    total_inc_btw,
    updated_at: new Date().toISOString(),
  }
  for (const k of [
    'client_name',
    'client_email',
    'client_address',
    'client_postal_code',
    'client_city',
    'client_btw_number',
    'invoice_date',
    'due_date',
  ]) {
    if (k in body) patch[k] = body[k]
  }

  // [EDIT-CAS] Compare-and-swap on 'draft'. The status check above read a FETCHED row, and
  // invoices_zzp_update carries no status test — so a send that landed in between (another tab,
  // a double submit) left this UPDATE free to rewrite the totals of an invoice that had just
  // become legally issued, and the lines below would then be swapped under a committed number.
  // /api/invoice/send guards its own commit exactly this way and explains why; the edit path
  // mutates the same legal record and needs the same guard.
  const { data: patched, error: upErr } = await supabase
    .from('invoices')
    // patch has a dynamic key set (only the fields the form sent) → cast past
    // the generated row type.
    .update(patch as never)
    .eq('id', id)
    .eq('sender_id', ownerId)
    .eq('status', 'draft')
    .select('id')
  if (upErr) return NextResponse.json({ error: 'Opslaan mislukt' }, { status: 500 })
  if (!patched || patched.length === 0) {
    // Lost the race: it is no longer a draft. Nothing was written, and the lines are untouched.
    return NextResponse.json(
      { error: 'Deze factuur is inmiddels verzonden en kan niet meer worden gewijzigd.' },
      { status: 409 }
    )
  }

  // Replace the lines wholesale.
  //
  // [EDIT-LINES-SAFE] Snapshot first, restore on failure. delete-then-insert is not atomic here
  // (no transaction over PostgREST), and the failure was not cosmetic: the header totals are
  // already committed above, so a failed insert left a draft with the NEW amounts and ZERO
  // lines. Sending that draft skips the recompute in /api/invoice/send (it only recomputes when
  // lines exist), mints a legal number, and renders a PDF with an empty table — a numbered
  // invoice, for a real amount, itemising nothing. Restoring the old lines keeps the draft
  // internally consistent (old lines, and the caller knows the save failed).
  const { data: previousLines } = await supabase
    .from('invoice_lines')
    // [UNIT] '*' zodat de eenheid meekomt in het TERUGZETPAD. Zou hij hier ontbreken, dan
    // zou een mislukte opslag de regels herstellen ZONDER eenheid — een stille wijziging bij
    // een handeling die juist bedoeld is om niets te veranderen.
    .select('*')
    .eq('invoice_id', id)

  await supabase.from('invoice_lines').delete().eq('invoice_id', id)
  const { error: insErr } = await supabase
    .from('invoice_lines')
    // [UNIT] `unit` gaat alleen mee als de kolom bestaat. Zonder deze terugval faalde het
    // OPSLAAN van een concept volledig op een database waar invoice_line_unit.sql nog open staat.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .insert(lines.map((l) => schoonRegel(id, l)) as any)
  if (insErr) {
    // Put BOTH halves back: the old lines, and the header totals that belong to them. Restoring
    // only the lines would leave a draft whose stored amounts describe a version that no longer
    // exists — the same mismatch, just harder to notice.
    if (previousLines && previousLines.length > 0) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (supabase as any)
        .from('invoice_lines')
        .insert(previousLines.map((l) => {
          const bron = l as unknown as { unit?: string | null }
          const regel: Record<string, unknown> = {
            invoice_id: id,
            description: l.description,
            quantity: l.quantity,
            unit_price: l.unit_price,
            btw_rate: l.btw_rate,
            line_total: l.line_total,
          }
          if (bron.unit !== undefined) regel.unit = bron.unit ?? null
          return regel
        }))
    }
    await supabase
      .from('invoices')
      .update({
        total_ex_btw: existing.total_ex_btw,
        btw_amount: existing.btw_amount,
        total_inc_btw: existing.total_inc_btw,
      } as never)
      .eq('id', id)
      .eq('sender_id', ownerId)
      .eq('status', 'draft')
    return NextResponse.json({ error: 'Opslaan mislukt (regels)' }, { status: 500 })
  }

  // [ARTIKEL-LEREN] Ook dit scherm. Toen het leren werd gebouwd stond er dat /api/invoice/draft
  // "de enige plek is waar een mens voor het eerst factuurregels typt". Dat was niet waar: deze
  // PUT vervangt de regels VOLLEDIG, dus elke regel die iemand op het bewerkscherm toevoegt is
  // nieuw getypte tekst — en die weg is voor veel ondernemers de gewone weg (snel een concept, dan
  // rustig afmaken). Zonder deze aanroep leerde de catalogus juist van de regels waar het meeste
  // over is nagedacht niets.
  await learnFromLines({
    // [ACTING-FOR] Dezelfde keuze als /api/articles maakt: `articles` heeft geen RLS-policy voor
    // een medewerker, dus namens iemand anders schrijven kan alleen met de pipeline-client. Zonder
    // dit leerde het bewerkscherm van een verkoopmedewerker stil niets — precies de persoon voor
    // wie een gevulde suggestielijst het meeste scheelt.
    db: isActingForOther(acting) ? createPipelineClient() : supabase,
    ownerId,
    documentKind: existing.invoice_type ?? 'factuur',
    lines: lines.map((l) => ({
      description: l.description,
      unit_price: l.unit_price,
      btw_rate: l.btw_rate,
      unit: l.unit,
    })),
  })

  return NextResponse.json({ success: true })
}

// DELETE /api/invoice/[id] — remove a DRAFT (and its lines). Sent invoices are
// immutable and cannot be deleted here.
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  // [ACTING-FOR] Wie handelt hier, namens wie? Voor een eigenaar verandert er niets.
  const acting = await getActingFor()
  if (!acting) return NextResponse.json({ error: 'Niet ingelogd' }, { status: 401 })
  const ownerId = invoiceOwnerId(acting)

  const { id } = await params
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Niet ingelogd' }, { status: 401 })

  const { data: existing } = await ownedInvoice(supabase, id, ownerId)
  if (!existing) return NextResponse.json({ error: 'Factuur niet gevonden' }, { status: 404 })
  // [ACTING-FOR] Een medewerker raakt alleen zijn eigen concept aan — niet dat van zijn baas of van
  // een collega. RLS zegt dat ook, maar dit is de plek waar een geraden id langskomt.
  if (!canAccessInvoice(acting, existing)) {
    return NextResponse.json({ error: 'Factuur niet gevonden' }, { status: 404 })
  }
  if (existing.status !== 'draft') {
    return NextResponse.json(
      { error: 'Alleen een concept kan verwijderd worden.' },
      { status: 409 }
    )
  }

  // [DELETE-CAS] Delete the INVOICE, guarded on 'draft', and let the FK do the rest:
  // invoice_lines.invoice_id is ON DELETE CASCADE, so the lines go with it.
  //
  // The old order was the bug. It deleted the LINES first — and invoice_lines_delete_own has no
  // status test, while invoices_zzp_delete permits status='draft' only. So if the row was no
  // longer a draft (a send that landed between the check above and this write), the lines were
  // destroyed and the invoice survived, and the unchecked result reported success: a SENT
  // invoice, its number committed, silently stripped of everything it itemises, with the screen
  // saying "Verwijderd". That is the exact failure FacturenClient's own comment describes for
  // the client-side code this route was created to replace — reproduced here in the race window.
  const { data: deleted, error } = await supabase
    .from('invoices')
    .delete()
    .eq('id', id)
    .eq('sender_id', ownerId)
    .eq('status', 'draft')
    .select('id')
  if (error) return NextResponse.json({ error: 'Verwijderen mislukt' }, { status: 500 })
  if (!deleted || deleted.length === 0) {
    // Nothing was removed — and because the invoice went first, nothing was damaged either.
    return NextResponse.json(
      { error: 'Deze factuur is inmiddels verzonden en kan niet meer worden verwijderd.' },
      { status: 409 }
    )
  }

  return NextResponse.json({ success: true })
}
