'use client'

// src/components/ui/DecimalInput.tsx
// [KOMMA-INVOER] A money or quantity field a Dutch owner can actually type into.
//
// <input type="number"> cannot be used for this, and the reason is worse than "it refuses the
// comma" — it SILENTLY DROPS it. Measured in the Chromium this app ships against:
//
//     owner types      .value      parseFloat(.value) || 0     meant
//     23,95            "2395"      2395                        23,95     100x too much
//     1.250,00         "1.25000"   1.25                        1250,00   1000x too little
//     0,5              "05"        5                           0,5        10x too much
//
// Nothing turns red. The field looks filled, the number is plausible, and it is the unit price on
// an invoice line that goes to a customer, or the quantity on a creditnota. 23,95 is not a random
// example: it is the figure from the ATAPACK invoice quoted in negative-line.ts.
//
// The two confirm/correction modals were converted to text fields long ago and are held there by
// the [KOMMA-INVOER] gate. That gate names its two files by hand, so the invoice line editor, the
// discount fields and the credit-quantity field — every other place an owner types money — were
// outside it and kept the number input.
//
// ── WHY A RAW DRAFT ────────────────────────────────────────────────────────────────────────────
//
// The field's value is derived from a number in the parent. Without a draft, typing "23," parses
// to 23, the parent re-renders with 23, and the comma the owner just typed disappears under their
// fingers — so the field can never get past the whole euros. While focused the input shows the
// RAW string; on blur it settles back to the parsed value. Same pairing, and the same reason, as
// [DATE-NL] and the amountFieldText pair in amount-triplet.ts.
//
// This component holds the behaviour only — no label, no palette. The screens keep their own look
// (Material You on the builder, Tailwind on the editor) and pass style or className.

import { useState, type CSSProperties, type ChangeEvent, type KeyboardEvent } from 'react'

export default function DecimalInput({
  value,
  onChange,
  min = 0,
  allowNegative = false,
  onFocusChange,
  style,
  className,
  placeholder = '0',
  ariaLabel,
  disabled = false,
}: {
  value: number
  onChange: (v: number) => void
  min?: number
  /**
   * [MIN-REGEL] May this field go below zero?
   *
   * Only a QUANTITY may, and only because a wholesaler settles a return on the next invoice as a
   * line with a negative aantal (ATAPACK 26304787: -3 x EUR 23,95). A price may never — Peppol
   * BR-27 rejects a negative cbc:PriceAmount, so such an invoice would look right on the PDF and
   * never reach the customer electronically. See negative-line.ts.
   */
  allowNegative?: boolean
  /** So a caller can colour its own label while the field has focus. */
  onFocusChange?: (focused: boolean) => void
  style?: CSSProperties
  className?: string
  placeholder?: string
  ariaLabel?: string
  disabled?: boolean
}) {
  const [focused, setFocused] = useState(false)
  const [raw, setRaw] = useState(value === 0 ? '' : String(value))

  // [REACT] Derived state adjusted DURING render rather than in an effect: the text follows the
  // outside value for as long as nobody is typing in it. Through an effect the owner saw the old
  // text for one frame.
  const [prevSync, setPrevSync] = useState<{ value: number; focused: boolean }>({ value, focused })
  if (prevSync.value !== value || prevSync.focused !== focused) {
    setPrevSync({ value, focused })
    if (!focused) setRaw(value === 0 ? '' : String(value))
  }

  const settle = (next: boolean) => { setFocused(next); onFocusChange?.(next) }

  function handleChange(e: ChangeEvent<HTMLInputElement>) {
    const typed = e.target.value.replace(',', '.')
    // Digits, one dot, an optional leading minus — nothing else reaches the parent.
    if (!/^-?\d*\.?\d*$/.test(typed)) return
    setRaw(typed)
    const parsed = parseFloat(typed)
    // [MIN-REGEL] The floor applies only to a field that may not go negative. A credit line is
    // judged when the form is submitted, which is where that decision belongs.
    if (!Number.isNaN(parsed)) onChange(allowNegative ? parsed : Math.max(min, parsed))
  }

  function handleBlur() {
    settle(false)
    const parsed = parseFloat(raw)
    if (Number.isNaN(parsed)) {
      setRaw(allowNegative ? '' : (min === 0 ? '' : String(min)))
      onChange(allowNegative ? 0 : min)
    } else if (!allowNegative && parsed < min) {
      setRaw(min === 0 ? '' : String(min))
      onChange(min)
    } else {
      setRaw(String(parsed))
      onChange(parsed)
    }
  }

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    // The comma key types the decimal separator this field stores internally as a dot, so the
    // owner types the number the way it is printed and the app keeps one representation.
    if (e.key === ',') {
      e.preventDefault()
      if (!raw.includes('.')) setRaw(raw ? raw + '.' : '0.')
      return
    }
    if (e.key === 'Enter') {
      e.preventDefault()
      const form = e.currentTarget.closest('[data-form]') ?? document
      const focusable = Array.from(form.querySelectorAll<HTMLElement>('input, select'))
        .filter((el) => !el.hasAttribute('disabled'))
      const idx = focusable.indexOf(e.currentTarget)
      if (idx >= 0 && idx < focusable.length - 1) focusable[idx + 1].focus()
      return
    }
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault()
      const delta = e.key === 'ArrowUp' ? 1 : -1
      const current = parseFloat(raw) || 0
      const next = allowNegative ? Math.round(current) + delta : Math.max(min, Math.round(current) + delta)
      setRaw(String(next))
      onChange(next)
    }
  }

  return (
    <input
      // NEVER type="number" — see the table in this file's header.
      type="text"
      inputMode="decimal"
      value={focused ? raw : (value === 0 ? '' : String(value))}
      onChange={handleChange}
      onKeyDown={handleKeyDown}
      onFocus={() => { settle(true); setRaw(value === 0 ? '' : String(value)) }}
      onBlur={handleBlur}
      placeholder={placeholder}
      aria-label={ariaLabel}
      disabled={disabled}
      style={style}
      className={className}
    />
  )
}
