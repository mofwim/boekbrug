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
import { createServerSupabaseClient } from '@/lib/supabase-server'
// [BOEK-031] BOEK-SECURITY-2 — audit logs via service_role helper — May 2026
import { logAuditAction, getClientIP } from '@/lib/audit'
// [FACTUUR-A] unified numbering + legal delivery — June 2026
import { generateInvoiceNumber } from '@/lib/invoice-numbering'
import { renderInvoicePdf } from '@/lib/invoice-pdf-server'
import { sendInvoiceToClient } from '@/lib/email'
import * as Sentry from '@sentry/nextjs'

// [CREDITNOTA-PDF] Same storage bucket the send route and the closing package
// use. A creditnota's PDF MUST be stored here and its path written to
// invoices.pdf_url, or the correction document is missing from the accountant's
// closing package (the package resolves an outgoing invoice's PDF via pdf_url).
const PDF_BUCKET = 'documents'

export async function POST(request: NextRequest) {
  try {
    const supabase = await createServerSupabaseClient()

    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body = await request.json()
    const { original_invoice_id, reason } = body

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
    if (original.sender_id !== user.id) {
      return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
    }

    // [BOEK-031] Creditnota alleen mogelijk op verzonden facturen
    // Draft facturen worden verwijderd — niet gecrediteerd
    const CREDITABLE_STATUSES: string[] = ['sent', 'paid', 'overdue', 'received', 'processing', 'processed']
    if (!original.status || !CREDITABLE_STATUSES.includes(original.status)) {
      return NextResponse.json(
        { error: 'Alleen verzonden facturen kunnen worden gecrediteerd. Concept-facturen verwijder je gewoon.' },
        { status: 400 }
      )
    }

    // [FACTUUR-A] Duplicate guard — one creditnota per invoice, enforced via
    // original_invoice_id (column + FK exist on invoices). Replaces the dead
    // invoice_number='CN-…' check that could never match CR- numbering.
    const { data: existingCreditnota } = await supabase
      .from('invoices')
      .select('id, invoice_number')
      .eq('sender_id', user.id)
      .eq('invoice_type', 'creditnota')
      .eq('original_invoice_id', original_invoice_id)
      .maybeSingle()

    if (existingCreditnota) {
      return NextResponse.json(
        { error: 'Er bestaat al een creditnota voor deze factuur' },
        { status: 409 }
      )
    }

    // [FACTUUR-A] Genereer creditnota nummer — unified generator, CR- prefix.
    // Same Art. 35 rule applies: once committed, no rollback.
    const creditnotaNumber = await generateInvoiceNumber(supabase, user.id, 'creditnota')
    if (!creditnotaNumber) {
      return NextResponse.json({ error: 'Kon creditnotanummer niet genereren' }, { status: 500 })
    }

    const today = new Date().toISOString().split('T')[0]

    // [BOEK-031] Maak de creditnota aan
    // Bedragen zijn NEGATIEF — creditnota annuleert de originele factuur
    // [FACTUUR-A] original_invoice_id now stored properly (column exists);
    // source:'created' restored (was swallowed by an inline comment).
    const { data: creditnota, error: insertError } = await supabase
      .from('invoices')
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .insert({
        sender_id: user.id,
        invoice_number: creditnotaNumber,
        invoice_date: today,
        due_date: today,
        status: 'sent',
        invoice_type: 'creditnota',
        direction: original.direction,
        // [BOEK-031] Negatieve bedragen — annulering
        total_ex_btw: -(original.total_ex_btw || 0),
        btw_amount: -(original.btw_amount || 0),
        total_inc_btw: -(original.total_inc_btw || 0),
        // [BRIDGE-A] sent_to_accountant removed — sharing is GENERATED from status
        source: 'created',
        client_name: original.client_name,
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
      } as any)
      .select()
      .single()

    if (insertError || !creditnota) {
      console.error('[FACTUUR-A] Creditnota insert failed', { original_invoice_id, insertError })
      return NextResponse.json({ error: 'Creditnota aanmaken mislukt' }, { status: 500 })
    }

    // [BOEK-031] Haal originele regels op en kopieer ze negatief
    const { data: originalLines } = await supabase
      .from('invoice_lines')
      .select('description, quantity, unit_price, btw_rate, line_total')
      .eq('invoice_id', original_invoice_id)

    if (originalLines && originalLines.length > 0) {
      await supabase.from('invoice_lines').insert(
        originalLines.map(line => ({
          invoice_id: creditnota.id,
          description: `[Creditnota] ${line.description}${reason ? ` — ${reason}` : ''}`,
          quantity: -(line.quantity || 0), // negatief aantal
          unit_price: line.unit_price,
          btw_rate: line.btw_rate,
          line_total: -(line.line_total || 0),
        }))
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

    const { data: profile } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', user.id)
      .single()

    const { data: creditLines } = await supabase
      .from('invoice_lines')
      .select('*')
      .eq('invoice_id', creditnota.id)

    let pdfBuffer: Buffer | null = null
    try {
      pdfBuffer = await renderInvoicePdf(creditnota, creditLines ?? [], profile ?? {})
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
        const pdfPath = `${user.id}/facturen/${creditnotaNumber}.pdf`
        const { error: uploadError } = await supabase.storage
          .from(PDF_BUCKET)
          .upload(pdfPath, pdfBuffer, { contentType: 'application/pdf', upsert: true })
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

    return NextResponse.json({
      success: true,
      creditnota_id: creditnota.id,
      creditnota_number: creditnota.invoice_number,
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