// src/lib/reminder-original.ts
// [HERINNERING-NOOIT] A payment reminder is never an invoice. Pure, no I/O.
// Run: npx tsx src/lib/reminder-original.test.ts
//
// ── WHAT WAS MEASURED ──
//
// One supplier (a horeca wholesaler) sends a "HERINNERING" for every invoice that is a week past
// due. Thirteen of those arrived by e-mail sync. Each one was read as an invoice — the reader
// marked it `is_reminder` correctly — and each one was IMPORTED into the verify queue, flagged, on
// the theory that the original might never have arrived. Twelve of the thirteen the owner then
// archived by hand, one at a time, because the original had of course arrived: the originals sat
// right next to them, 'paid' or 'received'.
//
// Why the old rule ("skip when the original is already booked") never fired: the reminder prints
// the number in a narrower column and the reader dropped its last digit on every one of them —
// "2670971" for "26709711". A number-only lookup found nothing, and "nothing found" meant "import
// it, flagged". The safe side of the old rule was the wrong side thirteen times out of thirteen.
//
// ── THE RULE ──
//
// A reminder — betalingsherinnering, aanmaning, sommatie, ingebrekestelling, WIK-brief — is
// about an invoice the owner already has or should have. It is never a NEW cost, so it never
// becomes a row in `invoices`, on any door. What happens instead:
//
//   · The file is kept in bestanden (it is evidence: the supplier says, on this date, that this
//     invoice is unpaid).
//   · The ORIGINAL is looked for with everything the reminder repeats, not only the number: the
//     number as printed, or the same supplier with the same amount on the same invoice date, or
//     the same supplier and amount where one number is a prefix of the other (the dropped digit).
//   · Found → the file is linked to that invoice, and the owner hears the one thing worth hearing:
//     the supplier still wants money for an invoice that stands PAID here (check the payment), or
//     for one that is still OPEN here (pay it).
//   · Not found → the file is kept UNLINKED and the owner is told the invoice is missing from the
//     books. The reminder repeats the whole invoice, so ONE deliberate tap can book it from the
//     file (read-as-invoice); nothing books by itself. That is what keeps the money-safe half of
//     the old argument: evidence is never thrown away, it is just never mistaken for a bill.
//
// The number match is deliberately the same normalisation the dedup path uses (whitespace only);
// the prefix rule is the one addition, and it is only allowed together with the supplier AND the
// amount — a prefix alone would join "2026-1" to "2026-10".

import { normalizeInvoiceNumber } from '@/lib/safecore'

/** What the reader says about the reminder. Every field may be missing. */
export interface ReminderFacts {
  isReminder?: boolean | null
  /** The number of the ORIGINAL invoice, as the reader returned it. */
  reminderOfInvoiceNumber?: string | null
  /** The number printed on the reminder itself — usually the same number. */
  invoiceNumber?: string | null
  vendor?: string | null
  totalIncBtw?: number | null
  /** The invoice date the reminder repeats ("Fact.datum"), ISO. Not the reminder's own date. */
  invoiceDate?: string | null
}

/** An invoice already in the books, as the caller fetched it. */
export interface OriginalCandidate {
  id: string
  invoiceNumber: string | null
  totalIncBtw: number | null
  invoiceDate: string | null
  clientName: string | null
  status: string | null
  paymentDate?: string | null
  dueDate?: string | null
}

export type ReminderPlacement =
  /** Not a reminder → the normal road. */
  | { action: 'import' }
  /** A reminder → filed, never booked. `original` is the invoice it is about, when exactly one fits. */
  | { action: 'file'; original: OriginalCandidate | null; ambiguous: number; reason: string }

const MIN_PREFIX_DIGITS = 6
const STOP_TOKENS = new Set(['bv', 'nv', 'vof', 'cv', 'de', 'het', 'een', 'van', 'en', 'the', 'ltd', 'gmbh', 'inc', 'co', 'horeca', 'group', 'groep'])

/** The words of a party name that carry identity: letters/digits, three or more, minus legal noise. */
function nameTokens(name: string | null | undefined): Set<string> {
  const out = new Set<string>()
  for (const raw of (name ?? '').toLowerCase().split(/[^a-z0-9]+/)) {
    if (raw.length >= 3 && !STOP_TOKENS.has(raw)) out.add(raw)
  }
  return out
}

function sameParty(a: string | null | undefined, b: string | null | undefined): boolean {
  const ta = nameTokens(a)
  if (ta.size === 0) return false
  for (const t of nameTokens(b)) if (ta.has(t)) return true
  return false
}

function sameCents(a: number | null | undefined, b: number | null | undefined): boolean {
  if (typeof a !== 'number' || typeof b !== 'number' || !Number.isFinite(a) || !Number.isFinite(b)) return false
  return Math.round(Math.abs(a) * 100) === Math.round(Math.abs(b) * 100)
}

/** Digits only — the prefix rule is about a dropped digit, not about a dash or a slash. */
function digitsOf(n: string | null | undefined): string {
  return (n ?? '').replace(/\D+/g, '')
}

function numberPrefixRelated(a: string | null | undefined, b: string | null | undefined): boolean {
  const da = digitsOf(a)
  const db = digitsOf(b)
  if (da.length < MIN_PREFIX_DIGITS || db.length < MIN_PREFIX_DIGITS) return false
  if (da === db) return true
  return da.length < db.length ? db.startsWith(da) : da.startsWith(db)
}

/** The number the reminder points at — the reader's `reminder_of` first, its own number second. */
export function reminderNumber(facts: ReminderFacts): string {
  const of = (facts.reminderOfInvoiceNumber ?? '').trim()
  if (of) return of
  return (facts.invoiceNumber ?? '').trim()
}

/**
 * Which booked invoice this reminder is about. Pure.
 *
 * A candidate fits when
 *   (a) its number equals the reminder's, whitespace-normalised — the dedup path's own rule; or
 *   (b) the same party AND the same amount to the cent AND (the same invoice date OR one number is
 *       a digit-prefix of the other of at least six digits).
 * Exactly one fit is a match. Two or more are reported as `ambiguous` and nothing is linked: a
 * wrong link would put the supplier's "still unpaid" on the wrong invoice.
 */
export function findReminderOriginal(
  facts: ReminderFacts,
  candidates: readonly OriginalCandidate[],
): { match: OriginalCandidate | null; ambiguous: number } {
  const key = normalizeInvoiceNumber(reminderNumber(facts))
  const fits: OriginalCandidate[] = []
  for (const c of candidates) {
    const cKey = normalizeInvoiceNumber(c.invoiceNumber)
    if (key && cKey && key === cKey) { fits.push(c); continue }
    if (!sameCents(facts.totalIncBtw, c.totalIncBtw)) continue
    if (!sameParty(facts.vendor, c.clientName)) continue
    const sameDate = !!facts.invoiceDate && !!c.invoiceDate && facts.invoiceDate === c.invoiceDate
    if (sameDate || numberPrefixRelated(reminderNumber(facts), c.invoiceNumber)) fits.push(c)
  }
  if (fits.length === 1) return { match: fits[0], ambiguous: 0 }
  return { match: null, ambiguous: fits.length }
}

/** Where a document goes once the reader has spoken. A reminder is filed; everything else imports. */
export function placeReminder(
  facts: ReminderFacts,
  candidates: readonly OriginalCandidate[],
): ReminderPlacement {
  if (facts.isReminder !== true) return { action: 'import' }
  const found = findReminderOriginal(facts, candidates)
  return {
    action: 'file',
    original: found.match,
    ambiguous: found.ambiguous,
    reason: reminderFiledReason(facts, found.match, found.ambiguous),
  }
}

/** The sentence in the skip registry. Dutch: it is read by the owner on the "overgeslagen" panel. */
export function reminderFiledReason(
  facts: ReminderFacts,
  original: OriginalCandidate | null,
  ambiguous = 0,
): string {
  const nr = reminderNumber(facts)
  const noemer = nr ? `factuur ${nr}` : 'een factuur'
  if (original) {
    const orig = original.invoiceNumber && original.invoiceNumber !== nr ? ` (bij jou ${original.invoiceNumber})` : ''
    return `herinnering voor ${noemer}${orig} — die factuur staat al in je boekhouding; de herinnering is bewaard in je bestanden en niet als tweede kost geboekt`
  }
  if (ambiguous > 1) {
    return `herinnering voor ${noemer} — er staan ${ambiguous} facturen met dit bedrag in je boekhouding; de herinnering is bewaard in je bestanden en niet geboekt`
  }
  return `herinnering voor ${noemer} — die factuur staat niet in je boekhouding; de herinnering is bewaard in je bestanden, vraag de factuur op of boek hem vanaf het bestand`
}

/** Kept for the audit trail that names the skipped reminder by its original. */
export function reminderSkipReason(originalNumber: string): string {
  return (
    `herinnering voor factuur ${originalNumber} — die factuur staat al in je boekhouding, ` +
    `dus deze herinnering is niet als tweede kost geïmporteerd`
  )
}
