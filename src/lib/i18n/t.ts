// src/lib/i18n/t.ts
// [I18N] The lookup function. Framework-agnostic and dependency-free so it can be
// used from server or client code, and swapped for a heavier library later without
// changing call sites.
//
//   translate('en', 'nav.invoices')            -> "Invoices"
//   translate('ar', 'greeting.hello', {name})  -> "مرحباً Sara"
//   translate('tr', 'nav.missing')             -> falls back to nl, else "nav.missing"

import { type AppLocale, DEFAULT_APP_LOCALE } from './config'
import { nl } from './messages/nl'
import { en } from './messages/en'
import { ar } from './messages/ar'
import { tr } from './messages/tr'

const CATALOGS: Record<AppLocale, unknown> = { nl, en, ar, tr }

function lookup(catalog: unknown, key: string): unknown {
  return key.split('.').reduce<unknown>((obj, part) => {
    if (obj && typeof obj === 'object') return (obj as Record<string, unknown>)[part]
    return undefined
  }, catalog)
}

function interpolate(text: string, vars?: Record<string, string | number>): string {
  if (!vars) return text
  return Object.entries(vars).reduce(
    (out, [k, v]) => out.replaceAll(`{${k}}`, String(v)),
    text,
  )
}

/**
 * Resolve a dot-path message key for a locale. Falls back to Dutch when the key
 * is missing in the target locale, and returns the key itself if it is missing
 * everywhere — so a gap is visible in the UI, never a crash.
 */
export function translate(
  locale: AppLocale,
  key: string,
  vars?: Record<string, string | number>,
): string {
  let value = lookup(CATALOGS[locale], key)
  if (typeof value !== 'string') value = lookup(CATALOGS[DEFAULT_APP_LOCALE], key)
  if (typeof value !== 'string') return key
  return interpolate(value, vars)
}
