// src/lib/mail-merk.ts
// [MERK-KOP] The BoekBrug wordmark at the top of a mail, and the link home under it.
//
// Not one mail this app sends carries a brand header. Every one opens straight into a sentence,
// which is why the morning digest reads like a machine note rather than like post from a product
// the owner pays for — and why, in a mailbox of forty unread, it is not recognisable at a glance.
//
// ── WHY A WORDMARK AND NOT THE LOGO IMAGE ──
//
// This is the one decision in this file worth arguing, because the obvious answer is wrong.
//
// Gmail, Outlook and Apple Mail block remote images by default, and Apple's Mail Privacy
// Protection proxies or suppresses them even when they load. An <img> logo therefore reaches most
// readers as a grey box, an alt-text stub, or nothing at all — so the mail that was supposed to be
// instantly recognisable opens with a hole where its identity should be. That is worse than the
// plain sentence it replaced.
//
// A wordmark set in TEXT renders in every client, at any width, with images off, in dark mode, and
// it costs no request. It is also the only version that cannot be mistaken for a tracking pixel,
// which matters for a mail whose deliverability was fought for once already ([BEZORGING]).
//
// ── AND THE BOUNDARY THAT MUST NOT MOVE ──
//
// This header belongs on a mail BoekBrug sends to ITS OWN user — the owner, their accountant, an
// invitee. It must NEVER appear on the invoice mail an owner sends their customer. That message is
// the owner's, to their customer, about their money; putting our name at the top of it would brand
// someone else's business correspondence with our product. [EIGEN-MARKER] drew that line on the
// PDF for the same reason, and a gate holds it here.
//
// Pure. Run: npx tsx --test src/lib/mail-merk.test.ts

import { escapeHtml } from "./escape-html";

/**
 * The brand blue. Already written by hand in a dozen mails and screens, in two different casings;
 * a second definition of a colour is how two mails come to be almost the same blue.
 */
export const MERK_BLAUW = "#1A73E8";

/**
 * The header: the wordmark as a link home, and the blue rule under it.
 *
 * `baseUrl` is the absolute origin, because a mail has no origin of its own — a root-relative href
 * in an inbox resolves against the mail client, which is nowhere.
 */
export function merkKop(baseUrl: string): string {
  const home = `${escapeHtml(baseUrl)}/dashboard`;
  return `
      <a href="${home}" style="display: inline-block; text-decoration: none; color: ${MERK_BLAUW}; font-size: 20px; font-weight: 700; letter-spacing: -0.2px;">BoekBrug</a>
      <div style="height: 3px; background: ${MERK_BLAUW}; border-radius: 2px; margin: 6px 0 18px; width: 44px;"></div>`;
}

/**
 * The closing line: what this product is, and the way out.
 *
 * The opt-out sentence is the caller's, because only the caller knows which mail this is and where
 * it is switched off — a footer that guesses sends the owner to a setting that does not exist.
 */
export function merkVoet(baseUrl: string, afmeldZin: string): string {
  return `
      <p style="color: #a0a0a5; font-size: 12px; margin-top: 24px; line-height: 1.6;">
        ${escapeHtml(afmeldZin)}<br />
        <a href="${escapeHtml(baseUrl)}/dashboard" style="color: #a0a0a5;">BoekBrug</a> — de brug tussen jou en je boekhouder
      </p>`;
}
