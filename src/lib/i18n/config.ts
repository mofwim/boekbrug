// src/lib/i18n/config.ts
// [I18N] App-side internationalisation config. Distinct from the blog's URL-prefix
// locale system (src/lib/blog.ts) — the authenticated dashboard picks its language
// from the USER's preference, not the URL. Dutch is the default and the fallback,
// so the Dutch experience is unchanged.
//
// This file (and everything under src/lib/i18n/) is additive: it is imported by
// nothing in the existing app yet, so it cannot break or conflict with in-flight
// work. Wiring it into the dashboard is a later, deliberate step (see
// docs/i18n-plan.md §6).

export type AppLocale = 'nl' | 'en' | 'ar' | 'tr'

export const APP_LOCALES: AppLocale[] = ['nl', 'en', 'ar', 'tr']

export const DEFAULT_APP_LOCALE: AppLocale = 'nl'

export interface AppLocaleMeta {
  /** Text direction — 'rtl' for Arabic drives the dashboard RTL pass. */
  dir: 'ltr' | 'rtl'
  /** The language's own name, for the language switcher. */
  label: string
  /** BCP-47 tag for Intl (dates, numbers). ar forces Latin digits for consistency. */
  intl: string
}

export const APP_LOCALE_META: Record<AppLocale, AppLocaleMeta> = {
  nl: { dir: 'ltr', label: 'Nederlands', intl: 'nl-NL' },
  en: { dir: 'ltr', label: 'English', intl: 'en-GB' },
  ar: { dir: 'rtl', label: 'العربية', intl: 'ar-u-nu-latn' },
  tr: { dir: 'ltr', label: 'Türkçe', intl: 'tr-TR' },
}

/** Narrow an arbitrary string (e.g. a stored preference) to a supported locale. */
export function asAppLocale(value: string | null | undefined): AppLocale {
  return (APP_LOCALES as string[]).includes(value ?? '') ? (value as AppLocale) : DEFAULT_APP_LOCALE
}
