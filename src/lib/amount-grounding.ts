// src/lib/amount-grounding.ts
// [GEGROND] Does the amount the reader reported actually APPEAR on the document? Pure — no I/O.
//
// ── THE HOLE THIS FILLS ──
// Every check this app performs on a money field today is the reader checking itself:
//
//   · the arithmetic gate verifies excl + btw = incl — among three numbers the SAME read produced,
//     so a read that is wrong consistently passes it;
//   · field_confidence is the model's own opinion of its own answer;
//   · `total_printed` was added so the printed total could disagree with the computed one — but it
//     too is the model reporting what it saw.
//
// There is no independent witness anywhere. A confidently-consistent misread — the exact shape that
// produced a € 0,46 BTW error on a real invoice, and the reason an owner keeps the paper copy open
// beside the app — passes every gate the app has.
//
// This is the witness, and it is not an AI at all. For a PDF with a text layer we already have the
// document's own characters (we extract them and feed them to the model). So the question "is
// € 2.265,41 really printed on this invoice?" is answerable mechanically, in a millisecond, with no
// model, no confidence, and no opinion: either that number occurs in the text or it does not.
//
// ── THE THREE ANSWERS, AND WHY THERE ARE THREE ──
//   'found'      — the number occurs in the document's own text. The strongest statement this app
//                  can make about any figure, and the only one that is not self-referential.
//   'absent'     — the text is readable and the number is NOT in it. The read produced a figure the
//                  paper does not contain: either derived, or invented.
//   'unreadable' — there is no text to search (a photo, a scan, an image-only PDF). NOT 'absent'.
//                  A check that could not RUN must never display as a check that FAILED, any more
//                  than it may display as one that passed — saying "this amount is not on your
//                  invoice" about a photograph is a lie that teaches people to ignore the warning.
//
// ── WHAT 'absent' DOES AND DOES NOT MEAN ──
// It is evidence, not a verdict. A legitimately absent case exists: an invoice printing only the
// total and the BTW leaves excl to be computed, so excl is genuinely not on the paper. That is why
// the fields are judged separately and why the TOTAL is the one that carries weight — the total is
// the number that becomes money, and an invoice that does not print its own total is close to
// hypothetical.

/** What the document's text can tell us about one number. */
export type GroundingVerdict = 'found' | 'absent' | 'unreadable'

/**
 * WHICH witness produced the verdict, because they are not equally strong and the app must not
 * present them as if they were.
 *
 *   'text' — the document's own characters, extracted from a text PDF. Mechanical: no model, no
 *            opinion. The strongest thing this app can say about a number.
 *   'ocr'  — a separate transcription read of a photo ([GEGROND-OCR]). Weaker: it is a model, from
 *            the same family as the extractor. It earns its place because it answers a DIFFERENT
 *            question with different failure modes — "write down what you see" fails locally on a
 *            smudged digit, where "what is the total?" fails semantically by computing a figure
 *            that is not on the paper. Corroboration, not proof.
 *   'e-invoice' — the supplier's own structured file (Factur-X / ZUGFeRD / Peppol UBL). Not a
 *            witness to a reading at all: there was no page to read. It is the strongest of the
 *            three by a distance, and it is named separately because the report must not present
 *            "the characters of the PDF say so" and "the supplier's own file says so" as the same
 *            sentence — an owner who is told both in one breath cannot tell which one they are
 *            trusting.
 */
export type GroundingSource = 'text' | 'ocr' | 'e-invoice'

export interface MoneyGrounding {
  totalIncBtw: GroundingVerdict
  totalExBtw: GroundingVerdict
  btwAmount: GroundingVerdict
  /** Absent on rows written before OCR grounding existed → read as 'text', which is what they were. */
  source?: GroundingSource
}

/** Below this, a number is too common in ordinary text to mean anything. */
const MIN_MEANINGFUL = 0.005

/**
 * Every way a Dutch invoice can print one amount.
 *
 * The formats matter more than they look. A supplier's PDF may print 2.265,41 (Dutch), 2265,41 (no
 * thousands separator), 2 265,41 (thin space, common from German and French systems) or 2,265.41
 * (an international template). Missing one of those turns a correct read into a false "absent",
 * and a false alarm on a correct invoice is how a warning stops being read.
 */
function variants(amount: number): string[] {
  const cents = Math.round(Math.abs(amount) * 100)
  const whole = Math.floor(cents / 100)
  const frac = String(cents % 100).padStart(2, '0')
  const w = String(whole)

  // Thousands-grouped forms, built by hand so the separator is explicit.
  const grouped = (sep: string): string => {
    let out = ''
    for (let i = 0; i < w.length; i++) {
      if (i > 0 && (w.length - i) % 3 === 0) out += sep
      out += w[i]
    }
    return out
  }

  const wholeForms = new Set<string>([w, grouped('.'), grouped(','), grouped(' '), grouped(' '), grouped(' ')])
  const out = new Set<string>()
  for (const wf of wholeForms) {
    out.add(`${wf},${frac}`) // Dutch decimal comma
    out.add(`${wf}.${frac}`) // international decimal point
  }
  // A whole-euro amount is often printed without decimals at all (“€ 500”), and with a dash for the
  // cents on older Dutch templates (“500,-”).
  if (cents % 100 === 0) {
    for (const wf of wholeForms) {
      out.add(wf)
      out.add(`${wf},-`)
      out.add(`${wf},--`)
    }
  }
  return [...out]
}

/**
 * Is `needle` in `haystack` as a WHOLE number rather than as part of a longer one?
 *
 * This is the check that decides whether the whole module is worth anything. A plain substring
 * search finds "871,40" inside "1.871,40" and would therefore confirm an amount that is off by a
 * thousand euros — the single most expensive misread there is, blessed by the very check meant to
 * catch it. So a match must not be flanked by a digit, nor by a separator that is itself flanked by
 * a digit (which is what makes it part of a larger grouped number).
 */
/**
 * Characters that can group the digits INSIDE one number: a dot, a comma, or a single space in its
 * various widths — the ordinary space included, spelled as \u0020 so it cannot fall out of the
 * class unnoticed the way it did once: with the plain space missing, "265,41" was confirmed by a
 * document printing "2 265,41", which is the thousand-euro error this guard exists to prevent.
 *
 * Line breaks and tabs are deliberately NOT here, and that omission is a bug this cost. `\s` covers
 * `\n`, so on a document listing amounts on consecutive lines — "1.872,24" then "393,17" — the
 * newline before 393,17 read as a thousands separator with a digit beyond it, and a correctly-read
 * amount came back 'absent'. A false alarm on a correct invoice is precisely how a warning stops
 * being read, so it is the failure direction that matters most here.
 */
const SEP = /[.,\u0020\u00A0\u202F\u2009]/

/** Does the text ending here already finish an amount (…2,24)? Then the next separator is a gap. */
const COMPLETED = /\d[.,]\d{2}$/

/** Does this needle already carry its cents? Then no thousands group can follow it. */
function hasCents(needle: string): boolean {
  return /[.,]\d{2}$/.test(needle)
}

function occursWhole(haystack: string, needle: string): boolean {
  let from = 0
  for (;;) {
    const i = haystack.indexOf(needle, from)
    if (i === -1) return false
    const before = haystack[i - 1] ?? ''
    const beforeTwo = haystack[i - 2] ?? ''
    const after = haystack[i + needle.length] ?? ''
    const afterTwo = haystack[i + needle.length + 1] ?? ''

    const digitBefore = /[0-9]/.test(before)
    // "1.871,40" — the char before is a grouping separator AND before that is a digit.
    // Only when the text before it is NOT already a finished amount: in "1.872,24 393,17" the space
    // follows a completed number, so it is a gap between two amounts, not a thousands separator.
    const groupedBefore =
      SEP.test(before) && /[0-9]/.test(beforeTwo) && !COMPLETED.test(haystack.slice(0, i - 1))
    // A digit straight after means we matched a prefix of a longer number.
    const digitAfter = /[0-9]/.test(after)
    // The mirror of groupedBefore, and it is not symmetry for its own sake — it is a bug this
    // caught. The whole-euro variant of € 1,00 is the bare string "1", which occurs at the start of
    // "1.871,40": nothing precedes it and the next character is a separator, so the three checks
    // above all passed and € 1,00 was confirmed by an invoice for € 1.871,40. An adversarial sweep
    // of 1.260 amount/format pairs found six of these and no other defect.
    // Nothing legitimate is lost: "500,00" is matched by its own variant long before the bare
    // "500" is tried, so the only strings this rejects are leading groups of larger numbers.
    // The mirror — and it applies ONLY to a needle without cents. A number already ending in ",41"
    // is complete, so digits past the next separator belong to a DIFFERENT amount; applying the rule
    // there rejected "2.265,41" whenever another amount followed it on the same line.
    const groupedAfter = !hasCents(needle) && SEP.test(after) && /[0-9]/.test(afterTwo)

    if (!digitBefore && !groupedBefore && !digitAfter && !groupedAfter) return true
    from = i + 1
  }
}

/**
 * Does this amount appear in the document's own text?
 *
 * `text` null/empty → 'unreadable'. That is the scanned-invoice case and it is deliberately not
 * 'absent' — see the header.
 */
export function groundAmount(amount: number | null | undefined, text: string | null | undefined): GroundingVerdict {
  const t = (text ?? '').trim()
  if (t.length === 0) return 'unreadable'
  if (typeof amount !== 'number' || !Number.isFinite(amount)) return 'unreadable'
  // Zero and near-zero occur everywhere in ordinary text; confirming them would be noise dressed as
  // evidence. A genuine 0%-BTW invoice reports its BTW as absent-from-check rather than as "found",
  // which is the honest answer: there is nothing to find.
  if (Math.abs(amount) < MIN_MEANINGFUL) return 'unreadable'

  for (const v of variants(amount)) {
    if (occursWhole(t, v)) return 'found'
  }
  return 'absent'
}

/** All three money fields at once. */
export function groundMoneyFields(
  amounts: { totalIncBtw?: number | null; totalExBtw?: number | null; btwAmount?: number | null },
  text: string | null | undefined,
  source: GroundingSource = 'text',
): MoneyGrounding {
  return {
    totalIncBtw: groundAmount(amounts.totalIncBtw, text),
    totalExBtw: groundAmount(amounts.totalExBtw, text),
    btwAmount: groundAmount(amounts.btwAmount, text),
    source,
  }
}

/**
 * May this read be booked WITHOUT a human, as far as grounding is concerned?
 *
 * Only the total decides. It is the number that becomes money, and it is the one an invoice always
 * prints; excl is routinely computed rather than printed, and a 0%-BTW invoice has no BTW figure to
 * find. Making those block would produce false alarms on correct invoices, which is how a warning
 * stops being read — and a warning nobody reads is worse than none.
 *
 * 'unreadable' does NOT block. A photographed receipt is the ordinary case this app is built for,
 * and refusing to automate it would take the product away in the name of protecting it. The other
 * gates — arithmetic, confidence, the duplicate probe — still apply there exactly as before. What
 * this adds is one more way to be CERTAIN, never a new way to be stuck.
 */
export function groundingBlocksAutoBooking(g: MoneyGrounding): boolean {
  return g.totalIncBtw === 'absent'
}

/**
 * The sentence the owner reads. Dutch, per AGENTS.md.
 *
 * The point of this feature, in one line: it tells the owner whether the app is repeating what the
 * paper says or telling them something the paper does not contain. That is the difference between
 * checking the invoice yourself and not having to.
 */
export function groundingText(g: MoneyGrounding): string | null {
  const viaOcr = g.source === 'ocr'
  switch (g.totalIncBtw) {
    case 'found':
      // The OCR sentence is deliberately weaker. Saying "wij hebben het letterlijk teruggevonden in
      // de tekst" about a photograph would claim the mechanical certainty of a text layer for a
      // model read, and an owner who later found one wrong would be right to distrust all of them.
      return viaOcr
        ? 'Wij hebben dit bedrag ook teruggelezen van de foto zelf — het komt overeen.'
        : 'Dit bedrag staat zo op de factuur — wij hebben het letterlijk teruggevonden in de tekst.'
    case 'absent':
      return viaOcr
        ? 'Let op: bij het teruglezen van de foto vonden wij dit bedrag niet terug. Controleer het even aan het document zelf.'
        : 'Let op: dit bedrag staat NIET letterlijk op de factuur. Controleer het even aan het document zelf.'
    case 'unreadable':
      // Said plainly rather than hidden: "we could not check" is a different state from "we checked
      // and it was fine", and pretending otherwise is what makes a green tick meaningless.
      return 'Dit is een foto of scan, dus wij konden het bedrag niet in de tekst nakijken.'
  }
}

/**
 * Read the stored grounding verdict for the TOTAL out of a field_confidence blob.
 *
 * One reader for both auto-booking doors. The alternative — each door reaching into the jsonb its
 * own way — is how the intake path and the e-mail path came to disagree about the duplicate marker,
 * and that disagreement was invisible until it double-booked a purchase invoice.
 *
 * Anything unrecognisable returns null, which the auto-advance gate treats exactly like a photo:
 * it blocks nothing. A malformed blob must never invent a refusal any more than it may invent an
 * approval.
 */
export function groundingOf(fieldConfidence: unknown): GroundingVerdict | null {
  if (!fieldConfidence || typeof fieldConfidence !== 'object') return null
  const g = (fieldConfidence as Record<string, unknown>)._grounding
  if (!g || typeof g !== 'object') return null
  const v = (g as Record<string, unknown>).totalIncBtw
  return v === 'found' || v === 'absent' || v === 'unreadable' ? v : null
}
