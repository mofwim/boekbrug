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
// [BTW-ROUND] Per-tarief afronding — nu uit de gedeelde module, zodat het opslaan van een concept
// (/api/invoice/[id] PUT) en het uitgeven hier per definitie hetzelfde bedrag opleveren.
import { computeInvoiceTotals } from '@/lib/invoice-totals'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { gateFairUse, type FairUseGate } from '@/lib/fair-use-gate'
import { logAuditAction, getClientIP } from '@/lib/audit'
import { getActingFor } from '@/lib/acting-for-server'
import { invoiceOwnerId, isActingForOther, canSendInvoice } from '@/lib/acting-for'
import { runBankAutoConfirm } from '@/lib/bank-auto-confirm'
import * as Sentry from '@sentry/nextjs'

// [FACTUUR-A] Storage bucket for generated invoice PDFs.
// TODO(M): verify this bucket name in Supabase Storage before deploy —
// upload is best-effort and never blocks legal delivery, but pdf_url
// storage only works once the name is right.
const PDF_BUCKET = 'documents'

// [SEND-DURATION] This route had no ceiling, and it is the heaviest — and legally the most
// consequential — request in the app: mint the number, commit it, render the PDF (with a retry),
// upload it, send the e-mail, then run a user-wide bank auto-confirm pass.
//
// Past the "POINT OF NO RETURN" below the number is consumed and cannot be given back (Art. 35 —
// no gaps). A function killed after that commit leaves the invoice legally issued while the
// customer received nothing AND no notification is written — the pdf_failed branch that writes
// one never runs. Meanwhile the client's catch rolls the row back to 'draft', so the screen says
// concept about an invoice that legally exists. The ceiling has to be far enough out that the
// window between the commit and the delivery never closes on a timeout.
export const maxDuration = 120

// [FACTUUR-A] Statuses from which an already-issued invoice may be re-delivered
const RESENDABLE_STATUSES = ['sent', 'paid', 'overdue'] as const

export async function POST(request: NextRequest) {
  // [FAIR-USE] Buiten de try, zodat de catch onderaan de reservering kan teruggeven. Blijft
  // null wanneer het misging vóór het hek — dan valt er ook niets terug te geven.
  let gate: FairUseGate | null = null
  try {
    // ── 1. Auth ────────────────────────────────────────────────
    const supabase = await createServerSupabaseClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // [ACTING-FOR] Wie zit hier, en namens wie? Voor een eigenaar is ownerId gelijk aan user.id en
    // verandert er hieronder letterlijk niets. Voor een verkoopmedewerker is ownerId de BAAS —
    // en dat is de enige manier waarop er één nummerreeks per bedrijf blijft bestaan
    // (Art. 35 Wet OB: doorlopend, zonder gaten, en een uitgegeven nummer komt niet terug).
    const acting = await getActingFor()
    if (!acting) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const ownerId = invoiceOwnerId(acting)

    // ── 2. Rate limit — 100 sends/hour per user ────────────────
    // Op de MENS, niet op het bedrijf: dit hek gaat over snelheid, en twee mensen die allebei
    // netjes werken horen elkaar niet te blokkeren.
    const limit = await checkRateLimit({
      userId: acting.actorId,
      endpoint: '/api/invoice/send',
      ...RATE_LIMITS.INVOICE_SEND,
    })
    if (!limit.allowed) return rateLimitResponse(limit)

    // [FAIR-USE] Het tweede hek (de gepubliceerde maandgrens op verstuurde facturen) stond
    // hiér, meteen na het snelheidshek — en dat was te vroeg. gateFairUse VERBRUIKT direct, en
    // daarna volgen zestien uitgangen die niets versturen: een ontbrekend klantadres, een
    // ontbrekend BTW-nummer van de ondernemer zelf, een verlopen concept, het verloren
    // race-409. Alleen de catch gaf terug, dus elk van die weigeringen kostte de gebruiker een
    // factuur van zijn maandtegoed voor een factuur die nooit de deur uit ging. Wie zijn
    // KvK-nummer nog niet had ingevuld en vijf keer op Versturen drukte, was vijf facturen
    // kwijt aan nul verzendingen — terwijl /eerlijk-gebruik §3 het omgekeerde belooft.
    //
    // Het hek staat nu waar het over gaat: vlak vóór het uitgeven van het nummer (stap 8), na
    // alle validatie. Daarmee telt precies één ding mee — een factuur die echt wordt uitgegeven.
    // Een HERVERZENDING passeert het niet eens: die geeft geen nummer uit en levert alleen de
    // al-getelde factuur opnieuw af, dus het herstelpad na onze eigen pdf_failed/email_failed
    // ("verstuur opnieuw") kost de gebruiker niets meer.

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
      .eq('sender_id', ownerId)
      .single()

    if (invoiceError || !invoiceData) {
      return NextResponse.json({ error: 'Factuur niet gevonden' }, { status: 404 })
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const invoice = invoiceData as any

    // [ACTING-FOR] Twee sloten op dezelfde deur, met opzet.
    // Het eerste is RLS: de policy invoices_member_read laat een medewerker alleen rijen zien
    // met created_by = auth.uid(), dus de query hierboven geeft hem de factuur van zijn baas
    // niet eens terug. Het tweede is deze regel, die hetzelfde nog eens in de code toetst.
    // Dubbel? Ja. Maar dit is het moment waarop een geraden invoiceId binnenkomt, en de
    // gevolgen van hier doorlopen zijn onomkeerbaar: een nummer uitgeven, een PDF versturen
    // naar de klant van iemand anders. Voor die prijs is één extra if goedkoop.
    if (!canSendInvoice(acting, invoice)) {
      return NextResponse.json({ error: 'Factuur niet gevonden' }, { status: 404 })
    }

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
    // [TRUST-NUMBER] A conversion keeps the row's own status (see step 9), and the branch above
    // skips the draft check for convertOnly — so a DRAFT pro forma would come out of here with a
    // number from the doorlopende reeks while still sitting in the one status the owner may edit
    // and delete. Deleting it puts a permanent hole in the sequence, which is precisely what the
    // "POINT OF NO RETURN" further down exists to prevent. Converting is for a document that has
    // already gone out; a draft is simply sent.
    if (convertOnly && invoice.status === 'draft') {
      return NextResponse.json(
        { error: 'Een concept wordt verstuurd, niet omgezet — verstuur het eerst.' },
        { status: 409 }
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

    // ── 6b. [TRUST-TOTALS] Recompute the legal totals SERVER-SIDE from the lines ─
    // The browser-supplied totals are never trusted on the record that gets a legal
    // number and is e-mailed. The create path stored raw floats; only the edit PUT
    // rounded — so the stored total depended on whether the draft was touched. We
    // recompute here for issuance and conversion, through the SAME shared module the edit
    // route uses (lib/invoice-totals). A resend delivers the already-issued PDF, untouched.
    const { data: lines } = await supabase
      .from('invoice_lines')
      .select('*')
      .eq('invoice_id', invoiceId)
    let computedTotals: { total_ex_btw: number; btw_amount: number; total_inc_btw: number } | null = null
    if (!resend && Array.isArray(lines) && lines.length > 0) {
      // [BTW-ROUND] Round BTW PER TARIEF, then sum — the Belastingdienst/Peppol method the legal
      // PDF (btwBreakdown → round2 per rate) AND the UBL export use. The logic now lives in
      // lib/invoice-totals.ts, shared with the edit route, so the concept the owner saved and the
      // invoice we issue can never differ by the cent they used to differ by.
      computedTotals = computeInvoiceTotals(lines)
    }
    // The authoritative total for the e-mail + accountant notification below.
    const finalTotalInc = computedTotals?.total_inc_btw ?? invoice.total_inc_btw

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

      // [FACTUUR-A] Art. 35a sub e — the DATE OF ISSUE is a mandatory invoice element. Without this
      // an undated factuur could be issued (number minted + e-mailed), which is legally invalid AND
      // date-driven downstream (a dateless invoice is dropped from the quarter's date-range → invisible
      // in /result and /aangifte). Enforce a real ISO date BEFORE minting the number so the check never
      // burns a sequence number. (The UI already requires it; this is the server backstop.)
      if (!invoice.invoice_date || !/^\d{4}-\d{2}-\d{2}/.test(String(invoice.invoice_date))) {
        return NextResponse.json(
          { error: 'Factuurdatum ontbreekt — verplicht op een factuur (Art. 35a Wet OB 1968)' },
          { status: 400 }
        )
      }

      // [SEC-SELLER] Art. 35a sub a/b — the SELLER's own name/address, BTW-id and
      // KvK are mandatory on a legal invoice. They were never enforced, so an
      // invoice could be issued (number consumed, e-mailed) with these printed as
      // "—" on the PDF. Enforce BEFORE minting the number so a failed check never
      // burns a sequence number. IBAN stays optional (payment info, not a validity
      // requirement). Reviewed values live on the seller's profile.
      // [ACTING-FOR] Het profiel van de VERKOPER — dat is de eigenaar, ook als een medewerker op de
      // knop drukt: zijn naam, adres, BTW-id en KvK staan op de factuur. Voor een medewerker is
      // die profielrij via RLS onleesbaar, dus dan langs service_role. Zou dat niet gebeuren,
      // dan kwam deze controle terug met "geen profiel" en zou de factuur worden geweigerd met
      // een melding over ontbrekende bedrijfsgegevens die wél gewoon ingevuld zijn.
      const { data: sellerProfile } = await (isActingForOther(acting) ? createPipelineClient() : supabase)
        .from('profiles')
        .select('btw_number, kvk_number, address, company_name, full_name')
        .eq('id', ownerId)
        .single()
      const missingSeller: string[] = []
      if (!sellerProfile?.btw_number || !String(sellerProfile.btw_number).trim()) missingSeller.push('BTW-nummer')
      if (!sellerProfile?.kvk_number || !String(sellerProfile.kvk_number).trim()) missingSeller.push('KvK-nummer')
      if (!sellerProfile?.address || !String(sellerProfile.address).trim()) missingSeller.push('adres')
      if (!sellerProfile?.company_name?.trim() && !sellerProfile?.full_name?.trim()) missingSeller.push('bedrijfsnaam')
      if (missingSeller.length > 0) {
        return NextResponse.json(
          {
            error: `Vul eerst je ${missingSeller.join(', ')} in bij Instellingen — wettelijk verplicht op een factuur (Art. 35a Wet OB 1968).`,
            missing_seller_fields: missingSeller,
          },
          { status: 400 }
        )
      }
    }

    // ── 8. Generate number — skipped entirely for resend ───────
    // [FAIR-USE] Het maandhek, hier: alles is gevalideerd, en de eerstvolgende stap geeft een
    // nummer uit dat niet meer teruggegeven kan worden. Faalt open. Een weigering pauzeert
    // ALLEEN het versturen — opstellen, opslaan en als PDF downloaden blijven werken, precies
    // zoals de onExceed-zin in fair-use.ts zegt.
    //
    // [ACTING-FOR] Op het BEDRIJF, niet op de mens: anders zou elke extra verkoopmedewerker een
    // tweede gratis maandtegoed zijn. De planlezing gaat dan langs service_role — het profiel
    // van de eigenaar is voor de sessie van een medewerker onleesbaar, en een mislukte
    // plandetectie zou het bedrijf stilzwijgend op het gratis plan zetten.
    if (!resend) {
      gate = await gateFairUse({
        client: isActingForOther(acting) ? createPipelineClient() : supabase,
        userId: ownerId,
        metric: "invoicesSent",
      })
      if (!gate.allowed) return gate.response!
    }

    // Always for conversion, only if missing for regular drafts
    let finalNumber: string = invoice.invoice_number ?? ''
    if (!resend && (isConversion || !finalNumber)) {
      const numberType: InvoiceNumberType =
        finalType === 'creditnota' ? 'creditnota' : 'factuur'

      // [ACTING-FOR] ownerId, en met de SESSIE-client — allebei noodzakelijk.
      // ownerId: één doorlopende reeks per bedrijf (Art. 35). Sessie-client: next_invoice_seq()
      // weigert onvoorwaardelijk zodra auth.uid() NULL is, dus service_role kan hier niet in de
      // plaats treden. De wacht in die functie is verbreed met precies één uitzondering — een
      // actieve verkoopkoppeling — en verder niets. Zie company_members_sales_role.sql.
      const generated = await generateInvoiceNumber(supabase, ownerId, numberType)
      if (!generated) {
        // No number, so nothing was issued — give the month's credit back.
        await gate?.release()
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
      // [TRUST-NUMBER] COMPARE-AND-SWAP. The status check in step 5 read a fetched
      // row; two concurrent sends (or a double-click that races the first commit)
      // both passed it and both minted a number under an id-only UPDATE, so one
      // number was orphaned as a permanent gap AND the invoice was e-mailed twice.
      // We now guard the UPDATE on the ORIGINAL state (draft for a send, pro_forma/
      // offerte for a conversion) and require exactly one affected row. The loser of
      // the race writes nothing and does NOT deliver — it gets a clean 409.
      let updateQ = supabase
        .from('invoices')

        .update({
          ...(convertOnly ? {} : { status: 'sent' as const }),
          invoice_number: finalNumber,
          invoice_type: finalType as 'factuur' | 'creditnota' | 'pro_forma' | 'offerte',
          ...(computedTotals ?? {}),
          updated_at: new Date().toISOString(),
        })
        .eq('id', invoiceId)
        // [ACTING-FOR] De eigenaar, niet de mens die op de knop drukte.
        .eq('sender_id', ownerId)
      updateQ = convertOnly
        // [TRUST-NUMBER] The type guard alone let a row that became a draft between the read and
        // this write still take a number. The status is re-asserted here for the same reason the
        // send path guards on 'draft': the check in step 5 read a fetched row.
        ? updateQ.in('invoice_type', ['pro_forma', 'offerte']).neq('status', 'draft')
        : updateQ.eq('status', 'draft')
      const { data: updatedRows, error: updateError } = await updateQ.select('id')

      if (updateError) {
        // The commit failed, so no number was consumed and nothing was issued.
        await gate?.release()
        console.error('[FACTUUR-A] Invoice update failed', { invoiceId, updateError })
        Sentry.captureException(updateError, {
          tags: { feature: 'invoice-send', severity: 'high' },
          extra: { invoiceId, finalNumber, userId: user.id },
        })
        return NextResponse.json({ error: 'Server fout' }, { status: 500 })
      }
      if (!updatedRows || updatedRows.length === 0) {
        // Lost the compare-and-swap: already sent/converted by a concurrent request.
        // The number we minted is now unused — log it so the rare gap is VISIBLE,
        // never silent — and refuse to double-deliver.
        // We lost the race and delivered nothing; the winner counted its own send.
        await gate?.release()
        console.warn('[TRUST-NUMBER] Send race lost — minted number unused (gap)', { invoiceId, finalNumber })
        Sentry.captureMessage('invoice-send race: minted number unused (sequence gap)', {
          level: 'warning',
          tags: { feature: 'invoice-send' },
          extra: { invoiceId, finalNumber, userId: user.id },
        })
        return NextResponse.json({ error: 'Deze factuur is al verzonden.' }, { status: 409 })
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
    // [ACTING-FOR] Het profiel van de VERKOPER staat op de PDF — dat is de eigenaar. Voor een
    // medewerker is die rij via RLS onleesbaar, dus dan langs service_role; anders zou de
    // factuur uitgaan met 'Onbekend' als bedrijfsnaam.
    const { data: profile } = await (isActingForOther(acting) ? createPipelineClient() : supabase)
      .from('profiles')
      .select('*')
      .eq('id', ownerId)
      .single()

    const zzperName = profile?.company_name || profile?.full_name || 'Onbekend'

    // ── 12. [FACTUUR-A] Render the legal PDF — AFTER number commit ─
    // The PDF must carry the final number + the server-recomputed totals (lines
    // were fetched in step 6b). It can only be rendered now.
    // [SEND-PDF-RETRY] Render is the delivery gate. A transient font/asset hiccup used to leave the
    // invoice 'sent' (verstuurd) with NO PDF, NO email, NO signal — the customer got nothing and the
    // owner had no idea. Retry once (catches the common transient), and on persistent failure make
    // the failure LOUD (an owner notification) instead of a silent false 'verstuurd'.
    let pdfBuffer: Buffer | null = null
    for (let attempt = 0; attempt < 2 && !pdfBuffer; attempt++) {
      try {
        pdfBuffer = await renderInvoicePdf(
          {
            ...invoice,
            ...(computedTotals ?? {}),
            invoice_number: finalNumber,
            invoice_type: finalType,
            status: resend || convertOnly ? invoice.status : 'sent',
          },
          lines ?? [],
          profile ?? {}
        )
      } catch (pdfErr) {
        console.error('[FACTUUR-A] PDF render failed', { invoiceId, finalNumber, attempt, error: pdfErr })
        if (attempt === 1) {
          Sentry.captureException(pdfErr, {
            tags: { feature: 'invoice-send', severity: 'high' },
            extra: { invoiceId, finalNumber, userId: user.id },
          })
        }
      }
    }

    if (!pdfBuffer) {
      if (resend) {
        // Pure delivery attempt — nothing was committed, a clean error is honest
        return NextResponse.json({ error: 'PDF genereren mislukt — probeer opnieuw' }, { status: 500 })
      }
      // Number is consumed (Art. 35 — no rollback). The invoice IS legally issued, but it was NOT
      // delivered. Do NOT let the owner believe it went out: write an owner notification so the
      // "verstuurd" state is corrected by an explicit "opnieuw versturen" prompt (recoverable via
      // resend once the cause is fixed). Service-role insert (notifications has no authed INSERT).
      try {
        const notifPipeline = createPipelineClient()
        // [ACTING-FOR] Naar de eigenaar ÉN naar wie hem verstuurde, als dat twee mensen zijn.
        //
        // Alleen de eigenaar waarschuwen is hier niet goed genoeg: het nummer is verbruikt, de
        // klant heeft niets, en de enige die dat weet is degene die net op 'versturen' drukte —
        // die anders zijn scherm sluit in de overtuiging dat het gelukt is. En alleen de
        // medewerker waarschuwen evenmin: het is de factuur van de eigenaar, met zijn nummer.
        const ontvangers = Array.from(new Set([ownerId, acting.actorId]))
        await notifPipeline.from('notifications').insert(
          ontvangers.map((uid) => ({
            user_id: uid,
            title: 'Factuur niet verzonden',
            body: `Factuur ${finalNumber} kreeg een nummer maar de PDF kon niet worden gemaakt — de klant heeft niets ontvangen. Verstuur ${finalNumber} opnieuw.`,
            type: 'invoice',
            read: false,
            link: uid === ownerId ? '/dashboard/facturen' : '/dashboard/verkoop',
          })),
        )
      } catch { /* non-blocking — the warning field below is the primary signal */ }
      return NextResponse.json({
        success: true,
        invoice_number: finalNumber,
        invoice_type: finalType,
        converted: isConversion,
        delivered: false,
        warning: 'pdf_failed',
      })
    }

    // ── 13. [FACTUUR-A] Store PDF in Storage — best-effort ─────
    // pdf_url stores the RAW path (house rule: signed on read).
    // Never blocks delivery; failure → Sentry breadcrumb only.
    try {
      // [ACTING-FOR] Onder de map van de EIGENAAR — daar staan al zijn facturen, en de
      // storage-policies zijn per gebruikersmap geschreven.
      const pdfPath = `${ownerId}/facturen/${finalNumber}.pdf`
      // [PDF-IMMUTABLE] upsert:false, and that is not a downgrade — it is what this write can
      // actually do, and what it should do.
      //
      // RLS staat aan op storage.objects (gemeten) en er zijn precies drie policies:
      // documents_upload (INSERT), documents_read (SELECT), documents_delete (DELETE). Er is GEEN
      // UPDATE-policy. Een upsert op een pad dat al bestaat is een UPDATE, dus die kon nooit
      // slagen — bij elke HERVERZENDING van dezelfde factuur liep deze regel tegen een weigering
      // aan, die de best-effort-catch eromheen stil opat.
      //
      // Het herstel is niet een vierde policy maar de erkenning dat overschrijven hier verkeerd
      // zou zijn: een verstuurde factuur ligt vast ([ISSUED-STAYS]), dus de PDF die onder dit
      // nummer staat hoort nooit te veranderen. Bestaat het object al, dan is dat de JUISTE
      // eindtoestand en niet een mislukking — pdf_url wijst er al naar sinds de eerste verzending.
      const { error: uploadError } = await supabase.storage
        .from(PDF_BUCKET)
        .upload(pdfPath, pdfBuffer, { contentType: 'application/pdf', upsert: false })

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
        totalInc: finalTotalInc,
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
      // [SEND-EMAIL-DURABLE] A notification, not only the `warning` in the response below.
      //
      // The screens DO handle warning==='email_failed' (facturen, invoice/new, the recovery
      // banner on the detail page), so an owner who is looking at their screen is told. But that
      // signal lives exactly as long as the response does. Close the tab, lose signal on a phone
      // after the server already committed, walk away while it sends — and it is gone, with
      // nothing left behind.
      //
      // And this state is worse than the PDF failure right above, which DOES leave a
      // notification: there the PDF is missing, so the closing package eventually reports it.
      // Here everything looks perfect. The number is consumed, the status says 'sent', the PDF
      // is stored, the BTW is declared on it — and the customer received nothing. The owner will
      // not chase a payment for an invoice their own screen calls sent.
      //
      // Same recipients and the same reasoning as the PDF path: the owner owns the invoice, and
      // whoever pressed send is the only one who knows it happened at all.
      try {
        const mailNotifPipeline = createPipelineClient()
        const mailOntvangers = Array.from(new Set([ownerId, acting.actorId]))
        await mailNotifPipeline.from('notifications').insert(
          mailOntvangers.map((uid) => ({
            user_id: uid,
            title: 'Factuur niet aangekomen',
            body: `Factuur ${finalNumber} is genummerd en opgeslagen, maar de e-mail naar de klant is niet verstuurd — de klant heeft niets ontvangen. Verstuur ${finalNumber} opnieuw.`,
            type: 'invoice',
            read: false,
            link: uid === ownerId ? '/dashboard/facturen' : '/dashboard/verkoop',
          })),
        )
      } catch { /* non-blocking — the warning in the response stays the primary signal */ }
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
          .eq('zzper_id', ownerId)
          .maybeSingle()

        if (accountantLink?.accountant_id) {
          const { error: notifError } = await pipelineClient
            .from('notifications')
            .insert({
              user_id: accountantLink.accountant_id,
              title: 'Nieuwe factuur verzonden',
              // [FACTUUR-A] Dutch comma in the notification too — one rule everywhere
              body: `${zzperName} heeft factuur ${finalNumber} verzonden — € ${Number(finalTotalInc).toLocaleString('nl-NL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
              type: 'invoice',
              read: false,
              link: `/dashboard/clients/${ownerId}`,
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

    // ── 15b. Close the circle from the SEND side ──────────────
    // [BANK-CIRCLE-SEND] A sales invoice that just became 'sent' may match a payment ALREADY sitting
    // in the bank — the statement was imported before this invoice existed, so it lingered as an
    // "ontvangen betaling zonder factuur" that only the incoming-bank flow (not invoice creation) ever
    // re-checked. Re-run the SAME safe auto-confirm now so the payment gets linked at issuance time.
    // Books only isSafeAutoConfirm matches, idempotent, one-tap reversible. Best-effort — a failure
    // here must never break a legally-sent invoice, and the cron/import paths remain the backstop.
    // First issuance only: a resend re-delivers an already-'sent' invoice (this pass already ran on
    // its original send, and a later-arriving payment is caught by the incoming-bank flow + cron), so
    // skip the full user-wide scan on the latency-sensitive resend path.
    if (!resend) {
      try {
        // [ACTING-FOR] Op het bedrijf. Handelt er een medewerker, dan is de sessie-client
        // waardeloos voor de bankregels van de eigenaar (RLS) — dan gaat de betaalschrijving
        // langs service_role, precies zoals de cron en de import dat doen. bank-auto-confirm
        // beschrijft die modus zelf: dan is de isEligible-controle de gezaghebbende wacht.
        const pipelineForConfirm = createPipelineClient()
        await runBankAutoConfirm({
          payClient: isActingForOther(acting) ? pipelineForConfirm : supabase,
          pipeline: pipelineForConfirm,
          userId: ownerId,
        })
      } catch (autoErr) {
        console.error('[BANK-CIRCLE-SEND] post-send auto-confirm failed (non-fatal)', { invoiceId, autoErr })
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
    // [FAIR-USE] Klapte het versturen alsnog, dan is er niets verstuurd en telt het niet.
    // `gate` kan hier nog ongedefinieerd zijn als het misging vóór het hek; vandaar de
    // voorzichtige aanroep.
    try { await gate?.release() } catch { /* teruggeven mag nooit de foutafhandeling breken */ }

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