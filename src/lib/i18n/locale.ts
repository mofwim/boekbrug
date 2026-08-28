// src/lib/i18n/locale.ts
// [TAAL] The app's language vocabulary — which languages exist, and what each one implies.
// Pure. No node:fs, no database, no React. Run: npx tsx --test src/lib/i18n/locale.test.ts
//
// WHY THIS FILE EXISTS, AND WHY IT IS NOT NEW
// Every line below already existed — inside src/lib/blog.ts, which opens with:
//
//     Server-only: uses node:fs and runs at build time (SSG). Never import this
//     into a client component.
//
// So the app already knew about four languages, already knew Arabic is written right to left, and
// already knew to force Latin digits for Arabic so an amount reads the same in every language. It
// knew all of that in a module no screen is allowed to import.
//
// That is the whole reason the product is Dutch-only while the funnel is not. There are 53 Arabic
// articles and an /ar/blog route: an Arab shop owner in the Netherlands can read this app's
// writing in their own language, click through, and land in a Dutch application. The vocabulary to
// fix that was already written; it was locked in the one file a screen cannot reach.
//
// Moving it costs nothing and breaks nothing: blog.ts re-exports these names, so every existing
// import keeps working, unchanged.
//
// WHAT DOES NOT MOVE
// The language of a DOCUMENT is not the language of a screen. An invoice PDF, the e-mail that
// carries it and the e-factuur XML are read by a Dutch customer, an accountant and the
// Belastingdienst — never by the owner's language setting. They stay Dutch. This module is about
// what the OWNER reads.

/**
 * The cookie the owner's language choice is kept in.
 *
 * [BOOT-STUB] It lives HERE, in the neutral module, and that is not tidiness — it is a bug fix.
 * It used to be declared in use-locale.ts, which carries 'use client'. locale-boot.ts is imported
 * by the SERVER root layout and interpolates this name into the pre-paint script, and Next
 * replaces every export of a client module reached from the server with a throwing stub. So the
 * emitted script contained, literally:
 *
 *   document.cookie.match(/(?:^|;\s*)function(){throw Error("Attempted to call LOCALE_COOKIE()
 *   from the server but LOCALE_COOKIE is on the client…
 *
 * — a regex that matches no cookie, inside a try/catch that swallowed the SyntaxError. So the
 * cookie branch of the boot script never ran, on any page, since it was written. The URL branch
 * did, which is why /ar/blog was right and everything else was not: an owner who set Arabic got
 * Arabic WORDS (useLocale reads the cookie fine in the browser) inside a document still stamped
 * lang="nl" dir="ltr". Right-to-left text in a left-to-right box, on every screen of the app,
 * announced to a screen reader as Dutch.
 *
 * The same stub reached src/lib/i18n/server.ts, which looked the cookie up by that name.
 */
export const LOCALE_COOKIE = 'boekbrug_taal'

/** The languages the app publishes in. Dutch is the source language; the rest are translations. */
export type Locale = 'nl' | 'en' | 'ar' | 'tr'

export const LOCALES: Locale[] = ['nl', 'en', 'ar', 'tr']

/**
 * Dutch, and not by accident: the product is a Dutch bookkeeping app under Dutch tax law, and
 * every legal string it prints is written in Dutch first. A missing translation therefore falls
 * back to something true rather than to a key or a blank.
 */
export const DEFAULT_LOCALE: Locale = 'nl'

export interface LocaleMeta {
  /** Text direction. Arabic is the reason this field exists. */
  dir: 'ltr' | 'rtl'
  /** The language's own name, for a language switch. Never translated. */
  label: string
  hreflang: string
  ogLocale: string
  /**
   * The BCP-47 tag for Intl formatting. Arabic carries `-u-nu-latn` deliberately: it forces
   * Latin digits, so € 1.234,56 reads as the same number in Arabic as it does in Dutch. Eastern
   * Arabic numerals would be correct as language and wrong as money — the owner reconciles these
   * figures against a Dutch bank statement and a Dutch invoice.
   */
  intl: string
}

export const LOCALE_META: Record<Locale, LocaleMeta> = {
  nl: { dir: 'ltr', label: 'Nederlands', hreflang: 'nl-NL', ogLocale: 'nl_NL', intl: 'nl-NL' },
  en: { dir: 'ltr', label: 'English', hreflang: 'en-GB', ogLocale: 'en_GB', intl: 'en-GB' },
  ar: { dir: 'rtl', label: 'العربية', hreflang: 'ar', ogLocale: 'ar_AR', intl: 'ar-u-nu-latn' },
  tr: { dir: 'ltr', label: 'Türkçe', hreflang: 'tr-TR', ogLocale: 'tr_TR', intl: 'tr-TR' },
}

/**
 * Is this a language the app actually has? Narrows, so a cookie, a URL segment or a database
 * column can be trusted after the check and never before.
 *
 * Anything unknown is NOT coerced to Dutch here. The caller decides what to do with a language it
 * does not have, and the two right answers differ: a URL should 404, a preference should fall
 * back. Deciding it here would make the second look like the first.
 */
export function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && (LOCALES as string[]).includes(value)
}

/** The language to actually use, given something that may or may not be one. */
export function resolveLocale(value: unknown): Locale {
  return isLocale(value) ? value : DEFAULT_LOCALE
}

/** 'rtl' for Arabic, 'ltr' for the rest. Unknown input reads as the default language's direction. */
export function localeDir(locale: unknown): 'ltr' | 'rtl' {
  return LOCALE_META[resolveLocale(locale)].dir
}

/**
 * The URL prefix for a language — '' for Dutch, '/ar' for Arabic.
 *
 * Dutch has no prefix and never will: it is the canonical language and the existing /blog URLs
 * are indexed. A prefix for it would be a redirect on every Dutch page in the app.
 */
export function localePrefix(locale: unknown): string {
  const l = resolveLocale(locale)
  return l === DEFAULT_LOCALE ? '' : `/${l}`
}
