// src/lib/pay-toggle-reason.ts
// [PAY-REDEN] What the owner reads when /api/invoice/pay-toggle refuses.
// =====================================================================
// That route answers with a machine CODE in `error` and only sometimes a written `detail`. Three
// screens call it — /vandaag, /facturen and /incoming/manage — and each had its own idea of what
// to show, so the same refusal reached the owner as three different things:
//
//   · manage   `detail || the Dutch line for the code || a neutral fallback`. Correct, and the
//              reasoning behind it is worth keeping: a 5xx `detail` is a raw Postgres string and
//              must never reach a phone, while a 4xx one is a sentence the server wrote on purpose.
//   · facturen `detail || error`. Falls through to the CODE for every refusal that carries no
//              detail — and it decided whether to open its "verwerkt" dialog by looking for the
//              word "verwerkt" INSIDE that message, which stops working the moment the message is
//              translated.
//   · vandaag  `data?.error` — the bare code, always. "invoice_already_paid" on a shop owner's
//              phone, in every language including Dutch.
//
// So the rule lives here once, and it returns a DECISION rather than a sentence:
//
//   { kind: 'server' } — the server wrote a sentence and the status says we may trust it.
//   { kind: 'key' }    — a known code, rendered from the catalogue in the owner's language.
//
// The screen does the rendering, which is what lets the same rule serve a translated screen and
// keeps the copy out of the component (AGENTS.md: "a component holds no language of its own").
//
// WHY `detail` STILL WINS WHEN IT IS THERE. It is Dutch, and on an Arabic screen that is a
// language switch mid-sentence. It is still the better answer: those details are the ones that
// carry a FACT the code cannot — which status was refused, which date window applies, which
// reference collided. A translated generic line would be smoother and less true, and this is a
// bookkeeping app. Every refusal that has no such fact has a key, and keys cover every code the
// route can emit — so the Dutch sentence appears exactly where it is buying something.
// =====================================================================

import type { MessageKey } from './i18n/messages'

/** What a screen should show. `server` is a sentence already written; `key` needs the translator. */
export type PayToggleAnswer =
  | { kind: 'server'; text: string }
  | { kind: 'key'; key: MessageKey }

/** The shape of the route's JSON body that matters here. Everything is optional — it may be {}. */
export type PayToggleError = { detail?: unknown; error?: unknown } | null | undefined

/**
 * One Dutch line per code the route can answer with, as a catalogue KEY.
 *
 * Written as literals, not built from the code at call time: the [TAAL] gate proves every declared
 * message is rendered somewhere by looking for the key as a literal string, and a key assembled as
 * `'pay.reden.' + code` would report every one of these as an orphan while they are all in use.
 */
export const PAY_TOGGLE_REASON_KEY: Record<string, MessageKey> = {
  verwerkt: 'pay.reden.verwerkt',
  invoice_already_paid: 'pay.reden.alBetaald',
  // [HAND-DUBBEL] Carries a written `detail` naming the other row's amounts, so payToggleAnswer
  // shows that sentence rather than this key. The key exists because a code without one falls back
  // to "er ging iets mis", and this refusal is the opposite of a malfunction.
  duplicate_already_paid: 'pay.reden.dubbelAlBetaald',
  invoice_not_found: 'pay.reden.nietGevonden',
  not_paid: 'pay.reden.nietBetaald',
  not_payable: 'pay.reden.nietAfboekbaar',
  status_conflict: 'pay.reden.statusVeranderd',
  unauthorized: 'pay.reden.sessieVerlopen',
  invalid_amount: 'pay.reden.bedragOngeldig',
  invalid_payment_date: 'pay.reden.datumOngeldig',
  partial_cash_unsupported: 'pay.reden.deelKasOnmogelijk',
  client_key_conflict: 'pay.reden.referentieBotst',
  undo_read_failed: 'pay.reden.leesFout',
  undo_failed: 'pay.reden.terugdraaienMislukt',
  pay_failed: 'pay.reden.algemeen',
}

/** The line for a refusal that named no code we know, or none at all. */
export const PAY_TOGGLE_FALLBACK_KEY: MessageKey = 'pay.reden.algemeen'

/** The code the route sends when the accountant has locked the invoice. */
export const VERWERKT_CODE = 'verwerkt'

/**
 * [HAND-DUBBEL] The code the route sends when this invoice NUMBER already stands paid elsewhere.
 *
 * Its own predicate rather than a string test at the call site, for the reason isVerwerktConflict
 * gives one paragraph down: a screen that recognises a refusal by reading its own sentence back
 * stops recognising it the moment that sentence is translated.
 */
export const DUPLICATE_PAID_CODE = 'duplicate_already_paid'

/**
 * Does this refusal deserve a QUESTION rather than a toast?
 *
 * The double booking this guards against was made three times in one evening on a live
 * administration, twice through this very route. But which of two rows is the real invoice is a
 * question about paper — so the screen asks, and the owner may book it anyway. A refusal the owner
 * cannot get past would strand every legitimate invoice whose number happens to repeat.
 */
export function isDuplicatePaidConflict(json: PayToggleError): boolean {
  return (typeof json?.error === 'string' ? json.error : '') === DUPLICATE_PAID_CODE;
}

/**
 * What to show for a failed pay-toggle response.
 *
 * @param status the HTTP status. A 5xx `detail` is a raw database string, never for a phone.
 */
export function payToggleAnswer(status: number, json: PayToggleError): PayToggleAnswer {
  const detail = typeof json?.detail === 'string' ? json.detail.trim() : '';
  if (status < 500 && detail !== '') return { kind: 'server', text: detail };
  const code = typeof json?.error === 'string' ? json.error : '';
  return { kind: 'key', key: PAY_TOGGLE_REASON_KEY[code] ?? PAY_TOGGLE_FALLBACK_KEY };
}

/**
 * Is this the accountant's lock, i.e. does the screen owe the owner its own dialog?
 *
 * Decided from the CODE. /facturen decided it by searching the displayed MESSAGE for the word
 * "verwerkt", which is two bugs waiting: the dialog stops opening the moment that message is
 * translated (the Arabic sentence contains no Dutch word), and it opens wrongly for any other
 * refusal whose sentence happens to mention the boekhouder. A code is not prose.
 */
export function isVerwerktConflict(json: PayToggleError): boolean {
  return (typeof json?.error === 'string' ? json.error : '') === VERWERKT_CODE;
}
