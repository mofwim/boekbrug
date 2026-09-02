'use client'

// src/components/invoice/SupplierNameInput.tsx
// [LEVERANCIER-KIEZEN] The supplier name field, with the suppliers the owner already has under it.
//
// ── WHY A PLAIN TEXT FIELD WAS THE WRONG SHAPE HERE ──
//
// On the customer side the owner picks from a list they built themselves (/dashboard/klanten has a
// form; /dashboard/invoice/new has a picker). On the supplier side there is no such form at all —
// suppliers.name is written by the IMPORT, from whatever the reader made of a letterhead. So the
// only place a supplier is ever named by a human is a correction field on an invoice, and until
// now that field was blank paper: the owner retyped a company name from memory with nothing on
// screen to match it against.
//
// Landing one character beside the existing spelling is not a cosmetic miss. learnSupplierAlias
// resolves the corrected name through supplierNameKey; a key that matches links this invoice to
// the company the owner already has, and a key that does not creates a SECOND supplier — after
// which /dashboard/leveranciers shows one company twice with the outstanding balance split
// between the halves. This panel is what makes the first outcome the easy one.
//
// ── THE PANEL SITS IN THE FLOW, NOT OVER IT ──
//
// Both doors that use this field live inside `.sheet-scroll` (globals.css) — a bottom sheet that
// is its own scroller, `overflow-y: auto`. An absolutely positioned dropdown inside a scroller is
// clipped by it, and the clip lands exactly where the sheet is longest: on a phone. An in-flow
// panel pushes the fields below it down and cannot be cut off. A suggestion nobody can see is
// worse than no suggestion at all, so this trades a little polish for being certain.
//
// ── WHY THE PANEL IS ITS OWN COMPONENT ──
//
// It is only ever on screen while the field has focus, and no gate in this repo can focus
// anything: test:render draws the FIRST paint with react-dom/server and the Playwright sweep never
// logs in. A panel that throws when opened would therefore pass the whole set — the exact blind
// spot AGENTS.md describes. Exported separately, it can be handed a real suggestion and rendered.
//
// [TAAL] Every sentence is a key. [NO-SILENT-EMPTY] "we could not load your suppliers" and "you
// have no supplier by that name" are different facts and are said differently — the second tells
// the owner a new supplier is about to be created, which is worth knowing before, not after.

import { useEffect, useId, useRef, useState, type CSSProperties } from 'react'

import { useLocale } from '@/lib/i18n/use-locale'
import { translator } from '@/lib/i18n/t'
import {
  shouldSuggest,
  suggestSuppliers,
  SUPPLIER_SUGGEST_LIMIT,
  type SupplierChoice,
  type SupplierSuggestion,
} from '@/lib/supplier-suggest'

export type { SupplierChoice }

/**
 * What sits under the field while it has focus: the suppliers that match, or the one sentence that
 * explains why there are none. Presentational — it decides nothing, so both doors show the same
 * thing for the same state.
 */
export function SupplierSuggestionPanel({
  suggestion,
  active,
  unavailable,
  newNotice,
  listId,
  onPick,
}: {
  suggestion: SupplierSuggestion
  /** The row the keyboard is on; -1 = none. */
  active: number
  /** The supplier list could not be READ. Outranks everything else: we know nothing. */
  unavailable: boolean
  /** Say that confirming will create a new supplier. Only true when there IS a list that missed. */
  newNotice: boolean
  listId: string
  onPick: (name: string) => void
}) {
  const t = translator(useLocale())

  if (unavailable) {
    return (
      <div style={{ marginTop: 6, fontSize: 11.5, color: '#9a5b00', textAlign: 'start' }}>
        {t('lev.kies.nietGeladen')}
      </div>
    )
  }

  if (suggestion.matches.length === 0) {
    if (!newNotice) return null
    return (
      <div style={{ marginTop: 6, fontSize: 11.5, color: '#5f6368', textAlign: 'start' }}>
        {t('lev.kies.nieuw')}
      </div>
    )
  }

  return (
    <div
      id={listId}
      role="listbox"
      style={{
        marginTop: 6, background: '#fff', border: '1px solid #e0e0e0', borderRadius: 12,
        overflow: 'hidden', textAlign: 'start',
      }}
    >
      <div style={{
        fontSize: 11.5, fontWeight: 600, color: '#5f6368', letterSpacing: 0.2,
        padding: '8px 12px 6px',
      }}>
        {t('lev.kies.kop')}
      </div>
      {suggestion.matches.map((m, i) => (
        <button
          key={m.id}
          id={`${listId}-${i}`}
          type="button"
          role="option"
          aria-selected={i === active}
          // The panel is inside a scroller; a mousedown would blur the input and close the panel
          // before the click ever landed on the row.
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => onPick(m.name)}
          style={{
            display: 'block', width: '100%', textAlign: 'start',
            padding: '9px 12px', border: 'none', borderTop: '1px solid #f1f3f4',
            background: i === active ? '#f1f7ff' : '#fff',
            cursor: 'pointer', fontFamily: 'inherit',
          }}
        >
          <span style={{ display: 'block', fontSize: 14, fontWeight: 600, color: '#202124' }}>
            {m.name}
          </span>
          {/* The account you pay them on — the one thing that tells two near-identical company
              names apart, and the field the IBAN-change check is keyed on. */}
          {m.iban && (
            <span style={{ display: 'block', fontSize: 11.5, color: '#5f6368', marginTop: 2 }}>
              {m.iban}
            </span>
          )}
        </button>
      ))}
      {/* [ZOEK-EERLIJK] A capped list never presents itself as the whole list: an owner who
          concludes their supplier is not in here types a second spelling of it. */}
      {suggestion.hidden > 0 && (
        <div style={{
          fontSize: 11.5, color: '#5f6368', padding: '7px 12px',
          borderTop: '1px solid #f1f3f4', background: '#fafafa',
        }}>
          {t('lev.kies.meer', { n: suggestion.hidden })}
        </div>
      )}
    </div>
  )
}

export default function SupplierNameInput({
  value,
  onChange,
  options,
  unavailable = false,
  inputStyle,
  wrapperStyle,
  autoFocus,
  placeholder,
}: {
  value: string
  /** The typed or picked name. Picking is a normal edit — the owner may still change it after. */
  onChange: (next: string) => void
  /** The owner's suppliers. Empty is a legitimate state (a brand-new account). */
  options: readonly SupplierChoice[]
  /** True when the READ failed. Never rendered as "you have no suppliers". */
  unavailable?: boolean
  inputStyle?: CSSProperties
  wrapperStyle?: CSSProperties
  autoFocus?: boolean
  placeholder?: string
}) {
  const t = translator(useLocale())
  const boxRef = useRef<HTMLDivElement | null>(null)
  const [focused, setFocused] = useState(false)
  // Which row the keyboard is on. -1 = none; Enter then does what Enter always did in this form.
  const [active, setActive] = useState(-1)
  const listId = useId()

  // A tap outside closes the panel. The sheet behind stops clicks, so blur alone is not enough on
  // every browser — and a panel left open over the amounts is a panel in the way.
  useEffect(() => {
    if (!focused) return
    const onDown = (e: MouseEvent | TouchEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setFocused(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('touchstart', onDown)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('touchstart', onDown)
    }
  }, [focused])

  const suggestion = suggestSuppliers(value, options, SUPPLIER_SUGGEST_LIMIT)
  // The panel is for CHOOSING. When the field already holds a known supplier's name exactly there
  // is nothing left to choose, so it stays shut instead of covering the form every time.
  const open = shouldSuggest(value, focused) && !suggestion.settled
  // Only once something has been typed, and only when there IS a list that missed it — on an empty
  // registry the sentence would explain nothing.
  const newNotice = options.length > 0 && value.trim() !== ''

  const pick = (name: string) => {
    onChange(name)
    setActive(-1)
    setFocused(false)
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!open || suggestion.matches.length === 0) return
    const last = suggestion.matches.length - 1
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive(active >= last ? 0 : active + 1)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive(active <= 0 ? last : active - 1)
    } else if (e.key === 'Enter' && active >= 0) {
      // Only when a row is highlighted. Enter with nothing selected belongs to the form.
      e.preventDefault()
      pick(suggestion.matches[active].name)
    } else if (e.key === 'Escape') {
      setActive(-1)
      setFocused(false)
    }
  }

  return (
    <div ref={boxRef} style={{ position: 'relative', ...wrapperStyle }}>
      <input
        type="text"
        role="combobox"
        aria-expanded={open && suggestion.matches.length > 0}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={open && active >= 0 ? `${listId}-${active}` : undefined}
        aria-label={t('lev.kies.veld')}
        autoComplete="off"
        autoFocus={autoFocus}
        placeholder={placeholder}
        value={value}
        onChange={(e) => { onChange(e.target.value); setActive(-1); setFocused(true) }}
        onFocus={() => setFocused(true)}
        onKeyDown={onKeyDown}
        style={{ width: '100%', boxSizing: 'border-box', ...inputStyle }}
      />
      {open && (
        <SupplierSuggestionPanel
          suggestion={suggestion}
          active={active}
          unavailable={unavailable}
          newNotice={newNotice}
          listId={listId}
          onPick={pick}
        />
      )}
    </div>
  )
}
