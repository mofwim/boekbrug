'use client'

// src/components/i18n/LocaleRestore.tsx
// [TAAL-VOLGT-MEE] The owner's language, restored on a device that has never been told.
//
// The cookie is the fast answer and stays the fast answer (use-locale.ts explains why). It is also
// per-device, and that is the whole problem this closes: an owner who reads Arabic sets it on the
// laptop, opens the app on their phone, and gets Dutch — with the switch itself two screens deep,
// in Dutch. The account remembers the choice; this component hands it to a device that has none.
//
// WHY IT ONLY SPEAKS INTO SILENCE
// Only when there is NO cookie. A device where the owner did choose keeps that choice, and that
// asymmetry is deliberate: the alternative is a screen that flips the language back under someone
// who just changed it because a save failed somewhere. Restoring into silence can only ever add
// information; overruling a stated choice can only ever remove it.
//
// It renders nothing and runs once. The cookie write re-renders every subscriber through the same
// store every screen already reads, so nothing else has to know this component exists.

import { useEffect } from 'react'

import { isLocale } from '@/lib/i18n/locale'
import { hasLocaleCookie, writeLocaleCookie } from '@/lib/i18n/use-locale'

export default function LocaleRestore({ accountLocale }: { accountLocale: string | null }) {
  useEffect(() => {
    if (!isLocale(accountLocale)) return
    if (hasLocaleCookie()) return
    writeLocaleCookie(accountLocale)
  }, [accountLocale])

  return null
}
