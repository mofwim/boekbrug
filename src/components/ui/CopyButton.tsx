'use client'

// src/components/ui/CopyButton.tsx
// [NUMMER-KOPIEREN] One tap copies a value the owner would otherwise have to select by hand.
//
// ── WHY ──
//
// Reported with a screenshot: dragging across an invoice number to copy it made the card open and
// shut under the cursor. row-tap.ts fixed that — a gesture that selected text is no longer a tap —
// but it fixed the SIDE EFFECT, not the goal. The goal was to copy the number, and selecting text
// inside a tappable card on a phone is still fiddly. This app ships to Android as a Trusted Web
// Activity, so the phone IS the product for most owners.
//
// The invoice number is the value they copy most and can least retype: it goes into a bank
// transfer's description, into an e-mail to the supplier, into a search.
//
// ── TWO THINGS IT MUST NOT DO ──
//
//   · TOGGLE THE ROW. It sits inside a card whose onClick expands it, so the click is stopped here.
//     Without that, copying would open the very card the owner was reading past.
//   · CLAIM A SUCCESS IT DID NOT HAVE. The clipboard write can be refused (a browser without
//     permission, a non-secure context, a page that lost focus). The confirmation is shown only
//     after the promise RESOLVES; a rejection says so instead. Saying "gekopieerd" over an empty
//     clipboard sends the owner to paste nothing into a payment.

import { useState } from 'react'
import { copyToClipboard } from '@/lib/clipboard'
import { useToast } from './Toast'
import { useLocale } from '@/lib/i18n/use-locale'
import { translator } from '@/lib/i18n/t'
import { M3 } from '@/lib/design/tokens'

export function CopyButton({ value, what }: {
  /** The text to copy. Empty or absent → the button does not render: there is nothing to copy. */
  value: string | null | undefined
  /** What is being copied, for the screen-reader label ("Factuurnummer 26704047 kopiëren"). */
  what: string
}) {
  const t = translator(useLocale())
  const toast = useToast()
  const [busy, setBusy] = useState(false)
  const tekst = (value ?? '').trim()
  if (!tekst) return null

  return (
    <button
      type="button"
      aria-label={t('kopieer.aria', { wat: what, waarde: tekst })}
      title={t('kopieer.aria', { wat: what, waarde: tekst })}
      disabled={busy}
      onClick={async (e) => {
        // The card around this button expands on click. Stopping here is what keeps copying from
        // opening the row — see the header.
        e.stopPropagation()
        e.preventDefault()
        setBusy(true)
        // [KOPIE-EERLIJK] The answer comes from the one module that writes the clipboard, and it is
        // the truth: false means nothing was copied and the clipboard still holds the PREVIOUS
        // value. Saying "gekopieerd" over that sends the owner to paste the wrong thing.
        const ok = await copyToClipboard(tekst)
        toast(ok ? t('kopieer.gelukt') : t('kopieer.mislukt'), { tone: ok ? 'success' : 'error' })
        setBusy(false)
      }}
      style={{
        flexShrink: 0,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: 28,
        height: 28,
        padding: 0,
        border: 'none',
        borderRadius: 999,
        background: 'transparent',
        color: M3.onSurfaceVariant,
        cursor: busy ? 'default' : 'pointer',
        opacity: busy ? 0.5 : 1,
        // The visible circle is 28px; .tap-44 grows the TOUCH target to 44 without moving the
        // layout, so a number in a dense money row stays where it is.
        alignSelf: 'center',
      }}
      className="tap-44"
    >
      <span className="material-symbols-outlined" aria-hidden style={{ fontSize: 16 }}>
        content_copy
      </span>
    </button>
  )
}
