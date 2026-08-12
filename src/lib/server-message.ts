// src/lib/server-message.ts
// [SERVER-ZIN] A machine code is not a sentence, on any screen.
// =====================================================================
// This app's routes answer failures two different ways, and a screen cannot tell them apart by
// looking:
//
//     { error: "Bankafschrift niet gevonden" }   ← written for a person
//     { error: "invoice_read_failed" }           ← written for a program
//
// Both arrive as `json.error`, so `showToast(json.error || 'Mislukt')` is right half the time and
// puts "opening_balance_lookup_failed" on a shop owner's phone the other half. That was the
// reported bug on /vandaag ("invoice_already_paid" under the "Al betaald?" button), and it is not
// one screen: the bank allocation screen, the kasboek and the statement-delete flow all do it,
// against routes that emit codes for unauthorized, transaction_not_found, invoice_read_failed,
// lookup_failed and verwerkt.
//
// ── THE RULE ──
//
// A code has no spaces. That is the whole test, and it is decidable: every machine value in this
// codebase is a single lowercase token or snake_case, and every sentence written for an owner has
// at least two words. Nothing has to be catalogued for the rule to hold, so it covers routes
// nobody has looked at yet — including the ones written next month.
//
// What it deliberately does NOT do is translate. A Dutch sentence the server wrote is shown as it
// is; a code is replaced by whatever the SCREEN wants to say, in the screen's own language. Screens
// that need a specific line per code have one (pay-toggle-reason.ts); this is the floor under all
// of them: never a code, never a blank.
//
// ── AND A 5xx `detail` IS NEVER SHOWN ──
//
// Several routes attach `detail: error.message` to a 500. That is a raw PostgreSQL string with a
// tag, a function name and a uuid in it. It is exactly what a developer wants in a log and exactly
// what an owner cannot use.
// =====================================================================

/**
 * Is this value a machine code rather than something written for a person?
 *
 * A code is one lowercase token, or snake_case. Anything containing a space is prose — including
 * prose that starts lowercase, because suppressing a real Dutch sentence to be safe would trade a
 * visible problem for an invisible one.
 */
export function isMachineCode(value: unknown): boolean {
  if (typeof value !== 'string') return false
  const t = value.trim()
  if (t === '') return false
  return /^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/.test(t)
}

/** The failure body a route can send. Everything optional — it may be `{}` or not JSON at all. */
export type ServerFailure = { error?: unknown; detail?: unknown } | null | undefined

/**
 * The sentence the server wrote, if it wrote one that is safe to show. Otherwise null, and the
 * screen says whatever it would have said anyway — in the owner's language.
 *
 * `detail` wins over `error` when both are prose: a route that bothers to attach a detail is
 * carrying a FACT the code cannot (which status was refused, which window applies, which reference
 * collided), and that is worth more than the general line.
 */
export function serverSentence(status: number, json: ServerFailure): string | null {
  // A 5xx detail is a raw database string. Never, on any screen.
  if (status < 500) {
    const detail = typeof json?.detail === 'string' ? json.detail.trim() : ''
    if (detail !== '' && !isMachineCode(detail)) return detail
  }
  const error = typeof json?.error === 'string' ? json.error.trim() : ''
  if (error !== '' && !isMachineCode(error)) return error
  return null
}

/**
 * What to show: the server's sentence when it has one, otherwise the screen's own line.
 *
 * `fallback` is already translated by the caller — this module holds no language of its own
 * (AGENTS.md), and a Dutch string here would render underneath an Arabic interface.
 */
export function failureText(status: number, json: ServerFailure, fallback: string): string {
  return serverSentence(status, json) ?? fallback
}
