// src/lib/mail-from.ts
// [AFZENDERNAAM] The From header for mail that goes to the ENTREPRENEUR'S OWN CUSTOMER.
// Run: npx tsx --test src/lib/mail-from.test.ts
//
// WHAT WAS WRONG
// Every one of the fifteen senders used `BoekBrug <noreply@boekbrug.nl>`, including the three that
// write to a third party on the owner's behalf: the invoice, the reminder and the quote. So a
// customer of Kiwi Food Market opened an inbox row that said BoekBrug — a name they have no
// relationship with, about an amount they are asked to pay. That reads as spam, and the mail that
// most needs to be recognised is the one asking for money.
//
// WHY THE ADDRESS CANNOT CHANGE, ONLY THE NAME
// The obvious wish is to send AS the owner: From: kfmtilburg@hotmail.com. That is not deliverable.
// Mail is authenticated per DOMAIN — SPF and DKIM are published by whoever owns hotmail.com, and
// their DMARC policy tells receivers to reject anything claiming to be from them that they did not
// sign. Only boekbrug.nl is verified with the mail provider, so the envelope address must stay
// noreply@boekbrug.nl or the mail lands in spam, or nowhere.
//
// The DISPLAY NAME is free, and that is the part a person actually reads. So: the business name,
// then "via BoekBrug", then the address. Exactly the shape GitHub, Slack and Notion use, and for
// the same reason — the recipient sees who it is from AND how it was sent, and neither is hidden.
// The owner's real address goes in Reply-To, which is where the answer belongs anyway.
//
// WHY THIS IS SANITISED AND NOT INTERPOLATED
// company_name is typed by a user and lands in a mail header that reaches strangers. Three things
// follow from that:
//
//   · A newline in a header is header INJECTION. In a JSON API the provider builds the header, so
//     this is defence in depth rather than the only guard — but a From value is exactly the place
//     not to rely on someone else's escaping.
//   · A display name containing `<`, `>` or `@` can be made to look like the real address, which
//     is the classic mail-spoofing trick: `"service@bank.nl" <noreply@boekbrug.nl>` reads as the
//     bank in a narrow client. Those characters come out.
//   · RFC 5322 gives `,` `;` `:` and friends structural meaning in an address list. A perfectly
//     ordinary Dutch trade name — "Jansen, Pietersen & Co" — would parse as TWO recipients and
//     break the header. The name is therefore quoted, always.
//
// "via BoekBrug" is not decoration and is never dropped: it is what stops a display name from
// being a free-form claim about who sent the mail.

/** The only address this product can send from — the one domain that is authenticated. */
export const MAIL_FROM_ADDRESS = "noreply@boekbrug.nl";

/** Shown when there is no usable business name. Also the whole name for internal mail. */
export const MAIL_FROM_FALLBACK = "BoekBrug";

/** A long display name is truncated by clients anyway; cut it where we control the result. */
const MAX_NAME = 60;

/**
 * Strip a user-typed business name down to something safe to put in a header.
 *
 * Returns "" when nothing usable is left, which is the caller's signal to fall back.
 */
export function sanitizeSenderName(name: string | null | undefined): string {
  const cleaned = String(name ?? "")
    // Control characters first: CR and LF are the injection vector, the rest render as nothing.
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    // Address-looking punctuation and the quoting characters themselves.
    .replace(/[<>@"\\]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned.length > MAX_NAME ? cleaned.slice(0, MAX_NAME).trimEnd() : cleaned;
}

/**
 * The From header for a mail sent to the owner's customer.
 *
 * `Kiwi Food Market via BoekBrug <noreply@boekbrug.nl>` — quoted, so a comma in the trade name
 * cannot turn one sender into two.
 */
export function customerMailFrom(businessName: string | null | undefined): string {
  const clean = sanitizeSenderName(businessName);
  // A business already called BoekBrug must not read "BoekBrug via BoekBrug".
  const label = !clean || clean === MAIL_FROM_FALLBACK ? MAIL_FROM_FALLBACK : `${clean} via ${MAIL_FROM_FALLBACK}`;
  return `"${label}" <${MAIL_FROM_ADDRESS}>`;
}
