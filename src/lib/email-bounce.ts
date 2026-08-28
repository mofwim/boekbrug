// src/lib/email-bounce.ts
// [BOUNCE] What a Resend webhook is telling us, and whether we may believe it.
// Pure. No I/O. Run: npx tsx --test src/lib/email-bounce.test.ts
//
// ── WHY THIS EXISTS ──
// The app sends an invoice, Resend accepts it, and the invoice says "verstuurd". If the address
// was deliverable-looking but wrong, the message hard-bounces MINUTES LATER — and nothing in this
// product was listening. The invoice stayed "verstuurd", every reminder tier went to the same dead
// mailbox, and the owner found out at non-payment, months on, with no way to tell a customer who
// never received the invoice from one who is refusing to pay.
//
// The send path is already honest about what it CAN know: a rejection at send time throws and
// becomes the email_failed recovery screen. This is the half it could never know, because it
// happens after the API call returns.
//
// ── TWO DECISIONS THIS MODULE MAKES, AND WHY THEY ARE HERE ──
//
// 1. WHICH EVENTS COUNT. A hard bounce ("this mailbox does not exist") and a spam complaint both
//    mean: stop sending here. A SOFT bounce (a full mailbox, a server having a bad afternoon) does
//    not — the mailbox is real and tomorrow's reminder may well arrive. Treating a full inbox as a
//    dead address would silence the dunning of a customer who is simply on holiday.
// 2. WHAT THE SIGNATURE PROVES. Resend signs with Svix. Getting that verification subtly wrong is
//    the kind of thing that looks fine forever: an endpoint that accepts anything, on which a
//    stranger can pause an owner's payment reminders by posting one JSON body.
//
// Both are decisions, not I/O, so both are testable without a network and are tested.

import { createHmac, timingSafeEqual } from 'node:crypto'

/** What we do with an event. */
export type BounceVerdict =
  /** The address is dead or unwelcome. Stop sending to it and tell the owner. */
  | 'stop'
  /** Temporary. The mailbox is real; the next attempt may land. */
  | 'transient'
  /** Not about deliverability at all (delivered, opened, clicked…). */
  | 'ignore'

/**
 * Resend's event types, as of the v6 API. An unknown type is 'ignore' and never 'stop': a webhook
 * that pauses an owner's reminders on an event we do not understand is worse than one that misses
 * a bounce.
 */
export function classifyEmailEvent(type: unknown, bounceType?: unknown): BounceVerdict {
  if (typeof type !== 'string') return 'ignore'
  if (type === 'email.complained') return 'stop'
  if (type === 'email.bounced') {
    // Resend reports the bounce class. A soft bounce is a full mailbox or a server hiccup: the
    // address is real, so the next reminder may well arrive and we must not silence it.
    const soort = typeof bounceType === 'string' ? bounceType.toLowerCase() : ''
    if (soort === 'soft' || soort === 'transient' || soort === 'undetermined') return 'transient'
    return 'stop'
  }
  return 'ignore'
}

/** The recipient the event is about, from the shapes Resend has used for `to`. */
export function recipientOf(data: unknown): string | null {
  if (!data || typeof data !== 'object') return null
  const to = (data as { to?: unknown }).to
  const eerste = Array.isArray(to) ? to[0] : to
  if (typeof eerste !== 'string') return null
  const adres = eerste.trim().toLowerCase()
  // A display-name form ("Jan <jan@x.nl>") is not what Resend sends, but reading it costs one line
  // and guessing wrong here means pausing reminders on the wrong invoices.
  const punt = /<([^>]+)>/.exec(adres)
  const schoon = (punt ? punt[1] : adres).trim()
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(schoon) ? schoon : null
}

export interface SvixHeaders {
  id: string | null
  timestamp: string | null
  signature: string | null
}

/**
 * Does this body actually come from Resend?
 *
 * The Svix scheme: HMAC-SHA256 over `${id}.${timestamp}.${body}` with the secret that follows
 * `whsec_`, base64-encoded. The header carries a space-separated list of `v1,<sig>` — a LIST,
 * because a secret being rotated is signed with both. Checking only the first would reject every
 * delivery during a rotation.
 *
 * `tolerantieSeconden` guards replay: a body someone captured and re-posts a week later verifies
 * perfectly against the same secret. Five minutes is Svix's own recommendation.
 */
export function verifySvixSignature({
  body, headers, secret, nowMs, tolerantieSeconden = 300,
}: {
  body: string
  headers: SvixHeaders
  secret: string
  nowMs: number
  tolerantieSeconden?: number
}): boolean {
  const { id, timestamp, signature } = headers
  if (!id || !timestamp || !signature || !secret) return false

  const seconden = Number(timestamp)
  if (!Number.isFinite(seconden)) return false
  const verschil = Math.abs(nowMs / 1000 - seconden)
  if (verschil > tolerantieSeconden) return false

  // `whsec_` is a prefix on the printed form, not part of the key.
  const sleutel = Buffer.from(secret.startsWith('whsec_') ? secret.slice(6) : secret, 'base64')
  if (sleutel.length === 0) return false

  const verwacht = createHmac('sha256', sleutel).update(`${id}.${timestamp}.${body}`).digest()

  for (const deel of signature.split(' ')) {
    const komma = deel.indexOf(',')
    if (komma < 0) continue
    if (deel.slice(0, komma) !== 'v1') continue
    let gegeven: Buffer
    try { gegeven = Buffer.from(deel.slice(komma + 1), 'base64') } catch { continue }
    // Length first: timingSafeEqual THROWS on a length mismatch, and a throw here would be a 500
    // on an unsigned request — an error page that tells an attacker their guess was the wrong size.
    if (gegeven.length !== verwacht.length) continue
    if (timingSafeEqual(gegeven, verwacht)) return true
  }
  return false
}
