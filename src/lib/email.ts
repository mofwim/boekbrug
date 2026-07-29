// src/lib/email.ts
// كل functions الإيميل في مكان واحد — Resend

import { Resend } from 'resend'
import * as Sentry from '@sentry/nextjs'
// [FACTUUR-A] Single Dutch formatting source — June 2026
import { formatDateNL, formatEuroNL } from './format-nl'

// [BUILD-SAFE] Construct the Resend client LAZILY, on first send — not at module
// import. The constructor throws when RESEND_API_KEY is absent, and Next.js's build
// step imports every route module to collect page data (with no runtime env), so a
// top-level `new Resend()` failed the whole production build / Vercel deploy over a
// key that's only needed at REQUEST time. The env var is present when a handler runs.
let _resend: Resend | null = null
function getResend(): Resend {
  if (!_resend) _resend = new Resend(process.env.RESEND_API_KEY)
  return _resend
}

// [TRUST-DELIVERY] Resend does NOT throw on an API rejection — it resolves with { error }. A sender
// that ignores it tells the app "verstuurd" while nothing was delivered (a silent dead-end). Every
// sender routes its result here:
//   - critical mail (accountant invite / draft-queue to the accountant / GDPR export summary) THROWS
//     so the caller surfaces a real failure instead of a false success;
//   - best-effort notifications are logged AND captured in Sentry (never lost) but never break the
//     main action they accompany.
//
// [TRUST-DELIVERY-RETURN] Het resultaat wordt nu ook TERUGGEGEVEN: true = afgeleverd,
// false = door Resend geweigerd (alleen bij critical:false — critical gooit nog steeds).
// Additief: de bestaande aanroepers die de waarde negeren gedragen zich exact als voorheen.
//
// Waarom dat nodig was: een logregel plus een Sentry-melding vertellen ONS dat een mail
// mislukte, maar de aanroeper niet — en die schreef intussen door alsof het gelukt was. Bij de
// herinneringen-cron betekende dat: de rij werd 'sent', de tier was permanent verbruikt, en de
// ondernemer kreeg de melding "Herinnering verstuurd" voor een mail die nooit vertrok. Zijn
// klant werd daarna nooit meer aangemaand, en niemand kon dat weten.
async function deliverEmail(
  result: { error: unknown } | null | undefined,
  opts: { label: string; critical: boolean },
): Promise<boolean> {
  const err = result?.error
  if (!err) return true
  console.error(`[TRUST-DELIVERY] ${opts.label} e-mail mislukt`, err)
  if (opts.critical) {
    throw new Error(`E-mail versturen mislukt (${opts.label})`)
  }
  Sentry.captureException(
    err instanceof Error ? err : new Error(`${opts.label} e-mail mislukt`),
    { extra: { label: opts.label } },
  )
  return false
}

// [M2] Escape any user-controlled string interpolated into an HTML email body. Client
// names, invoice numbers, message text and accountant names all reach third parties
// (customers, accountants), so a name like <b>… or an injected link must render as
// literal text, never as markup. Scripts are already stripped by mail clients (no XSS),
// but this closes phishing/spoofing/hidden-text injection. Subjects are plain-text
// headers and are deliberately NOT passed through this.
function escapeHtml(s: string): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

// ── إيميل دعوة المحاسب ────────────────────────────────────────────────────────
export async function sendAccountantInvite({
  toEmail,
  zzperName,
  acceptUrl
}: {
  toEmail: string
  zzperName: string
  acceptUrl: string
}) {
  const __sendResult = await getResend().emails.send({
    from: 'BoekBrug <noreply@boekbrug.nl>',
    to: toEmail,
    subject: `${zzperName} wil je toevoegen als boekhouder`,
    html: `
      <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto; padding: 32px;">
        <h2 style="color: #202124;">Je bent uitgenodigd</h2>
        <p style="color: #555;">${escapeHtml(zzperName)} wil je toevoegen als boekhouder via BoekBrug.</p>
        <p style="color: #555;">Als je accepteert, zie je automatisch alle facturen van ${escapeHtml(zzperName)} in jouw dashboard.</p>
        <a href="${acceptUrl}"
           style="display:inline-block; background:#1a73e8; color:#fff; padding:12px 24px; border-radius:10px; text-decoration:none; font-weight:600; margin-top:16px;">
          Uitnodiging accepteren
        </a>
        <p style="color: #aaa; font-size: 12px; margin-top: 32px;">BoekBrug — De brug tussen jou en je boekhouder</p>
      </div>
    `
  })
  await deliverEmail(__sendResult, { label: 'accountant-invite', critical: true })
}

// ── إيميل دعوة العميل من قبل المحاسب ─────────────────────────────────────────
export async function sendClientInvite({
  toEmail,
  clientName,
  accountantName,
  acceptUrl
}: {
  toEmail: string
  clientName: string
  accountantName: string
  acceptUrl: string
}) {
  // [TRUST-DELIVERY] Capture Resend's { error } — it does NOT throw on an API
  // rejection — and throw so the caller (invite route) rolls back the pending row
  // and returns a retryable error instead of a silent dead-end.
  const { error: sendError } = await getResend().emails.send({
    from: 'BoekBrug <noreply@boekbrug.nl>',
    to: toEmail,
    subject: `${accountantName} nodigt je uit op BoekBrug`,
    html: `
      <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto; padding: 32px;">
        <h2 style="color: #202124;">Je bent uitgenodigd</h2>
        <p style="color: #555;">Je boekhouder <strong>${escapeHtml(accountantName)}</strong> nodigt je uit om BoekBrug te gebruiken.</p>
        <p style="color: #555;">Via BoekBrug kun je eenvoudig facturen delen met je boekhouder — geen WhatsApp meer, geen e-mail zoeken.</p>
        <a href="${acceptUrl}"
           style="display:inline-block; background:#1a73e8; color:#fff; padding:12px 24px; border-radius:10px; text-decoration:none; font-weight:600; margin-top:16px;">
          Uitnodiging accepteren
        </a>
        <p style="color: #aaa; font-size: 12px; margin-top: 32px;">BoekBrug — De brug tussen jou en je boekhouder</p>
      </div>
    `
  })
  if (sendError) {
    throw new Error(`Resend afgewezen: ${sendError.message ?? 'onbekende fout'}`)
  }
}

// ── إيميل للعميل عند استلام فاتورة ───────────────────────────────────────────
// [FACTUUR-A] Rebuilt — June 2026:
//   * PDF attached (Resend attachments) — the e-mail now carries the actual
//     legal invoice, not a bare notification. Critical defect #1 closed.
//   * Amount via formatEuroNL ("€ 243,21" — not "€243.21").
//   * Dates via formatDateNL ("12-07-2026" — not "2026-07-12").
//   * Optional invoiceDate row + creditnota wording support.
//   * Body text + marketing footer preserved (good assets).
export async function sendInvoiceToClient({
  toEmail,
  clientName,
  zzperName,
  invoiceNumber,
  totalInc,
  dueDate,
  invoiceDate,
  pdfBuffer,
  isCreditnota = false
}: {
  toEmail: string
  clientName: string
  zzperName: string
  invoiceNumber: string
  totalInc: number
  dueDate: string
  /** ISO date — shown as Factuurdatum when provided */
  invoiceDate?: string
  /** Rendered invoice PDF — attached when provided */
  pdfBuffer?: Buffer
  /** Creditnota wording (subject + heading) */
  isCreditnota?: boolean
}) {
  const docLabel = isCreditnota ? 'Creditnota' : 'Factuur'
  const numberLabel = isCreditnota ? 'Creditnotanummer' : 'Factuurnummer'

  const invoiceDateRow = invoiceDate
    ? `<p style="margin:4px 0; color:#202124;"><strong>${isCreditnota ? 'Datum' : 'Factuurdatum'}:</strong> ${formatDateNL(invoiceDate)}</p>`
    : ''
  const dueDateRow = isCreditnota
    ? ''
    : `<p style="margin:4px 0; color:#202124;"><strong>Vervaldatum:</strong> ${formatDateNL(dueDate)}</p>`

  const attachmentLine = pdfBuffer
    ? `<p style="color: #555;">De volledige ${docLabel.toLowerCase()} is bijgevoegd als PDF.</p>`
    : ''

  // [TRUST-DELIVERY] Resend's SDK resolves to { data, error } and does NOT throw on
  // an API-level rejection (invalid recipient, unverified domain, rate-limit,
  // validation). Ignoring the return let a rejected send look delivered, so the
  // invoice showed "verstuurd" while the customer received nothing. Capture the
  // result and THROW on error so the caller's catch marks it email_failed.
  const { error: sendError } = await getResend().emails.send({
    from: 'BoekBrug <noreply@boekbrug.nl>',
    to: toEmail,
    subject: `${docLabel} ${invoiceNumber} van ${zzperName}`,
    html: `
      <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto; padding: 32px;">
        <h2 style="color: #202124;">${isCreditnota ? 'Creditnota ontvangen' : 'Nieuwe factuur ontvangen'}</h2>
        <p style="color: #555;">Beste ${escapeHtml(clientName)},</p>
        <p style="color: #555;">Je hebt een ${docLabel.toLowerCase()} ontvangen van <strong>${escapeHtml(zzperName)}</strong>.</p>
        <div style="background:#f8f9fa; border-radius:12px; padding:16px; margin:20px 0;">
          <p style="margin:4px 0; color:#202124;"><strong>${numberLabel}:</strong> ${escapeHtml(invoiceNumber)}</p>
          <p style="margin:4px 0; color:#202124;"><strong>Bedrag:</strong> ${formatEuroNL(totalInc)}</p>
          ${invoiceDateRow}
          ${dueDateRow}
        </div>
        ${attachmentLine}
        <p style="color: #aaa; font-size: 12px; margin-top: 32px;">BoekBrug — De brug tussen jou en je boekhouder</p>
      </div>
    `,
    // [FACTUUR-A] Attach the legal PDF — only when rendering succeeded.
    // No attachments key at all when absent (cleaner than empty array).
    ...(pdfBuffer
      ? {
          attachments: [
            {
              filename: `${invoiceNumber}.pdf`,
              content: pdfBuffer,
            },
          ],
        }
      : {})
  })
  if (sendError) {
    // Surface the real reason; the caller treats any throw here as email_failed.
    throw new Error(`Resend afgewezen: ${sendError.message ?? 'onbekende fout'}`)
  }
}

// ── BOEK-007: إيميل إشعار رسالة جديدة ────────────────────────────────────────
export async function sendMessageNotification({
  toEmail,
  receiverName,
  senderName,
  messagePreview,
  conversationUrl
}: {
  toEmail: string
  receiverName: string
  senderName: string
  messagePreview: string
  conversationUrl: string
}) {
  const __sendResult = await getResend().emails.send({
    from: 'BoekBrug <noreply@boekbrug.nl>',
    to: toEmail,
    subject: `Nieuw bericht van ${senderName}`,
    html: `
      <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto; padding: 32px;">
        <h2 style="color: #202124;">Nieuw bericht</h2>
        <p style="color: #555;">Beste ${escapeHtml(receiverName)},</p>
        <p style="color: #555;"><strong>${escapeHtml(senderName)}</strong> heeft je een bericht gestuurd via BoekBrug.</p>
        <div style="background:#f8f9fa; border-radius:12px; padding:16px; margin:20px 0; border-left: 3px solid #1a73e8;">
          <p style="margin:0; color:#202124; font-style: italic;">"${escapeHtml(messagePreview)}"</p>
        </div>
        <a href="${conversationUrl}"
           style="display:inline-block; background:#1a73e8; color:#fff; padding:12px 24px; border-radius:10px; text-decoration:none; font-weight:600; margin-top:8px;">
          Bericht bekijken
        </a>
        <p style="color: #aaa; font-size: 12px; margin-top: 32px;">BoekBrug — De brug tussen jou en je boekhouder</p>
      </div>
    `
  })
  await deliverEmail(__sendResult, { label: 'message-notification', critical: false })
}
// ── إشعار المحاسب بإنهاء الربط من قبل العميل ──────────────────────────────────
export async function sendAccountantUnlinkedNotification({
  toEmail,
  accountantName,
  clientName
}: {
  toEmail: string
  accountantName: string
  clientName: string
}) {
  const __sendResult = await getResend().emails.send({
    from: 'BoekBrug <noreply@boekbrug.nl>',
    to: toEmail,
    subject: `${clientName} heeft de koppeling beëindigd`,
    html: `
      <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto; padding: 32px;">
        <h2 style="color: #202124;">Koppeling beëindigd</h2>
        <p style="color: #555;">Beste ${escapeHtml(accountantName)},</p>
        <p style="color: #555;"><strong>${escapeHtml(clientName)}</strong> heeft de koppeling met jou als boekhouder beëindigd via BoekBrug.</p>
        <p style="color: #555;">Je hebt geen toegang meer tot nieuwe facturen of documenten van deze klant. Historische gegevens waar je eerder aan hebt gewerkt, blijven beschikbaar voor je administratie.</p>
        <p style="color: #aaa; font-size: 12px; margin-top: 32px;">BoekBrug — De brug tussen jou en je boekhouder</p>
      </div>
    `
  })
  await deliverEmail(__sendResult, { label: 'accountant-unlinked', critical: false })
}

// ── إشعار العميل بإنهاء الربط من قبل المحاسب ──────────────────────────────────
export async function sendClientUnlinkedNotification({
  toEmail,
  clientName,
  accountantName
}: {
  toEmail: string
  clientName: string
  accountantName: string
}) {
  const __sendResult = await getResend().emails.send({
    from: 'BoekBrug <noreply@boekbrug.nl>',
    to: toEmail,
    subject: `${accountantName} heeft de koppeling beëindigd`,
    html: `
      <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto; padding: 32px;">
        <h2 style="color: #202124;">Koppeling beëindigd</h2>
        <p style="color: #555;">Beste ${escapeHtml(clientName)},</p>
        <p style="color: #555;">Je boekhouder <strong>${escapeHtml(accountantName)}</strong> heeft de koppeling met jou beëindigd via BoekBrug.</p>
        <p style="color: #555;">Je facturen en documenten blijven volledig van jou en blijven beschikbaar in je account. Je kunt op elk moment een nieuwe boekhouder uitnodigen via je instellingen.</p>
        <p style="color: #aaa; font-size: 12px; margin-top: 32px;">BoekBrug — De brug tussen jou en je boekhouder</p>
      </div>
    `
  })
  await deliverEmail(__sendResult, { label: 'client-unlinked', critical: false })
}
// ─────────────────────────────────────────────────────────────────────────────
// [BOEK-030] APPEND THIS FUNCTION to src/lib/email.ts (end of file).
// Do NOT rewrite the rest of the file — this is a surgical, tagged addition,
// pre-approved by Tech Lead. email.ts is the single home for all Resend sends,
// so the Draft Queue letter is sent from here (no second Resend client).
//
// House style matches the existing templates in this file (#1a73e8 brand, same
// footer) — emails are brand-level, not the Workspace dashboard palette.
// The AI/edited body is plain text with \n line breaks; we HTML-escape it and
// convert newlines to <br> so arbitrary content can't break the markup.
// ─────────────────────────────────────────────────────────────────────────────

export async function sendDraftQueueEmail({
  toEmail,
  clientName,
  accountantName,
  subject,
  body
}: {
  toEmail: string
  clientName: string
  accountantName: string
  subject: string
  body: string
}) {
  const safeBody = escapeHtml(body).replace(/\r?\n/g, '<br>')

  const __sendResult = await getResend().emails.send({
    from: 'BoekBrug <noreply@boekbrug.nl>',
    to: toEmail,
    subject,
    html: `
      <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto; padding: 32px;">
        <h2 style="color: #202124;">Bericht van je boekhouder</h2>
        <div style="background:#f8f9fa; border-radius:12px; padding:16px; margin:20px 0; color:#202124; line-height:1.5;">
          ${safeBody}
        </div>
        <p style="color: #aaa; font-size: 12px; margin-top: 32px;">
          ${escapeHtml(accountantName)} · via BoekBrug — De brug tussen jou en je boekhouder
        </p>
      </div>
    `
  })
  await deliverEmail(__sendResult, { label: 'draft-queue', critical: true })

  // clientName is intentionally available for future personalization / subject use.
  void clientName
}
// ─────────────────────────────────────────────────────────────────────────────
// [BOEK-032] APPEND THIS FUNCTION to src/lib/email.ts (end of file).
// Do NOT rewrite the rest of the file — surgical, tagged addition, pre-approved
// by Tech Lead. email.ts is the single home for all Resend sends.
//
// House style matches the existing templates (#1a73e8 brand, same footer) —
// emails are brand-level, not the dashboard palette. All values here are
// numbers/dates (no user free text), so no HTML escaping is required.
// ─────────────────────────────────────────────────────────────────────────────

export async function sendAccountExportSummary({
  toEmail,
  invoiceCount,
  fileCount,
  skippedCount,
  generatedAt
}: {
  toEmail: string
  invoiceCount: number
  fileCount: number
  skippedCount: number
  generatedAt: string
}) {
  const datum = new Date(generatedAt).toLocaleDateString('nl-NL')
  const skippedLine =
    skippedCount > 0
      ? `<p style="color:#999; font-size:13px;">${skippedCount} bestand(en) konden niet worden opgehaald en zijn overgeslagen.</p>`
      : ''

  const __sendResult = await getResend().emails.send({
    from: 'BoekBrug <noreply@boekbrug.nl>',
    to: toEmail,
    subject: 'Je BoekBrug-gegevensexport',
    html: `
      <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto; padding: 32px;">
        <h2 style="color: #202124;">Je gegevensexport is klaar</h2>
        <p style="color: #555;">Je hebt een export van je BoekBrug-gegevens gedownload op ${datum}.</p>
        <div style="background:#f8f9fa; border-radius:12px; padding:16px; margin:20px 0;">
          <p style="margin:4px 0; color:#202124;"><strong>Facturen:</strong> ${invoiceCount}</p>
          <p style="margin:4px 0; color:#202124;"><strong>Documenten:</strong> ${fileCount}</p>
        </div>
        ${skippedLine}
        <p style="color: #555; font-size: 13px;">Heb je deze export niet zelf aangevraagd? Neem dan direct contact met ons op.</p>
        <p style="color: #aaa; font-size: 12px; margin-top: 32px;">BoekBrug — De brug tussen jou en je boekhouder</p>
      </div>
    `
  })
  await deliverEmail(__sendResult, { label: 'account-export', critical: true })
}
// ─────────────────────────────────────────────────────────────────────────────
// [REMINDERS] Automatic payment reminder — appended to src/lib/email.ts (single
// home for all Resend sends). Sent by the reminder cron for an outgoing invoice
// that is still openstaand past its due date.
//
// TRUST / FINANCIAL-TRUTH contract:
//   * best-effort (critical:false) — a failed reminder is logged + captured, and
//     NEVER breaks the cron or any other action. It is a notification, not a
//     legal delivery.
//   * shows `openstaand` (the amount STILL owed), computed by the caller via
//     openstaandOf — never the full total, so a part-paid invoice is honest.
//   * every third-party-visible string (client/company name, invoice number) is
//     HTML-escaped; the amount + date are pre-formatted numbers/dates (no free
//     text). Reuses the existing brand template + footer.
//   * always carries an "already paid? ignore this" line — paid-but-unreconciled
//     is the #1 cause of a false "overdue", and we must never dun someone twice.
//   * `firm` only softens/firms the WORDING (tier 30 vs 14) — it changes nothing
//     financial.
// ─────────────────────────────────────────────────────────────────────────────

export async function sendInvoiceReminder({
  toEmail,
  clientName,
  zzperName,
  invoiceNumber,
  openstaand,
  dueDate,
  firm = false,
  pdfBuffer,
}: {
  toEmail: string
  clientName: string
  zzperName: string
  invoiceNumber: string
  /** Amount STILL owed (from openstaandOf) — never the full total. */
  openstaand: number
  /** ISO due date — shown as the (passed) vervaldatum. */
  dueDate: string
  /** Firmer wording for a later tier (e.g. day 30). Wording only — no money change. */
  firm?: boolean
  /** Re-attach the invoice PDF when available. */
  pdfBuffer?: Buffer
}) {
  const heading = firm ? 'Betalingsherinnering' : 'Herinnering'
  const subject = firm
    ? `Betalingsherinnering: factuur ${invoiceNumber}`
    : `Herinnering: factuur ${invoiceNumber}`

  const intro = firm
    ? `Onze administratie laat zien dat factuur <strong>${escapeHtml(invoiceNumber)}</strong> van <strong>${escapeHtml(zzperName)}</strong> nog niet is voldaan. De vervaldatum is inmiddels verstreken.`
    : `Een vriendelijke herinnering dat factuur <strong>${escapeHtml(invoiceNumber)}</strong> van <strong>${escapeHtml(zzperName)}</strong> nog openstaat.`

  const attachmentLine = pdfBuffer
    ? `<p style="color: #555;">De factuur is nogmaals bijgevoegd als PDF.</p>`
    : ''

  const __sendResult = await getResend().emails.send({
    from: 'BoekBrug <noreply@boekbrug.nl>',
    to: toEmail,
    subject,
    html: `
      <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto; padding: 32px;">
        <h2 style="color: #202124;">${heading}</h2>
        <p style="color: #555;">Beste ${escapeHtml(clientName)},</p>
        <p style="color: #555;">${intro}</p>
        <div style="background:#f8f9fa; border-radius:12px; padding:16px; margin:20px 0;">
          <p style="margin:4px 0; color:#202124;"><strong>Factuurnummer:</strong> ${escapeHtml(invoiceNumber)}</p>
          <p style="margin:4px 0; color:#202124;"><strong>Openstaand bedrag:</strong> ${formatEuroNL(openstaand)}</p>
          <p style="margin:4px 0; color:#202124;"><strong>Vervaldatum:</strong> ${formatDateNL(dueDate)}</p>
        </div>
        ${attachmentLine}
        <p style="color: #999; font-size: 13px;">Heb je deze factuur al betaald? Dan kun je deze herinnering als niet verzonden beschouwen.</p>
        <p style="color: #aaa; font-size: 12px; margin-top: 32px;">BoekBrug — De brug tussen jou en je boekhouder</p>
      </div>
    `,
    ...(pdfBuffer
      ? {
          attachments: [
            {
              filename: `${invoiceNumber}.pdf`,
              content: pdfBuffer,
            },
          ],
        }
      : {})
  })
  // Best-effort: a reminder that fails to send must never break the cron run.
  // [TRUST-DELIVERY-RETURN] De cron MOET dit weten: hij verbruikt per herinnering een tier die
  // nooit terugkomt, en meldt de ondernemer dat er iets is verstuurd.
  return deliverEmail(__sendResult, { label: 'invoice-reminder', critical: false })
}

// ── [BILLING] Eén mail over betalen, en bewust maar één ───────────────────────
//
// Op de billing-tak stonden er twee: een waarschuwing dat de proefperiode afliep, en deze.
// De eerste is hier NIET overgenomen — wij kennen geen proefperiode, dus er is niets dat
// afloopt en niets om voor te waarschuwen. Wat overblijft is de mail die er wel toe doet:
// een mislukte incasso die niemand benoemt verandert een dode kaart in een opzegging.
//
// Best effort: een mail die niet verstuurd kan worden mag nooit de webhook breken die hem
// aanriep.

/**
 * "We couldn't take the payment." Sent when Stripe reports a failed charge.
 *
 * Tone matters more here than anywhere else in the app: an expired card is not
 * a moral failing, and the customer has NOT lost access — `past_due` keeps them
 * in while Stripe retries. Saying that plainly is what stops a recoverable card
 * problem from becoming a cancellation.
 */
export async function sendPaymentFailedEmail({
  toEmail,
  name,
}: {
  toEmail: string
  name: string
}) {
  const __sendResult = await getResend().emails.send({
    from: 'BoekBrug <noreply@boekbrug.nl>',
    to: toEmail,
    subject: 'Je betaling is niet gelukt',
    html: `
      <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto; padding: 32px;">
        <h2 style="color: #202124;">De betaling is niet gelukt</h2>
        <p style="color: #555;">Beste ${escapeHtml(name)},</p>
        <p style="color: #555;">
          We konden het abonnementsbedrag niet afschrijven. Meestal is de kaart verlopen
          of het saldo net te laag — het is zo opgelost.
        </p>
        <p style="color: #555;">
          <strong>Je houdt gewoon toegang tot BoekBrug.</strong> We proberen het de komende
          dagen automatisch nog een paar keer.
        </p>
        <a href="https://boekbrug.nl/dashboard/settings/facturering"
           style="display:inline-block; margin:20px 0; padding:12px 24px; background:#1A73E8; color:#fff; border-radius:8px; text-decoration:none; font-weight:600;">
          Betaalgegevens bijwerken
        </a>
        <p style="color: #999; font-size: 13px;">
          Heb je je gegevens net al aangepast? Dan kun je deze mail negeren.
        </p>
        <p style="color: #aaa; font-size: 12px; margin-top: 32px;">BoekBrug — De brug tussen jou en je boekhouder</p>
      </div>
    `,
  })
  await deliverEmail(__sendResult, { label: 'payment-failed', critical: false })
}

// ── [BRUG] De mail die het hele product waarmaakt ────────────────────────────
//
// Dit was de grootste gat in de brug, en het zat niet in de code maar in de bezorging.
//
// De belofte is: "aan het eind van het kwartaal staat alles klaar voor je boekhouder."
// Die belofte werd afgeleverd als een BADGE in de app — een notificatierij plus een
// web-push waarop hij zich nooit heeft ingeschreven. Een eenmanskantoor logt niet in om
// te kijken of er een badge is. De mededeling bereikte dus niemand, en de link die zij
// wél droeg wees naar /dashboard/clients/beheer: een uitnodig-formulier, niet het kwartaal.
//
// Een boekhouder leeft in zijn mailbox. Daar hoort dit binnen te komen.
//
// De toon is bewust vlak: geen uitroeptekens, geen "geweldig nieuws". Hij krijgt dit vier
// keer per jaar per klant en het moet lezen als een levering, niet als reclame.
export async function sendQuarterReadyToAccountant({
  toEmail,
  accountantName,
  clientName,
  quarterLabel,
  outgoingCount,
  incomingCount,
  topGaps,
  packageUrl,
  quarterUrl,
}: {
  toEmail: string
  accountantName: string
  clientName: string
  quarterLabel: string
  outgoingCount: number
  incomingCount: number
  /** De koppen van wat er nog mist. Leeg = niets aan de hand. */
  topGaps: string[]
  /** Directe download van het kwartaalpakket (ZIP + index). */
  packageUrl: string
  /** Het kwartaal van deze klant in de app. */
  quarterUrl: string
}) {
  const compleet = topGaps.length === 0

  const gapBlok = compleet
    ? ''
    : `
      <div style="background:#FEF7E0; border:1px solid #FDE9B8; border-radius:10px; padding:14px 16px; margin:18px 0;">
        <div style="color:#7C5800; font-weight:600; font-size:14px; margin-bottom:6px;">Nog niet compleet</div>
        <ul style="margin:0; padding-left:18px; color:#7C5800; font-size:14px; line-height:1.6;">
          ${topGaps.slice(0, 3).map((g) => `<li>${escapeHtml(g)}</li>`).join('')}
        </ul>
      </div>`

  const __sendResult = await getResend().emails.send({
    from: 'BoekBrug <noreply@boekbrug.nl>',
    to: toEmail,
    // Klantnaam in het onderwerp: hij heeft er tientallen en scant op naam, niet op product.
    subject: `${escapeHtml(clientName)} — ${quarterLabel} staat klaar`,
    html: `
      <div style="font-family: sans-serif; max-width: 520px; margin: 0 auto; padding: 32px;">
        <h2 style="color:#202124; font-size:20px; margin:0 0 4px;">${escapeHtml(quarterLabel)} staat klaar</h2>
        <p style="color:#5f6368; font-size:15px; margin:0 0 20px;">van ${escapeHtml(clientName)}</p>

        <p style="color:#555; font-size:15px; line-height:1.6;">Beste ${escapeHtml(accountantName)},</p>
        <p style="color:#555; font-size:15px; line-height:1.6;">
          De administratie van ${escapeHtml(clientName)} over ${escapeHtml(quarterLabel)} staat klaar:
          <strong>${outgoingCount} verkoopfactuur${outgoingCount === 1 ? '' : 'en'}</strong> en
          <strong>${incomingCount} inkoopfactuur${incomingCount === 1 ? '' : 'en'}</strong>,
          geordend per kwartaal met de bijlagen erbij.
        </p>

        ${gapBlok}

        <a href="${packageUrl}"
           style="display:inline-block; margin:8px 8px 8px 0; padding:12px 22px; background:#1A73E8; color:#fff; border-radius:8px; text-decoration:none; font-weight:600; font-size:15px;">
          Download het kwartaalpakket
        </a>
        <a href="${quarterUrl}"
           style="display:inline-block; margin:8px 0; padding:12px 22px; background:#fff; color:#1A73E8; border:1.5px solid #1A73E8; border-radius:8px; text-decoration:none; font-weight:600; font-size:15px;">
          Bekijk in BoekBrug
        </a>

        <p style="color:#5f6368; font-size:13.5px; line-height:1.6; margin-top:22px;">
          Je ziet alleen wat je klant zelf heeft verstuurd, ontvangen of als betaald heeft
          gemarkeerd — zijn concepten blijven van hem. BoekBrug is voor jou gratis, ook met
          honderd klanten.
        </p>
        <p style="color:#aaa; font-size:12px; margin-top:28px;">BoekBrug — De brug tussen jou en je boekhouder</p>
      </div>
    `,
  })
  // Best effort: een mislukte mail mag de kwartaal-cron nooit laten vallen. Maar hij krijgt wél
  // te horen of het lukte — dit is de mail die het product maakt: "het kwartaal staat klaar".
  return deliverEmail(__sendResult, { label: 'quarter-ready-accountant', critical: false })
}
