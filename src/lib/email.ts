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
async function deliverEmail(
  result: { error: unknown } | null | undefined,
  opts: { label: string; critical: boolean },
): Promise<void> {
  const err = result?.error
  if (!err) return
  console.error(`[TRUST-DELIVERY] ${opts.label} e-mail mislukt`, err)
  if (opts.critical) {
    throw new Error(`E-mail versturen mislukt (${opts.label})`)
  }
  Sentry.captureException(
    err instanceof Error ? err : new Error(`${opts.label} e-mail mislukt`),
    { extra: { label: opts.label } },
  )
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