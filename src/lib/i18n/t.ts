// src/lib/i18n/t.ts
// [TAAL] The translator. Pure. Run: npx tsx --test src/lib/i18n/t.test.ts
//
// The rule this file exists to enforce is one line long: **a missing translation falls back to
// Dutch, never to a key and never to a blank.**
//
// That is not politeness, it is the difference between a usable app and a broken one. This is a
// bookkeeping product; a button that reads `invoice.send` or an empty confirmation next to a
// permanent invoice number is worse than the same sentence in a language the owner reads less
// comfortably. Dutch is the source language — every string is written there first and is legally
// correct there — so falling back to it always leaves something TRUE on the screen.
//
// WHY NOT AN i18n LIBRARY
// The app needs three things: look a key up, fall back, and substitute a number or a name. A
// library brings a provider, a loader, a plural engine, a compiler step and a version to keep in
// step with a Next.js that already differs from what anyone remembers. None of that buys a
// property this file cannot state in twenty lines and pin with a test — and the one property that
// matters most (fallback is Dutch, never a key) is exactly the one a library would decide for us.
//
// WHAT IS NOT TRANSLATED, EVER
// The invoice PDF, the e-mail that carries it, and the e-factuur XML. Those are read by a Dutch
// customer, an accountant and the Belastingdienst — not by the owner. Translating them would
// change what the documents ARE. See the note in locale.ts.

import { DEFAULT_LOCALE, resolveLocale, type Locale } from './locale'
import { MESSAGES, type MessageKey } from './messages'

/** Values substituted into a message: {name}, {number}, {amount}. */
export type Params = Record<string, string | number>

/**
 * Substitute {placeholders}. A placeholder with no matching parameter is LEFT AS IT IS.
 *
 * Deliberately not blanked: "Factuur {number} ligt vast" is visibly broken and someone reports
 * it, while "Factuur  ligt vast" reads like a rendering hiccup and ships. The loud failure is the
 * safe one on a screen that talks about permanent numbers.
 */
function fill(template: string, params?: Params): string {
  if (!params) return template
  return template.replace(/\{(\w+)\}/g, (whole, name: string) =>
    name in params ? String(params[name]) : whole,
  )
}

/**
 * The message for a key in a language.
 *
 * The fallback chain is: the requested language → Dutch → the key itself. The last step can only
 * be reached by a key that is not in the catalogue at all, which the [TAAL] gate makes impossible
 * to commit — it is here so that a typo during development shows up as the typo, loudly, instead
 * of as an empty element.
 */
export function translate(locale: unknown, key: MessageKey, params?: Params): string {
  const entry = MESSAGES[key] as Record<string, string> | undefined
  if (!entry) return key
  const wanted = entry[resolveLocale(locale)]
  if (typeof wanted === 'string' && wanted.length > 0) return fill(wanted, params)
  const dutch = entry[DEFAULT_LOCALE]
  return typeof dutch === 'string' && dutch.length > 0 ? fill(dutch, params) : key
}

export type Translator = (key: MessageKey, params?: Params) => string

/** A translator bound to one language, for a component that renders many strings. */
export function translator(locale: unknown): Translator {
  const l: Locale = resolveLocale(locale)
  return (key, params) => translate(l, key, params)
}
