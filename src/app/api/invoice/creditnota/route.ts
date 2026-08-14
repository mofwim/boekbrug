// src/app/api/invoice/creditnota/route.ts
// [BOEK-031] Creditnota aanmaken — May 2026
// [FACTUUR-A] Consistency rebuild — June 2026
// Regel: alleen voor verzonden facturen (sent / paid / overdue / received / processing / processed)
// Creditnota corrigeert — verwijderen mag nooit
// =====================================================
// [FACTUUR-A] Changes:
//   * Numbering unified on lib/invoice-numbering generateInvoiceNumber
//     (CR- prefix — same generator as the send route; the old
//     rpc('generate_invoice_number') + 'CN-' fallback produced a second,
//     conflicting numbering scheme).
//   * Fixed silently swallowed `source: 'created'` — a BRIDGE-A comment was
//     merged onto the same line and commented the field out.
//   * Real duplicate guard via original_invoice_id (the column + FK exist on
//     invoices) — the old check matched invoice_number = 'CN-…' which never
//     matches CR- format, i.e. dead code.
//   * delivery_date copied from the original (the creditnota corrects that
//     same supply — Art. 35a sub f).
//   * Creditnota is itself a legal invoice (Art. 35) → it is now DELIVERED:
//     PDF rendered + e-mailed, same pipeline as the send route. Best-effort:
//     a delivery failure never rolls back the creditnota (number consumed).
// =====================================================

import { NextRequest, NextResponse } from 'next/server'
import { amsterdamToday } from '@/lib/format-nl'
import { createServerSupabaseClient } from '@/lib/supabase-server'
import { createPipelineClient } from '@/lib/supabase-pipeline'
import { runBankAutoConfirm } from '@/lib/bank-auto-confirm'
// [BOEK-031] BOEK-SECURITY-2 — audit logs via service_role helper — May 2026
import { logAuditAction, getClientIP } from '@/lib/audit'
// [FACTUUR-A] unified numbering + legal delivery — June 2026
import { generateInvoiceNumber } from '@/lib/invoice-numbering'
import { renderInvoicePdf } from '@/lib/invoice-pdf-server'
import { sendInvoiceToClient } from '@/lib/email'
import * as Sentry from '@sentry/nextjs'
// [ACTING-FOR] Omgebouwd in plaats van dichtgezet. Een verkoper die zich vergiste in een VERSTUURDE
// factuur heeft maar één wettelijke weg terug: een creditnota. Zonder deze route zou hij bij een
// typefout in een bedrag moeten wachten op zijn baas, terwijl de klant al een verkeerde factuur
// heeft. Het nummer komt uit de reeks van de EIGENAAR — dat is de hele reden dat dit zo loopt.
import { getActingFor } from '@/lib/acting-for-server'
import { invoiceOwnerId, invoiceCreatedBy, isActingForOther, canAccessInvoice } from '@/lib/acting-for'
// [ACTING-FOR] created_by bestaat pas ná de migratie — zonder terugval faalt de creditnota, en dat
// is de enige wettelijke weg terug bij een fout in een verstuurde factuur.
import { writeWithTrail } from '@/lib/created-by'
// [ALARM] Een poort die niet kon draaien moet iemand bereiken — zie report-handled.ts.
import { reportHandledFailure } from '@/lib/report-handled'
// [KLANT-EXTRA] De twee vrije klantregels reizen mee naar het nieuwe document — in een
// aparte, mislukbare schrijfbeurt. Zie de kop van dat bestand.
import { copyExtraLinesOnto } from '@/lib/client-extra-lines-write'
// [CREDIT-SIGN] The per-line mirror: which fields flip, which travel, which are hardened.
import { creditLinesFor } from '@/lib/creditnota-lines'
// [DEEL-CREDIT] Welke regels, hoeveel ervan, en het plafond dat nooit mag schuiven.
import {
  buildCreditSelection,
  checkCreditSelection,
  creditableRemaining,
  fitsWithinOriginal,
  overCreditReason,
  type LineSelection,
} from '@/lib/partial-credit'
import { creditedTotalsFrom } from '@/lib/credited-invoices'

// [CREDITNOTA-PDF] Same storage bucket the send route and the closing package
// use. A creditnota's PDF MUST be stored here and its path written to
// invoices.pdf_url, or the correction document is missing from the accountant's
// closing package (the package resolves an outgoing invoice's PDF via pdf_url).
const PDF_BUCKET = 'documents'

export async function POST(request: NextRequest) {
  // [ACTING-FOR] Wie handelt hier, namens wie? Voor een eigenaar verandert er niets.
  const acting = await getActingFor()
  if (!acting) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const ownerId = invoiceOwnerId(acting)

  try {
    const supabase = await createServerSupabaseClient()

    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body = await request.json()
    const { original_invoice_id, reason } = body
    // [DEEL-CREDIT] Optioneel, en dat is de hele migratiestrategie: laat een client hem weg, dan
    // is dit letterlijk het verzoek van hiervoor — de HELE factuur — en komt er tot op de cent
    // uit wat er altijd uitkwam.
    const selectie: LineSelection[] | null = Array.isArray(body?.lines)
      ? (body.lines as unknown[])
          .map((r) => {
            const row = (r ?? {}) as Record<string, unknown>
            return { id: String(row.id ?? ''), quantity: Number(row.quantity) }
          })
          .filter((r) => r.id !== '')
      : null

    if (!original_invoice_id) {
      return NextResponse.json(
        { error: 'original_invoice_id is verplicht' },
        { status: 400 }
      )
    }

    // [BOEK-031] Haal de originele factuur op — verificatie eigenaar
    // [FACTUUR-A] select('*') — delivery_date + full address block needed
    const { data: originalData, error: fetchError } = await supabase
      .from('invoices')
      .select('*')
      .eq('id', original_invoice_id)
      .single()

    if (fetchError || !originalData) {
      return NextResponse.json({ error: 'Originele factuur niet gevonden' }, { status: 404 })
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const original = originalData as any

    // [BOEK-031] Alleen de eigenaar mag een creditnota aanmaken
    // [ACTING-FOR] ...of de medewerker die de oorspronkelijke factuur ZELF maakte. canAccessInvoice() dekt
    // beide gevallen in één regel: het bedrijf moet kloppen, en bij een medewerker ook created_by.
    if (!canAccessInvoice(acting, original)) {
      return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
    }

    // [BOEK-031] Creditnota alleen mogelijk op verzonden facturen. Draft facturen verwijder je.
    // [LC2] This route only credits an invoice the owner SENT (outgoing — see the sender_id guard
    // above), and the creditnota counts as −omzet (status 'sent'). So the original MUST be a status
    // that actually counted as +omzet — outgoing = {sent, paid, overdue} in computeResult. Crediting
    // an outgoing invoice that never counted (a stray 'processing'/'received'/'processed') would
    // book phantom NEGATIVE omzet with nothing to offset it. Those statuses aren't reachable for a
    // normal outgoing invoice anyway, so restricting to the counting set is safe and closes the gap.
    const CREDITABLE_STATUSES: string[] = ['sent', 'paid', 'overdue']
    if (!original.status || !CREDITABLE_STATUSES.includes(original.status)) {
      return NextResponse.json(
        { error: 'Alleen een verzonden of betaalde factuur kan worden gecrediteerd. Een concept of nog niet-geboekte factuur verwijder of bewerk je gewoon.' },
        { status: 400 }
      )
    }

    // [COHERENCE-CREDITNOTA] Never credit a creditnota (a creditnota has status 'sent', so
    // it passes the status check above). Crediting a credit would mint a positive "credit
    // of a credit" that fabricates +omzet with nothing behind it. Only a real factuur is
    // creditable. Not reachable through the UI, but the route is the authority.
    if (original.invoice_type === 'creditnota') {
      return NextResponse.json(
        { error: 'Een creditnota kan niet zelf worden gecrediteerd.' },
        { status: 400 }
      )
    }

    // [FACTUUR-A] Duplicate guard — one creditnota per invoice, enforced via
    // original_invoice_id (column + FK exist on invoices). Replaces the dead
    // invoice_number='CN-…' check that could never match CR- numbering.
    // [NO-SILENT-EMPTY] The error was dropped, and null here means "no creditnota exists yet" — so
    // a failed read let a SECOND one be created for the same invoice. That is money out twice: the
    // customer's balance is credited again, two credit notes point at one invoice, and the
    // `credited` set that the public pay page and the reminder cron both derive from
    // original_invoice_id stops meaning one thing.
    //
    // It is also unrecoverable in the one way this codebase cares most about. Ten lines below, the
    // route mints a creditnota number — Art. 35, forward-only, "once committed, no rollback". A
    // duplicate created here does not just double the credit, it burns a number in the legal
    // sequence to do it. So the refusal has to come BEFORE the number, which is where it now is.
    const { data: existingCreditnotas, error: existingErr } = await supabase
      .from('invoices')
      .select('id, invoice_number, total_inc_btw')
      .eq('sender_id', ownerId)
      .eq('invoice_type', 'creditnota')
      .eq('original_invoice_id', original_invoice_id)

    if (existingErr) {
      reportHandledFailure({
        tag: 'CREDITNOTA-GUARD',
        message: 'existing-creditnota check failed — refusing to create',
        severity: 'gate-unavailable',
        context: { ownerId, originalInvoiceId: original_invoice_id, error: existingErr.message },
      })
      return NextResponse.json(
        { error: 'We konden niet nakijken wat er al van deze factuur is gecrediteerd. Er is niets aangemaakt — probeer het zo meteen opnieuw.' },
        { status: 503 },
      )
    }

    // ── [DEEL-CREDIT] De regels van het origineel, en wat er van gecrediteerd wordt ──
    //
    // Dit staat VÓÓR het nummer, en dat is dezelfde les als bij de oude dubbelcheck: een creditnota
    // die hier wordt geweigerd heeft nog geen nummer verbruikt. Art. 35 kent geen weg terug.
    const { data: originalLines, error: linesErr } = await supabase
      .from('invoice_lines')
      // [UNIT] '*' zodat elke kolom meekomt zonder tweede lijst; de INSERT typt hieronder over.
      .select('*')
      .eq('invoice_id', original_invoice_id)

    if (linesErr) {
      reportHandledFailure({
        tag: 'DEEL-CREDIT',
        message: 'invoice lines read failed — refusing to credit',
        severity: 'gate-unavailable',
        context: { ownerId, originalInvoiceId: original_invoice_id, error: linesErr.message },
      })
      return NextResponse.json(
        { error: 'We konden de regels van deze factuur niet lezen. Er is niets aangemaakt — probeer het zo meteen opnieuw.' },
        { status: 503 },
      )
    }

    const bronRegels = (originalLines ?? []) as Parameters<typeof buildCreditSelection>[0]['lines']
    const selectieFout = checkCreditSelection(bronRegels, selectie)
    if (selectieFout) {
      const uitleg: Record<string, string> = {
        no_lines: 'Deze factuur heeft geen regels om te crediteren.',
        nothing_selected: 'Kies minstens één regel om te crediteren.',
        unknown_line: 'Een van de gekozen regels hoort niet bij deze factuur.',
        quantity_exceeds_line: 'Je kunt niet meer crediteren dan er op de factuur staat.',
        quantity_negative: 'Het aantal om te crediteren klopt niet.',
      }
      return NextResponse.json({ error: uitleg[selectieFout] ?? 'De selectie klopt niet.' }, { status: 400 })
    }

    const keuze = buildCreditSelection({
      lines: bronRegels,
      selection: selectie,
      discountType: original.discount_type,
      discountValue: original.discount_value,
    })

    // ── Het plafond ──
    //
    // Meer teruggeven dan er ooit in rekening is gebracht betekent btw terugvragen die nooit is
    // afgedragen, en een tegoed voor de klant dat nergens vandaan komt. De database bewaakt
    // dezelfde regel (creditnota_partial.sql, met een vergrendeling tegen gelijktijdigheid); dit
    // is de weigering die de ondernemer kan LEZEN, vóór er een nummer wordt verbruikt.
    const alGecrediteerd = creditedTotalsFrom(
      (existingCreditnotas ?? []).map((c) => ({
        original_invoice_id,
        total_inc_btw: (c as { total_inc_btw: number | null }).total_inc_btw,
      })),
    ).get(original_invoice_id) ?? 0

    if (!fitsWithinOriginal(original.total_inc_btw, alGecrediteerd, keuze.totalIncBtw)) {
      return NextResponse.json(
        { error: overCreditReason(creditableRemaining(original.total_inc_btw, alGecrediteerd)) },
        { status: 409 },
      )
    }

    // [FACTUUR-A] Genereer creditnota nummer — unified generator, CR- prefix.
    // Same Art. 35 rule applies: once committed, no rollback.
    // [ACTING-FOR] ownerId, met de SESSIE-client. Eén doorlopende reeks per bedrijf (Art. 35), en
    // next_invoice_seq() weigert onvoorwaardelijk als auth.uid() NULL is — service_role kan hier
    // dus niet in de plaats treden. Zie company_members_sales_role.sql.
    const creditnotaNumber = await generateInvoiceNumber(supabase, ownerId, 'creditnota')
    if (!creditnotaNumber) {
      return NextResponse.json({ error: 'Kon creditnotanummer niet genereren' }, { status: 500 })
    }

    const today = amsterdamToday()

    // [BOEK-031] Maak de creditnota aan
    // Bedragen zijn NEGATIEF — creditnota annuleert de originele factuur
    // [FACTUUR-A] original_invoice_id now stored properly (column exists);
    // source:'created' restored (was swallowed by an inline comment).
    const { data: creditnota, error: insertError } = // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await writeWithTrail<any>(
      (spoor) => supabase
      .from('invoices')

      .insert({
        sender_id: ownerId,
        ...spoor,
        invoice_number: creditnotaNumber,
        invoice_date: today,
        due_date: today,
        status: 'sent',
        invoice_type: 'creditnota',
        direction: original.direction,
        // [BOEK-031] Negatieve bedragen — annulering
        // [DEEL-CREDIT] Uit de SELECTIE, niet uit het origineel. Bij een volledige creditnota is
        // dat tot op de cent hetzelfde bedrag (buildCreditSelection rekent met dezelfde functies
        // die de factuur zelf hebben opgeteld); bij een deelcreditnota is het het enige juiste,
        // en het kopiëren van het origineel zou het hele document een leugen maken.
        total_ex_btw: -keuze.totalExBtw,
        btw_amount: -keuze.btwAmount,
        total_inc_btw: -keuze.totalIncBtw,
        // [KORTING-KOPIE] De korting reist mee met de bedragen. Deze route kopieert de TOTALEN van
        // het origineel maar bouwt de REGELS opnieuw op — en zonder de korting spraken die twee
        // elkaar tegen: de kop droeg het verlaagde bedrag, de regels het volle. Elke afgeleide
        // (de PDF en de UBL-export rekenen uit de regels) drukte dan een ander bedrag dan er in de
        // boeken staat. Gemeten op een factuur van EUR 1.000 met 10%: EUR 121 verschil.
        // Op een creditnota spiegelt applyDiscount de korting mee (negatief document, negatieve
        // toeslag), dus de regels reproduceren de kop precies — regel voor regel te vergelijken
        // met de factuur die hij terugdraait, wat de vorm is die een boekhouder kan controleren.
        // [DEEL-CREDIT] En de korting zoals hij bij DEZE selectie hoort: een percentage reist
        // ongewijzigd mee, een vast bedrag is naar het gecrediteerde aandeel geschaald. Zonder die
        // schaling geeft een deelcreditnota met een vaste korting minder terug dan er voor die
        // regels is betaald — zie de kop van partial-credit.ts.
        discount_type: keuze.discount?.type ?? null,
        discount_value: keuze.discount?.value ?? null,
        // [BRIDGE-A] sent_to_accountant removed — sharing is GENERATED from status
        source: 'created',
        client_name: original.client_name,
        // Carry the robust invoice→klant link onto the creditnota too, so the
        // customer's history stays linked even if the name is later edited or
        // the client row is renamed. Falls back to null (name path) for legacy
        // originals that predate client_id.
        client_id: original.client_id ?? null,
        client_email: original.client_email,
        client_address: original.client_address,
        client_postal_code: original.client_postal_code,
        client_city: original.client_city,
        client_btw_number: original.client_btw_number,
        original_invoice_id,
        // [FACTUUR-A] Leverdatum of the corrected supply travels with the
        // creditnota (Art. 35a sub f). Falls back to the original invoice
        // date. NOTE: requires the FACTUUR-A delivery_date migration + type
        // regen (CMD) before deploy.
        delivery_date: original.delivery_date ?? original.invoice_date ?? null,
      })
      .select()
      .single(),
      { created_by: invoiceCreatedBy(acting) },
    )

    if (insertError || !creditnota) {
      // [IN1] / [DEEL-CREDIT] The database is the real guard against the SELECT-then-INSERT race
      // above. It used to be a unique index ("one creditnota per invoice", SQLSTATE 23505); it is
      // now a trigger that locks the original and refuses anything that would take the credits
      // past the invoice (creditnota_partial.sql, raised as check_violation / 23514). Both are
      // surfaced as the same clean 409 the pre-check returns, because both mean the same thing to
      // the owner: another credit got there first and this one no longer fits.
      const code = (insertError as { code?: string } | null)?.code
      const raceLost =
        code === '23505' ||
        code === '23514' ||
        (typeof insertError?.message === 'string' &&
          /duplicate key value|unique constraint|exceeds original invoice/i.test(insertError.message))
      if (raceLost) {
        return NextResponse.json(
          { error: 'Er is inmiddels een andere creditnota op deze factuur gemaakt — kijk even wat er nog openstaat en probeer het opnieuw.' },
          { status: 409 }
        )
      }
      console.error('[FACTUUR-A] Creditnota insert failed', { original_invoice_id, insertError })
      return NextResponse.json({ error: 'Creditnota aanmaken mislukt' }, { status: 500 })
    }

    // [KLANT-EXTRA] Dezelfde klantregels als op de factuur die deze creditnota corrigeert. Zonder
    // ze belandt de correctie op een ander bureau dan de factuur — bij precies de klant die de
    // factuur zonder die regels niet kon verwerken.
    await copyExtraLinesOnto(
      (fields) => supabase.from('invoices').update(fields as never).eq('id', creditnota.id),
      original,
      { original: original_invoice_id, creditnota: creditnota.id },
    )

    // [BOEK-031] Kopieer de gekozen regels negatief.
    // [DEEL-CREDIT] Uit `keuze`, niet uit een tweede lezing van de factuur: dat zijn de regels
    // waarmee het plafond hierboven is gecontroleerd én waarmee de totalen zijn uitgerekend. Ze
    // nog eens ophalen zou betekenen dat de bedragen op de kop uit de ene lezing komen en de
    // regels eronder uit de andere — en tussen die twee kan een bewerking hebben gezeten.
    if (keuze.lines.length > 0) {
      // [CREDIT-SIGN] The mirror lives in creditnota-lines.ts, with every rule it applies and the
      // reason for it: which fields flip (the quantity and the line total, never the price — that
      // is BR-27 and [MIN-REGEL]), which travel (the unit, so "-2 uur" does not become "-2 stuks",
      // and the exemption flag, whose absence puts the correction in a different rubriek than the
      // invoice it undoes), and which are hardened. It sat here as an object literal inside a
      // .map(), where none of it could be checked without a database.
      await supabase.from('invoice_lines').insert(
        creditLinesFor(keuze.lines, creditnota.id, reason) as never,
      )
    }

    // [BOEK-031] BOEK-SECURITY-2 — audit via helper, newValue is object — May 2026
    await logAuditAction({
      userId: user.id,
      action: 'creditnota.created',
      entityType: 'invoice',  // singular — matches historical 2 rows
      entityId: creditnota.id,
      newValue: {
        creditnota_number: creditnota.invoice_number,
        original_invoice_id,
        original_invoice_number: original.invoice_number,
        // [DEEL-CREDIT] Of dit de hele factuur was of een deel, en welk deel. Een deelcreditnota
        // is niet af te leiden uit het bedrag alleen — daarvoor moet je weten wat de factuur was
        // en wat er al eerder van is gecrediteerd. Dat hoort in het spoor te staan, niet in een
        // reconstructie achteraf.
        partial: !keuze.isFull,
        credited_inc_btw: keuze.totalIncBtw,
        already_credited_before: alGecrediteerd,
        credited_line_count: keuze.lines.length,
      },
      ipAddress: getClientIP(request),
    })

    // ── [FACTUUR-A] Render + store the creditnota PDF, then deliver ──
    // A creditnota is a legal invoice (Art. 35). Render the PDF and store it
    // UNCONDITIONALLY — not only when the customer has an e-mail — so it reaches
    // the accountant's closing package via invoices.pdf_url. Previously the PDF
    // was rendered only inside the e-mail branch and never stored, so every
    // creditnota showed up in the package as "pdf_missing" (a correction with no
    // document). Storage + delivery are both best-effort; neither rolls back the
    // creditnota (number already consumed). [CREDITNOTA-PDF]
    let warning: string | undefined

    // [ACTING-FOR] Het profiel van de VERKOPER staat op de creditnota — dat is de eigenaar. Voor een
    // medewerker is die rij via RLS onleesbaar, dus dan langs service_role.
    const { data: profile } = await (isActingForOther(acting) ? createPipelineClient() : supabase)
      .from('profiles')
      .select('*')
      .eq('id', ownerId)
      .single()

    const { data: creditLines } = await supabase
      .from('invoice_lines')
      .select('*')
      .eq('invoice_id', creditnota.id)

    let pdfBuffer: Buffer | null = null
    try {
      // [CREDITNOTA-REF] The original's number and date travel INTO the render (not into the
      // row): art. 219 requires the document to name the invoice it corrects, and `original` is
      // already loaded above. Nothing is stored — the number of an issued invoice never changes,
      // so resolving it at render time is stable.
      pdfBuffer = await renderInvoicePdf(
        {
          ...creditnota,
          original_invoice_number: original.invoice_number,
          original_invoice_date: original.invoice_date,
        },
        creditLines ?? [],
        profile ?? {},
      )
    } catch (pdfErr) {
      console.error('[FACTUUR-A] Creditnota PDF render failed', {
        creditnota_id: creditnota.id,
        error: pdfErr,
      })
      Sentry.captureException(pdfErr, {
        tags: { feature: 'creditnota', severity: 'medium' },
        extra: { creditnota_id: creditnota.id, userId: user.id },
      })
    }

    // Store the PDF (raw path; signed on read) so it lands in the closing
    // package — mirrors the send route's storage step. Best-effort.
    if (pdfBuffer) {
      try {
        const pdfPath = `${ownerId}/facturen/${creditnotaNumber}.pdf`
        // [PDF-IMMUTABLE] Zie de toelichting in invoice/send: er is geen UPDATE-policy op
        // storage.objects, dus een overschrijving kan niet slagen. Hier is dat sowieso nooit aan
        // de orde — creditnotaNumber komt vers uit de reeks, dus het pad is per definitie nieuw —
        // maar `upsert: true` suggereerde een mogelijkheid die niet bestaat.
        const { error: uploadError } = await supabase.storage
          .from(PDF_BUCKET)
          .upload(pdfPath, pdfBuffer, { contentType: 'application/pdf', upsert: false })
        if (!uploadError) {
          await supabase
            .from('invoices')
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            .update({ pdf_url: pdfPath, updated_at: new Date().toISOString() } as any)
            .eq('id', creditnota.id)
        } else {
          console.error('[CREDITNOTA-PDF] storage upload failed', {
            creditnota_id: creditnota.id,
            uploadError,
          })
        }
      } catch (storageErr) {
        console.error('[CREDITNOTA-PDF] storage block error', {
          creditnota_id: creditnota.id,
          storageErr,
        })
      }
    }

    // Deliver by e-mail if the customer has one — reuse the same rendered PDF.
    if (original.client_email) {
      if (!pdfBuffer) {
        warning = 'delivery_failed'
      } else {
        try {
          await sendInvoiceToClient({
            toEmail: original.client_email,
            clientName: original.client_name ?? '',
            zzperName: profile?.company_name || profile?.full_name || 'Onbekend',
            // [ANTWOORD-ADRES] Een creditnota roept vaker een vraag op dan een factuur.
            senderEmail: profile?.email ?? null,
            // [FACTUUR-A] use the locally generated number (guaranteed non-null —
            // we returned 500 above if generation failed). creditnota.invoice_number
            // is typed string|null by the DB schema, which the e-mail signature rejects.
            invoiceNumber: creditnotaNumber,
            totalInc: creditnota.total_inc_btw ?? 0,
            dueDate: creditnota.due_date ?? '',
            invoiceDate: creditnota.invoice_date ?? undefined,
            pdfBuffer,
            isCreditnota: true,
          })
        } catch (deliveryErr) {
          warning = 'delivery_failed'
          console.error('[FACTUUR-A] Creditnota delivery failed', {
            creditnota_id: creditnota.id,
            error: deliveryErr,
          })
          Sentry.captureException(deliveryErr, {
            tags: { feature: 'creditnota', severity: 'medium' },
            extra: { creditnota_id: creditnota.id, userId: user.id },
          })
        }
      }
    }

    // [BANK-CIRCLE-SEND] A creditnota is issued 'sent' and is immediately matchable to a refund line
    // that may already sit in the bank (the money moved before the credit document existed). Re-run
    // the same safe auto-confirm so that refund gets linked at issuance. Best-effort, idempotent,
    // one-tap reversible — never breaks the (already-committed) creditnota.
    try {
      // [ACTING-FOR] Op het bedrijf. Handelt er een medewerker, dan is de sessie-client waardeloos
      // voor de bankregels van de eigenaar (RLS) — dan langs service_role, de modus die
      // bank-auto-confirm zelf beschrijft voor cron en import.
      const pipelineForConfirm = createPipelineClient()
      await runBankAutoConfirm({
        payClient: isActingForOther(acting) ? pipelineForConfirm : supabase,
        pipeline: pipelineForConfirm,
        userId: ownerId,
      })
    } catch (autoErr) {
      console.error('[BANK-CIRCLE-SEND] post-creditnota auto-confirm failed (non-fatal)', { creditnota_id: creditnota.id, autoErr })
    }

    return NextResponse.json({
      success: true,
      creditnota_id: creditnota.id,
      creditnota_number: creditnota.invoice_number,
      // [DEEL-CREDIT] Wat er is gecrediteerd en wat er van de factuur overblijft, zodat het scherm
      // het meteen kan tonen zonder de factuur opnieuw op te halen — en zodat een tweede
      // deelcreditnota begint met het juiste plafond in beeld.
      partial: !keuze.isFull,
      credited_inc_btw: keuze.totalIncBtw,
      remaining_creditable: creditableRemaining(original.total_inc_btw, alGecrediteerd + keuze.totalIncBtw),
      ...(warning ? { warning } : {}),
    })

  } catch (err) {
    console.error('[FACTUUR-A] /api/invoice/creditnota fatal error', err)
    Sentry.captureException(err, {
      tags: { feature: 'creditnota', severity: 'high' },
    })
    return NextResponse.json({ error: 'Onbekende fout' }, { status: 500 })
  }
}