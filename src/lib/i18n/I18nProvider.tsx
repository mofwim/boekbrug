'use client'

// src/lib/i18n/I18nProvider.tsx
// [I18N] Client-side locale context + hooks for the dashboard. At rollout, the
// app shell resolves the user's locale (saved preference → Accept-Language → nl)
// and passes it here once; components then call useT()/useDir().
//
// Inert until something renders <I18nProvider> — importing this changes nothing.

import { createContext, useContext, useMemo } from 'react'
import { type AppLocale, DEFAULT_APP_LOCALE, APP_LOCALE_META } from './config'
import { translate } from './t'

const LocaleContext = createContext<AppLocale>(DEFAULT_APP_LOCALE)

export function I18nProvider({
  locale = DEFAULT_APP_LOCALE,
  children,
}: {
  locale?: AppLocale
  children: React.ReactNode
}) {
  return <LocaleContext.Provider value={locale}>{children}</LocaleContext.Provider>
}

/** The active app locale. */
export function useLocale(): AppLocale {
  return useContext(LocaleContext)
}

/** Text direction of the active locale ('rtl' for Arabic). */
export function useDir(): 'ltr' | 'rtl' {
  return APP_LOCALE_META[useContext(LocaleContext)].dir
}

/**
 * Returns a translate function bound to the active locale:
 *   const t = useT(); t('nav.invoices')
 */
export function useT(): (key: string, vars?: Record<string, string | number>) => string {
  const locale = useContext(LocaleContext)
  return useMemo(() => (key: string, vars?: Record<string, string | number>) => translate(locale, key, vars), [locale])
}
