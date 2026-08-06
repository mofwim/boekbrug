// [GEGROND] Pure node test — run: npx tsx --test src/lib/amount-grounding.test.ts
//
// Every check this app makes on a money field is the reader checking itself: arithmetic among three
// numbers the same read produced, plus the model's own confidence in its own answer. A read that is
// wrong consistently passes all of it — which is why an owner keeps the paper invoice open beside
// the app.
//
// This is the one check that is not self-referential: for a PDF with a text layer, either the
// number occurs in the document's own characters or it does not.
//
// The test that matters most is the boundary one. A plain substring search finds "871,40" inside
// "1.871,40" and would confirm an amount that is off by a thousand euros — the most expensive
// misread there is, blessed by the very check meant to catch it.

import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  groundAmount,
  groundMoneyFields,
  groundingBlocksAutoBooking,
  groundingText,
} from './amount-grounding'

test('[GEGROND] the amount that is printed is found', () => {
  const factuur = `
    ATAPACK Cash & Carry B.V.
    Factuurnummer 26302050
    Subtotaal            1.872,24
    BTW 21%                393,17
    Totaal te betalen  € 2.265,41
  `
  assert.equal(groundAmount(2265.41, factuur), 'found')
  assert.equal(groundAmount(1872.24, factuur), 'found')
  assert.equal(groundAmount(393.17, factuur), 'found')
})

test('[GEGROND] a number off by a thousand is NOT confirmed by the digits inside it', () => {
  // The whole module lives or dies here. "871,40" is a substring of "1.871,40"; a naive search
  // would confirm a read that is € 1.000 wrong, using the check built to catch exactly that.
  const factuur = 'Totaal € 1.871,40'
  assert.equal(groundAmount(871.4, factuur), 'absent', 'a prefix-of-a-larger-number is not a match')
  assert.equal(groundAmount(1871.4, factuur), 'found', 'and the real one still is')

  // The mirror: a longer number that ENDS with the one we want.
  assert.equal(groundAmount(265.41, 'Totaal 2.265,41'), 'absent')
  // And a digit immediately after.
  assert.equal(groundAmount(22.65, 'artikelnr 22.6541'), 'absent')
})

test('[GEGROND] every way a Dutch invoice prints one amount', () => {
  // Missing a format turns a CORRECT read into a false alarm, and a false alarm on a correct
  // invoice is how a warning stops being read.
  for (const printed of [
    'Totaal 2.265,41',      // Dutch thousands separator
    'Totaal 2265,41',       // none
    'Totaal 2 265,41',      // thin/normal space — common from German and French systems
    'Totaal 2,265.41',      // international template
    'Totaal 2265.41',       // international, no grouping
    'Totaal € 2.265,41',    // with the sign
    'Totaal EUR 2.265,41',
  ]) {
    assert.equal(groundAmount(2265.41, printed), 'found', `not found in: ${printed}`)
  }
  // A whole-euro amount is often printed without cents, and with the old Dutch dash.
  for (const printed of ['Totaal 500,00', 'Totaal € 500', 'Totaal 500,-', 'Totaal 500,--']) {
    assert.equal(groundAmount(500, printed), 'found', `not found in: ${printed}`)
  }
})

test('[GEGROND] no text is UNREADABLE, never absent', () => {
  // A photographed receipt has no text layer. Saying "this amount is not on your invoice" about a
  // photograph is a lie, and a lying warning teaches people to ignore the true ones. A check that
  // could not RUN is its own state — it may not read as failed and it may not read as passed.
  assert.equal(groundAmount(2265.41, null), 'unreadable')
  assert.equal(groundAmount(2265.41, ''), 'unreadable')
  assert.equal(groundAmount(2265.41, '   \n  '), 'unreadable')
  // And an unusable amount is equally not a finding about the document.
  assert.equal(groundAmount(null, 'Totaal 2.265,41'), 'unreadable')
  assert.equal(groundAmount(Number.NaN, 'Totaal 2.265,41'), 'unreadable')
  // Zero is everywhere in ordinary text; confirming it would be noise dressed as evidence.
  assert.equal(groundAmount(0, 'Totaal 0,00 en 0 stuks'), 'unreadable')
})

test('[GEGROND] a negative amount is found by its magnitude — a creditnota prints no minus', () => {
  const credit = 'Creditnota CR0300343\nTotaal 6,81'
  assert.equal(groundAmount(-6.81, credit), 'found')
})

test('[GEGROND] only the TOTAL blocks an unattended booking', () => {
  const text = 'Totaal € 2.265,41\nBTW 21% 393,17'
  const g = groundMoneyFields({ totalIncBtw: 2265.41, totalExBtw: 1872.24, btwAmount: 393.17 }, text)
  assert.equal(g.totalIncBtw, 'found')
  assert.equal(g.btwAmount, 'found')
  // excl is routinely COMPUTED rather than printed. Blocking on it would fire on correct invoices.
  assert.equal(g.totalExBtw, 'absent')
  assert.equal(groundingBlocksAutoBooking(g), false, 'an unprinted excl is normal, not a defect')

  // The total missing from the paper IS the defect: the read produced a figure the document does
  // not contain.
  const verzonnen = groundMoneyFields({ totalIncBtw: 9999.99, totalExBtw: null, btwAmount: null }, text)
  assert.equal(verzonnen.totalIncBtw, 'absent')
  assert.equal(groundingBlocksAutoBooking(verzonnen), true)
})

test('[GEGROND] a photo never blocks — this adds certainty, it never takes the product away', () => {
  // Photographed receipts are the ordinary case this app exists for. Refusing to automate them in
  // the name of protecting them would remove the product; the arithmetic, confidence and duplicate
  // gates all still apply there exactly as before.
  const g = groundMoneyFields({ totalIncBtw: 2265.41 }, null)
  assert.equal(g.totalIncBtw, 'unreadable')
  assert.equal(groundingBlocksAutoBooking(g), false)
})

test('[GEGROND] the sentence says which of the three states it is', () => {
  const found = groundingText(groundMoneyFields({ totalIncBtw: 500 }, 'Totaal 500,00'))
  assert.match(found!, /letterlijk teruggevonden/)

  const absent = groundingText(groundMoneyFields({ totalIncBtw: 500 }, 'Totaal 400,00'))
  assert.match(absent!, /NIET letterlijk/)
  assert.match(absent!, /Controleer/, 'and it says what to do')

  const unreadable = groundingText(groundMoneyFields({ totalIncBtw: 500 }, null))
  assert.match(unreadable!, /foto of scan/)
  assert.doesNotMatch(unreadable!, /NIET letterlijk/, 'never phrased as a failed check')
})

test('[GEGROND] the real misread this exists for', () => {
  // The Enka case: the reader returned a BTW that made excl + btw = incl exactly, so the arithmetic
  // gate passed — and the figure was € 0,46 wrong. The paper says one thing, the read another, and
  // no check in the app could see the difference because they all asked the same reader.
  const paper = 'Subtotaal 21,45\nBTW 21% 4,50\nTotaal 25,95'
  // What the reader returned: an internally consistent set that is not what is printed.
  const gelezen = { totalIncBtw: 25.95, totalExBtw: 21.91, btwAmount: 4.04 }
  const g = groundMoneyFields(gelezen, paper)
  assert.equal(g.totalIncBtw, 'found', 'the total was read correctly')
  assert.equal(g.btwAmount, 'absent', 'and the BTW it invented is nowhere on the paper')
  assert.equal(g.totalExBtw, 'absent')
  // Consistent arithmetic: 21.91 + 4.04 = 25.95. Every existing gate passes. This one does not.
  assert.ok(Math.abs(gelezen.totalExBtw + gelezen.btwAmount - gelezen.totalIncBtw) <= 0.02)
})

test('[GEGROND] amounts sitting next to each other do not shadow one another', () => {
  // Two bugs lived here, both found by running the OCR half against a real transcription, and both
  // in the SAME guard — the one that decides whether a match is part of a bigger number.
  //
  // 1. `\\s` in the separator class covers `\\n`. A document listing amounts on consecutive lines
  //    made the newline read as a thousands separator, so a CORRECTLY read amount came back
  //    'absent'. A false alarm on a correct invoice is how a warning stops being read.
  // 2. Fixing that by spelling the class out dropped the ordinary space, and then "265,41" was
  //    confirmed by a document printing "2 265,41" — the thousand-euro error the guard exists for.
  //
  // Both directions are held here, because each fix broke the other.
  assert.equal(groundAmount(393.17, '1.872,24\n393,17'), 'found', 'a newline is a line break, not a grouping separator')
  assert.equal(groundAmount(2265.41, '1.872,24 2.265,41'), 'found', 'nor is the gap between two finished amounts')
  assert.equal(groundAmount(265.41, 'Totaal 2 265,41'), 'absent', 'but a space INSIDE one number still groups it')
  assert.equal(groundAmount(2265.41, 'Totaal 2 265,41'), 'found')
  // The non-breaking and thin spaces some templates use must behave identically.
  assert.equal(groundAmount(265.41, 'Totaal 2\u00A0265,41'), 'absent')
  assert.equal(groundAmount(265.41, 'Totaal 2\u202F265,41'), 'absent')
})

test('[GEGROND] an adversarial sweep: no amount is ever confirmed by a different one', () => {
  // A false 'found' is the ONLY outcome that makes this feature dangerous: it would bless a wrong
  // number using the very check built to catch wrong numbers. So the property is checked
  // exhaustively rather than by example — every amount against every other, in three layouts.
  //
  // This sweep found a real defect on its first run. The whole-euro variant of € 1,00 is the bare
  // string "1", which occurs at the start of "1.871,40" with nothing before it and a separator
  // after — so an invoice for € 1.871,40 confirmed a read of € 1,00. Six such pairs, all the same
  // shape, all fixed by requiring the mirror of the leading-group guard.
  const printedForms = (n: number): string[] => {
    const [w, f] = n.toFixed(2).split('.')
    const grouped = w.replace(/\B(?=(\d{3})+(?!\d))/g, '.')
    return [`Totaal € ${grouped},${f}`, `Totaal ${w},${f}`, `Bedrag: ${grouped},${f} EUR`]
  }
  const amounts = [
    0.46, 4.04, 4.5, 6.81, 21.45, 21.91, 25.95, 89, 128.6, 274.86,
    393.17, 500, 871.4, 1000, 1871.4, 1872.24, 2265.41, 22654.1, 100, 10, 1,
  ]

  const falsePositives: string[] = []
  const falseNegatives: string[] = []
  for (const printed of amounts) {
    for (const text of printedForms(printed)) {
      if (groundAmount(printed, text) !== 'found') falseNegatives.push(`${printed} in "${text}"`)
      for (const other of amounts) {
        if (other === printed) continue
        if (groundAmount(other, text) === 'found') falsePositives.push(`${other} in "${text}"`)
      }
    }
  }
  assert.deepEqual(falsePositives, [], 'an amount was confirmed by a document printing a different one')
  assert.deepEqual(falseNegatives, [], 'a correctly printed amount was not found — that is a false alarm')
})
