// [NAREKENEN] Pure node test — run: npx tsx --test src/lib/books-audit.test.ts
//
// [GEGROND] gave every amount an independent witness — from the moment it was built. Every invoice
// booked before that has no verdict and nothing could produce one, which leaves the owner exactly
// where they started: their doubt is about what is ALREADY in the books.
//
// So this is a pass over the existing ones. What is held here is mostly what it may NOT claim.

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { summarizeAudit, auditTitle, auditLines, type AuditedInvoice } from './books-audit'

const row = (o: Partial<AuditedInvoice> & { id: string }): AuditedInvoice => ({
  invoiceNumber: '26302050',
  clientName: 'ATAPACK Cash & Carry B.V.',
  totalIncBtw: 2265.41,
  verdict: 'found',
  ...o,
})

test('[NAREKENEN] a clean pass says how many no longer need checking by hand', () => {
  // The reason an owner runs this: they have been opening the paper invoice beside the app, and
  // they want to know how many of those they can stop opening.
  const s = summarizeAudit([row({ id: 'a' }), row({ id: 'b' }), row({ id: 'c' })])
  assert.equal(s.confirmed, 3)
  assert.deepEqual(s.mismatched, [])
  assert.match(auditTitle(s), /3 facturen nagerekend/)
  assert.match(auditTitle(s), /staan zo op de documenten/)
})

test('[NAREKENEN] a problem leads, never a reassuring number above it', () => {
  // "142 facturen kloppen" with one failure underneath is how a report gets skimmed past the one
  // line that mattered.
  const s = summarizeAudit([
    row({ id: 'ok1' }), row({ id: 'ok2' }),
    row({ id: 'bad', verdict: 'absent', invoiceNumber: '2601291', totalIncBtw: 871.4 }),
  ])
  assert.match(auditTitle(s), /^1 factuur klopt niet/)
  const lines = auditLines(s)
  assert.match(lines[0], /2601291/, 'the failing invoice is named first')
  assert.match(lines[0], /871,40/, 'with the amount that is in question')
  assert.ok(lines.some((l) => /Van de rest staat het bedrag wél/.test(l)), 'the good news comes after')
})

test('[NAREKENEN] it never claims to have fixed anything', () => {
  // An audit that can also correct what it finds is an audit whose results cannot be checked — and
  // on a booked invoice a silent correction moves a figure that may already sit in a filed aangifte.
  const s = summarizeAudit([row({ id: 'bad', verdict: 'absent' })])
  const lines = auditLines(s)
  assert.ok(lines.some((l) => /Wij hebben niets aangepast/.test(l)))
  assert.ok(lines.some((l) => /nagerekend is niet hetzelfde als veranderd/.test(l)))
})

test('[NAREKENEN] the photographs are never counted as fine', () => {
  // The failure that would make this report worthless: saying "everything checks out" while
  // silently skipping every invoice it could not look at. That is a claim about documents nobody
  // opened.
  const s = summarizeAudit([
    row({ id: 'ok' }),
    row({ id: 'foto1', verdict: 'unreadable' }),
    row({ id: 'foto2', verdict: 'unreadable' }),
  ])
  assert.equal(s.confirmed, 1)
  assert.equal(s.unchecked, 2)
  assert.equal(s.examined, 3)
  const lines = auditLines(s)
  assert.ok(lines.some((l) => /2 facturen zijn een foto of scan/.test(l)))
  assert.ok(
    lines.some((l) => /daar zeggen deze cijfers dus niets over/.test(l)),
    'and it says plainly that the other numbers do not cover them',
  )
  // The headline counts only what was actually confirmed — never the unchecked ones.
  assert.match(auditTitle(s), /^1 factuur nagerekend/)
})

test('[NAREKENEN] a long list of failures is capped, and says it was capped', () => {
  // Twelve lines of the same shape is a wall, and a wall gets closed. But a silent truncation would
  // let an owner believe they had seen all of them.
  const many = Array.from({ length: 12 }, (_, i) =>
    row({ id: `x${i}`, verdict: 'absent', invoiceNumber: `NR${i}` }))
  const lines = auditLines(summarizeAudit(many))
  assert.equal(lines.filter((l) => /^ATAPACK/.test(l)).length, 10)
  assert.ok(lines.some((l) => /en nog 2 andere/.test(l)), 'the rest is counted, never dropped')
})

test('[NAREKENEN] nothing to check says exactly that', () => {
  const s = summarizeAudit([])
  assert.equal(s.examined, 0)
  assert.match(auditTitle(s), /geen facturen om na te rekenen/)
  assert.deepEqual(auditLines(s), [], 'and claims nothing else')
})

test('[E-FACTUUR-NAREKENEN] the supplier\'s own file gets its own sentence, never the page\'s', () => {
  // This was the report's blind spot, and it pointed at exactly the wrong document: a Peppol XML
  // has no PDF text layer, so it landed in "we could not check this one" — beside a blurry photo —
  // for the ONE class the app can verify exactly, mechanically, at no cost.
  const s = summarizeAudit([
    row({ id: 'pdf' }),                                  // confirmed off the page's characters
    row({ id: 'ubl', source: 'e-invoice' }),             // confirmed against the supplier's file
    row({ id: 'cii', source: 'e-invoice' }),
  ])
  assert.equal(s.confirmed, 3, 'all three are confirmed')
  assert.equal(s.confirmedByEInvoice, 2, 'and two of them by the strongest witness there is')

  const lines = auditLines(s)
  assert.ok(
    lines.some((l) => /2 facturen zijn vergeleken met de e-factuur/.test(l)),
    'the e-invoice claim is made out loud',
  )
  assert.ok(
    lines.some((l) => /niets aan gelezen of geïnterpreteerd/.test(l)),
    'and says WHY it is stronger, not merely that it is',
  )
})

test('[E-FACTUUR-NAREKENEN] a page-confirmed invoice never borrows the stronger claim', () => {
  // "Het bedrag staat zo op het document" is about characters. Merging the two would let the weaker
  // claim take the stronger one's certainty — which is the whole reason the source is tracked.
  const s = summarizeAudit([row({ id: 'a' }), row({ id: 'b' })])
  assert.equal(s.confirmedByEInvoice, 0)
  assert.ok(
    !auditLines(s).some((l) => /e-factuur/.test(l)),
    'no e-invoice sentence when no e-invoice spoke',
  )
})

test('[E-FACTUUR-NAREKENEN] a supplier file that disagrees with the books is a mismatch', () => {
  // The strongest finding the report can produce, and it was invisible: the supplier's OWN file
  // contradicts what was booked. It must read as a mismatch, not as "unchecked".
  const s = summarizeAudit([row({ id: 'bad', verdict: 'absent', source: 'e-invoice' })])
  assert.equal(s.mismatched.length, 1)
  assert.equal(s.unchecked, 0, 'never filed under "we could not look"')
  assert.match(auditTitle(s), /^1 factuur klopt niet/)
})
