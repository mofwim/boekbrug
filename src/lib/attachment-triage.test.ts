// [OVERSLAG-ZICHTBAAR] Pure node test — run: npx tsx --test src/lib/attachment-triage.test.ts
//
// ── THE RULE THIS FILE HOLDS ──
// An attachment that arrived and was not read is either NOISE or A FILE THE OWNER MUST HEAR ABOUT.
// There is no third bucket, and the app may not decide silently that something belongs in the
// first one because it happens to be small or oddly named.
//
// The bug: te groot, te klein and unreadable-format all left through the same `return false` as a
// logo in a signature. The skipped panel — the ONE surface where the app admits something came in
// that it did not read — then reported "Niets overgeslagen" about an e-mail that carried an
// invoice. That sentence is what makes an entrepreneur stop looking.
//
// So the tests below are mostly about the SPLIT, not about the drop: which refusals speak, which
// stay quiet, and — the part that is easy to get wrong — that making them speak did not change one
// single import decision.

import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  triageAttachment,
  unreadableFormatReason,
  isLikelyInvoiceCandidate,
  attachmentSkipReason,
} from './email-integration'

const img = (filename: string, size: number) => ({ filename, mimeType: 'image/png', size })
const pdf = (filename: string, size: number) => ({ filename, mimeType: 'application/pdf', size })
const MB = 1024 * 1024

test('[OVERSLAG-ZICHTBAAR] the reorder changed no import decision at all', () => {
  // The name rule moved AHEAD of the size rule so a 3 KB logo is attributed to "chrome" instead of
  // "too small" — otherwise reporting the size rule would bury the panel under forty signatures.
  // Both rules refuse, so the set of files that gets through must be bit-for-bit identical. This is
  // the test that says so, because "we only changed the reasons" is a claim, not a fact.
  const cases: Array<[{ filename: string; mimeType: string; size: number }, boolean]> = [
    // must keep — a false drop is a missing number in an aangifte
    [pdf('factuur.pdf', 5000), true],
    [pdf('inv.pdf', 3000), true],
    [pdf('net-goed.pdf', 10 * MB), true],
    [img('iconic-foods-factuur.png', 50000), true],
    [img('banner-print-invoice.png', 40000), true],
    [img('logomakers-2026.png', 60000), true],
    [img('IMG_2938.jpg', 30000), true],
    [img('kassabon.jpg', 15000), true],
    [img('scan.png', 0), true],
    [img('scan_20260703.png', 45000), true],
    [img('image12.png', 30000), true],
    [img('att123.png', 30000), true],
    // must drop
    [pdf('inkoopfactuur-groot.pdf', 12 * MB), false],
    [img('image001.png', 8000), false],
    [img('ATT00001.png', 5000), false],
    [img('logo.png', 9000), false],
    [img('logo.png', 50000), false],
    [img('logo2.png', 7000), false],
    [img('signature.png', 6000), false],
    [img('sig.png', 4000), false],
    [img('whatever.png', 5000), false],
  ]
  for (const [att, keep] of cases) {
    assert.equal(triageAttachment(att).keep, keep, `${att.filename} @ ${att.size}`)
    assert.equal(isLikelyInvoiceCandidate(att), keep, `${att.filename} — wrapper must agree`)
  }
})

test('[OVERSLAG-ZICHTBAAR] a small image that is not recognisable chrome now speaks', () => {
  // THE GAP. A 5 KB image called "whatever.png" was dropped with exactly the same silence as a
  // logo. A heavily compressed till receipt at 8 KB is rare — but it exists, and when it happens
  // the panel is the only trace that it ever arrived.
  const t = triageAttachment(img('bonnetje.jpg', 8000))
  assert.equal(t.keep, false, 'still dropped — the volume argument has not changed')
  assert.equal(t.kind, 'too-small')
  assert.ok(t.reason, 'but it is no longer silent')
  assert.match(t.reason ?? '', /12 KB/, 'it names the rule that caught it')
  assert.match(t.reason ?? '', /Uploaden/, 'and the way out that really exists')
})

test('[OVERSLAG-ZICHTBAAR] recognisable chrome stays silent, whatever its size', () => {
  // The other half of the same rule. A panel that lists forty signatures is a panel nobody opens,
  // and then the one real invoice in it is invisible — which is the failure this whole file exists
  // to prevent, arrived at from the other side.
  for (const name of ['logo.png', 'signature.png', 'image001.png', 'ATT00001.png', 'pixel.png']) {
    for (const size of [800, 5000, 50000]) {
      const t = triageAttachment(img(name, size))
      assert.equal(t.keep, false, `${name} must still be dropped`)
      assert.equal(t.reason, null, `${name} @ ${size} must stay silent`)
      assert.equal(t.kind, null)
    }
  }
})

test('[OVERSLAG-ZICHTBAAR] under 2 KB nothing legible can exist, so nothing is claimed', () => {
  // Not taste — arithmetic. A tracking pixel is 43 bytes and a bare JPEG header is ~600. Writing a
  // line about a 900-byte image is writing a line about nothing, and every such line costs the
  // panel a little of the attention the real ones need.
  const t = triageAttachment(img('a1b2c3.gif', 900))
  assert.equal(t.keep, false)
  assert.equal(t.reason, null)

  // But the band directly above it is exactly where a compressed receipt can land — that one speaks.
  assert.ok(triageAttachment(img('a1b2c3.gif', 2048)).reason)
})

test('[OVERSLAG-ZICHTBAAR] an unknown size is never treated as small', () => {
  // Providers report 0 for "unknown" on inline and forwarded parts. Reading that as "tiny" would
  // drop real invoices, so 0 passes the gate and the real byte length is checked after download.
  assert.equal(triageAttachment(img('scan.png', 0)).keep, true)
  assert.equal(triageAttachment(img('scan.png', 0)).reason, null)
})

test('[OVERSLAG-ZICHTBAAR] too big still speaks, and says how to get around it', () => {
  const groot = pdf('inkoopfactuur-groot.pdf', 12 * MB)
  const t = triageAttachment(groot)
  assert.equal(t.keep, false)
  assert.equal(t.kind, 'oversized')
  assert.match(t.reason ?? '', /10 MB/)
  assert.match(t.reason ?? '', /splits|foto/i)
  // The wrapper the older test uses must keep returning the same sentence.
  assert.equal(attachmentSkipReason(groot), t.reason)
})

test('[OVERSLAG-ZICHTBAAR] a format we cannot open is reported, not swallowed', () => {
  // This was the quietest path in the whole import. A .xlsx invoice, an iPhone .heic photo of a
  // receipt, a zipped invoice bundle or a forwarded .eml all failed normalizeAttachmentMime and
  // vanished without a single trace anywhere in the app.
  for (const name of ['factuur-juli.xlsx', 'nota.docx', 'bon.heic', 'facturen-q2.zip', 'doorgestuurd.eml']) {
    const reason = unreadableFormatReason(name)
    assert.ok(reason, `${name} must be reported`)
    assert.match(reason ?? '', /Uploaden/, `${name}: the way out is named`)
  }
  assert.match(unreadableFormatReason('factuur-juli.xlsx') ?? '', /\.xlsx/, 'it names the type')
})

test('[OVERSLAG-ZICHTBAAR] mail plumbing is not reported — the list is closed and checkable', () => {
  // Reported BY DEFAULT, silent only for a short explicit list. That direction matters: a list of
  // "what is an invoice" guesses wrong forever; a list of "what is calendar traffic" is finite.
  for (const name of [
    'uitnodiging.ics', 'kaartje.vcf', 'smime.p7s', 'winmail.dat',
    'logo.svg', 'bericht.txt', 'oledata.mso',
    'image001.svg', 'ATT00001.txt', // chrome names, whatever the extension
    'geen-extensie',
  ]) {
    assert.equal(unreadableFormatReason(name), null, `${name} must stay silent`)
  }
})

test('[OVERSLAG-ZICHTBAAR] the two wrappers can never disagree with the gate', () => {
  // isLikelyInvoiceCandidate and attachmentSkipReason are the same decision seen from two sides.
  // They used to be two implementations; a drift between them is a file that is dropped by one and
  // accounted for by the other — i.e. lost while looking accounted for.
  const samples = [
    pdf('a.pdf', 100), pdf('a.pdf', 11 * MB), img('logo.png', 3000),
    img('bon.jpg', 6000), img('bon.jpg', 60000), img('x.png', 0),
  ]
  for (const s of samples) {
    const t = triageAttachment(s)
    assert.equal(isLikelyInvoiceCandidate(s), t.keep)
    assert.equal(attachmentSkipReason(s), t.reason)
    // A refusal either carries BOTH a reason and a kind, or neither. Half of one is a row in the
    // panel with no reason, or a notification rule that cannot tell which case it is looking at.
    assert.equal(t.reason === null, t.kind === null, `${s.filename}: reason and kind travel together`)
  }
})
