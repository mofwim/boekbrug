'use client'

// src/components/settings/LanguageCard.tsx
// [TAAL] The language switch.
//
// It says what it can do and what it cannot, because the alternative is a promise the app does not
// keep. The interface is being translated screen by screen; a document is not, and never will be.
//
// The distinction is not a limitation to apologise for — it is the correct behaviour. An invoice
// PDF, the e-mail carrying it and the e-factuur XML are read by a Dutch customer, an accountant
// and the Belastingdienst. Translating those would change what the documents ARE, and would put an
// owner in the position of sending a Dutch company a bill it cannot book.
//
// Each language's name is written in that language, never translated: someone looking for their
// own language scans for the shape of their own script.

import { LOCALES, LOCALE_META, type Locale } from '@/lib/i18n/locale'
import { useLocale, writeLocaleCookie } from '@/lib/i18n/use-locale'

/** Written in each language itself — the one string on this card that is not Dutch by default. */
const UITLEG: Record<Locale, { klaar: string; documenten: string }> = {
  nl: {
    klaar: 'Het scherm wordt stap voor stap vertaald. Wat nog niet vertaald is, blijft Nederlands.',
    documenten: 'Je facturen, e-mails en e-facturen blijven altijd Nederlands — die leest je klant en de Belastingdienst, niet jij.',
  },
  en: {
    klaar: 'The interface is being translated screen by screen. Anything not translated yet stays Dutch.',
    documenten: 'Your invoices, e-mails and e-invoices always stay Dutch — those are read by your customer and the tax office, not by you.',
  },
  ar: {
    klaar: 'تُترجَم الواجهة شاشةً بعد شاشة. وما لم يُترجَم بعد يبقى بالهولندية.',
    documenten: 'أما فواتيرك ورسائلك والفواتير الإلكترونية فتبقى بالهولندية دائماً — فهي لعميلك ولمصلحة الضرائب، لا لك.',
  },
  tr: {
    klaar: 'Het scherm wordt stap voor stap vertaald. Wat nog niet vertaald is, blijft Nederlands.',
    documenten: 'Je facturen, e-mails en e-facturen blijven altijd Nederlands — die leest je klant en de Belastingdienst, niet jij.',
  },
}

export function LanguageCard() {
  // The same subscription every other screen uses, so this card cannot hold a different opinion
  // about the current language than the panels it changes.
  const locale = useLocale()

  const uitleg = UITLEG[locale]

  return (
    <div
      dir={LOCALE_META[locale].dir}
      style={{
        backgroundColor: 'white', borderRadius: 16, padding: 16,
        display: 'flex', flexDirection: 'column', gap: 12,
      }}
    >
      <div>
        <h2 style={{ fontSize: 16, fontWeight: 700, color: '#202124', margin: 0 }}>
          {/* The heading stays in the language of the app, so it is findable in a Dutch settings
              page while the rest of that page is still Dutch. */}
          Taal · اللغة · Language
        </h2>
        <p style={{ fontSize: 13, color: '#5F6368', lineHeight: 1.6, margin: '6px 0 0' }}>
          {uitleg.klaar}
        </p>
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        {LOCALES.map((l) => {
          const actief = l === locale
          return (
            <button
              key={l}
              onClick={() => writeLocaleCookie(l)}
              aria-pressed={actief}
              lang={l}
              dir={LOCALE_META[l].dir}
              style={{
                minHeight: 44, padding: '0 16px', borderRadius: 9999,
                border: actief ? 'none' : '1px solid #DADCE0',
                backgroundColor: actief ? '#1A73E8' : 'white',
                color: actief ? 'white' : '#202124',
                fontSize: 14, fontWeight: actief ? 600 : 500, cursor: 'pointer',
              }}
            >
              {LOCALE_META[l].label}
            </button>
          )
        })}
      </div>

      <p style={{ fontSize: 12, color: '#5F6368', lineHeight: 1.6, margin: 0 }}>
        {uitleg.documenten}
      </p>
    </div>
  )
}
