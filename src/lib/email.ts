// src/lib/email.ts
// كل functions الإيميل في مكان واحد — Resend

import { Resend } from 'resend'

const resend = new Resend(process.env.RESEND_API_KEY)

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
  await resend.emails.send({
    from: 'BoekBrug <noreply@boekbrug.nl>',
    to: toEmail,
    subject: `${zzperName} wil je toevoegen als boekhouder`,
    html: `
      <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto; padding: 32px;">
        <h2 style="color: #1c1c1e;">Je bent uitgenodigd</h2>
        <p style="color: #555;">${zzperName} wil je toevoegen als boekhouder via BoekBrug.</p>
        <p style="color: #555;">Als je accepteert, zie je automatisch alle facturen van ${zzperName} in jouw dashboard.</p>
        <a href="${acceptUrl}"
           style="display:inline-block; background:#007aff; color:#fff; padding:12px 24px; border-radius:10px; text-decoration:none; font-weight:600; margin-top:16px;">
          Uitnodiging accepteren
        </a>
        <p style="color: #aaa; font-size: 12px; margin-top: 32px;">BoekBrug — De brug tussen jou en je boekhouder</p>
      </div>
    `
  })
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
  await resend.emails.send({
    from: 'BoekBrug <noreply@boekbrug.nl>',
    to: toEmail,
    subject: `${accountantName} nodigt je uit op BoekBrug`,
    html: `
      <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto; padding: 32px;">
        <h2 style="color: #1c1c1e;">Je bent uitgenodigd</h2>
        <p style="color: #555;">Je boekhouder <strong>${accountantName}</strong> nodigt je uit om BoekBrug te gebruiken.</p>
        <p style="color: #555;">Via BoekBrug kun je eenvoudig facturen delen met je boekhouder — geen WhatsApp meer, geen e-mail zoeken.</p>
        <a href="${acceptUrl}"
           style="display:inline-block; background:#007aff; color:#fff; padding:12px 24px; border-radius:10px; text-decoration:none; font-weight:600; margin-top:16px;">
          Uitnodiging accepteren
        </a>
        <p style="color: #aaa; font-size: 12px; margin-top: 32px;">BoekBrug — De brug tussen jou en je boekhouder</p>
      </div>
    `
  })
}

// ── إيميل للعميل عند استلام فاتورة ───────────────────────────────────────────
export async function sendInvoiceToClient({
  toEmail,
  clientName,
  zzperName,
  invoiceNumber,
  totalInc,
  dueDate
}: {
  toEmail: string
  clientName: string
  zzperName: string
  invoiceNumber: string
  totalInc: number
  dueDate: string
}) {
  await resend.emails.send({
    from: 'BoekBrug <noreply@boekbrug.nl>',
    to: toEmail,
    subject: `Factuur ${invoiceNumber} van ${zzperName}`,
    html: `
      <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto; padding: 32px;">
        <h2 style="color: #1c1c1e;">Nieuwe factuur ontvangen</h2>
        <p style="color: #555;">Beste ${clientName},</p>
        <p style="color: #555;">Je hebt een factuur ontvangen van <strong>${zzperName}</strong>.</p>
        <div style="background:#f2f2f7; border-radius:12px; padding:16px; margin:20px 0;">
          <p style="margin:4px 0; color:#1c1c1e;"><strong>Factuurnummer:</strong> ${invoiceNumber}</p>
          <p style="margin:4px 0; color:#1c1c1e;"><strong>Bedrag:</strong> €${totalInc.toFixed(2)}</p>
          <p style="margin:4px 0; color:#1c1c1e;"><strong>Vervaldatum:</strong> ${dueDate}</p>
        </div>
        <p style="color: #aaa; font-size: 12px; margin-top: 32px;">BoekBrug — De brug tussen jou en je boekhouder</p>
      </div>
    `
  })
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
  await resend.emails.send({
    from: 'BoekBrug <noreply@boekbrug.nl>',
    to: toEmail,
    subject: `Nieuw bericht van ${senderName}`,
    html: `
      <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto; padding: 32px;">
        <h2 style="color: #1c1c1e;">Nieuw bericht</h2>
        <p style="color: #555;">Beste ${receiverName},</p>
        <p style="color: #555;"><strong>${senderName}</strong> heeft je een bericht gestuurd via BoekBrug.</p>
        <div style="background:#f2f2f7; border-radius:12px; padding:16px; margin:20px 0; border-left: 3px solid #007aff;">
          <p style="margin:0; color:#1c1c1e; font-style: italic;">"${messagePreview}"</p>
        </div>
        <a href="${conversationUrl}"
           style="display:inline-block; background:#007aff; color:#fff; padding:12px 24px; border-radius:10px; text-decoration:none; font-weight:600; margin-top:8px;">
          Bericht bekijken
        </a>
        <p style="color: #aaa; font-size: 12px; margin-top: 32px;">BoekBrug — De brug tussen jou en je boekhouder</p>
      </div>
    `
  })
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
  await resend.emails.send({
    from: 'BoekBrug <noreply@boekbrug.nl>',
    to: toEmail,
    subject: `${clientName} heeft de koppeling beëindigd`,
    html: `
      <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto; padding: 32px;">
        <h2 style="color: #1c1c1e;">Koppeling beëindigd</h2>
        <p style="color: #555;">Beste ${accountantName},</p>
        <p style="color: #555;"><strong>${clientName}</strong> heeft de koppeling met jou als boekhouder beëindigd via BoekBrug.</p>
        <p style="color: #555;">Je hebt geen toegang meer tot nieuwe facturen of documenten van deze klant. Historische gegevens waar je eerder aan hebt gewerkt, blijven beschikbaar voor je administratie.</p>
        <p style="color: #aaa; font-size: 12px; margin-top: 32px;">BoekBrug — De brug tussen jou en je boekhouder</p>
      </div>
    `
  })
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
  await resend.emails.send({
    from: 'BoekBrug <noreply@boekbrug.nl>',
    to: toEmail,
    subject: `${accountantName} heeft de koppeling beëindigd`,
    html: `
      <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto; padding: 32px;">
        <h2 style="color: #1c1c1e;">Koppeling beëindigd</h2>
        <p style="color: #555;">Beste ${clientName},</p>
        <p style="color: #555;">Je boekhouder <strong>${accountantName}</strong> heeft de koppeling met jou beëindigd via BoekBrug.</p>
        <p style="color: #555;">Je facturen en documenten blijven volledig van jou en blijven beschikbaar in je account. Je kunt op elk moment een nieuwe boekhouder uitnodigen via je instellingen.</p>
        <p style="color: #aaa; font-size: 12px; margin-top: 32px;">BoekBrug — De brug tussen jou en je boekhouder</p>
      </div>
    `
  })
}
// ─────────────────────────────────────────────────────────────────────────────
// [BOEK-030] APPEND THIS FUNCTION to src/lib/email.ts (end of file).
// Do NOT rewrite the rest of the file — this is a surgical, tagged addition,
// pre-approved by Tech Lead. email.ts is the single home for all Resend sends,
// so the Draft Queue letter is sent from here (no second Resend client).
//
// House style matches the existing templates in this file (#007aff brand, same
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
  const escape = (s: string) =>
    s.replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')

  const safeBody = escape(body).replace(/\r?\n/g, '<br>')

  await resend.emails.send({
    from: 'BoekBrug <noreply@boekbrug.nl>',
    to: toEmail,
    subject,
    html: `
      <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto; padding: 32px;">
        <h2 style="color: #1c1c1e;">Bericht van je boekhouder</h2>
        <div style="background:#f2f2f7; border-radius:12px; padding:16px; margin:20px 0; color:#1c1c1e; line-height:1.5;">
          ${safeBody}
        </div>
        <p style="color: #aaa; font-size: 12px; margin-top: 32px;">
          ${escape(accountantName)} · via BoekBrug — De brug tussen jou en je boekhouder
        </p>
      </div>
    `
  })

  // clientName is intentionally available for future personalization / subject use.
  void clientName
}