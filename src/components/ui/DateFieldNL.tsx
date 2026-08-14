'use client'

// src/components/ui/DateFieldNL.tsx
// [DATE-NL] A date field a Dutch owner can actually type into. Drop-in for <input type="date">.
//
// The reason it exists is in date-field-nl.ts and it is measured, not assumed: Chromium orders the
// segments of a native date input by the BROWSER's locale, and nothing on the page — not `lang` on
// the input, not on a wrapper, not on <html>, which this app already sets to "nl" — changes it.
// Under an en-US browser the first box is the month, so "21" for the 21st becomes February and the
// caret jumps before a second digit can be typed.
//
// ── WHAT IS KEPT, AND WHY THAT MATTERS ON A PHONE ──
// The native control is not simply replaced. On a phone its picker is the better input by far —
// a wheel beats eight taps on a number pad — and picking a day off a calendar is unambiguous no
// matter which order the labels are in. So the typing surface becomes ours, in Dutch order, and
// the picker stays one tap away behind the calendar button, exactly as the escape hatch in
// InvoiceDocumentSheet keeps "open in a new tab" one tap away.
//
// ── AND IT SAYS WHAT IT UNDERSTOOD ──
// "02-01-2026" is unambiguous once complete. Half-typed it is not, and the failure this fixes is
// precisely someone believing they typed a day when the field took a month. The line underneath
// spells the result out — "vrijdag 2 januari 2026" — so a wrong month is visible before it is
// saved rather than a quarter later on an aangifte.

import { useId, useRef, useState } from 'react'
// [TAAL] A component holds no language of its own.
import { useLocale } from '@/lib/i18n/use-locale'
import { translator } from '@/lib/i18n/t'
import { M3, R, FONT } from '@/lib/design/tokens'
import {
  DUTCH_DATE_PLACEHOLDER,
  formatDutchDateInput,
  dutchDateToIso,
  isoToDutchDate,
  dutchDateInWords,
  dutchDateOutOfRange,
} from '@/lib/date-field-nl'

export interface DateFieldNLProps {
  /** ISO "YYYY-MM-DD", or "" when empty — the same value an <input type="date"> carries. */
  value: string
  /** Called with ISO, or "" while the field is incomplete. Same contract as the native onChange. */
  onChange: (iso: string) => void
  min?: string
  max?: string
  disabled?: boolean
  /** Merged over the input's own styling, so existing call sites keep their layout. */
  style?: React.CSSProperties
  'aria-label'?: string
  id?: string
}

export default function DateFieldNL({
  value,
  onChange,
  min,
  max,
  disabled,
  style,
  id,
  ...rest
}: DateFieldNLProps) {
  const t = translator(useLocale())
  // The typed text is its own state: while someone is halfway through "21-01-20" there is no ISO
  // to hold it in, and pushing an empty value up on every keystroke would clear the parent's date
  // the moment they started editing it.
  const [typed, setTyped] = useState(() => isoToDutchDate(value))
  const [touched, setTouched] = useState(false)
  const pickerRef = useRef<HTMLInputElement | null>(null)
  const autoId = useId()
  const inputId = id ?? autoId

  // The parent's value wins when it changes from outside (a reset, a different invoice). Compared
  // through the display form so re-rendering with the same date never re-formats what is being
  // typed underneath the owner's fingers.
  const fromParent = isoToDutchDate(value)
  const [lastParent, setLastParent] = useState(fromParent)
  if (fromParent !== lastParent) {
    setLastParent(fromParent)
    setTyped(fromParent)
  }

  const iso = dutchDateToIso(typed)
  const words = dutchDateInWords(iso)
  const rangeProblem = dutchDateOutOfRange(iso, min, max)
  // Only complain about an unparseable date once it is as long as a date. Flashing an error at
  // someone mid-keystroke teaches them to ignore the line that is supposed to catch a real error.
  const shape = touched && typed.length >= DUTCH_DATE_PLACEHOLDER.length && !iso
    ? t('datum.geenBestaande')
    : null
  const problem = shape ?? rangeProblem

  const push = (next: string) => {
    const formatted = formatDutchDateInput(next)
    setTyped(formatted)
    const parsed = dutchDateToIso(formatted)
    // An out-of-range date is reported, never silently clamped: clamping would save a date the
    // owner did not type, on a field that decides which quarter the money lands in.
    onChange(parsed && !dutchDateOutOfRange(parsed, min, max) ? parsed : '')
  }

  return (
    <div style={{ minWidth: 0 }}>
      <div style={{ display: 'flex', alignItems: 'stretch', gap: 6 }}>
        <input
          id={inputId}
          type="text"
          inputMode="numeric"
          autoComplete="off"
          placeholder={DUTCH_DATE_PLACEHOLDER}
          value={typed}
          disabled={disabled}
          onChange={(e) => push(e.target.value)}
          onBlur={() => setTouched(true)}
          {...rest}
          style={{
            flex: 1, minWidth: 0, padding: '12px 14px', fontSize: 16, borderRadius: R.md,
            border: `1.5px solid ${problem ? M3.error : M3.outlineVariant}`,
            fontFamily: FONT, boxSizing: 'border-box',
            ...style,
          }}
        />
        {/* The picker, kept. On a phone this is the better input, and a day chosen off a calendar
            is unambiguous whatever order the browser labels it in. The native control is visually
            hidden rather than removed, because showPicker() only works on a real one. */}
        <button
          type="button"
          aria-label={t('datum.kies')}
          disabled={disabled}
          onClick={() => {
            const el = pickerRef.current
            if (!el) return
            // showPicker throws if the element is not user-activated or unsupported; falling back
            // to focus keeps the control usable instead of dead.
            const withPicker = el as HTMLInputElement & { showPicker?: () => void }
            try {
              if (typeof withPicker.showPicker === 'function') withPicker.showPicker()
              else el.focus()
            } catch { el.focus() }
          }}
          style={{
            width: 44, border: `1.5px solid ${M3.outlineVariant}`, borderRadius: R.md,
            background: '#fff', cursor: disabled ? 'default' : 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
          }}
        >
          <span className="material-symbols-outlined" style={{ fontSize: 20, color: M3.onSurfaceVariant }}>
            date_range
          </span>
        </button>
        <input
          ref={pickerRef}
          type="date"
          tabIndex={-1}
          aria-hidden="true"
          value={iso ?? ''}
          min={min}
          max={max}
          onChange={(e) => { setTouched(true); push(isoToDutchDate(e.target.value)) }}
          style={{ position: 'absolute', width: 1, height: 1, opacity: 0, pointerEvents: 'none' }}
        />
      </div>
      {/* What we understood, or what is wrong with it. One line, never both — an error outranks a
          confirmation of a date we are about to refuse. */}
      {problem ? (
        <p style={{ fontSize: 12, color: M3.error, margin: '4px 0 0', lineHeight: 1.4 }}>{problem}</p>
      ) : words ? (
        <p style={{ fontSize: 12, color: M3.onSurfaceVariant, margin: '4px 0 0', lineHeight: 1.4 }}>{words}</p>
      ) : null}
    </div>
  )
}
