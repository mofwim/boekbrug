// src/app/api/invoice/send/route.ts
// [BOEK-031] Invoice send — May 2026
// =====================================================
// Flow: draft → sent
// - Generates invoice_number if missing (drafts)
// - Updates DB status + number (this is the legal trigger per Wet OB 1968)
// - Audit log via service_role
// - Sends email (best-effort, doesn't block legal completion)
// - Notifies accountant (best-effort, via service_role)
// - Rate limit: 100 sends/hour per user (via RATE_LIMITS.INVOICE_SEND)
//
// Per Dutch Belastingdienst (Article 35 — Wet OB 1968):
// Once number is generated and committed to DB, the invoice is legally sent.
// Email is delivery mechanism, not legal trigger.
//
// TODO: Add DB trigger for AUTO-UPDATE updated_at, then remove manual setting
// =====================================================

import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase-server'
import { createPipelineClient } from '@/lib/supabase-pipeline'
import { sendInvoiceToClient } from '@/lib/email'
import { generateInvoiceNumber, type InvoiceNumberType } from '@/lib/invoice-numbering'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { logAuditAction, getClientIP } from '@/lib/audit'
import * as Sentry from '@sentry/nextjs'

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
    const { invoiceId } = body
    if (!invoiceId) {
      return NextResponse.json({ error: 'invoiceId verplicht' }, { status: 400 })
    }

    // ── 4. Fetch invoice (ownership via RLS + sender_id) ───────
    const { data: invoice, error: invoiceError } = await supabase
      .from('invoices')
      .select('id, sender_id, status, invoice_number, invoice_type, client_name, client_email, total_inc_btw, due_date')
      .eq('id', invoiceId)
      .eq('sender_id', user.id)
      .single()

    if (invoiceError || !invoice) {
      return NextResponse.json({ error: 'Factuur niet gevonden' }, { status: 404 })
    }

    // ── 5. Status check — only drafts can be sent ─────────────
    if (invoice.status !== 'draft') {
      return NextResponse.json(
        { error: 'Factuur kan niet meer worden verzonden — al verzonden' },
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
    const isConversion = invoice.invoice_type === 'pro_forma' || invoice.invoice_type === 'offerte'
    const finalType = isConversion ? 'factuur' : invoice.invoice_type

    // Generate number: always for conversion, only if missing for regular drafts
    let finalNumber = invoice.invoice_number
    if (isConversion || !finalNumber) {
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

    // ── 8. UPDATE DB — commit number + status (legal trigger) ─
    // Per Belastingdienst: once number is committed, invoice is legally sent.
    const { error: updateError } = await supabase
      .from('invoices')
      .update({
        status: 'sent',
        invoice_number: finalNumber,
        invoice_type: finalType,
        // [BOEK-031] TODO: Remove after DB trigger for AUTO-UPDATE updated_at is added
        updated_at: new Date().toISOString(),
      })
      .eq('id', invoiceId)

    if (updateError) {
      console.error('[BOEK-031] Invoice update failed', { invoiceId, updateError })
      Sentry.captureException(updateError, {
        tags: { feature: 'invoice-send', severity: 'high' },
        extra: { invoiceId, finalNumber, userId: user.id },
      })
      return NextResponse.json({ error: 'Server fout' }, { status: 500 })
    }

    // ── 9. Audit log — via service_role (BOEK-SECURITY-2) ─────
    // status_changed is generic — works for all status transitions
    await logAuditAction({
      userId: user.id,
      action: 'invoice.status_changed',
      entityType: 'invoice',
      entityId: invoiceId,
      oldValue: {
        status: invoice.status,            // 'draft'
        invoice_number: invoice.invoice_number,  // null or preview
      },
      newValue: {
        status: 'sent',
        invoice_number: finalNumber,
      },
      ipAddress: getClientIP(request),
    })

    // ── 10. Fetch sender profile for email + notification ─────
    const { data: profile } = await supabase
      .from('profiles')
      .select('full_name, company_name')
      .eq('id', user.id)
      .single()

    const zzperName = profile?.company_name || profile?.full_name || 'Onbekend'

    // ── 11. Send email — best-effort, doesn't block legal completion ─
    let emailFailed = false
    try {
      await sendInvoiceToClient({
        toEmail: invoice.client_email,
        clientName: invoice.client_name,
        zzperName,
        invoiceNumber: finalNumber,
        totalInc: invoice.total_inc_btw,
        dueDate: invoice.due_date ?? '',
      })
    } catch (emailErr) {
      emailFailed = true
      console.error('[BOEK-031] Email send failed', {
        invoiceId,
        finalNumber,
        error: emailErr,
      })
      Sentry.captureException(emailErr, {
        tags: { feature: 'invoice-send', severity: 'medium' },
        extra: { invoiceId, finalNumber, userId: user.id },
      })
    }

    // ── 12. Notify accountant — best-effort, via service_role ─
    // notifications.INSERT requires service_role per RLS Phase 2
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
            body: `${zzperName} heeft factuur ${finalNumber} verzonden — €${invoice.total_inc_btw.toFixed(2)}`,
            type: 'invoice',
            read: false,
            link: `/dashboard/clients/${user.id}`,
          })

        if (notifError) {
          console.error('[BOEK-031] Notification insert failed', { invoiceId, notifError })
          // Low severity — don't bother Sentry
        }
      }
    } catch (notifErr) {
      console.error('[BOEK-031] Notification block error', { invoiceId, notifErr })
      // Low severity — don't bother Sentry
    }

    // ── 13. Response ──────────────────────────────────────────
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
    console.error('[BOEK-031] /api/invoice/send fatal error', err)
    Sentry.captureException(err, {
      tags: { feature: 'invoice-send', severity: 'critical' },
    })
    return NextResponse.json(
      { error: 'Server fout — probeer opnieuw' },
      { status: 500 }
    )
  }
}