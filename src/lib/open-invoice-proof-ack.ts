// src/lib/open-invoice-proof-ack.ts
// [BEWIJS-BEANTWOORDEN] The answer to the question the proof panel asks. Pure, no I/O of its own.
// Run: npx tsx --test src/lib/open-invoice-proof-ack.test.ts
//
// ── WHAT WAS REPORTED ──
//
// The panel says, over a list of unpaid purchase invoices:
//
//     "Bij 1 factuur vonden we tóch een betaling die erbij lijkt te passen.
//      FAC/2026/00296 · Coroama Stefan Daniel — € 40,00 open
//      In je bank staat € 40,00 op 27 juli 2026 aan COROAMA STEFAN DANIEL — "26/00623".
//      Klopt het dat deze factuur nog openstaat?"
//
// …and offers nothing to answer it with. No cross, no confirmation, no later. The owner checked it
// the first day, found it was a different € 40, and then saw the same question every single time
// they opened the screen.
//
// A question with no answer is worse than no question. It teaches the owner to read past the
// panel, and the panel is the one place in this app that shows its working — the thing they are
// meant to come to rely on. The noise removed elsewhere in this repo was noise BECAUSE it could
// not be acted on; this is the same defect wearing a useful sentence.
//
// ── WHY THE KEY IS THE PAIR AND NOT THE INVOICE ──
//
// The dangerous shortcut is "the owner dismissed this invoice, never ask about it again". Then a
// DIFFERENT payment turns up next month that really does settle it, and the one screen that would
// have said so has been told to be quiet about that invoice forever.
//
// So the answer is keyed to the PAIRING: this invoice AND this payment, by its day, its amount and
// its description. Acknowledge it and that pairing stops asking. Any other payment that ever looks
// like this invoice is a new question, and gets asked.
//
// ── WHY NOTHING DISAPPEARS SILENTLY ──
//
// The panel keeps a count of what has been put away and a way to bring it back. That is not a
// courtesy: this whole feature exists because an app that quietly decides what the owner does not
// need to see is exactly what they cannot check. Hiding the row is the owner's decision; hiding
// the FACT that a row was hidden would be ours.
//
// ── WHY localStorage, AND WHAT THAT COSTS ──
//
// A column would follow the owner across devices; this does not, so someone who works on a phone
// and a laptop answers the same question twice. That is a real cost and it is the smaller one:
// the alternative is a migration, and an acknowledgement is not bookkeeping — nothing about the
// books changes when a question is put away, and the [DUBBEL-BEWIJS] check still stands between
// the owner and paying that invoice twice. If this ever needs to travel, this file is the one
// place that changes.
//
// NOTE ON LANGUAGE: identifiers and comments are English (AGENTS.md). This module produces no
// sentence — the words live in messages.ts and are assembled in open-invoice-proof-text.ts.

import type { OpenInvoiceHit } from './open-invoice-proof-types'

/** The minimal storage shape, so this stays testable without a browser. Same as factuur-handoff. */
export interface AckStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

export const ACK_KEY = 'boekbrug.bewijs-beantwoord'

/** Bump on an incompatible change: older payloads are then ignored rather than misread. */
export const ACK_VERSION = 1

/**
 * How many answers are kept.
 *
 * A ceiling exists because localStorage is small and shared with the rest of the app; blowing past
 * its quota would make writes throw on screens that have nothing to do with this. The OLDEST are
 * dropped first, which is the safe direction: an old answer that comes back asks a question the
 * owner has already looked at once, while dropping a NEW one would lose the answer they just gave.
 */
export const MAX_ACKS = 200

/**
 * The identity of one question: this invoice, and this payment.
 *
 * Built from the fields the owner actually sees on the row, because those are what make it the
 * same question. The amount is fixed to cents so 40 and 40.00 are one key, and the description is
 * squeezed to lower case without runs of whitespace — a bank that re-exports the same line with
 * different spacing is not asking a new question.
 */
export function hitKey(hit: Pick<OpenInvoiceHit, 'invoiceId' | 'transaction'>): string {
  const tx = hit.transaction
  const amount = Math.round(Math.abs(Number(tx?.amount) || 0) * 100)
  const description = String(tx?.description ?? '').toLowerCase().replace(/\s+/g, ' ').trim()
  return [hit.invoiceId, String(tx?.date ?? ''), String(amount), description].join('|')
}

/** What is stored: the version, and the keys that have been answered. */
interface AckPayload {
  version: number
  keys: string[]
}

/**
 * The answers given so far.
 *
 * Anything unreadable — broken JSON, another version, a payload that is not a list — reads as NO
 * answers. That is the fail-safe direction: the worst case is a question the owner has already
 * seen being asked once more, and the alternative would be swallowing a warning because a string
 * in storage was malformed.
 */
export function readAcks(storage: AckStorage | null | undefined): Set<string> {
  if (!storage) return new Set()
  let raw: string | null
  try { raw = storage.getItem(ACK_KEY) } catch { return new Set() }
  if (!raw) return new Set()

  let parsed: unknown
  try { parsed = JSON.parse(raw) } catch { return new Set() }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return new Set()

  const p = parsed as Partial<AckPayload>
  if (p.version !== ACK_VERSION) return new Set()
  if (!Array.isArray(p.keys)) return new Set()
  return new Set(p.keys.filter((k): k is string => typeof k === 'string' && k.length > 0))
}

/**
 * Write the answers back. Fails quietly: storage can be full or blocked (private mode, a locked-
 * down browser), and a panel that throws while the owner clicks a cross is worse than a question
 * that comes back.
 *
 * Returns whether it was actually stored, so a caller that wants to say "this will be back next
 * time" can. Nothing says it today, and that is a deliberate silence rather than an oversight: the
 * row is gone from THIS render either way, and a warning about browser storage in the middle of a
 * screen about money would be the noise this feature is removing.
 */
export function writeAcks(storage: AckStorage | null | undefined, keys: Iterable<string>): boolean {
  if (!storage) return false
  // Oldest out first — see MAX_ACKS.
  const list = [...keys].filter((k) => typeof k === 'string' && k.length > 0)
  const kept = list.length > MAX_ACKS ? list.slice(list.length - MAX_ACKS) : list
  try {
    storage.setItem(ACK_KEY, JSON.stringify({ version: ACK_VERSION, keys: kept } satisfies AckPayload))
    return true
  } catch { return false }
}

/** Answer one question. Returns the new set, so a caller can put it straight into state. */
export function acknowledge(storage: AckStorage | null | undefined, key: string): Set<string> {
  const next = readAcks(storage)
  if (key) next.add(key)
  writeAcks(storage, next)
  return next
}

/**
 * Bring every put-away question back.
 *
 * All of them and not one at a time, because the owner who reaches for this does not remember
 * which row they dismissed — they remember that something was there. A list of hidden rows to pick
 * from would be a second screen about a panel that is meant to be one quiet line.
 */
export function forgetAcks(storage: AckStorage | null | undefined): Set<string> {
  if (storage) { try { storage.removeItem(ACK_KEY) } catch { /* nothing to be done, and nothing bad */ } }
  return new Set()
}

/** Split hits into the ones still worth asking about and the ones already answered. */
export function partitionHits<T extends Pick<OpenInvoiceHit, 'invoiceId' | 'transaction'>>(
  hits: readonly T[],
  answered: ReadonlySet<string>,
): { asking: T[]; answered: T[] } {
  const asking: T[] = []
  const done: T[] = []
  for (const h of hits) (answered.has(hitKey(h)) ? done : asking).push(h)
  return { asking, answered: done }
}
