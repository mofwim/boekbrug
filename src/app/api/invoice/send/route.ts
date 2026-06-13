// src/app/api/invoice/send/route.ts
// [BOEK-031] Invoice send — May 2026
// [FACTUUR-A] Legal delivery rebuild — June 2026
// =====================================================
// Flow: draft → sent
// - Generates invoice_number if missing (drafts)
// - Updates DB status + number (this is the legal trigger per Wet OB 1968)
// - [FACTUUR-A] Renders the invoice PDF server-side and ATTACHES it to the
//   delivery e-mail — the recipient now receives the actual legal invoice,
//   not a bare notification (critical defect #1).
// - [FACTUUR-A] Stores pdf_url (raw storage path, signed on read) best-effort.
// - [FACTUUR-A] resend=true mode: re-deliver PDF + e-mail for an already-sent
//   invoice WITHOUT touching number/status (recovery path for pdf_failed /
//   email_failed warnings).
// - Audit log via service_role
// - Notifies accountant (best-effort, via service_role)
// - Rate limit: 100 sends/hour per user (via RATE_LIMITS.INVOICE_SEND)
//
// Per Dutch Belastingdienst (Article 35 — Wet OB 1968):
// Once number is generated and committed to DB, the invoice is legally sent.
// E-mail is the delivery mechanism, not the legal trigger.
//
// [FACTUUR-A] Failure ordering (decided with M, June 2026):
//   number commit (point of no return) → PDF render → e-mail with attachment.
//   * PDF render fails AFTER number commit → invoice stays 'sent' (number is
//     consumed, Art. 35 — no rollback), NO e-mail goes out (a notification
//     without the invoice is exactly the defect we are killing), response
//     carries warning:'pdf_failed' → user re-delivers via resend.
//   * E-mail fails → warning:'email_failed' → same resend recovery.
//   Nothing incomplete ever reaches the recipient.
//
// TODO: Add DB trigger for AUTO-UPDATE updated_at, then remove manual setting
// TODO(BRIDGE-C): swap generateInvoiceNumber internals to a PostgreSQL
//   sequence — closes the SELECT-then-compute race. Call site stays as-is.
// =====================================================

import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase-server'
import { createPipelineClient } from '@/lib/supabase-pipeline'
import { sendInvoiceToClient } from '@/lib/email'
import { renderInvoicePdf } from '@/lib/invoice-pdf-server'
import { generateInvoiceNumber, type InvoiceNumberType } from '@/lib/invoice-numbering'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { logAuditAction, getClientIP } from '@/lib/audit'
import * as Sentry from '@sentry/nextjs'

// [FACTUUR-A] Storage bucket for generated invoice PDFs.
// TODO(M): verify this bucket name in Supabase Storage before deploy —
// upload is best-effort and never blocks legal delivery, but pdf_url
// storage only works once the name is right.
const PDF_BUCKET = 'documents'

// [FACTUUR-A] Statuses from which an already-issued invoice may be re-delivered
const RESENDABLE_STATUSES = ['sent', 'paid', 'overdue'] as const

export async function POST(request: NextRequest) {
  try {
    // ── 1. Auth ────────────────────────────────────────────────
    const supabase = await createServerSupabaseClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // ── 2. Rate limit — 100 sends/hour per user ────────────────
    const limit = await checkRateLimit({
      userId: user.id,
      endpoint: '/api/invoice/send',
      ...RATE_LIMITS.INVOICE_SEND,
    })
    if (!limit.allowed) return rateLimitResponse(limit)

    // ── 3. Parse body ──────────────────────────────────────────
    const body = await request.json()
    const { invoiceId, convertOnly = false, resend = false } = body
    // convertOnly=true: "Maak factuur aan" flow — convert pro_forma to factuur
    // resend=true: [FACTUUR-A] re-deliver PDF+e-mail for an already-sent
    //   invoice — number/status untouched
    if (!invoiceId) {
      return NextResponse.json({ error: 'invoiceId verplicht' }, { status: 400 })
    }

    // ── 4. Fetch invoice (ownership via RLS + sender_id) ───────
    // [FACTUUR-A] select('*') — the PDF needs every field (address block,
    // delivery_date, type). delivery_date lands after the FACTUUR-A migration;
    // select('*') keeps this resilient either way.
    const { data: invoiceData, error: invoiceError } = await supabase
      .from('invoices')
      .select('*')
      .eq('id', invoiceId)
      .eq('sender_id', user.id)
      .single()

    if (invoiceError || !invoiceData) {
      return NextResponse.json({ error: 'Factuur niet gevonden' }, { status: 404 })
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const invoice = invoiceData as any

    // ── 5. Status check ────────────────────────────────────────
    // normal send:  only drafts
    // convertOnly:  sent pro_formas / offertes (Maak factuur aan flow)
    // resend:       already-issued invoices with a number — re-delivery only
    if (resend) {
      if (!RESENDABLE_STATUSES.includes(invoice.status) || !invoice.invoice_number) {
        return NextResponse.json(
          { error: 'Alleen verzonden facturen kunnen opnieuw worden verstuurd' },
          { status: 400 }
        )
      }
    } else if (!convertOnly && invoice.status !== 'draft') {
      return NextResponse.json(
        { error: 'Factuur kan niet meer worden verzonden — al verzonden' },
        { status: 400 }
      )
    }
    if (convertOnly && invoice.invoice_type !== 'pro_forma' && invoice.invoice_type !== 'offerte') {
      return NextResponse.json(
        { error: 'Alleen pro forma facturen kunnen worden omgezet' },
        { status: 400 }
      )
    }

    // ── 6. Required fields validation ──────────────────────────
    if (!invoice.client_email) {
      return NextResponse.json({ error: 'Klant e-mail ontbreekt' }, { status: 400 })
    }
    if (!invoice.client_name) {
      return NextResponse.json({ error: 'Klant naam ontbreekt' }, { status: 400 })
    }
    if (invoice.total_inc_btw === null || invoice.total_inc_btw === undefined) {
      return NextResponse.json({ error: 'Factuurbedrag ontbreekt' }, { status: 400 })
    }

    // ── 7. Pro forma / Offerte → convert to official Factuur upon sending ─
    // Per Belastingdienst: only official facturen count — pro forma is not a legal invoice
    const isConversion = !resend &&
      (invoice.invoice_type === 'pro_forma' || invoice.invoice_type === 'offerte')
    const finalType: string = resend
      ? (invoice.invoice_type ?? 'factuur')
      : isConversion ? 'factuur' : (invoice.invoice_type ?? 'factuur')

    // [FACTUUR-A] Art. 35a sub c — customer ADDRESS is a mandatory invoice
    // element. Enforced server-side (defense in depth; the UI enforces it
    // too). Applies on first issuance of a factuur/creditnota — resend of an
    // already-issued invoice is delivery only, not issuance.
    if (!resend && (finalType === 'factuur' || finalType === 'creditnota')) {
      if (!invoice.client_address || !String(invoice.client_address).trim()) {
        return NextResponse.json(
          { error: 'Klantadres ontbreekt — verplicht op een factuur (Art. 35a Wet OB 1968)' },
          { status: 400 }
        )
      }
    }

    // ── 8. Generate number — skipped entirely for resend ───────
    // Always for conversion, only if missing for regular drafts
    let finalNumber: string = invoice.invoice_number ?? ''
    if (!resend && (isConversion || !finalNumber)) {
      const numberType: InvoiceNumberType =
        finalType === 'creditnota' ? 'creditnota' : 'factuur'

      const generated = await generateInvoiceNumber(supabase, user.id, numberType)
      if (!generated) {
        return NextResponse.json(
          { error: 'Kon factuurnummer niet genereren' },
          { status: 500 }
        )
      }
      finalNumber = generated
    }

    // ── 9. UPDATE DB — commit number + type (legal trigger) ───
    // Per Belastingdienst: once number is committed, invoice is legally issued.
    // POINT OF NO RETURN — no rollback past this line (Art. 35, no gaps).
    // convertOnly: keep status='sent', just update number + type
    // resend: nothing to commit — delivery only
    if (!resend) {
      const { error: updateError } = await supabase
        .from('invoices')
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .update({
          ...(convertOnly ? {} : { status: 'sent' as const }),
          invoice_number: finalNumber,
          invoice_type: finalType as 'factuur' | 'creditnota' | 'pro_forma' | 'offerte',
          updated_at: new Date().toISOString(),
        } as any)
        .eq('id', invoiceId)

      if (updateError) {
        console.error('[FACTUUR-A] Invoice update failed', { invoiceId, updateError })
        Sentry.captureException(updateError, {
          tags: { feature: 'invoice-send', severity: 'high' },
          extra: { invoiceId, finalNumber, userId: user.id },
        })
        return NextResponse.json({ error: 'Server fout' }, { status: 500 })
      }

      // ── 10. Audit log — via service_role (BOEK-SECURITY-2) ───
      // status_changed is generic — works for all status transitions
      await logAuditAction({
        userId: user.id,
        action: 'invoice.status_changed',
        entityType: 'invoice',
        entityId: invoiceId,
        oldValue: {
          status: invoice.status,                  // 'draft'
          invoice_number: invoice.invoice_number,  // null or preview
        },
        newValue: {
          status: convertOnly ? invoice.status : 'sent',
          invoice_number: finalNumber,
        },
        ipAddress: getClientIP(request),
      })
    }
    // [FACTUUR-A] resend path: no audit log. A resend touches no legal record
    // (no number, status, or amount change) — it is pure re-delivery, so there
    // is nothing auditable. (Avoids inventing a new AuditAction value.)

    // ── 11. Fetch sender profile — full row, the PDF needs it all ─
    const { data: profile } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', user.id)
      .single()

    const zzperName = profile?.company_name || profile?.full_name || 'Onbekend'

    // ── 12. [FACTUUR-A] Render the legal PDF — AFTER number commit ─
    // The PDF must carry the final number, so it can only be rendered now.
    const { data: lines } = await supabase
      .from('invoice_lines')
      .select('*')
      .eq('invoice_id', invoiceId)

    let pdfBuffer: Buffer | null = null
    try {
      pdfBuffer = await renderInvoicePdf(
        {
          ...invoice,
          invoice_number: finalNumber,
          invoice_type: finalType,
          status: resend || convertOnly ? invoice.status : 'sent',
        },
        lines ?? [],
        profile ?? {}
      )
    } catch (pdfErr) {
      console.error('[FACTUUR-A] PDF render failed', { invoiceId, finalNumber, error: pdfErr })
      Sentry.captureException(pdfErr, {
        tags: { feature: 'invoice-send', severity: 'high' },
        extra: { invoiceId, finalNumber, userId: user.id },
      })
    }

    if (!pdfBuffer) {
      if (resend) {
        // Pure delivery attempt — nothing was committed, a clean error is honest
        return NextResponse.json({ error: 'PDF genereren mislukt — probeer opnieuw' }, { status: 500 })
      }
      // Number is consumed (Art. 35 — no rollback). The invoice IS legally
      // issued. We do NOT send a PDF-less notification — that is defect #1.
      // The user re-delivers via resend once the cause is fixed.
      return NextResponse.json({
        success: true,
        invoice_number: finalNumber,
        invoice_type: finalType,
        converted: isConversion,
        warning: 'pdf_failed',
      })
    }

    // ── 13. [FACTUUR-A] Store PDF in Storage — best-effort ─────
    // pdf_url stores the RAW path (house rule: signed on read).
    // Never blocks delivery; failure → Sentry breadcrumb only.
    try {
      const pdfPath = `${user.id}/facturen/${finalNumber}.pdf`
      const { error: uploadError } = await supabase.storage
        .from(PDF_BUCKET)
        .upload(pdfPath, pdfBuffer, { contentType: 'application/pdf', upsert: true })

      if (!uploadError) {
        await supabase
          .from('invoices')
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          .update({ pdf_url: pdfPath, updated_at: new Date().toISOString() } as any)
          .eq('id', invoiceId)
      } else {
        console.error('[FACTUUR-A] PDF storage upload failed', { invoiceId, uploadError })
      }
    } catch (storageErr) {
      console.error('[FACTUUR-A] PDF storage block error', { invoiceId, storageErr })
      // Best-effort — delivery continues regardless
    }

    // ── 14. Send e-mail WITH the PDF attached ──────────────────
    // convertOnly previously skipped the e-mail — [FACTUUR-A] it no longer
    // does: the conversion mints a NEW legal factuur (new number) and
    // Art. 35a requires that document to reach the recipient. The earlier
    // pro forma e-mail was not a legal invoice.
    let emailFailed = false
    try {
      await sendInvoiceToClient({
        toEmail: invoice.client_email,
        clientName: invoice.client_name,
        zzperName,
        invoiceNumber: finalNumber,
        totalInc: invoice.total_inc_btw,
        dueDate: invoice.due_date ?? '',
        invoiceDate: invoice.invoice_date ?? undefined,
        pdfBuffer,
        isCreditnota: finalType === 'creditnota',
      })
    } catch (emailErr) {
      emailFailed = true
      console.error('[FACTUUR-A] Email send failed', {
        invoiceId,
        finalNumber,
        error: emailErr,
      })
      Sentry.captureException(emailErr, {
        tags: { feature: 'invoice-send', severity: 'medium' },
        extra: { invoiceId, finalNumber, userId: user.id },
      })
    }

    // ── 15. Notify accountant — best-effort, via service_role ─
    // notifications.INSERT requires service_role per RLS Phase 2
    // [FACTUUR-A] first issuance only — a resend is not a new invoice
    if (!resend) {
      try {
        const pipelineClient = createPipelineClient()

        const { data: accountantLink } = await pipelineClient
          .from('accountant_clients')
          .select('accountant_id')
          .eq('zzper_id', user.id)
          .maybeSingle()

        if (accountantLink?.accountant_id) {
          const { error: notifError } = await pipelineClient
            .from('notifications')
            .insert({
              user_id: accountantLink.accountant_id,
              title: 'Nieuwe factuur verzonden',
              // [FACTUUR-A] Dutch comma in the notification too — one rule everywhere
              body: `${zzperName} heeft factuur ${finalNumber} verzonden — € ${invoice.total_inc_btw.toLocaleString('nl-NL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
              type: 'invoice',
              read: false,
              link: `/dashboard/clients/${user.id}`,
            })

          if (notifError) {
            console.error('[FACTUUR-A] Notification insert failed', { invoiceId, notifError })
            // Low severity — don't bother Sentry
          }
        }
      } catch (notifErr) {
        console.error('[FACTUUR-A] Notification block error', { invoiceId, notifErr })
        // Low severity — don't bother Sentry
      }
    }

    // ── 16. Response ──────────────────────────────────────────
    if (emailFailed) {
      return NextResponse.json({
        success: true,
        invoice_number: finalNumber,
        invoice_type: finalType,
        converted: isConversion,
        warning: 'email_failed',
      })
    }

    return NextResponse.json({
      success: true,
      invoice_number: finalNumber,
      invoice_type: finalType,
      converted: isConversion,
    })

  } catch (err) {
    // Catch-all: any uncaught exception → Sentry + 500 (no crash)
    console.error('[FACTUUR-A] /api/invoice/send fatal error', err)
    Sentry.captureException(err, {
      tags: { feature: 'invoice-send', severity: 'critical' },
    })
    return NextResponse.json(
      { error: 'Server fout — probeer opnieuw' },
      { status: 500 }
    )
  }
}