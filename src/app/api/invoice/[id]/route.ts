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
import { computeInvoiceTotals, round2 } from '@/lib/invoice-totals'
// [REGEL-PARITEIT] Dezelfde regelkeuring als /api/invoice/draft — één definitie van wat een
// factuurregel mag zijn, voor allebei de schrijvers op invoice_lines.
import { validateDraftLines } from '@/lib/draft-totals'
import { applyDiscount, parseDiscount } from '@/lib/invoice-discount'
import { checkInvoiceDates } from '@/lib/invoice-dates'
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
import { isInvoiceEditable, editRefusalText, isQuote } from '@/lib/invoice-editable'
// [UNIT] Alleen bekende eenheden komen de database in — zie de normalisatie hieronder.
import { isKnownUnit } from '@/lib/units'
// [KLANT-EXTRA] Twee vrije klantregels met een eigen terugval — zie de kop van dat bestand.
import { writeWithExtraLines, extraLineFields } from '@/lib/client-extra-lines-write'

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
    /** [KORTING] Bestaan pas ná invoice_discount.sql — daarom NIET in de eerste kolomlijst
     *  verplicht: readWithTrail valt terug op de tweede zodra een kolom ontbreekt, en dan rekent
     *  deze route gewoon zonder korting, precies zoals vóór de feature. */
    discount_type?: string | null
    discount_value?: number | null
  }>(

    (kolommen: string) => supabase
      .from('invoices')
      .select(kolommen)
      .eq('id', id)
      .eq('sender_id', userId)
      .single(),
    'id, status, sender_id, created_by, invoice_type, invoice_number, discount_type, discount_value, total_ex_btw, btw_amount, total_inc_btw',
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
  //
  // [REGEL-PARITEIT] Dezelfde controle als /api/invoice/draft, uit dezelfde functie.
  //
  // Er staan TWEE schrijvers op invoice_lines, en ze keurden verschillend. De aanmaakroute
  // weigert een regel zonder omschrijving (Art. 35a Wet OB: de aard van de prestatie hoort op de
  // factuur), weigert een hoeveelheid of prijs die geen getal is, en weigert meer regels dan een
  // factuur kan dragen. Deze route keek alleen naar het BTW-tarief en maakte van de rest stil een
  // 0: `Number(l.quantity) || 0` verandert "twee" in nul, en een lege omschrijving ging er zo
  // doorheen. Een factuur die niet aangemaakt MAG worden, kon dus wel bewerkt worden tot precies
  // die vorm — en daarna verstuurd, want versturen slaat eerst op via deze route.
  //
  // Het scherm controleert het ook, maar het scherm is niet de grendel: deze route is de deur.
  //
  // De sign blijft van deze route: een creditnota houdt haar negatieve regels, en validateDraftLines
  // heeft daar geen mening over — zij keurt alleen of het getallen zijn die op een factuur kunnen.
  const keuring = validateDraftLines(rawLines)
  if (!keuring.ok) {
    const eerste = keuring.errors[0]
    const waar = eerste.index >= 0 ? `Regel ${eerste.index + 1}: ` : ''
    const uitleg =
      eerste.field === 'btw_rate'
        ? 'ongeldig BTW-tarief — kies 21%, 9% of 0%.'
        : `${eerste.reason}.`
    return NextResponse.json(
      { error: `${waar}${uitleg}`, fouten: keuring.errors },
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
  // [KORTING] De korting van deze factuur telt mee. Zonder dit wist elke bewerking hem: het
  // scherm stuurt de regels terug, de route rekent de totalen opnieuw uit ALLEEN die regels, en de
  // verlaging verdwijnt terwijl discount_type/discount_value in de rij blijven staan — een factuur
  // die zegt dat er korting op zit en het volle bedrag rekent.
  //
  // Het bewerkscherm mag hem WIJZIGEN. Stuurt het de velden mee, dan telt wat er staat — ook als
  // dat leeg is, want "korting eraf halen" is een even geldige bewerking als hem instellen. Stuurt
  // een oudere (gecachete) pagina ze niet mee, dan blijft de korting van de rij staan; die twee
  // gevallen uit elkaar houden is precies waarom `in body` wordt getest en niet de waarde zelf.
  // [FACTUUR-DATUMS] Een vervaldatum vóór de factuurdatum maakt een factuur die al verlopen is op
  // het moment dat hij wordt verstuurd — de herinneringscron leidt zijn trap af van due_date, dus
  // de klant krijgt de factuur en de aanmaning zo ongeveer tegelijk.
  const datums = checkInvoiceDates({
    invoiceDate: typeof body.invoice_date === 'string' ? body.invoice_date : null,
    dueDate: typeof body.due_date === 'string' ? body.due_date : null,
  })
  if (!datums.ok) {
    return NextResponse.json({ error: datums.error, code: datums.code }, { status: 400 })
  }

  const kortingMeegestuurd = 'discount_type' in body || 'discount_value' in body
  const kortingHier = kortingMeegestuurd
    ? parseDiscount(body.discount_type, body.discount_value)
    : parseDiscount(existing.discount_type, existing.discount_value)
  const { total_ex_btw, btw_amount, total_inc_btw } = kortingHier
    ? (() => { const d = applyDiscount(lines, kortingHier); return { total_ex_btw: d.total_ex_btw, btw_amount: d.btw_amount, total_inc_btw: d.total_inc_btw } })()
    : computeInvoiceTotals(lines)

  // Header patch — only the client/date fields the edit form sends, plus totals.
  const patch: Record<string, unknown> = {
    total_ex_btw,
    btw_amount,
    total_inc_btw,
    updated_at: new Date().toISOString(),
  }
  // [KORTING] Meeschrijven zodra het scherm hem stuurt — anders zou de PDF straks een korting
  // tonen die de totalen niet meer dragen (of andersom).
  if (kortingMeegestuurd) {
    patch.discount_type = kortingHier ? kortingHier.type : null
    patch.discount_value = kortingHier ? kortingHier.value : null
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
    // [LEVERDATUM] De leverdatum hoort erbij. Art. 35a lid 1 sub f Wet OB eist hem op elke factuur,
    // het aanmaakscherm vraagt hem, de PDF drukt hem af — en dit was de enige weg terug naar dat
    // veld. Stond hij niet in deze lijst, dan gold: eenmaal verkeerd ingevuld, nooit meer te
    // corrigeren. Wie de datum aanpaste zag het scherm meebewegen, sloeg op, en kreeg een PDF met
    // de oude leverdatum erop — een wettelijk verplicht gegeven dat iets anders zegt dan de
    // ondernemer bedoelde, op een document dat de deur uitgaat.
    'delivery_date',
  ]) {
    if (k in body) patch[k] = body[k]
  }

  // [EDIT-CAS] Compare-and-swap on 'draft'. The status check above read a FETCHED row, and
  // invoices_zzp_update carries no status test — so a send that landed in between (another tab,
  // a double submit) left this UPDATE free to rewrite the totals of an invoice that had just
  // become legally issued, and the lines below would then be swapped under a committed number.
  // /api/invoice/send guards its own commit exactly this way and explains why; the edit path
  // mutates the same legal record and needs the same guard.
  //
  // [OFFERTE-BEWERKBAAR] De CAS stond op de LETTERLIJKE waarde 'draft', en dat sprak de poort
  // hierboven tegen zodra een verstuurde offerte bewerkbaar werd: die kwam door isInvoiceEditable
  // heen, raakte hier nul rijen en kreeg "Deze factuur is inmiddels verzonden" — de functie was
  // dus wel gebouwd en werkte niet, met een melding die de ondernemer op het verkeerde been zet.
  //
  // De grendel moet dezelfde vraag stellen als de poort, niet een strengere. Wat hij beschermt is
  // dat de rij tussen lezen en schrijven niet van staat is veranderd, dus: de status die we ZAGEN,
  // plus — voor een offerte — dat er nog steeds geen nummer op staat. Wordt de offerte in dat
  // venster omgezet naar een factuur, dan krijgt hij een nummer en raakt deze UPDATE niets.
  // [KLANT-EXTRA] De twee vrije klantregels reizen in hun EIGEN terugval, niet in de patch-lijst
  // hierboven. Noemt een payload een kolom die de database nog niet kent, dan weigert PostgREST de
  // HELE rij (PGRST204) — dan zou het opslaan van een factuur volledig mislukken op elke installatie
  // waar client_extra_lines.sql nog open staat, en dat is een te hoge prijs voor twee adresregels.
  //
  // De CAS zit binnen de poging en niet eromheen, met opzet: de tweede poging moet dezelfde
  // vergrendeling dragen als de eerste. Zou hij eromheen staan, dan schreef de terugval zonder
  // statustest — precies op de factuur die intussen verstuurd en genummerd kan zijn.
  const extraSent = 'client_extra_line1' in body || 'client_extra_line2' in body
  const runPatch = (extra: Record<string, unknown>) => {
    let q = supabase
      .from('invoices')
      // patch has a dynamic key set (only the fields the form sent) → cast past
      // the generated row type.
      .update({ ...patch, ...extra } as never)
      .eq('id', id)
      .eq('sender_id', ownerId)
      .eq('status', existing.status ?? 'draft')
    if (existing.status !== 'draft') q = q.is('invoice_number', null)
    return q.select('id')
  }
  const { data: patched, error: upErr } = await writeWithExtraLines(
    runPatch,
    // Alleen patchen wat het scherm meestuurde — dezelfde regel als de lus hierboven. Stuurt een
    // andere aanroeper deze velden niet mee, dan blijft de opgeslagen waarde staan in plaats van
    // stilletjes leeggemaakt te worden.
    extraSent ? extraLineFields(body.client_extra_line1, body.client_extra_line2) : {},
  )
  if (upErr) return NextResponse.json({ error: 'Opslaan mislukt' }, { status: 500 })
  if (!patched || patched.length === 0) {
    // Lost the race: it is no longer a draft. Nothing was written, and the lines are untouched.
    return NextResponse.json(
      {
        error: isQuote(existing.invoice_type)
          ? 'Deze offerte is inmiddels omgezet naar een factuur en kan niet meer worden gewijzigd.'
          : 'Deze factuur is inmiddels verzonden en kan niet meer worden gewijzigd.',
      },
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
