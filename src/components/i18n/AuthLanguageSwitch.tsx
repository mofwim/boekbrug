'use client'

// src/components/i18n/AuthLanguageSwitch.tsx
// [TAAL-POORT] The language switch on the door.
//
// ── THE CHICKEN AND EGG THIS SOLVES ──
// The app publishes 56 blog articles in Arabic, has an /ar/blog route that renders right-to-left,
// and its first accountants read Arabic. That reader finishes an Arabic article, taps "أنشئ
// حساباً مجانياً", and lands on /register — which until now was Dutch from top to bottom.
//
// Translating those two screens is half the fix. The other half is this: the ONLY way to change
// the language was a card inside Instellingen, two screens deep behind a login, labelled in Dutch.
// So the setting that lets you escape Dutch was itself only reachable in Dutch, and only after
// you had already got through the Dutch screens. On the door, the switch has to be ON the door.
//
// ── WHY NOT LanguageCard ──
// That one writes the choice to profiles.preferred_language as well as the cookie, so the account
// remembers it on the next device ([TAAL-VOLGT-MEE]). It needs a session, and here there is none
// by definition. This writes the cookie only — and when the visitor logs in, LocaleRestore leaves
// their device choice alone, which is exactly right: someone who just picked Arabic on this screen
// means it.
//
// Each language's name is written in that language and never translated: a person looking for
// their own language scans for the shape of their own script, not for a word they cannot read.

import { LOCALES, LOCALE_META, type Locale } from '@/lib/i18n/locale'
import { translator } from '@/lib/i18n/t'
import { useLocale, writeLocaleCookie } from '@/lib/i18n/use-locale'

export function AuthLanguageSwitch() {
  const locale = useLocale()
  const t = translator(locale)

  return (
    <div className="flex items-center justify-center gap-1 flex-wrap" role="group" aria-label={t('auth.taal')}>
      {LOCALES.map((l: Locale) => {
        const actief = l === locale
        return (
          <button
            key={l}
            type="button"
            onClick={() => writeLocaleCookie(l)}
            // The pressed state is what a screen reader has to go on: the styling below says which
            // language is current with weight and colour, and neither of those is announced.
            aria-pressed={actief}
            // Written in the language itself, so `lang` has to say so too — otherwise a screen
            // reader pronounces العربية with Dutch phonetics.
            lang={l}
            className={
              'px-2.5 py-1 rounded-lg text-xs transition-colors ' +
              (actief
                ? 'bg-blue-50 text-blue-700 font-semibold'
                : 'text-gray-500 hover:bg-gray-50 font-medium')
            }
          >
            {LOCALE_META[l].label}
          </button>
        )
      })}
    </div>
  )
}
