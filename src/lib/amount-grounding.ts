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
// [ANDER-TOTAAL] The document's own totals block, found among the amounts the witness read.
import { alternativeTotals } from './amount-candidates'
import { parseOcrAmounts, ocrAmountValues } from './ocr-amounts'

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
  /**
   * [ANDER-TOTAAL] A totals block that IS on the document, when the one we read is not.
   *
   * Set only when totalIncBtw is 'absent' — the one case where the owner is being told to go and
   * check the paper. The witness that just proved the read total is not printed also transcribed
   * what IS printed, and among those amounts there is often exactly one triple that adds up. That
   * is not a guess about which number is the total; it is the arithmetic every invoice's totals
   * block satisfies. Measured on the invoice this came from: the app read EUR 1.149,56 and the
   * document said 1.065,14 + 95,54 = 1.160,68.
   *
   * Never applied, only shown. Both figures come from a model reading a scan; the app knows they
   * disagree and does not know which is right — and the owner, holding the invoice, settles it in
   * a glance once they are told what to look for.
   */
  alternative?: { ex: number; btw: number; inc: number }
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

  // [VORM-GEMIST] The apostrophe is a real grouping separator on templates a Dutch owner
  // receives from Swiss and some German suppliers. Leaving it out cost nothing; keeping it
  // out costs a false "this total is not on your invoice" on a correct one.
  const wholeForms = new Set<string>([w, grouped('.'), grouped(','), grouped(' '), grouped(' '), grouped(' '), grouped("'"), grouped('\u2019')])
  const out = new Set<string>()
  for (const wf of wholeForms) {
    out.add(`${wf},${frac}`) // Dutch decimal comma
    out.add(`${wf}.${frac}`) // international decimal point
    // [VORM-GEMIST] A space between the separator and the cents. Not a way anyone WRITES an
    // amount — it is how a PDF's text layer hands one over when the glyphs sit in their own
    // cells, and "1.044, 80" was making the app tell an owner their own printed total was not
    // on the paper.
    out.add(`${wf}, ${frac}`)
    out.add(`${wf}. ${frac}`)
  }
  // [VORM-GEMIST] The trailing cent-zero, dropped. "1044.8" is how a transcription and many a
  // spreadsheet-built invoice render EUR 1.044,80, and it was the likeliest reason for a false
  // 'absent' — the check that exists to catch a misread was reporting one on a correct read.
  //
  // ONLY when the cents END in a zero, so the short form is unambiguous: EUR 1.044,08 has cents
  // "08", whose short form would be "0" and is never generated. And findWhole still refuses a
  // match followed by a digit, so "1044.8" cannot confirm a document that says 1044.85.
  if (cents % 10 === 0) {
    for (const wf of wholeForms) {
      out.add(`${wf},${frac[0]}`)
      out.add(`${wf}.${frac[0]}`)
    }
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

/**
 * Where does `needle` occur as a WHOLE number, at or after `from`? −1 when nowhere.
 *
 * The index matters to callers who need to look at what SURROUNDS the number rather than merely
 * whether it is there — [STATIEGELD-GAT] asks whether a deposit label stands beside the amount.
 * Exposing the position instead of copying this matcher keeps ONE definition of "this is the whole
 * number and not a slice of a bigger one", which is the entire reason this module exists.
 */
function findWhole(haystack: string, needle: string, from = 0): number {
  for (;;) {
    const i = haystack.indexOf(needle, from)
    if (i === -1) return -1
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

    if (!digitBefore && !groupedBefore && !digitAfter && !groupedAfter) return i
    from = i + 1
  }
}

function occursWhole(haystack: string, needle: string): boolean {
  return findWhole(haystack, needle) !== -1
}

/**
 * Every position where `amount` occurs in `text` as a whole number, in any of its printed forms.
 *
 * For callers that must read the CONTEXT of the number rather than its presence. Empty when the
 * text is empty, the amount is not finite, or it is too small to mean anything — the same three
 * refusals groundAmount makes, so the two can never disagree about what "occurs" means.
 */
export function amountOccurrences(
  amount: number | null | undefined,
  text: string | null | undefined,
): number[] {
  const t = (text ?? '').trim()
  if (t.length === 0) return []
  if (typeof amount !== 'number' || !Number.isFinite(amount)) return []
  if (Math.abs(amount) < MIN_MEANINGFUL) return []
  const out: number[] = []
  for (const v of variants(amount)) {
    for (let from = 0; ; ) {
      const i = findWhole(t, v, from)
      if (i === -1) break
      out.push(i)
      from = i + 1
    }
  }
  return out.sort((a, b) => a - b)
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
/**
 * [SOM-IS-GROND] Is a total that is not printed nevertheless proven by the page?
 *
 * ── THE INVOICES THIS EXISTS FOR ──
 *
 * GROOTHANDEL M.H. BAL invoices its subtotal and its BTW and never restates the gross. Measured on
 * production: 53 of the 53 grounded invoices from this supplier — the owner's LARGEST, 96 invoices
 * — report totalIncBtw 'absent', and every single one has totalExBtw 'found', btwAmount 'found',
 * and ex + btw equal to the total to the cent:
 *
 *   611,61 + 55,04 = 666,65      744,58 + 67,01 = 811,59
 *   627,63 + 56,49 = 684,12      779,95 + 70,20 = 850,15
 *
 * Every other supplier in the same administration scores 0 or 1. So this is not a misread; it is
 * one supplier's layout, and the app called it a problem 53 times.
 *
 * ── WHY THAT IS THE WRONG ANSWER, AND WHAT IT COSTS ──
 *
 * The header of this file assumes the opposite case — "an invoice printing only the total and the
 * BTW leaves excl to be computed" — and concludes that "an invoice that does not print its own
 * total is close to hypothetical". On this owner's data that is false for more than half of the
 * biggest supplier's invoices.
 *
 * And the sentence the owner reads is "het totaalbedrag staat niet letterlijk in de tekst —
 * controleer het aan de factuur zelf", which implies the app may have invented the number. It did
 * not: it added two figures that are literally on the page. That is not a guess, it is arithmetic
 * over grounded evidence, and it is the strongest provenance available short of reading the total
 * itself. A warning that fires on 53 correct invoices is how the warning stops being read — and the
 * one it exists to catch then goes past unread too.
 *
 * ── WHY THIS DOES NOT WEAKEN THE CHECK THAT MATTERS ──
 *
 * [ANDER-TOTAAL] came from NemaFood 262697: the app read EUR 1.149,56 and the document said
 * 1.065,14 + 95,54 = 1.160,68. That read ALSO added up internally — 1.054,64 + 94,92 = 1.149,56 —
 * so "the numbers are consistent" proves nothing on its own.
 *
 * What separates them is grounding, not arithmetic. On NemaFood all THREE fields were 'absent' and
 * a competing totals block was found on the page. Here two of the three are literally present and
 * nothing competes with them. So this asks for both halves — each component individually FOUND, and
 * their sum exactly the total — and stays silent the moment either fails.
 */
export function totalIsDerivedFromGrounded(
  g: Pick<MoneyGrounding, 'totalIncBtw' | 'totalExBtw' | 'btwAmount'> | null | undefined,
  amounts: { totalIncBtw?: number | null; totalExBtw?: number | null; btwAmount?: number | null },
): boolean {
  if (!g) return false;
  // Only ever rescues a total the text does not carry. When it IS found there is nothing to rescue.
  if (g.totalIncBtw !== 'absent') return false;
  // Both components must be literally on the page. 'unreadable' is not evidence of anything, and
  // 'absent' is the NemaFood shape this must never cover.
  if (g.totalExBtw !== 'found' || g.btwAmount !== 'found') return false;

  const inc = amounts.totalIncBtw;
  const ex = amounts.totalExBtw;
  const btw = amounts.btwAmount;
  if (typeof inc !== 'number' || typeof ex !== 'number' || typeof btw !== 'number') return false;
  if (!Number.isFinite(inc) || !Number.isFinite(ex) || !Number.isFinite(btw)) return false;
  // Exactly, to the cent. This is a proof, not a plausibility check: a tolerance here would let a
  // read that is a euro out present itself as grounded.
  return Math.abs(ex + btw - inc) <= 0.005;
}

export function groundMoneyFields(
  amounts: { totalIncBtw?: number | null; totalExBtw?: number | null; btwAmount?: number | null },
  text: string | null | undefined,
  source: GroundingSource = 'text',
): MoneyGrounding {
  const g: MoneyGrounding = {
    totalIncBtw: groundAmount(amounts.totalIncBtw, text),
    totalExBtw: groundAmount(amounts.totalExBtw, text),
    btwAmount: groundAmount(amounts.btwAmount, text),
    source,
  }
  // [ANDER-TOTAAL] Only when the read total is NOT on the document. When it is, there is nothing
  // to raise and a second figure would only be noise on a correct invoice — which is how a warning
  // stops being read.
  if (g.totalIncBtw === 'absent') {
    const alt = alternativeTotals(amounts.totalIncBtw, ocrAmountValues(parseOcrAmounts(text)))
    if (alt) g.alternative = alt
  }
  return g
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
// Geen aanroeper, met opzet: beide deuren houden een opgeslagen verdict, niet dit object, dus zij
// vragen verdictBlocksAutoBooking() hieronder. Dit is de vorm voor wie de hele grounding in handen
// heeft — de audit-route — en de plek waar de regel als geheel te lezen is. Hij DELEGEERT, dus hij
// kan niet meer los gaan lopen van wat er echt beslist; dat was precies het probleem dat hier zat.
export function groundingBlocksAutoBooking(g: MoneyGrounding): boolean {
  return verdictBlocksAutoBooking(g.totalIncBtw)
}

/**
 * The same rule, asked of a bare verdict.
 *
 * Both auto-booking doors hold a stored verdict rather than a MoneyGrounding — groundingOf() reads
 * it out of field_confidence — so they could not use the function above, and auto-advance.ts wrote
 * `=== "absent"` itself instead. That left two statements of one rule in two files, and the one
 * with the twenty lines of reasoning above it was the one nobody called: editing it would have
 * changed nothing while looking exactly like changing the veto.
 *
 * Null and undefined do NOT block, deliberately. Absent from the blob means the check never ran on
 * this document (an older row, a path that stored no grounding), and a check that did not run may
 * not hold an invoice any more than it may wave one through — the other gates still apply.
 */
export function verdictBlocksAutoBooking(v: GroundingVerdict | null | undefined): boolean {
  return v === 'absent'
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
/**
 * [GEGROND-STAAT-IN] Are ALL THREE money figures literally printed in the document's own text?
 *
 * ── WHY THIS QUESTION EXISTS, AND WHY IT IS ASKED SO NARROWLY ──
 *
 * Measured in production over two months on one shop: of 265 incoming documents the app held back,
 * 246 cleared the confidence bar on vendor, date AND invoice number, only 21 carried any warning
 * flag at all — and 182 had NO per-amount confidence from the model whatsoever. The reader knew
 * who, when and which number, said nothing was wrong, and the document was held anyway, because
 * the money gate is fail-closed on a missing score and falls back to demanding a VERY high overall
 * confidence. That is the gate working exactly as written.
 *
 * ── AND THEN THE SAME DATA, BROKEN DOWN BY WEEK, SAID SOMETHING ELSE ──
 *
 * All 181 of those documents arrived by e-mail between 5 and 14 July — the fortnight the backlog
 * was first fed in — and NOT ONE document since 20 July has lacked an amount score. Six weeks, zero.
 *
 * So the honest account of this function is: it recovers 44 documents that are already in the
 * queue, and on that administration its forward effect today is ZERO, because the condition it
 * answers stopped occurring. It is kept, and it was worth writing, for two reasons and not a third:
 * a fail-closed gate that refuses on a missing signal will meet a missing signal again the next
 * time a reader changes, and the rule costs nothing when the signal is present. It is NOT kept
 * because it is currently saving anybody time. Whoever reads this next should believe the second
 * paragraph, not the first — the first is what an average over a bulk import looks like.
 *
 * The bucket that IS live is different and deliberately left shut: of 34 documents held since
 * 20 July, 20 carry a real warning flag, 7 have a total the text does not contain, and 14 are
 * photographs — of which 7 have all three amounts corroborated by the OCR witness and no flag at
 * all. Admitting that witness here would open those 7 (~60 a year). Narrowing 2 below explains why
 * it stays shut; this is the price of that decision, stated so it can be argued with.
 *
 * The evidence to close that gap was already on the row and unused. `_grounding` records, per
 * figure, whether that exact number occurs in the characters of the document itself. That is not
 * the model's opinion of the model — it is the one witness in this whole file that is not.
 *
 * ── THE THREE NARROWINGS, EACH ONE LOAD-BEARING ──
 *
 * 1. ALL THREE, not the total alone. `verdictBlocksAutoBooking` weighs the total because a total
 *    the paper does not contain is the dangerous shape. Here the question is the opposite one —
 *    may we PROCEED — so it takes the strongest form: excl, btw and incl each found. Combined with
 *    the arithmetic gate that already ran (excl + btw = incl, enforced by classifyImportHealth),
 *    three independently printed numbers that also add up is a far harder thing to be wrong about
 *    than one printed number.
 *
 * 2. 'text' ONLY — never 'ocr'. The header of this file says it plainly: the OCR witness "is a
 *    model, from the same family as the extractor… Corroboration, not proof." Letting it stand in
 *    for the model's own confidence would be the model vouching for itself, which is the precise
 *    circularity this module exists to break. A missing `source` reads as 'text', because that is
 *    what those rows were.
 *
 * 3. It substitutes for ONE missing signal and widens nothing else. Every other gate — document
 *    kind, duplicates, the IBAN change, placement, the printed BTW split, the supplier's own
 *    e-invoice, the overall confidence floor, and the per-field bar on vendor/number/date — runs
 *    first and unchanged. This does not lower a bar; it accepts a stronger witness in place of an
 *    absent weaker one.
 */
export function moneyGroundedInText(fieldConfidence: unknown): boolean {
  if (!fieldConfidence || typeof fieldConfidence !== 'object') return false
  const g = (fieldConfidence as Record<string, unknown>)._grounding
  if (!g || typeof g !== 'object') return false
  const b = g as Record<string, unknown>
  const src = b.source
  // Absent means 'text' — see the note on MoneyGrounding.source. Anything else, including a value
  // this build does not recognise, answers no: an unknown witness is not a stronger one.
  if (!(src === undefined || src === null || src === 'text')) return false
  return b.totalIncBtw === 'found' && b.totalExBtw === 'found' && b.btwAmount === 'found'
}

export function groundingOf(fieldConfidence: unknown): GroundingVerdict | null {
  if (!fieldConfidence || typeof fieldConfidence !== 'object') return null
  const g = (fieldConfidence as Record<string, unknown>)._grounding
  if (!g || typeof g !== 'object') return null
  const v = (g as Record<string, unknown>).totalIncBtw
  return v === 'found' || v === 'absent' || v === 'unreadable' ? v : null
}
