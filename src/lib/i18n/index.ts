// src/lib/i18n/index.ts
// [I18N] Public surface of the app i18n layer. See docs/i18n-plan.md.
//
// Server / anywhere:   import { translate, DEFAULT_APP_LOCALE } from '@/lib/i18n'
// Client components:    import { I18nProvider, useT, useDir, useLocale } from '@/lib/i18n'

export {
  type AppLocale,
  type AppLocaleMeta,
  APP_LOCALES,
  DEFAULT_APP_LOCALE,
  APP_LOCALE_META,
  asAppLocale,
} from './config'
export { translate } from './t'
export { I18nProvider, useT, useDir, useLocale } from './I18nProvider'
export type { Messages } from './messages/nl'
