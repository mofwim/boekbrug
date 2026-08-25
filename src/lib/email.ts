// src/lib/email.ts
// كل functions الإيميل في مكان واحد — Resend

import { Resend } from 'resend'
import * as Sentry from '@sentry/nextjs'
// [FACTUUR-A] Single Dutch formatting source — June 2026
import { formatDateNL, formatEuroNL } from './format-nl'
import { offerteSubject, offerteEmailHtml } from './offerte-send'
// [M2] De escaper woont in een eigen bestand sinds de offertetekst puur moest worden — zie de kop
// van escape-html.ts. Zelfde functie, zelfde gedrag, alleen niet meer hier gedeclareerd.
import { escapeHtml } from './escape-html'
// [AFZENDERNAAM] Mail naar de KLANT VAN DE ONDERNEMER draagt zijn bedrijfsnaam, niet die van ons.
// Alleen deze drie (factuur, herinnering, offerte) gaan naar een derde; de overige twaalf schrijven
// aan de ondernemer zelf, zijn boekhouder of een genodigde, en daar is BoekBrug de juiste afzender.
import { customerMailFrom } from './mail-from'
// [MAIL-TEKST] De teksthelft van elke mail — zie de kop van mail-text.ts.
import { htmlToMailText } from './mail-text'

// [BUILD-SAFE] Construct the Resend client LAZILY, on first send — not at module
// import. The constructor throws when RESEND_API_KEY is absent, and Next.js's build
// step imports every route module to collect page data (with no runtime env), so a
// top-level `new Resend()` failed the whole production build / Vercel deploy over a
// key that's only needed at REQUEST time. The env var is present when a handler runs.
let _resend: Resend | null = null
function rawResend(): Resend {
  if (!_resend) _resend = new Resend(process.env.RESEND_API_KEY)
  return _resend
}

// [BIJLAGE-NAAM] A custom numbering template may put a '/' in the number ("045/2026" is a
// documented shape) — legal on the document, illegal in a filename. MIME agents disagree on what
// a slash in an attachment name means, and disagreement here surfaces as a mail without its PDF.
function safeFileName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_')
}

// [MAIL-TEKST] Every send goes through this wrapper, and the wrapper adds the text/plain part
// that none of the fifteen senders had. HTML-only mail is one of the oldest spam heuristics
// (SpamAssassin's MIME_HTML_ONLY), and this product's sending domain is young — the invoice mail
// asking a stranger for money is exactly the message that cannot afford the free negative signal.
//
// The text is DERIVED from the same html string the call passes, at the one chokepoint, so the
// two parts cannot drift and a sender added next month inherits the fix without knowing it
// exists. A sender that provides its own `text` keeps it.
type ResendSendPayload = Parameters<Resend["emails"]["send"]>[0]
function getResend(): { emails: { send: (p: ResendSendPayload) => ReturnType<Resend["emails"]["send"]> } } {
  return {
    emails: {
      send: (payload) => {
        const withText =
          "html" in payload && typeof payload.html === "string" && !("text" in payload && payload.text)
            ? { ...payload, text: htmlToMailText(payload.html) }
            : payload
        return rawResend().emails.send(withText as ResendSendPayload)
      },
    },
  }
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
        <p style="color: #5f6368; font-size: 12px; margin-top: 32px;">BoekBrug — De brug tussen jou en je boekhouder</p>
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
        <p style="color: #5f6368; font-size: 12px; margin-top: 32px;">BoekBrug — De brug tussen jou en je boekhouder</p>
      </div>
    `
  })
  if (sendError) {
    throw new Error(`Resend afgewezen: ${sendError.message ?? 'onbekende fout'}`)
  }
}

// ── [ACTING-FOR] Uitnodiging voor een verkoopmedewerker ──────────────────────────
// Een andere mail dan sendClientInvite, met opzet: hier wordt iemand geen KLANT van een
// boekhouder maar krijgt hij het recht om facturen te versturen ONDER HET BTW-NUMMER van een
// ander. Dat hoort in de uitnodiging te staan — wie op een knop klikt zonder te weten wat hij
// aanneemt, kan later niet zeggen dat hij het wist.
export async function sendMemberInvite({
  toEmail,
  companyName,
  acceptUrl,
}: {
  toEmail: string
  companyName: string
  acceptUrl: string
}) {
  const { error: sendError } = await getResend().emails.send({
    from: 'BoekBrug <noreply@boekbrug.nl>',
    to: toEmail,
    subject: `${companyName} vraagt je om facturen te maken op BoekBrug`,
    html: `
      <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto; padding: 32px;">
        <h2 style="color: #202124;">Facturen maken voor ${escapeHtml(companyName)}</h2>
        <p style="color: #555;"><strong>${escapeHtml(companyName)}</strong> geeft je toegang tot BoekBrug om verkoopfacturen te maken en te versturen.</p>
        <p style="color: #555;">Wat dat betekent, in gewone woorden:</p>
        <ul style="color: #555; padding-left: 18px;">
          <li>De facturen die je maakt gaan uit op naam en BTW-nummer van ${escapeHtml(companyName)}.</li>
          <li>Je ziet <strong>alleen wat je zelf aanmaakt</strong> — niet de bank, niet de omzet, niet de facturen van collega's.</li>
          <li>${escapeHtml(companyName)} kan je toegang op elk moment intrekken.</li>
        </ul>
        <a href="${acceptUrl}"
           style="display:inline-block; background:#1a73e8; color:#fff; padding:12px 24px; border-radius:10px; text-decoration:none; font-weight:600; margin-top:16px;">
          Toegang accepteren
        </a>
        <p style="color: #5f6368; font-size: 12px; margin-top: 32px;">Deze uitnodiging verloopt na 14 dagen. Verwacht je hem niet? Klik dan niet, en laat het ${escapeHtml(companyName)} weten.</p>
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
  isCreditnota = false,
  senderEmail,
  isCorrected = false,
  extraAttachment,
  ublAttachment,
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
  /**
   * [HERSTEL] Corrected-invoice wording: subject + heading say this REPLACES the earlier version
   * with the same number, and the body says the earlier one is void. Without that sentence the
   * customer holds two PDFs with one number and picks one at random — the exact divergence the
   * herstel path exists to prevent.
   */
  isCorrected?: boolean
  /**
   * [ANTWOORD-ADRES] Het e-mailadres van de ondernemer, uit zijn profiel — dat is het adres waarmee
   * hij zich bij BoekBrug heeft aangemeld.
   *
   * Deze mail ging uit vanaf noreply@boekbrug.nl zonder reply-to, net als de offerte tot voor kort.
   * Op "Beantwoorden" drukken is het eerste wat een klant doet die iets wil zeggen over een
   * factuur — "ik heb al betaald", "kan het gespreid?", "de tenaamstelling klopt niet" — en dat
   * antwoord kwam nergens aan. Bij een herinnering is dat erger dan onhandig: dan schrijft iemand
   * die WIL betalen naar een brievenbus die niet bestaat, en de volgende herinnering gaat gewoon
   * uit.
   *
   * Optioneel, zodat elke bestaande aanroep blijft werken: zonder adres geen reply-to, precies
   * zoals het was.
   */
  senderEmail?: string | null
  /**
   * [FACTUUR-BIJLAGE] Het eigen bestand van de ondernemer, als hij er een koos.
   *
   * Al opgehaald en gekeurd door de verstuurroute, VOORDAT de factuur een nummer kreeg — zie de
   * kop van invoice-attachment.ts. Hier komt dus alleen nog een bestand binnen dat mee mag.
   */
  extraAttachment?: { filename: string; content: Buffer } | null
  /**
   * [E-FACTUUR-MEE] De e-factuur (UBL-XML) naast de PDF, als hij gebouwd kon worden. Zakelijke
   * klanten lezen hem rechtstreeks in hun boekhoudpakket in; wie hem niet kent, leest de PDF
   * zoals altijd. Best-effort aangeleverd door de verstuurroute — nooit een blokkade.
   */
  ublAttachment?: { filename: string; content: Buffer } | null
}) {
  const docLabel = isCreditnota ? 'Creditnota' : 'Factuur'
  const numberLabel = isCreditnota ? 'Creditnotanummer' : 'Factuurnummer'

  const invoiceDateRow = invoiceDate
    ? `<p style="margin:4px 0; color:#202124;"><strong>${isCreditnota ? 'Datum' : 'Factuurdatum'}:</strong> ${formatDateNL(invoiceDate)}</p>`
    : ''
  const dueDateRow = isCreditnota
    ? ''
    : `<p style="margin:4px 0; color:#202124;"><strong>Vervaldatum:</strong> ${formatDateNL(dueDate)}</p>`

  // [FACTUUR-BIJLAGE] De zin noemt wat er ECHT in de mail zit. Zit er een eigen bestand bij, dan
  // wordt het bij naam genoemd: een klant die een werkbon verwacht moet kunnen zien dat hij er is
  // zonder de bijlagen open te klappen, en een naam is ook het enige waaraan hij merkt dat er per
  // ongeluk het verkeerde bestand meeging.
  const attachmentLine = pdfBuffer
    ? extraAttachment
      ? `<p style="color: #555;">De volledige ${docLabel.toLowerCase()} is bijgevoegd als PDF, samen met <strong>${escapeHtml(extraAttachment.filename)}</strong>.</p>`
      : `<p style="color: #555;">De volledige ${docLabel.toLowerCase()} is bijgevoegd als PDF.</p>`
    : extraAttachment
      ? `<p style="color: #555;"><strong>${escapeHtml(extraAttachment.filename)}</strong> is bijgevoegd.</p>`
      : ''

  // [E-FACTUUR-MEE] Eén zin, alleen als de e-factuur er echt bij zit: een zakelijke klant weet
  // dan dat het XML-bestand geen bijvangst is maar de factuur zelf, klaar voor zijn pakket.
  const eFactuurRegel = ublAttachment
    ? `<p style="color: #555;">Ook bijgevoegd: een e-factuur (UBL) die je boekhoudpakket direct kan inlezen.</p>`
    : ''

  // [TRUST-DELIVERY] Resend's SDK resolves to { data, error } and does NOT throw on
  // an API-level rejection (invalid recipient, unverified domain, rate-limit,
  // validation). Ignoring the return let a rejected send look delivered, so the
  // invoice showed "verstuurd" while the customer received nothing. Capture the
  // result and THROW on error so the caller's catch marks it email_failed.
  const antwoordAdres = (senderEmail ?? '').trim()
  // [ANTWOORD-ADRES-ZICHTBAAR] Het adres staat ook IN de mail, niet alleen in de Reply-To-header.
  // Die header doet zijn werk pas als de klant op "Beantwoorden" drukt; wie de mail doorstuurt naar
  // zijn boekhouder, hem afdrukt, of vanaf een ander account wil reageren, ziet hem nooit. Op de
  // offerte stond het adres al in de tekst — op de factuur en de herinnering, de twee stukken waar
  // een klant juist iets over te melden heeft, nergens.
  const contactRegel = antwoordAdres
    ? `<p style="color: #555;">Vragen over deze ${docLabel.toLowerCase()}? Antwoord op deze mail of neem contact op via <a href="mailto:${escapeHtml(antwoordAdres)}" style="color:#1a73e8;">${escapeHtml(antwoordAdres)}</a>.</p>`
    : ''
  // [BEZORGING] De platte-teksttweeling. Een mail met alléén HTML scoort structureel slechter
  // bij spamfilters (Gmail/Outlook wegen de aanwezigheid van een text/plain-deel mee), en dit
  // zijn precies de mails die een klant MOET ontvangen. Zelfde feiten, geen opmaak.
  const tekstDeel = [
    `Beste ${clientName},`,
    '',
    isCorrected
      ? `Je hebt een gecorrigeerde factuur ontvangen van ${zzperName}. Deze versie vervangt de eerdere factuur met nummer ${invoiceNumber}; de eerdere versie is vervallen.`
      : `Je hebt een ${docLabel.toLowerCase()} ontvangen van ${zzperName}.`,
    '',
    `${numberLabel}: ${invoiceNumber}`,
    `Bedrag: ${formatEuroNL(totalInc)}`,
    ...(invoiceDate ? [`Factuurdatum: ${formatDateNL(invoiceDate)}`] : []),
    ...(dueDate ? [`Vervaldatum: ${formatDateNL(dueDate)}`] : []),
    '',
    pdfBuffer ? `De volledige ${docLabel.toLowerCase()} is bijgevoegd als PDF.` : '',
    ublAttachment ? 'Ook bijgevoegd: een e-factuur (UBL) voor je boekhoudpakket.' : '',
    antwoordAdres ? `Vragen? Antwoord op deze mail of mail ${antwoordAdres}.` : '',
    '',
    'BoekBrug — De brug tussen jou en je boekhouder',
  ].filter((r, i, a) => r !== '' || a[i - 1] !== '').join('\n')

  const { error: sendError } = await getResend().emails.send({
    from: customerMailFrom(zzperName),
    to: toEmail,
    // [ANTWOORD-ADRES] Beantwoorden komt bij de ondernemer terecht, niet bij noreply@.
    ...(antwoordAdres ? { replyTo: antwoordAdres } : {}),
    subject: isCorrected
      ? `Gecorrigeerde factuur ${invoiceNumber} van ${zzperName}`
      : `${docLabel} ${invoiceNumber} van ${zzperName}`,
    text: tekstDeel,
    html: `
      <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto; padding: 32px;">
        <h2 style="color: #202124;">${isCorrected ? 'Gecorrigeerde factuur ontvangen' : isCreditnota ? 'Creditnota ontvangen' : 'Nieuwe factuur ontvangen'}</h2>
        <p style="color: #555;">Beste ${escapeHtml(clientName)},</p>
        <p style="color: #555;">${
          isCorrected
            ? `Je hebt een <strong>gecorrigeerde factuur</strong> ontvangen van <strong>${escapeHtml(zzperName)}</strong>. Deze versie vervangt de eerdere factuur met hetzelfde nummer ${escapeHtml(invoiceNumber)} — de eerdere versie is daarmee vervallen. Gebruik alleen deze.`
            : `Je hebt een ${docLabel.toLowerCase()} ontvangen van <strong>${escapeHtml(zzperName)}</strong>.`
        }</p>
        <div style="background:#f8f9fa; border-radius:12px; padding:16px; margin:20px 0;">
          <p style="margin:4px 0; color:#202124;"><strong>${numberLabel}:</strong> ${escapeHtml(invoiceNumber)}</p>
          <p style="margin:4px 0; color:#202124;"><strong>Bedrag:</strong> ${formatEuroNL(totalInc)}</p>
          ${invoiceDateRow}
          ${dueDateRow}
        </div>
        ${attachmentLine}
        ${eFactuurRegel}
        ${contactRegel}
        <p style="color: #5f6368; font-size: 12px; margin-top: 32px;">BoekBrug — De brug tussen jou en je boekhouder</p>
      </div>
    `,
    // [FACTUUR-A] Attach the legal PDF — only when rendering succeeded.
    // No attachments key at all when absent (cleaner than empty array).
    //
    // [FACTUUR-BIJLAGE] En daarnaast, als de ondernemer er een koos, zijn eigen bestand: een
    // werkbon, een urenstaat, een pakbon. Het is al opgehaald en gekeurd VOORDAT de factuur een
    // nummer kreeg (zie invoice-attachment.ts) — hier wordt het alleen nog meegegeven.
    //
    // De factuur-PDF staat vooraan. De klant opent de eerste bijlage, en dat hoort het document
    // te zijn waar de mail over gaat.
    // [E-FACTUUR-MEE] De e-factuur direct na de PDF: eerst het document waar de mail over gaat,
    // dan de machineleesbare tweeling ervan, dan pas het eigen bestand van de ondernemer.
    ...(pdfBuffer || extraAttachment || ublAttachment
      ? {
          attachments: [
            ...(pdfBuffer ? [{ filename: `${safeFileName(invoiceNumber)}.pdf`, content: pdfBuffer, contentType: 'application/pdf' }] : []),
            ...(ublAttachment ? [{ ...ublAttachment, contentType: 'application/xml' }] : []),
            ...(extraAttachment ? [extraAttachment] : []),
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
        <p style="color: #5f6368; font-size: 12px; margin-top: 32px;">BoekBrug — De brug tussen jou en je boekhouder</p>
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
        <p style="color: #5f6368; font-size: 12px; margin-top: 32px;">BoekBrug — De brug tussen jou en je boekhouder</p>
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
        <p style="color: #5f6368; font-size: 12px; margin-top: 32px;">BoekBrug — De brug tussen jou en je boekhouder</p>
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
        <p style="color: #5f6368; font-size: 12px; margin-top: 32px;">
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
        <p style="color: #5f6368; font-size: 12px; margin-top: 32px;">BoekBrug — De brug tussen jou en je boekhouder</p>
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
  wik,
  pdfBuffer,
  senderEmail,
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
  /**
   * [WIK] Present on the FINAL reminder: the statutory aanmaning (buildWikNotice). Its sentence
   * names the fourteen-day term and the exact collection costs — the two elements art. 6:96 BW
   * requires before those costs may ever be charged to a consumer. Without it this stays the
   * friendly reminder it always was.
   */
  wik?: { sentence: string; deadline: string; costs: number } | null
  /** Re-attach the invoice PDF when available. */
  pdfBuffer?: Buffer
  /**
   * [ANTWOORD-ADRES] Zie sendInvoiceToClient. Bij een herinnering weegt dit het zwaarst: hier
   * schrijft iemand die WIL betalen — "ik heb vorige week overgemaakt", "kan het gespreid?" — en
   * dat antwoord kwam bij noreply@ terecht terwijl de volgende herinnering gewoon uitging.
   */
  senderEmail?: string | null
}) {
  const heading = wik ? 'Laatste aanmaning' : firm ? 'Betalingsherinnering' : 'Herinnering'
  const subject = wik
    ? `Laatste aanmaning: factuur ${invoiceNumber}`
    : firm
      ? `Betalingsherinnering: factuur ${invoiceNumber}`
      : `Herinnering: factuur ${invoiceNumber}`

  const intro = wik
    ? `Factuur <strong>${escapeHtml(invoiceNumber)}</strong> van <strong>${escapeHtml(zzperName)}</strong> is ondanks eerdere herinneringen nog niet voldaan. De vervaldatum is ruim verstreken.`
    : firm
      ? `Onze administratie laat zien dat factuur <strong>${escapeHtml(invoiceNumber)}</strong> van <strong>${escapeHtml(zzperName)}</strong> nog niet is voldaan. De vervaldatum is inmiddels verstreken.`
      : `Een vriendelijke herinnering dat factuur <strong>${escapeHtml(invoiceNumber)}</strong> van <strong>${escapeHtml(zzperName)}</strong> nog openstaat.`

  // [WIK] The legally required paragraph, set apart so it cannot be missed — this block IS the
  // letter's legal effect. Rendered as plain text from the pure builder; no amount is computed here.
  const wikBlock = wik
    ? `<div style="border-left:3px solid #B3261E; background:#FCEEEE; border-radius:8px; padding:14px 16px; margin:20px 0;">
         <p style="margin:0; color:#5F2120; line-height:1.6;">${escapeHtml(wik.sentence)}</p>
       </div>`
    : ''

  const attachmentLine = pdfBuffer
    ? `<p style="color: #555;">De factuur is nogmaals bijgevoegd als PDF.</p>`
    : ''

  const antwoordAdres = (senderEmail ?? '').trim()
  // [ANTWOORD-ADRES-ZICHTBAAR] Het adres staat ook IN de mail, niet alleen in de Reply-To-header.
  // Die header doet zijn werk pas als de klant op "Beantwoorden" drukt; wie de mail doorstuurt naar
  // zijn boekhouder, hem afdrukt, of vanaf een ander account wil reageren, ziet hem nooit. Op de
  // offerte stond het adres al in de tekst — op de factuur en de herinnering, de twee stukken waar
  // een klant juist iets over te melden heeft, nergens.
  const contactRegel = antwoordAdres
    ? `<p style="color: #555;">Vragen over deze factuur? Antwoord op deze mail of neem contact op via <a href="mailto:${escapeHtml(antwoordAdres)}" style="color:#1a73e8;">${escapeHtml(antwoordAdres)}</a>.</p>`
    : ''
  // [GEEN-UNSUBSCRIBE] Deliberately NO List-Unsubscribe header on a payment reminder, and the
  // absence is a decision worth recording: Gmail's one-click-unsubscribe requirement targets
  // PROMOTIONAL bulk mail, and a dunning message about an existing debt is transactional. Adding
  // the header would hand every debtor a button that silently stops their own payment reminders —
  // the owner would keep believing the app chases their money while the debtor has opted out.
  const __sendResult = await getResend().emails.send({
    from: customerMailFrom(zzperName),
    to: toEmail,
    // [ANTWOORD-ADRES] Beantwoorden komt bij de ondernemer terecht, niet bij noreply@.
    ...(antwoordAdres ? { replyTo: antwoordAdres } : {}),
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
        ${wikBlock}
        ${attachmentLine}
        <p style="color: #5f6368; font-size: 13px;">Heb je deze factuur al betaald? Dan kun je deze ${wik ? 'aanmaning' : 'herinnering'} als niet verzonden beschouwen.</p>
        ${contactRegel}
        <p style="color: #5f6368; font-size: 12px; margin-top: 32px;">BoekBrug — De brug tussen jou en je boekhouder</p>
      </div>
    `,
    ...(pdfBuffer
      ? {
          attachments: [
            {
              filename: `${safeFileName(invoiceNumber)}.pdf`,
              content: pdfBuffer,
              contentType: 'application/pdf',
            },
          ],
        }
      : {})
  })
  // Best-effort: a reminder that fails to send must never break the cron run — but the caller
  // has to be ABLE to know. [REMINDER-TRUTH] This used to return void, so a Resend rejection was
  // logged and swallowed: the cron counted the reminder as sent, kept the claimed tier, and told
  // the owner the letter went out. On the final tier that letter is the statutory WIK aanmaning,
  // the one that grants the right to charge incassokosten at all — believing it was sent when it
  // was not is the worst version of this bug.
  await deliverEmail(__sendResult, { label: 'invoice-reminder', critical: false })
  return { delivered: !__sendResult?.error }
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
        <p style="color: #5f6368; font-size: 13px;">
          Heb je je gegevens net al aangepast? Dan kun je deze mail negeren.
        </p>
        <p style="color: #5f6368; font-size: 12px; margin-top: 32px;">BoekBrug — De brug tussen jou en je boekhouder</p>
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
          gemarkeerd — zijn concepten blijven van hem. BoekBrug is voor jou gratis tot en met
          tien gekoppelde klanten.
        </p>
        <p style="color:#aaa; font-size:12px; margin-top:28px;">BoekBrug — De brug tussen jou en je boekhouder</p>
      </div>
    `,
  })
  // Best effort: een mislukte mail mag de kwartaal-cron nooit laten vallen. Maar hij krijgt wél
  // te horen of het lukte — dit is de mail die het product maakt: "het kwartaal staat klaar".
  return deliverEmail(__sendResult, { label: 'quarter-ready-accountant', critical: false })
}

// ─────────────────────────────────────────────────────────────────────────────
// [WAARSCHUWING] De 30-dagenbrief van voorwaarden §5.7.5.
//
// Dit is de enige mail in dit bestand waarvan het NIET-verzenden geen ongemak is maar een
// contractbreuk. Hij gaat naar iemand die BoekBrug allang verlaten heeft, wiens wettelijke
// bewaartermijn afloopt, en die daarna zijn administratie kwijt is. §5.7.5 belooft hem dertig
// dagen en een werkende export, en dit is die dertig dagen.
//
// `critical: true` — anders dan de herinneringsmail. Een mislukte betalingsherinnering probeer je
// morgen opnieuw; een mislukte waarschuwing is de reden dat er straks iets weg is zonder dat
// iemand het wist. De cron zet purge_warning_sent_at daarom pas NA een geslaagde verzending: geen
// mail = geen stempel = geen verwijdering. Zie retention-warning.ts.
//
// Geen enkele knop in deze mail is een actie die wij voor hem kunnen doen. Exporteren doet hij
// zelf, en dat is precies wat §5.7.5 hem belooft dat blijft werken.
// ─────────────────────────────────────────────────────────────────────────────
export async function sendRetentionWarning({
  toEmail,
  name,
  daysLeft,
  eligibleDate,
  loginUrl,
}: {
  toEmail: string
  name: string | null
  /** Hoeveel dagen er nog zijn. 0 = de termijn is al verstreken; de brief loopt dan vanaf vandaag. */
  daysLeft: number
  /** De datum waarop de wettelijke bewaartermijn afloopt, ISO. */
  eligibleDate: string
  loginUrl: string | null
}) {
  const datum = new Date(eligibleDate).toLocaleDateString('nl-NL', {
    day: 'numeric', month: 'long', year: 'numeric',
  })
  const aanhef = name?.trim() ? `Beste ${escapeHtml(name.trim())},` : 'Beste ondernemer,'
  // De belofte is "minstens 30 dagen". Is de termijn al verstreken, dan begint die dertig dagen
  // vandaag — nooit korter, nooit met terugwerkende kracht.
  const termijn =
    daysLeft > 0
      ? `Op <strong>${datum}</strong> loopt de wettelijke bewaartermijn van je administratie af.`
      : `De wettelijke bewaartermijn van je administratie is verstreken (${datum}).`

  const knop = loginUrl
    ? `<p style="margin:24px 0;"><a href="${loginUrl}" style="background:#1a73e8; color:#fff; padding:12px 20px; border-radius:8px; text-decoration:none; display:inline-block;">Inloggen en exporteren</a></p>`
    : `<p style="color:#555;">Log in op boekbrug.nl om je gegevens te exporteren.</p>`

  const __sendResult = await getResend().emails.send({
    from: 'BoekBrug <noreply@boekbrug.nl>',
    to: toEmail,
    subject: 'Je administratie bij BoekBrug wordt over 30 dagen verwijderd',
    html: `
      <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto; padding: 32px;">
        <h2 style="color: #202124;">Nog 30 dagen om je administratie op te halen</h2>
        <p style="color: #555;">${aanhef}</p>
        <p style="color: #555;">${termijn} Over <strong>30 dagen</strong> verwijderen wij je gegevens definitief.</p>
        <p style="color: #555;">Tot die tijd kun je alles nog kosteloos exporteren — je facturen, je bonnen en je documenten, in één bestand. Daarna is het weg, en dat kunnen wij niet ongedaan maken.</p>
        ${knop}
        <p style="color: #555; font-size: 13px;">Wil je je administratie langer bewaren? Dat kan met de Bewaarkluis. Log in en kies zelf tot welk jaar.</p>
        <p style="color: #5f6368; font-size: 12px; margin-top: 32px;">Je krijgt deze mail omdat je BoekBrug-account is beëindigd en wij je administratie sindsdien hebben bewaard. Dit is de aankondiging uit artikel 5.7.5 van onze voorwaarden.</p>
        <p style="color: #5f6368; font-size: 12px;">BoekBrug — De brug tussen jou en je boekhouder</p>
      </div>
    `,
  })
  await deliverEmail(__sendResult, { label: 'retention-warning', critical: true })
}

/**
 * [FEEDBACK] Tell the operator an owner reported a problem.
 *
 * BEST-EFFORT ON PURPOSE, and the direction matters: the ROW in `feedback` is the truth. A report
 * that existed only as an e-mail would be lost the moment Resend rejected it or the key was
 * missing — which is exactly the silence this whole feature exists to end. So the route stores
 * first, sends second, and a failure here changes nothing about whether the report was received.
 *
 * Returns whether it was delivered, so the caller can log the difference instead of assuming.
 */
export async function sendFeedbackNotification({
  toEmail,
  fromEmail,
  message,
  pagePath,
  hasImage,
}: {
  toEmail: string
  fromEmail: string
  message: string
  pagePath: string | null
  hasImage: boolean
}): Promise<boolean> {
  const __sendResult = await getResend().emails.send({
    from: 'BoekBrug <noreply@boekbrug.nl>',
    to: toEmail,
    // The reporter's address as reply-to, so answering is one tap and does not need a lookup.
    replyTo: fromEmail,
    subject: `Feedback${pagePath ? ` — ${pagePath}` : ''}`,
    html: `
      <div style="font-family: sans-serif; max-width: 560px; margin: 0 auto; padding: 32px;">
        <h2 style="color: #202124;">Nieuwe melding</h2>
        <p style="color:#555; margin:0 0 4px;"><strong>Van:</strong> ${escapeHtml(fromEmail)}</p>
        <p style="color:#555; margin:0 0 4px;"><strong>Pagina:</strong> ${escapeHtml(pagePath ?? 'onbekend')}</p>
        <p style="color:#555; margin:0 0 16px;"><strong>Schermafbeelding:</strong> ${hasImage ? 'ja' : 'nee'}</p>
        <div style="background:#f8f9fa; border-radius:12px; padding:16px; border-left:3px solid #1a73e8;">
          <p style="margin:0; color:#202124; white-space:pre-wrap;">${escapeHtml(message)}</p>
        </div>
        <p style="color:#aaa; font-size:12px; margin-top:32px;">De melding staat ook in de tabel <code>feedback</code>.</p>
      </div>
    `
  })
  return deliverEmail(__sendResult, { label: 'feedback-notification', critical: false })
}

/**
 * [OFFERTE-VERSTUREN] Mail a QUOTE to the customer — as a quote.
 *
 * Not sendInvoiceToClient with different words. That function is invoice-shaped all the way
 * through: "Factuur", "Factuurnummer", "Vervaldatum", a payment request, and an attachment named
 * after an invoice. A quote has none of those. It has no number (it is in no series), its date is
 * a VALIDITY date and not a due date, and the one thing it must say — that it is vrijblijvend, non
 * binding — is the whole difference between a proposal and a bill. Reusing the invoice mail would
 * have put a customer under the impression they owed money for work they had not agreed to.
 *
 * Returns whether it was delivered. The caller reports that: an owner who thinks their quote is
 * with the customer, and waits, is worse off than one who knows it bounced.
 */
export async function sendOfferteToClient({
  toEmail,
  clientName,
  senderName,
  senderEmail,
  totalInc,
  validUntil,
  offerteDate,
  pdfBuffer,
  fileName,
  akkoordUrl,
}: {
  toEmail: string
  clientName: string
  senderName: string
  /**
   * [OFFERTE-AKKOORD] De link waarop de klant met één tik ja of nee zegt.
   *
   * Optioneel: bestaat het token niet (de migratie staat nog open, of de schrijfbeurt mislukte),
   * dan gaat exact de mail uit die hier altijd al uitging — met "antwoord op deze mail". Een knop
   * naar een pagina die niet bestaat is erger dan geen knop.
   */
  akkoordUrl?: string | null
  /**
   * [OFFERTE-ANTWOORD] Waar het "ja" naartoe moet.
   *
   * Deze mail vraagt om een akkoord — dat is de hele reden dat hij bestaat — en ging uit vanaf
   * noreply@boekbrug.nl zonder reply-to. Op "Beantwoorden" drukken, wat de klant als eerste doet,
   * stuurde het antwoord dus nergens heen. En de PDF eronder helpt niet: het afzenderblok draagt
   * naam, adres, KvK, btw-nummer en IBAN — geen e-mailadres en geen telefoonnummer. Een klant die
   * ja wilde zeggen had letterlijk geen adres om het naartoe te sturen.
   */
  senderEmail?: string | null
  totalInc: number
  /** ISO date — "Geldig tot", the quote's own deadline. Optional: a quote need not expire. */
  validUntil?: string | null
  offerteDate?: string | null
  pdfBuffer?: Buffer
  fileName?: string
}): Promise<boolean> {
  // Geen bedrag is beter dan een verkeerd bedrag: is het totaal onbekend, dan zwijgt deze regel en
  // staat het echte bedrag nog steeds in de PDF. "€ 0,00" naast een offerte van duizend euro is de
  // soort tegenspraak waar een klant terecht over belt.
  // [OFFERTE-MAILTEKST] De tekst zelf is puur en woont bij het onderwerp en de bestandsnaam, in
  // offerte-send.ts. Wat hier overblijft is de envelop: van wie, naar wie, waar het antwoord heen
  // gaat en wat eraan hangt.
  const antwoordAdres = (senderEmail ?? '').trim()

  const __sendResult = await getResend().emails.send({
    from: customerMailFrom(senderName),
    to: toEmail,
    // [OFFERTE-ANTWOORD] Beantwoorden komt bij de ondernemer terecht, niet bij noreply@.
    ...(antwoordAdres ? { replyTo: antwoordAdres } : {}),
    subject: offerteSubject(senderName),
    html: offerteEmailHtml({ clientName, senderName, senderEmail, totalInc, validUntil, offerteDate, akkoordUrl }),
    ...(pdfBuffer
      ? { attachments: [{ filename: fileName || 'offerte.pdf', content: pdfBuffer }] }
      : {}),
  })
  return deliverEmail(__sendResult, { label: 'offerte-to-client', critical: false })
}
