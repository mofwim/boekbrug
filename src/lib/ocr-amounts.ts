// src/lib/ocr-amounts.ts
// [GEGROND-OCR] Reading the amounts off a PHOTO, so the grounding check works there too. Pure — the
// prompt and the parser; the call itself lives in ai.ts.
//
// ── WHAT THIS IS FOR ──
// [GEGROND] answers "is this amount really printed on the document?" by searching the document's own
// characters. For a text PDF that is a mechanical certainty with no model involved. For a PHOTO
// there are no characters, so the verdict is 'unreadable' — honest, and useless: a photographed
// receipt is the ordinary case this app exists for, so the majority of intake gets no independent
// check at all.
//
// ── WHY A SECOND MODEL CALL IS NOT "THE READER CHECKING ITSELF" ──
// It is a fair objection and it has to be answered, not waved away. The extraction call and this
// call use the same model family, so this is a WEAKER witness than a text layer — and the code says
// so, in its own verdict, rather than quietly presenting the two as equal.
//
// But they are not the same question, and that is where the value is:
//
//   · EXTRACTION asks "what is the total of this invoice?" — a semantic task. Its failures are
//     semantic: it picks a subtotal, it reads the wrong column, or it COMPUTES a figure that is
//     internally consistent and not on the paper. That last one is the € 0,46 error, and every
//     existing gate is blind to it.
//   · TRANSCRIPTION asks "list the amounts you can SEE, verbatim, compute nothing". Its failures are
//     local and visual: a smudged 3 read as an 8. It has no reason to produce a number that is not
//     on the page, because producing numbers is not the task.
//
// So an extracted total that also appears in an independent verbatim transcription is corroborated
// by a different kind of reading with different failure modes. That is not proof. It is evidence,
// and it is the only evidence available for a photograph.
//
// ── THE ONE RULE THAT MAKES IT WORTH ANYTHING ──
// The transcription call must NEVER be told what the extractor found. Show a model a number and ask
// it to check the number, and it will agree — the whole exercise then measures nothing and reports
// confidence. The prompt below therefore contains no amounts, no fields, and no context from the
// first read, and a source gate holds that.

/**
 * The transcription instruction. A constant, and deliberately so: a gate asserts that the string
 * sent to the model contains no interpolation, because the moment an extracted value can reach it
 * this stops being an independent witness.
 */
export const OCR_AMOUNTS_PROMPT = [
  'Lees dit document en schrijf ALLE bedragen op die je ziet staan.',
  '',
  'Regels:',
  '- Schrijf elk bedrag EXACT over zoals het er staat, inclusief punten en komma\'s.',
  '- Reken NIETS uit. Tel niets op, trek niets af, leid niets af.',
  '- Laat niets weg en verzin niets: alleen wat er letterlijk staat.',
  '- Eén bedrag per regel, verder geen tekst, geen uitleg, geen JSON.',
  '',
  'Voorbeeld van het antwoordformaat:',
  '1.872,24',
  '393,17',
  '2.265,41',
].join('\n')

/** The system line for that call. Also a constant, for the same reason. */
export const OCR_AMOUNTS_SYSTEM =
  'Je bent een transcribeur. Je schrijft over wat er staat en je berekent nooit iets.'

/**
 * Turn the model's reply into text the grounding check can search.
 *
 * Deliberately forgiving about the SHAPE of the reply (a stray "Totaal:" prefix, a bullet, a blank
 * line) and completely unforgiving about its CONTENT: only characters that can form an amount
 * survive, so a chatty model cannot smuggle a sentence into the haystack and make an unrelated
 * number match by accident.
 *
 * Returns null when nothing amount-shaped came back at all — which must read as 'unreadable', never
 * as 'the amount is absent'. A failed transcription is not evidence about the document.
 */
export function parseOcrAmounts(reply: string | null | undefined): string | null {
  const raw = (reply ?? '').trim()
  if (raw.length === 0) return null

  const found: string[] = []
  for (const line of raw.split(/\r?\n/)) {
    // Every amount-shaped run on the line, whatever else is around it.
    const matches = line.match(/\d[\d.,\s ]*\d|\d/g)
    if (!matches) continue
    for (const m of matches) {
      const t = m.trim()
      // A bare year or a house number is not an amount; requiring a decimal part or real length
      // keeps the haystack from filling with noise that could coincidentally match.
      if (t.length >= 3) found.push(t)
    }
  }
  if (found.length === 0) return null
  // One per line: the grounding check reads flanking characters to decide whether a match is a whole
  // number, and a newline is the cleanest possible boundary.
  return found.join('\n')
}

/**
 * How many distinct amount-shaped tokens the transcription produced.
 *
 * Used as a sanity floor by the caller: a reply with one token is far more likely to be a model that
 * gave up than a genuine invoice with one number on it, and treating that as a real search space
 * would turn every unfound amount into a false 'absent'.
 */
export function ocrAmountCount(haystack: string | null): number {
  if (!haystack) return 0
  return haystack.split('\n').filter((s) => s.trim().length > 0).length
}

/** Below this many transcribed amounts we do not trust the transcription as a search space. */
export const MIN_OCR_AMOUNTS = 2
