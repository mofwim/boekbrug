// [GEGROND-OCR] Pure node test — run: npx tsx --test src/lib/ocr-amounts.test.ts
//
// [GEGROND] gave the app its first check on a money figure that is not the reader checking itself —
// but only for a text PDF. A photograph has no characters to search, so the verdict there is
// 'unreadable': honest, and useless, because photographed receipts are the ordinary case this app
// exists for.
//
// This is the photo half: a second, BLIND read that transcribes the amounts it can see, searched by
// the same grounding check. Weaker than a text layer, and recorded as weaker.

import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  OCR_AMOUNTS_PROMPT,
  OCR_AMOUNTS_SYSTEM,
  parseOcrAmounts,
  ocrAmountCount,
  MIN_OCR_AMOUNTS,
} from './ocr-amounts'
import { groundMoneyFields, groundingText } from './amount-grounding'

test('[GEGROND-OCR] the transcription prompt asks for what is SEEN, and computes nothing', () => {
  // The distinction that makes this evidence at all. "What is the total?" fails semantically — it
  // picks a subtotal, or computes a figure that is internally consistent and not on the paper (the
  // € 0,46 error). "Write down what you see" fails locally, on a smudged digit. Different failure
  // modes are the only reason a second read from the same model family is worth anything.
  assert.match(OCR_AMOUNTS_PROMPT, /Reken NIETS uit/)
  assert.match(OCR_AMOUNTS_PROMPT, /EXACT over zoals het er staat/)
  assert.match(OCR_AMOUNTS_PROMPT, /verzin niets/)
  assert.match(OCR_AMOUNTS_SYSTEM, /berekent nooit iets/)
})

test('[GEGROND-OCR] the prompt carries NOTHING from the extraction — that is the whole point', () => {
  // Show a model a number and ask it to check that number, and it agrees. The exercise then
  // measures nothing and reports confidence, which is worse than not running it: it manufactures
  // trust. So the instruction is a constant with no interpolation and no amounts in it at all.
  assert.doesNotMatch(OCR_AMOUNTS_PROMPT, /\$\{/, 'no interpolation may reach this prompt')
  // The only digits allowed are the ones in the format example, which is fixed text.
  const beyondExample = OCR_AMOUNTS_PROMPT.split('Voorbeeld van het antwoordformaat:')[0]
  assert.doesNotMatch(beyondExample, /\d/, 'no figure appears in the instruction itself')
})

test('[GEGROND-OCR] a normal reply becomes a searchable haystack', () => {
  const reply = '1.872,24\n393,17\n2.265,41'
  const hay = parseOcrAmounts(reply)
  assert.equal(hay, '1.872,24\n393,17\n2.265,41')

  const g = groundMoneyFields(
    { totalIncBtw: 2265.41, totalExBtw: 1872.24, btwAmount: 393.17 }, hay, 'ocr',
  )
  assert.equal(g.totalIncBtw, 'found')
  assert.equal(g.btwAmount, 'found')
  assert.equal(g.source, 'ocr')
})

test('[GEGROND-OCR] a chatty model cannot smuggle prose into the haystack', () => {
  // Only amount-shaped runs survive. A sentence in the haystack could make an unrelated number
  // match by accident, which is the one outcome that makes this dangerous rather than merely weak.
  const reply = [
    'Hier zijn de bedragen die ik zie:',
    '- Subtotaal: 1.872,24',
    '* BTW 21% → 393,17',
    'Totaal te betalen 2.265,41 EUR',
  ].join('\n')
  const hay = parseOcrAmounts(reply)!
  assert.doesNotMatch(hay, /[a-zA-Z]/, 'no letters reach the search space')
  assert.equal(groundMoneyFields({ totalIncBtw: 2265.41 }, hay, 'ocr').totalIncBtw, 'found')
  // The percentage was transcribed too; it must not confirm an unrelated amount of € 21,00.
  assert.equal(groundMoneyFields({ totalIncBtw: 21 }, hay, 'ocr').totalIncBtw, 'absent')
})

test('[GEGROND-OCR] a transcription that did not happen is never evidence', () => {
  // null must read as 'unreadable' upstream, never as 'the amount is absent'. A failed second read
  // says nothing about the document, and a warning that is wrong is worse than no warning.
  assert.equal(parseOcrAmounts(null), null)
  assert.equal(parseOcrAmounts(''), null)
  assert.equal(parseOcrAmounts('   '), null)
  assert.equal(parseOcrAmounts('Ik kan dit document niet lezen.'), null)
})

test('[GEGROND-OCR] one lonely number is not a search space', () => {
  // A reply with a single token is far likelier to be a model that gave up than an invoice with one
  // number on it. Accepting it would turn every other amount into a false 'absent'.
  const thin = parseOcrAmounts('2.265,41')
  assert.equal(ocrAmountCount(thin), 1)
  assert.ok(ocrAmountCount(thin) < MIN_OCR_AMOUNTS, 'the caller must reject this as unusable')

  const real = parseOcrAmounts('1.872,24\n393,17\n2.265,41')
  assert.ok(ocrAmountCount(real) >= MIN_OCR_AMOUNTS)
  assert.equal(ocrAmountCount(null), 0)
})

test('[GEGROND-OCR] the sentence never claims a photo was read as certainly as a text layer', () => {
  // An owner who is told "we found this literally in the text" about a photograph, and later finds
  // one of those wrong, is right to distrust every green tick afterwards. The weaker witness gets
  // the weaker sentence.
  const viaText = groundingText(groundMoneyFields({ totalIncBtw: 500 }, 'Totaal 500,00\n100,00', 'text'))
  const viaOcr = groundingText(groundMoneyFields({ totalIncBtw: 500 }, 'Totaal 500,00\n100,00', 'ocr'))
  assert.notEqual(viaText, viaOcr, 'the two witnesses must not produce the same claim')
  assert.match(viaText!, /letterlijk teruggevonden in de tekst/)
  assert.match(viaOcr!, /teruggelezen van de foto/)
  assert.doesNotMatch(viaOcr!, /letterlijk teruggevonden in de tekst/)
})

test('[GEGROND-OCR] the boundary rule still holds on a transcribed haystack', () => {
  // The grounding check does the searching, so its guards apply here unchanged — but this is where
  // an OCR digit error would surface, so the property is asserted on this path too.
  const hay = parseOcrAmounts('1.871,40\n265,41')!
  assert.equal(groundMoneyFields({ totalIncBtw: 871.4 }, hay, 'ocr').totalIncBtw, 'absent')
  assert.equal(groundMoneyFields({ totalIncBtw: 1871.4 }, hay, 'ocr').totalIncBtw, 'found')
})
