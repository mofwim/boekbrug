// src/app/api/invoice/numbering/route.ts
// [FACTUUR-B] Invoice-numbering configuration — the single server-side
// authority. June 2026.
// =====================================================================
// Called by BOTH the onboarding wizard AND the Settings page. Settings saves
// the rest of the profile client-side (RLS), but numbering CANNOT: the lock
// (Art. 35 Wet OB 1968) and the counter seed must live server-side where the
// client cannot bypass them. One endpoint, one source of truth.
//
// POST { invoice_start: string }  -> configure / reconfigure
//   1. auth (session client — same pattern as the other routes).
//   2. parse invoice_start via extractInvoiceTemplate (AUTHORITATIVE — never
//      trust the client's live preview). empty => system default; invalid => 400.
//   3. lock: locked = a NUMBERED factuur already exists in the year the
//      template governs (reset => current calendar year via invoice_date;
//      continuous => any year). NOT a permanent flag — a customer may still
//      correct their numbering BEFORE the first issued invoice. A locked
//      *change* => audit numbering_change_blocked + 409.
//   4. apply (not locked): write profiles.template/padding (session), seed
//      invoice_counters.last_seq = MAX(startSeq-1, existing) FORWARD-ONLY
//      (service_role — the counter table denies session writes), audit
//      numbering_configured. Returns the ACTUAL resulting first/next numbers.
//
// GET  -> current numbering state for the Settings card
//   { template, isCustom, padding, yearlyReset, locked, next, nextSeq }
//
// Uses the schema already shipped by the atomic migration: invoice_counters
// (+ last_seq) and profiles.invoice_number_template / _padding. NO new
// migration. number_assigned is already covered by status_changed in the send
// route — not touched here.
//
// NOTE: createPipelineClient is the project's service-role client
// (src/lib/supabase-pipeline.ts). Adjust the import if your export differs.
// =====================================================================

import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase-server'
import { createPipelineClient } from '@/lib/supabase-pipeline'
import { logAuditAction, getClientIP } from '@/lib/audit'
import {
  extractInvoiceTemplate,
  formatInvoiceNumber,
  reasonToDutch,
} from '@/lib/invoice-template'
import * as Sentry from '@sentry/nextjs'

const DEFAULT_TEMPLATE = '{seq}-{year}'
const DEFAULT_PADDING = 3

interface DesiredConfig {
  template: string | null // null = system default
  padding: number
  startSeq: number | null // null = do not seed (default branch)
  yearlyReset: boolean
}

// ─────────────────────────────────────────────────────────────────────
// POST — configure / reconfigure numbering
// ─────────────────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  try {
    const supabase = await createServerSupabaseClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Niet ingelogd' }, { status: 401 })

    const body = await req.json().catch(() => ({}))
    const raw: string = typeof body.invoice_start === 'string' ? body.invoice_start : ''

    // 1. parse (authoritative)
    const ex = extractInvoiceTemplate(raw)
    let desired: DesiredConfig
    if (ex.ok) {
      desired = { template: ex.template, padding: ex.padding, startSeq: ex.startSeq, yearlyReset: ex.yearlyReset }
    } else if (ex.reason === 'empty') {
      desired = { template: null, padding: DEFAULT_PADDING, startSeq: null, yearlyReset: true }
    } else {
      return NextResponse.json({ ok: false, error: reasonToDutch(ex.reason), reason: ex.reason }, { status: 400 })
    }

    const year = new Date().getFullYear()
    const counterYear = desired.yearlyReset ? year : 0

    // current profile config (for old_value + no-op detection)
    const { data: prof } = await supabase
      .from('profiles')
      .select('invoice_number_template, invoice_number_padding')
      .eq('id', user.id)
      .single()
    const currentTemplate = (prof?.invoice_number_template ?? null) as string | null
    const currentPadding =
      typeof prof?.invoice_number_padding === 'number' ? prof.invoice_number_padding : DEFAULT_PADDING

    // 2. lock (date-based, reliable — no invoice_number string parsing)
    let lockQ = supabase
      .from('invoices')
      .select('id', { head: true, count: 'exact' })
      .eq('sender_id', user.id)
      .eq('invoice_type', 'factuur')
      .not('invoice_number', 'is', null)
    if (desired.yearlyReset) {
      lockQ = lockQ.gte('invoice_date', `${year}-01-01`).lte('invoice_date', `${year}-12-31`)
    }
    const { count: issuedCount } = await lockQ
    const locked = (issuedCount ?? 0) > 0

    const isNoOp =
      desired.template === currentTemplate &&
      desired.padding === currentPadding &&
      desired.startSeq == null

    if (locked && !isNoOp) {
      // The most valuable audit legally: prove the platform refused a
      // retroactive change after a number was issued.
      await logAuditAction({
        userId: user.id,
        action: 'invoice.numbering_change_blocked',
        entityType: 'profile',
        entityId: user.id,
        oldValue: { template: currentTemplate, padding: currentPadding },
        newValue: {
          attempted_template: desired.template,
          attempted_padding: desired.padding,
          reason: 'issued_invoice_exists',
        },
        ipAddress: getClientIP(req),
      })
      return NextResponse.json(
        { ok: false, locked: true, error: 'Je nummering staat vast — er is al een factuur verstuurd. Wijzigen kan niet meer.' },
        { status: 409 }
      )
    }

    // current counter (session client — the SELECT RLS policy allows own row)
    const { data: cur } = await supabase
      .from('invoice_counters')
      .select('last_seq')
      .eq('user_id', user.id)
      .eq('year', counterYear)
      .eq('type', 'factuur')
      .maybeSingle()
    const current = typeof cur?.last_seq === 'number' ? cur.last_seq : 0

    // 3. effective start sequence (forward-only seed; never collide / go back)
    let effectiveStartSeq: number
    if (!locked && desired.startSeq != null) {
      const target = Math.max(desired.startSeq - 1, current) // >= current => forward-only
      const pipeline = createPipelineClient() // service_role — counter table denies session writes
      const { error: seedErr } = await pipeline
        .from('invoice_counters')
        .upsert(
          { user_id: user.id, year: counterYear, type: 'factuur', last_seq: target },
          { onConflict: 'user_id,year,type' }
        )
      if (seedErr) {
        console.error('[FACTUUR-B] counter seed failed', { userId: user.id, counterYear, seedErr })
        return NextResponse.json({ ok: false, error: 'Kon de nummering niet instellen.' }, { status: 500 })
      }
      effectiveStartSeq = target + 1
    } else {
      effectiveStartSeq = current + 1
    }

    // 4. write profile config (session — RLS: own profile) + audit
    if (!locked) {
      const { error: profErr } = await supabase
        .from('profiles')
        .update({
          invoice_number_template: desired.template, // null = default
          invoice_number_padding: desired.padding,
        })
        .eq('id', user.id)
      if (profErr) {
        console.error('[FACTUUR-B] profile numbering update failed', { userId: user.id, profErr })
        return NextResponse.json({ ok: false, error: 'Kon de nummering niet opslaan.' }, { status: 500 })
      }

      await logAuditAction({
        userId: user.id,
        action: 'invoice.numbering_configured',
        entityType: 'profile',
        entityId: user.id,
        oldValue: { template: currentTemplate, padding: currentPadding },
        newValue: {
          template: desired.template,
          padding: desired.padding,
          start_seq: effectiveStartSeq,
          requested_start_seq: desired.startSeq,
          yearly_reset: desired.yearlyReset,
        },
        ipAddress: getClientIP(req),
      })
    }

    const effTemplate = desired.template ?? DEFAULT_TEMPLATE
    return NextResponse.json({
      ok: true,
      template: effTemplate,
      padding: desired.padding,
      startSeq: effectiveStartSeq,
      yearlyReset: desired.yearlyReset,
      first: formatInvoiceNumber(effTemplate, effectiveStartSeq, desired.padding, year),
      next: formatInvoiceNumber(effTemplate, effectiveStartSeq + 1, desired.padding, year),
    })
  } catch (err) {
    console.error('[FACTUUR-B] /api/invoice/numbering POST fatal', err)
    Sentry.captureException(err, { tags: { feature: 'invoice-numbering', severity: 'high' } })
    return NextResponse.json({ ok: false, error: 'Onbekende fout' }, { status: 500 })
  }
}

// ─────────────────────────────────────────────────────────────────────
// GET — current numbering state (for the Settings card)
// ─────────────────────────────────────────────────────────────────────
export async function GET() {
  try {
    const supabase = await createServerSupabaseClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Niet ingelogd' }, { status: 401 })

    const year = new Date().getFullYear()

    const { data: prof } = await supabase
      .from('profiles')
      .select('invoice_number_template, invoice_number_padding')
      .eq('id', user.id)
      .single()
    const template = (prof?.invoice_number_template ?? null) as string | null
    const padding = typeof prof?.invoice_number_padding === 'number' ? prof.invoice_number_padding : DEFAULT_PADDING
    const effTemplate = template ?? DEFAULT_TEMPLATE
    const yearlyReset = effTemplate.includes('{year}')
    const counterYear = yearlyReset ? year : 0

    let lockQ = supabase
      .from('invoices')
      .select('id', { head: true, count: 'exact' })
      .eq('sender_id', user.id)
      .eq('invoice_type', 'factuur')
      .not('invoice_number', 'is', null)
    if (yearlyReset) {
      lockQ = lockQ.gte('invoice_date', `${year}-01-01`).lte('invoice_date', `${year}-12-31`)
    }
    const { count } = await lockQ
    const locked = (count ?? 0) > 0

    const { data: cur } = await supabase
      .from('invoice_counters')
      .select('last_seq')
      .eq('user_id', user.id)
      .eq('year', counterYear)
      .eq('type', 'factuur')
      .maybeSingle()
    const nextSeq = (typeof cur?.last_seq === 'number' ? cur.last_seq : 0) + 1

    return NextResponse.json({
      ok: true,
      template: effTemplate,
      isCustom: template !== null,
      padding,
      yearlyReset,
      locked,
      nextSeq,
      next: formatInvoiceNumber(effTemplate, nextSeq, padding, year),
    })
  } catch (err) {
    console.error('[FACTUUR-B] /api/invoice/numbering GET fatal', err)
    return NextResponse.json({ ok: false, error: 'Onbekende fout' }, { status: 500 })
  }
}