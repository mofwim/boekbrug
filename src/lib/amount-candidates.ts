// src/lib/amount-candidates.ts
// [ANDER-TOTAAL] The document's own total, when the read one is not on it.
// =====================================================================
// [GEGROND-OCR] already does the hard part. When a scan has no text layer there is nothing to
// search, so the app pays for a SECOND, blind read — "write down every amount you can see" — and
// checks whether the extracted total appears in it. When it does not, the owner is told:
//
//     "het totaalbedrag staat niet letterlijk in de tekst van dit document — controleer het aan de
//      factuur zelf"
//
// True, and as far as it went, useless: the owner is sent to find the paper. Meanwhile the app is
// holding a transcription of that paper's amounts and throws it away.
//
// Measured on a real three-page supplier invoice (NemaFood B.V., 262697): the app read
// € 1.149,56 with € 94,92 BTW. The document says € 1.065,14 + € 95,54 = € 1.160,68. Eleven euro of
// cost and sixty-two cents of voorbelasting, on an invoice the app itself had flagged as
// unverified — and the numbers that would have shown it were in hand and discarded.
//
// ── WHAT THIS DOES, AND WHAT IT REFUSES TO DO ──
//
// It looks for a triple among the transcribed amounts that ADDS UP: ex + btw = inc, exactly, to the
// cent. That is not a guess about which number is the total — it is the one arithmetic relationship
// every Dutch invoice's totals block satisfies and almost nothing else does. A line price and a
// quantity do not sum to a third printed number by accident very often, and when they do the
// candidate is shown as a QUESTION, never applied.
//
// It never overwrites the read. The owner sees both figures and decides — because the transcription
// is a model read too, with its own failure modes, and replacing one unverified number with another
// unverified number would move the problem rather than solve it. What changes is that the owner can
// answer the question on the screen instead of going to look for the paper.
// =====================================================================

/** One totals block that adds up: ex + btw = inc, to the cent. */
export interface TotalsCandidate {
  ex: number
  btw: number
  inc: number
}

/** Cents, as an integer — the only safe unit for an equality test on money. */
const cents = (n: number): number => Math.round(n * 100)

/**
 * Below this an amount is too small to be a document's total, and small numbers are exactly where
 * coincidental sums live (0,10 + 0,15 = 0,25 appears on any receipt with three line prices).
 */
const MIN_TOTAL = 1

/**
 * [TARIEF-MOGELIJK] The highest BTW rate the Netherlands has. A totals block whose btw/ex exceeds
 * it is not a totals block.
 *
 * ── WHY THIS WAS THE MISSING HALF ──
 *
 * "ex + btw = inc, to the cent" is a real constraint, and the header above argues it is rare by
 * accident. On a wholesale invoice it is not rare at all, because the QUANTITY column is a column
 * of small integers and small integers add up constantly. Measured on a real one (BALKIP B.V.
 * 264091): POTEN 50, VLEUGELS 30, KIP FILET 80 — and the owner was shown
 *
 *     "er staat wél € 50,00 + € 30,00 btw = € 80,00"
 *
 * about an invoice for € 1.224,75. Seven such triples were found on that document and EVERY ONE of
 * them implied an impossible rate: 60%, 50%, 33%, 30%, 25%. Not one was a totals block.
 *
 * The rate is what tells them apart, and it costs one division. A Dutch invoice's btw is 0%, 9% or
 * 21%, or any blend between them when rates are mixed — so anything above 21% is arithmetic that
 * happens to work, not money. Deliberately a CEILING rather than a match against the three rates:
 * a genuine mixed-rate block lands between them, and demanding an exact rate would throw away the
 * blocks this feature exists to find.
 */
const MAX_NL_BTW_RATE = 0.21

/**
 * A hair of slack, because the block is read off a scan. 21% of a large net rounds to a cent that
 * can sit a fraction over the ceiling; refusing that would drop real blocks over rounding.
 */
const RATE_SLACK = 0.005

/**
 * How many amounts to consider. A transcription of a three-page invoice runs to dozens of tokens,
 * and the search below is quadratic — bounded so a pathological reply cannot stall a request.
 * The totals block is always among the LARGEST amounts on the page, so the cap keeps the ones
 * that matter.
 */
const MAX_CONSIDERED = 60

/**
 * Every distinct amount, largest first, bounded.
 *
 * Distinct matters: an invoice prints the same figure more than once (a subtotal repeated in the
 * totals block, a BTW amount per rate and again as a sum), and duplicates would produce triples
 * like `x + 0 = x` that add up and mean nothing.
 */
function candidates(amounts: readonly number[]): number[] {
  const seen = new Set<number>()
  const out: number[] = []
  for (const a of amounts) {
    if (!Number.isFinite(a)) continue
    const v = Math.abs(a)
    if (v < 0.005) continue // a printed 0,00 is real, but it cannot be part of a meaningful triple
    const c = cents(v)
    if (seen.has(c)) continue
    seen.add(c)
    out.push(v)
  }
  return out.sort((x, y) => y - x).slice(0, MAX_CONSIDERED)
}

/**
 * Every totals block hiding in a list of amounts: ex + btw = inc, all three distinct, inc the
 * largest of the three.
 *
 * Returned largest-inc first. An invoice's per-rate blocks also add up (3,60 + 1.061,54 = 1.065,14
 * on the measured document), so ordering by the total is what puts the GRAND total first —
 * the one that becomes money.
 */
export function totalsCandidates(amounts: readonly number[]): TotalsCandidate[] {
  const list = candidates(amounts)
  const byCents = new Map<number, number>()
  for (const v of list) byCents.set(cents(v), v)

  const out: TotalsCandidate[] = []
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      const a = list[i]
      const b = list[j]
      const sum = cents(a) + cents(b)
      const inc = byCents.get(sum)
      if (inc === undefined) continue
      if (inc < MIN_TOTAL) continue
      // `a` is the larger of the pair (the list is sorted), so it is the ex-BTW side. A block where
      // the BTW exceeds the net is not a Dutch invoice; refusing it drops half the false pairs.
      if (b > a) continue
      // [TARIEF-MOGELIJK] …and half is not enough. 30 on 50 passes the test above and is a 60%
      // rate, which is the shape a quantity column produces. The rate is what separates a totals
      // block from three integers that happen to add up.
      if (b / a > MAX_NL_BTW_RATE + RATE_SLACK) continue
      out.push({ ex: a, btw: b, inc })
    }
  }
  return out.sort((x, y) => y.inc - x.inc)
}

/**
 * The totals block to put in front of the owner, given what the reader claimed.
 *
 * `null` when there is nothing worth saying: no consistent block, or one that merely agrees with
 * the read. Agreement is not a finding — this only speaks when the document and the reader differ,
 * which is the whole reason the owner is being interrupted.
 */
export function alternativeTotals(
  readTotalIncBtw: number | null | undefined,
  amounts: readonly number[],
): TotalsCandidate | null {
  const known = typeof readTotalIncBtw === 'number' && Number.isFinite(readTotalIncBtw)
    ? Math.abs(readTotalIncBtw)
    : null

  // [SCHAAL] A competing reading of a number is the same size as that number.
  //
  // The rate filter kills most of the quantity-column noise; it cannot kill all of it, because a
  // 20% ratio is not impossible. On the measured invoice (read € 1.224,75) what survived was
  // 10 + 2 = 12 — three quantities, arithmetically perfect, and absurd as "the total on this
  // document" the moment you hold it next to what was read.
  //
  // This claim is "we may have read your total wrong". A misread is a digit, a transposition, a
  // decimal point — it is never two orders of magnitude, and the two cases this feature was built
  // from are both within one percent (1.149,56 vs 1.160,68). A factor of ten is far wider than
  // either and still refuses everything that is merely arithmetic.
  //
  // When nothing was read there is nothing to be the same size as, and the block stands on its own.
  const floor = known === null ? 0 : known / 10
  const found = totalsCandidates(amounts).filter((c) => c.inc >= floor)
  if (found.length === 0) return null

  const best = found[0]
  // The reader's own figure, corroborated. Nothing to raise.
  if (known !== null && cents(known) === cents(best.inc)) return null
  return best
}

/** Dutch money, as this app writes it everywhere else. Local so this module stays pure. */
function euro(n: number): string {
  return `€ ${n.toLocaleString('nl-NL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

/**
 * The sentence the owner reads, or null.
 *
 * Deliberately a QUESTION and not a correction. Both numbers come from a model reading a scan; the
 * app knows they disagree and does not know which is right. Saying which one is right would be the
 * same overconfidence that produced the wrong number in the first place — and the owner, holding
 * the invoice, can settle it in a glance if we show them WHAT to look for.
 */
export function alternativeTotalsText(
  readTotalIncBtw: number | null | undefined,
  amounts: readonly number[],
): string | null {
  const alt = alternativeTotals(readTotalIncBtw, amounts)
  if (!alt) return null
  const read = typeof readTotalIncBtw === 'number' && Number.isFinite(readTotalIncBtw)
    ? `Wij lazen ${euro(Math.abs(readTotalIncBtw))}, maar dat bedrag staat nergens op dit document. `
    : ''
  return (
    `${read}Wél staat er een totaal dat klopt: ${euro(alt.ex)} + ${euro(alt.btw)} btw = ` +
    `${euro(alt.inc)}. Kijk even op de factuur welk bedrag er staat.`
  )
}
