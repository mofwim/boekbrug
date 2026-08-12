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
//   3. lock: locked = a number has already been DRAWN from the counter this
//      request would re-seed. Two witnesses, either of which locks — an issued
//      factuur dated inside the year, or one whose NUMBER carries the year
//      ([NUMMER-SLOT]; the date alone missed every back-dated invoice, because
//      invoice_date is the owner's field while the counter is keyed by the
//      clock). Continuous numbering draws from the single year=0 counter, so
//      any issued factuur locks it and no window applies. NOT a permanent flag
//      — a customer may still correct their numbering BEFORE the first issued
//      invoice. A locked *change* => audit numbering_change_blocked + 409.
//   4. apply (not locked): write profiles.template/padding (session), seed
//      invoice_counters via seed_invoice_counter — GREATEST(existing, startSeq-1)
//      evaluated UNDER the ON CONFLICT lock, so a concurrent next_invoice_seq
//      cannot be undone (service_role — the counter table denies session
//      writes), audit numbering_configured. Returns the ACTUAL first/next
//      numbers, taken from what the function says landed.
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
import { requireOwner } from '@/lib/owner-only'
// [NUMMER-JAAR] The owner's year, not the server's — see format-nl.ts.
import { amsterdamYear } from '@/lib/format-nl'
// [NUMMER-SLOT] The lock's two witnesses, written down once — see numbering-lock.ts.
import { invoiceDateWindow, invoiceNumberYearPattern } from '@/lib/numbering-lock'
import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Has a number been drawn from this owner's counter for `year`?
 *
 * [NUMMER-SLOT] Two witnesses, either of which locks. The date window is what this lock always
 * asked; the number pattern is the witness it was missing, because `invoice_date` is a field the
 * OWNER fills in while the counter is keyed by the clock at allocation. A back-dated invoice —
 * December work billed on 4 January — drew a number from this year's counter and carries last
 * year's date, so the date-only question answered "nothing issued yet" and the numbering could be
 * reshaped after a number had already reached a customer. See numbering-lock.ts for the full
 * argument, including why the union may over-lock and why that is the direction to be wrong in.
 *
 * Returns null when either count could not be read. [LOCK-READ-HONEST]: the caller must treat that
 * as LOCKED, never as "nothing issued" — a database hiccup is not evidence that nobody has invoiced.
 */
async function countIssuedForCounterYear(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any>,
  userId: string,
  year: number,
  yearlyReset: boolean,
): Promise<number | null> {
  const base = () =>
    supabase
      .from('invoices')
      .select('id', { head: true, count: 'exact' })
      .eq('sender_id', userId)
      .eq('invoice_type', 'factuur')
      .not('invoice_number', 'is', null)

  // Continuous numbering draws from the single year=0 counter, so ANY issued factuur locks it and
  // there is no window to get wrong.
  if (!yearlyReset) {
    const { count, error } = await base()
    return error ? null : (count ?? 0)
  }

  const { from, to } = invoiceDateWindow(year)
  const [byDate, byNumber] = await Promise.all([
    base().gte('invoice_date', from).lte('invoice_date', to),
    base().like('invoice_number', invoiceNumberYearPattern(year)),
  ])
  // Both errors are read. Either one failing means the answer is unknown, and unknown locks.
  if (byDate.error || byNumber.error) return null
  // The union is not the sum — a row can satisfy both — but the caller only asks "> 0", and the
  // maximum is the honest lower bound on the union without a second round trip.
  return Math.max(byDate.count ?? 0, byNumber.count ?? 0)
}

// [FACTUUR-UNIFY] Unified product-wide default: YEAR+sequence, padding 4
// (e.g. 20260001) — matches lib/invoice-numbering and the free generator.
const DEFAULT_TEMPLATE = '{year}{seq}'
const DEFAULT_PADDING = 4

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
  // [ACTING-FOR] Alleen de eigenaar — zie src/lib/owner-only.ts. Een medewerker hier
  // doorlaten zou een tweede nummerreeks onder hetzelfde BTW-nummer openen.
  { const w = await requireOwner('De factuurnummering wijzigen'); if (w.response) return w.response }

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

    // [NUMMER-JAAR] The owner's year. Between 23:00 UTC on 31 December and midnight the server is
    // still in the old one, and this route would then lock — and seed — the closed year's counter.
    const year = amsterdamYear()
    const counterYear = desired.yearlyReset ? year : 0

    // current profile config (for old_value + no-op detection)
    const { data: prof } = await supabase
      .from('profiles')
      .select('invoice_number_template, invoice_number_padding')
      .eq('id', user.id)
      .single()
    const currentTemplate = (prof?.invoice_number_template ?? null) as string | null
    // Default template ⇒ DEFAULT_PADDING (mirror resolveFormat); stored padding
    // only meaningful for a custom template.
    const currentPadding =
      currentTemplate !== null && typeof prof?.invoice_number_padding === 'number'
        ? prof.invoice_number_padding
        : DEFAULT_PADDING

    // 2. lock — has a number been drawn from the counter this request would re-seed?
    //
    // [NUMMER-SLOT] This used to be date-only, and said so: "date-based, reliable — no
    // invoice_number string parsing". Reliable it was not. `invoice_date` is the owner's field and
    // the counter is keyed by the clock at allocation, so a back-dated invoice burned a number this
    // check could not see — and the lock opened on a series that had already issued. The number is
    // the only column that records which counter a document came from, so it is now the second
    // witness. Union, never intersection: this can only lock more than before.
    const issuedCount = await countIssuedForCounterYear(supabase, user.id, year, desired.yearlyReset)
    // [LOCK-READ-HONEST] The error is read, and an unreadable count LOCKS.
    //
    // `const { count }` alone made a failed read answer `count: null`, which `?? 0` turned into
    // "this owner has issued nothing" — so the lock opened. That is the fail-OPEN direction on an
    // art. 35 protection: the template and padding of a doorlopende reeks would be rewritten after
    // numbers had already gone out, changing the SHAPE of a sequence mid-year, and the audit row
    // twenty lines below — the one that exists to prove the platform refused exactly this — would
    // never be written either. A database hiccup is not evidence that nobody has invoiced.
    //
    // Locking on an unreadable count is the recoverable direction: an owner who has genuinely
    // issued nothing is asked to try again in a moment. The other direction cannot be undone.
    //
    // countIssuedForCounterYear returns null for exactly that case — either of its two counts
    // failing — so the rule survives the move into the helper rather than being re-derived here.
    if (issuedCount === null) {
      console.error('[LOCK-READ-HONEST] issued-invoice count failed — treating numbering as locked', {
        userId: user.id, year,
      })
      return NextResponse.json(
        {
          ok: false,
          error: 'We konden nu niet nagaan of je al facturen hebt verstuurd. Er is niets gewijzigd ' +
            '— probeer het zo meteen opnieuw.',
          code: 'lock_check_unavailable',
        },
        { status: 503 },
      )
    }
    // `?? 0` is gone with the null case handled above: an unknown count now refuses at the 503
    // rather than reading as zero here, which is the whole of [LOCK-READ-HONEST].
    const locked = issuedCount > 0

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
    //
    // [FACTUUR-B] The forward-only rule lives in seed_invoice_counter, not here, and that is the
    // whole of this change. It used to be `Math.max(startSeq - 1, current)` followed by an
    // unconditional upsert — a maximum taken against a value read a few lines earlier, written as
    // a plain SET. next_invoice_seq is atomic precisely because two invoices can be numbered at
    // the same instant, so it can allocate inside that window; the upsert then wrote a SMALLER
    // last_seq than the counter had, and the next invoice reused a sequence.
    //
    // Article 35 Wet OB 1968 wants sequential numbers. The UNIQUE constraint on
    // (sender_id, invoice_number) turns most duplicates into a retry, but only while BOTH invoices
    // still exist — archive the earlier one and the number is simply reissued, with two different
    // documents having carried it and nothing recording that.
    //
    // GREATEST inside the ON CONFLICT is evaluated under the lock, against the row as it is at
    // write time. And the function returns what LANDED, which is what the owner is now shown:
    // reporting `target + 1` meant that on the one occasion the seed was clamped, the confirmation
    // named a number the next invoice would not carry.
    let effectiveStartSeq: number
    if (!locked && desired.startSeq != null) {
      const pipeline = createPipelineClient() // service_role — counter table denies session writes
      const { data: seeded, error: seedErr } = await pipeline.rpc('seed_invoice_counter', {
        p_user_id: user.id,
        p_year: counterYear,
        p_type: 'factuur',
        p_last_seq: Math.max(0, desired.startSeq - 1),
      })
      if (seedErr || typeof seeded !== 'number') {
        console.error('[FACTUUR-B] counter seed failed', { userId: user.id, counterYear, seedErr })
        return NextResponse.json({ ok: false, error: 'Kon de nummering niet instellen.' }, { status: 500 })
      }
      effectiveStartSeq = seeded + 1
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
  // [ACTING-FOR] Alleen de eigenaar — zie src/lib/owner-only.ts. Een medewerker hier
  // doorlaten zou een tweede nummerreeks onder hetzelfde BTW-nummer openen.
  { const w = await requireOwner('De factuurnummering wijzigen'); if (w.response) return w.response }

  try {
    const supabase = await createServerSupabaseClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Niet ingelogd' }, { status: 401 })

    const year = amsterdamYear() // [NUMMER-JAAR] the owner's year, as in POST

    const { data: prof } = await supabase
      .from('profiles')
      .select('invoice_number_template, invoice_number_padding')
      .eq('id', user.id)
      .single()
    const template = (prof?.invoice_number_template ?? null) as string | null
    // Mirror resolveFormat: the stored padding only applies to a CUSTOM
    // template. The default template always uses DEFAULT_PADDING, regardless of
    // the DB column (whose historical default is 3, not 4) — otherwise the
    // preview shows "2026001" while the real first invoice is "20260001".
    const padding =
      template !== null && typeof prof?.invoice_number_padding === 'number'
        ? prof.invoice_number_padding
        : DEFAULT_PADDING
    const effTemplate = template ?? DEFAULT_TEMPLATE
    const yearlyReset = effTemplate.includes('{year}')
    const counterYear = yearlyReset ? year : 0

    // [NUMMER-SLOT] The same two witnesses POST uses. This card is what tells the owner whether the
    // numbering can still be changed; if it disagreed with POST, an owner would be shown an open
    // form that then refuses with a 409 — or, far worse, an open form that is genuinely open on a
    // series that has already issued.
    const count = await countIssuedForCounterYear(supabase, user.id, year, yearlyReset)
    // An unreadable count reads as LOCKED here too. This handler only DISPLAYS, so it cannot do
    // damage on its own — but showing "you can still change this" on an unknown answer is how an
    // owner is invited into the 409 above, or into believing a lock is not there.
    const locked = count === null || count > 0

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
} //