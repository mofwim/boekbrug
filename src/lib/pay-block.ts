// src/lib/pay-block.ts
// [BETAALBLOK] The payment instructions that go INSIDE the mail asking for money.
// Pure. No I/O. Run: npx tsx --test src/lib/pay-block.test.ts
//
// ── WHY THIS EXISTS ──
// The invoice mail said what was owed and by when, and gave the customer no way to pay it. The
// IBAN, the reference and the scan-to-pay QR lived in one place only: inside the attached PDF —
// and a QR code on the same phone screen that is reading the mail cannot be scanned. So the
// customer who WANTS to pay has to open an attachment, find the number, and type it into their
// banking app from another window.
//
// Meanwhile the product already has the good version of this. /pay/[token] is a finished public
// page with the IBAN, the amount, the reference, an EPC QR and — where the owner connected Mollie
// — an iDEAL button. Its security boundary (toPublicPayView) was written and tested. The only way
// a customer ever reached it was the owner pressing "Betaalverzoek" by hand and sending them the
// link themselves.
//
// Worse on the chasing side: every reminder tier, up to and including the statutory aanmaning that
// names collection costs, went out with no payment details at all. A letter that threatens costs
// and does not say where to transfer the money is a letter that generates a phone call, not a
// payment.
//
// ── WHY IT IS ITS OWN MODULE AND NOT TWO COPIES IN email.ts ──
// Two mails need the identical block (the invoice and every reminder), and one of them is a legal
// document. The day the IBAN line changes it has to change in both, and a block that drifts
// between the invoice and its own reminder is exactly the inconsistency a customer reads as
// "which of these is real?".
//
// ── LANGUAGE ──
// Dutch, and not through the catalogue. This is the mail to the CUSTOMER, which AGENTS.md lists
// among the things that are never translated: it is read by a Dutch customer and their
// bookkeeper, not by the owner's language setting. Same rule as the invoice PDF it accompanies.

import { escapeHtml } from './escape-html'
import { formatEuroNL } from './format-nl'

export interface PayBlockInput {
  /** Absolute https URL of the public pay page, when the invoice has a token. */
  payUrl?: string | null
  /** The owner's own IBAN — the beneficiary account. Already normalised upstream. */
  iban?: string | null
  /** Who the account is in the name of, as it should be typed into a banking app. */
  beneficiaryName?: string | null
  /** What is STILL open, never the original total when part of it is already settled. */
  amount?: number | null
  /** The payment reference (usually the invoice number) the owner reconciles on. */
  reference?: string | null
}

export interface PayBlock {
  /** An HTML fragment, ready to drop into the mail body. */
  html: string
  /** The plain-text twin, as lines. Same facts, no markup. */
  textLines: string[]
}

/**
 * The payment block, or null when there is nothing honest to put in one.
 *
 * Null is a real answer and the common one for an owner who never filled in an IBAN: a heading
 * that says "Betalen" above no account number is worse than no heading, because it reads as
 * something that failed to load.
 */
export function buildPayBlock(input: PayBlockInput): PayBlock | null {
  const payUrl = (input.payUrl ?? '').trim()
  const iban = (input.iban ?? '').trim()
  // Only https, and only an absolute URL. This string is pasted into an anchor in an e-mail; a
  // caller that hands over a path or something javascript-shaped must not be able to make a link
  // out of it here.
  const link = /^https:\/\/[^\s"'<>]+$/.test(payUrl) ? payUrl : ''
  if (!link && !iban) return null

  const beneficiary = (input.beneficiaryName ?? '').trim()
  const reference = (input.reference ?? '').trim()
  const amount = typeof input.amount === 'number' && Number.isFinite(input.amount) && input.amount > 0
    ? input.amount
    : null

  // The link first, because it is the one action that needs no typing — and on the phone the mail
  // is being read on, it is the only one that works without switching apps.
  const knop = link
    ? `<p style="margin:0 0 14px;">
         <a href="${escapeHtml(link)}" style="display:inline-block; background:#1a73e8; color:#fff; text-decoration:none; font-weight:600; padding:11px 20px; border-radius:22px;">Betaal deze factuur</a>
       </p>
       <p style="margin:0 0 14px; color:#5f6368; font-size:13px;">Op die pagina staan je betaalgegevens en een QR-code die je met je bank-app kunt scannen.</p>`
    : ''

  // …and the details beside it, for the customer who pays from their own banking app, from a
  // desktop, or who forwards this mail to whoever does the payments. That person never taps a
  // button, and until now they got nothing at all.
  const regels: string[] = []
  if (iban) regels.push(`<strong>IBAN:</strong> ${escapeHtml(iban)}`)
  if (iban && beneficiary) regels.push(`<strong>Ten name van:</strong> ${escapeHtml(beneficiary)}`)
  if (amount !== null) regels.push(`<strong>Bedrag:</strong> ${formatEuroNL(amount)}`)
  if (reference) regels.push(`<strong>Kenmerk:</strong> ${escapeHtml(reference)}`)

  const detail = regels.length > 0
    ? `<div style="background:#f8f9fa; border-radius:12px; padding:14px 16px;">
         ${regels.map((r) => `<p style="margin:4px 0; color:#202124;">${r}</p>`).join('\n         ')}
       </div>`
    : ''

  const html = `
      <div style="border:1px solid #d3e3fd; border-radius:12px; padding:16px 18px; margin:20px 0;">
        <p style="margin:0 0 12px; font-weight:600; color:#202124;">Betalen</p>
        ${knop}
        ${detail}
      </div>`

  const textLines: string[] = ['Betalen']
  if (link) textLines.push(link)
  if (iban) textLines.push(`IBAN: ${iban}`)
  if (iban && beneficiary) textLines.push(`Ten name van: ${beneficiary}`)
  if (amount !== null) textLines.push(`Bedrag: ${formatEuroNL(amount)}`)
  if (reference) textLines.push(`Kenmerk: ${reference}`)

  return { html, textLines }
}
