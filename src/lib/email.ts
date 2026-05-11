import { Resend } from 'resend'

const resend = new Resend(process.env.RESEND_API_KEY)

// إيميل دعوة المحاسب
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
    from: 'BoekBrug <onboarding@resend.dev>',
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

// إيميل للعميل عند استلام فاتورة
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
    from: 'BoekBrug <onboarding@resend.dev>',
   // to: toEmail,
   to: 'mofwim@gmail.com', // مؤقت للاختبار
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