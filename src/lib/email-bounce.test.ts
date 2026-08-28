// src/lib/email-bounce.test.ts
// Run: npx tsx --test src/lib/email-bounce.test.ts

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'

import { classifyEmailEvent, recipientOf, verifySvixSignature } from './email-bounce'

test('[BOUNCE] a dead mailbox stops the sending; a full one does not', () => {
  assert.equal(classifyEmailEvent('email.bounced', 'Permanent'), 'stop')
  assert.equal(classifyEmailEvent('email.bounced', 'hard'), 'stop')
  assert.equal(classifyEmailEvent('email.complained'), 'stop')

  // A full mailbox or a server having a bad afternoon: the address is REAL. Silencing the dunning
  // of a customer who is merely on holiday is the expensive half of this feature going wrong.
  assert.equal(classifyEmailEvent('email.bounced', 'Soft'), 'transient')
  assert.equal(classifyEmailEvent('email.bounced', 'transient'), 'transient')
  assert.equal(classifyEmailEvent('email.bounced', 'Undetermined'), 'transient')

  // Everything else is not about deliverability.
  for (const t of ['email.sent', 'email.delivered', 'email.opened', 'email.clicked']) {
    assert.equal(classifyEmailEvent(t), 'ignore', t)
  }

  // An event type we do not know may never stop an owner's reminders. Missing a bounce is
  // recoverable; silently pausing the chasing of a paying customer is not.
  assert.equal(classifyEmailEvent('email.something_new'), 'ignore')
  assert.equal(classifyEmailEvent(undefined), 'ignore')
  assert.equal(classifyEmailEvent(42), 'ignore')
  assert.equal(classifyEmailEvent(null), 'ignore')
})

test('[BOUNCE] the recipient is read from the shapes Resend uses, or not at all', () => {
  assert.equal(recipientOf({ to: ['Jan@Bedrijf.NL'] }), 'jan@bedrijf.nl')
  assert.equal(recipientOf({ to: 'jan@bedrijf.nl' }), 'jan@bedrijf.nl')
  assert.equal(recipientOf({ to: ['Jan de Vries <jan@bedrijf.nl>'] }), 'jan@bedrijf.nl')

  // Anything that is not an address yields null, and the caller then does NOTHING — this value
  // selects which invoices get their reminders paused.
  assert.equal(recipientOf({ to: [] }), null)
  assert.equal(recipientOf({ to: 'geen adres' }), null)
  assert.equal(recipientOf({}), null)
  assert.equal(recipientOf(null), null)
  assert.equal(recipientOf('jan@bedrijf.nl'), null)
})

// ── The signature ────────────────────────────────────────────────────────────────────────────
const SECRET = 'whsec_' + Buffer.from('een-geheim-van-voldoende-lengte').toString('base64')
const NOW = Date.parse('2026-08-28T12:00:00Z')

function tekenen(body: string, id: string, ts: string, secret = SECRET): string {
  const sleutel = Buffer.from(secret.slice(6), 'base64')
  return 'v1,' + createHmac('sha256', sleutel).update(`${id}.${ts}.${body}`).digest('base64')
}

test('[BOUNCE] a correctly signed body is accepted', () => {
  const body = '{"type":"email.bounced"}'
  const id = 'msg_1'
  const ts = String(Math.floor(NOW / 1000))
  assert.equal(
    verifySvixSignature({ body, headers: { id, timestamp: ts, signature: tekenen(body, id, ts) }, secret: SECRET, nowMs: NOW }),
    true,
  )
})

test('[BOUNCE] every way of being wrong is refused', () => {
  const body = '{"type":"email.bounced"}'
  const id = 'msg_1'
  const ts = String(Math.floor(NOW / 1000))
  const goed = tekenen(body, id, ts)
  const roep = (o: Partial<Parameters<typeof verifySvixSignature>[0]>) =>
    verifySvixSignature({ body, headers: { id, timestamp: ts, signature: goed }, secret: SECRET, nowMs: NOW, ...o })

  // A changed body: the whole point.
  assert.equal(roep({ body: '{"type":"email.delivered"}' }), false)
  // Another secret — someone who knows the URL but not the key.
  assert.equal(roep({ secret: 'whsec_' + Buffer.from('een-ander-geheim-dat-niet-klopt').toString('base64') }), false)
  // No secret configured at all may never verify. This is the fail-closed case: an env var that
  // was forgotten on a deploy must not turn the endpoint into an open door.
  assert.equal(roep({ secret: '' }), false)
  // Missing headers.
  assert.equal(roep({ headers: { id: null, timestamp: ts, signature: goed } }), false)
  assert.equal(roep({ headers: { id, timestamp: null, signature: goed } }), false)
  assert.equal(roep({ headers: { id, timestamp: ts, signature: null } }), false)
  // A signature over a DIFFERENT id: the id is part of the signed content precisely so one
  // delivery's signature cannot be pasted onto another.
  assert.equal(roep({ headers: { id: 'msg_2', timestamp: ts, signature: goed } }), false)
  // Garbage in the header, in the shapes that could throw rather than return false.
  for (const sig of ['', 'nonsense', 'v1', 'v1,', 'v2,' + goed.slice(3), '!!!not-base64!!!']) {
    assert.equal(roep({ headers: { id, timestamp: ts, signature: sig } }), false, sig)
  }
  // A signature of the wrong LENGTH must be refused, not throw: timingSafeEqual throws on a length
  // mismatch, and a 500 here tells an attacker their guess was the wrong size.
  assert.equal(roep({ headers: { id, timestamp: ts, signature: 'v1,' + Buffer.from('kort').toString('base64') } }), false)
  assert.equal(roep({ headers: { id, timestamp: ts, signature: 'v1,c2hvcnQ=' } }), false)
})

test('[BOUNCE] a captured body cannot be replayed a week later', () => {
  const body = '{"type":"email.bounced"}'
  const id = 'msg_1'
  const oud = String(Math.floor((NOW - 7 * 24 * 3600_000) / 1000))
  // Signed perfectly, with the real secret — and still refused, because it is old.
  assert.equal(
    verifySvixSignature({ body, headers: { id, timestamp: oud, signature: tekenen(body, id, oud) }, secret: SECRET, nowMs: NOW }),
    false,
  )
  // Just inside the window is fine, either side of now — clocks drift both ways.
  for (const verschuiving of [-240, 240]) {
    const ts = String(Math.floor(NOW / 1000) + verschuiving)
    assert.equal(
      verifySvixSignature({ body, headers: { id, timestamp: ts, signature: tekenen(body, id, ts) }, secret: SECRET, nowMs: NOW }),
      true,
      String(verschuiving),
    )
  }
  // A timestamp that is not a number is not a timestamp.
  assert.equal(
    verifySvixSignature({ body, headers: { id, timestamp: 'gisteren', signature: goedNietNodig() }, secret: SECRET, nowMs: NOW }),
    false,
  )
  function goedNietNodig() { return tekenen(body, id, 'gisteren') }
})

test('[BOUNCE] a secret in rotation signs with both, and both are accepted', () => {
  // Svix sends a space-separated LIST during a rotation. Checking only the first entry would
  // reject every delivery for as long as the rotation lasts — silently, on the endpoint whose
  // whole job is to notice silence.
  const body = '{"type":"email.bounced"}'
  const id = 'msg_1'
  const ts = String(Math.floor(NOW / 1000))
  const oudeSleutel = 'whsec_' + Buffer.from('het-vorige-geheim-van-die-week').toString('base64')
  const lijst = `${tekenen(body, id, ts, oudeSleutel)} ${tekenen(body, id, ts)}`
  assert.equal(verifySvixSignature({ body, headers: { id, timestamp: ts, signature: lijst }, secret: SECRET, nowMs: NOW }), true)
  assert.equal(verifySvixSignature({ body, headers: { id, timestamp: ts, signature: lijst }, secret: oudeSleutel, nowMs: NOW }), true)
})
