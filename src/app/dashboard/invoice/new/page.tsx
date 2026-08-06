'use client'

// src/app/dashboard/invoice/new/page.tsx
// [BOEK-031] Complete rebuild — Factuur / Offerte / Credit — May 2026
// Mobile-first, iOS-style design
// Supports: autocomplete clients, AI translation, offerte→factuur conversion

import React, { useState, useEffect, useRef, Suspense } from 'react'
// [FUNNEL-OVERDRACHT] De factuur die op /factuur-maken is gemaakt vóór er een account was.
import {
  readHandoff, clearHandoff, hasInvoiceContent, isMeaningfulLine, describeHandoff,
  type FactuurHandoff,
} from '@/lib/factuur-handoff'
import { createClient } from '@/lib/supabase'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
// [BOEK-031] Navigation Strategy — May 2026
import { useParentPath } from '@/lib/navigation-hooks'
import { useSubPageHeader } from '@/components/nav/SubPageHeaderContext'
import type { Role } from '@/lib/navigation'
// [FACTUUR-A] Single Dutch formatting source — June 2026
import { amsterdamToday, formatDateNL } from '@/lib/format-nl'
// [ICP] Same classifier the aangifte and the ICP-opgaaf use, so the invoice screen and the
// quarter can never disagree about which customer counts as intra-EU.
import { classifyVatNumber } from '@/lib/icp'
import { matchArticles, foldText, type Article } from '@/lib/articles'
import { M3, columnInner, COLUMN, sheetPaddingBottom } from '@/lib/design/tokens'
// [PRIJS-MODUS] Typen met of zonder btw — één pure omrekening, gedeeld met het bewerkscherm.
// Wat er wordt OPGESLAGEN blijft ex-btw; dit is een invoerstand, geen opslagformaat.
import {
  priceFieldValue, priceFieldToStored, repriceForRateChange, toDisplayCents, type PriceMode,
} from '@/lib/price-mode'
// [BACK-CLOSES] Back closes what is open — see src/lib/use-close-on-back.ts.
import { useCloseOnBack } from '@/lib/use-close-on-back'
// [DATE-NL] The typing surface, in Dutch order — see date-field-nl.ts.
import DateFieldNL from '@/components/ui/DateFieldNL'

// ─── Fixed Dutch formatting — never changes ────────────────────────────────────
const NL_NUMBER = new Intl.NumberFormat('nl-NL', { style: 'currency', currency: 'EUR' })

// ─── [FACTUUR-A] Numbering moved server-side — June 2026 ─────────────────────
// The browser-side generateNumber() was removed: it did a SELECT-then-compute
// from the client (the same race the TODO in invoice-numbering.ts warns about)
// AND bypassed the atomic, legal numbering in /api/invoice/send. The page now
// ALWAYS saves a draft (no number) and lets the send route mint the number —
// single source of truth, no gaps (Art. 35 Wet OB 1968). BRIDGE-C later swaps
// the route's internals to a PostgreSQL sequence.

// ─── [FACTUUR-A] Client-side BTW-id format check — June 2026 ─────────────────
// Mirrors BOEK-019: NL + 9 digits + 'B' + 2 digits (e.g. NL123456789B01).
// Non-blocking on the customer field (foreign customers are valid), but we
// flag a malformed Dutch-looking number so it never silently lands on a
// legal invoice.
const NL_BTW_RE = /^NL\d{9}B\d{2}$/i
function looksLikeDutchBtw(v: string): boolean {
  return /^NL/i.test(v.replace(/\s/g, ''))
}
function isValidDutchBtw(v: string): boolean {
  return NL_BTW_RE.test(v.replace(/\s/g, ''))
}

// ─── Types ─────────────────────────────────────────────────────────────────────

// [BOEK-031] fix type — creditnota replaces credit — May 2026
type InvoiceType = 'factuur' | 'offerte' | 'creditnota'

type Profile = {
  id: string
  full_name: string
  company_name: string
  kvk_number: string
  btw_number: string
  iban: string
  address: string
  postal_code: string
  city: string
  email: string
  // [BOEK-031] role needed for navigation parent — May 2026
  role?: string | null
  // [VRIJGESTELD] The owner's own declaration (Instellingen). Optional, because the profile is
  // read with select('*') and this column does not exist until vat_exemption.sql is applied —
  // absent then, which correctly hides the "Vrijgesteld" option instead of breaking the form.
  vat_exempt_activity?: boolean | null
}

type Client = {
  id: string
  name: string
  email: string
  address: string
  postal_code: string
  city: string
  btw_number: string
  kvk_number: string
}

// [VRIJGESTELD] Sentinel for the BTW-tarief dropdown. "Vrijgesteld" is not a rate, but a
// <select> can only carry one value per option — so a value that is not a legal NL rate stands
// in for it, and is translated back into (0%, vat_treatment='exempt') the moment it is chosen.
// Negative on purpose: no rate can ever collide with it.
const EXEMPT_OPTION = -1

type InvoiceLine = {
  description: string
  quantity: number
  unit_price: number
  btw_rate: number
  // [VRIJGESTELD] 'exempt' = vrijgestelde prestatie (art. 11 Wet OB): geen BTW, en de omzet gaat
  // in GEEN aangifterubriek. Alleen te kiezen als de ondernemer dat in Instellingen heeft
  // verklaard; afwezig = gewoon belast, precies zoals elke regel van vóór dit veld.
  vat_treatment?: 'exempt' | null
  // [UNIT] De eenheid van deze regel ("uur", "m²", "stuk"). Komt mee uit de catalogus zodra
  // je een artikel kiest, en gaat door naar invoice_lines.unit → de UN/ECE-code in de e-factuur.
  // Leeg = geen eenheid, wat neerkomt op C62 (stuk) — precies het gedrag van vóór dit veld.
  unit?: string | null
  // [BOEK-031] AI translation support per line
  translating?: boolean
  rawInput?: string
}

// ─── Config ────────────────────────────────────────────────────────────────────

// [DS] Design System v1.0 — Type config with DS tokens
const TYPE_CONFIG: Record<InvoiceType, {
  label: string
  activeBg: string      // active chip background
  activeColor: string   // active chip text
  activeBorder: string  // active chip border
  primaryBtn: string    // primary button color
  focusColor: string    // input focus border color
}> = {
  factuur: {
    label: 'Factuur',
    activeBg: '#D3E3FD', activeColor: '#1967D2', activeBorder: '#1A73E8',
    primaryBtn: '#1A73E8', focusColor: '#1A73E8',
  },
  offerte: {
    label: 'Offerte',
    activeBg: '#FEF7E0', activeColor: '#EA8600', activeBorder: '#FBBC04',
    primaryBtn: '#FBBC04', focusColor: '#FBBC04',
  },
  creditnota: {
    label: 'Credit',
    activeBg: '#F9DEDC', activeColor: '#B3261E', activeBorder: '#EA4335',
    primaryBtn: '#EA4335', focusColor: '#EA4335',
  },
}

// ─── [DS] LineInput — number input for Factuurregels ─────────────────────────
// Fixes: no leading zero, comma/dot both work, step=1, Enter→next input
function LineInput({
  label, value, onChange, min = 0, focusColor, hasError = false,
}: {
  label: string
  value: number
  onChange: (v: number) => void
  min?: number
  focusColor: string
  hasError?: boolean
}) {
  const [focused, setFocused] = useState(false)
  // Raw string while typing — allows "0." mid-entry
  const [raw, setRaw] = useState(value === 0 ? '' : String(value))

  // [REACT] Ruwe invoer bijstellen tijdens de render in plaats van via een effect: dit is
  // afgeleide state (het tekstveld volgt de waarde van buiten zolang je er niet in typt).
  // Via een effect zag de gebruiker één frame lang de oude tekst staan.
  const [prevSync, setPrevSync] = useState<{ value: number; focused: boolean }>({ value, focused })
  if (prevSync.value !== value || prevSync.focused !== focused) {
    setPrevSync({ value, focused })
    if (!focused) setRaw(value === 0 ? '' : String(value))
  }

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    let v = e.target.value
    // [BOEK-031] comma → dot for decimal — May 2026
    v = v.replace(',', '.')
    // Only allow valid number characters: digits, one dot, optional minus
    if (!/^-?\d*\.?\d*$/.test(v)) return
    setRaw(v)
    const parsed = parseFloat(v)
    if (!isNaN(parsed)) onChange(Math.max(min, parsed))
  }

  function handleBlur() {
    setFocused(false)
    // [BOEK-031] clean up on blur — remove leading zeros — May 2026
    const parsed = parseFloat(raw)
    if (isNaN(parsed) || parsed < min) {
      setRaw(min === 0 ? '' : String(min))
      onChange(min)
    } else {
      setRaw(String(parsed))
      onChange(parsed)
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    // [BOEK-031] comma key → insert dot — May 2026
    if (e.key === ',') {
      e.preventDefault()
      if (!raw.includes('.')) {
        const next = raw ? raw + '.' : '0.'
        setRaw(next)
      }
      return
    }
    // [BOEK-031] Enter → focus next input — May 2026
    if (e.key === 'Enter') {
      e.preventDefault()
      const form = e.currentTarget.closest('[data-form]') ?? document
      const focusable = Array.from(
        form.querySelectorAll<HTMLElement>('input, select')
      ).filter(el => !el.hasAttribute('disabled'))
      const idx = focusable.indexOf(e.currentTarget)
      if (idx >= 0 && idx < focusable.length - 1) focusable[idx + 1].focus()
      return
    }
    // [BOEK-031] ArrowUp/Down step by 1 whole number — May 2026
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault()
      const delta = e.key === 'ArrowUp' ? 1 : -1
      const current = parseFloat(raw) || 0
      const next = Math.max(min, Math.round(current) + delta)
      setRaw(String(next))
      onChange(next)
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <label style={{ fontSize: 12, fontWeight: 500, color: hasError ? '#EA4335' : focused ? focusColor : '#5F6368' }}>{label}</label>
      <input
        type="text"
        inputMode="decimal"
        value={focused ? raw : (value === 0 ? '' : String(value))}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        onFocus={() => { setFocused(true); setRaw(value === 0 ? '' : String(value)) }}
        onBlur={handleBlur}
        placeholder="0"
        style={{
          width: '100%', minHeight: 44,
          border: `${hasError || focused ? '2px' : '1px'} solid ${hasError ? '#EA4335' : focused ? focusColor : '#E0E0E0'}`,
          borderRadius: 8, padding: '0 12px',
          fontSize: 16, color: '#202124',
          backgroundColor: hasError ? '#FFF8F7' : 'white', outline: 'none',
          boxSizing: 'border-box', transition: 'border 0.1s ease',
          fontFamily: 'Roboto Mono, monospace',
        }}
      />
    </div>
  )
}

// ─── [DS] OutlinedInput — Material You Outlined Text Field ─────────────────────
// font-size: 16px mandatory to prevent iOS auto-zoom
// Enter key moves focus to next input
function OutlinedInput({
  value, onChange, onFocus, placeholder, label, type = 'text', required = false, focusColor, hasError = false,
}: {
  value: string | number
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void
  onFocus?: () => void
  placeholder?: string
  label: string
  type?: string
  required?: boolean
  focusColor: string
  hasError?: boolean
}) {
  const [focused, setFocused] = useState(false)

  // [FACTUUR-A] On mobile, the fixed bottom action bar + the on-screen
  // keyboard can cover a focused field. Nudge it into the middle of the
  // visible area. Guarded so it only fires on small screens.
  function handleFocus(e: React.FocusEvent<HTMLInputElement>) {
    setFocused(true)
    onFocus?.()
    if (typeof window !== 'undefined' && window.innerWidth <= 640) {
      const el = e.currentTarget
      setTimeout(() => el.scrollIntoView({ behavior: 'smooth', block: 'center' }), 300)
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      e.preventDefault()
      const form = e.currentTarget.closest('[data-form]') ?? document
      const focusable = Array.from(
        form.querySelectorAll<HTMLElement>('input, select, button, textarea')
      ).filter(el => !el.hasAttribute('disabled') && el.tabIndex !== -1)
      const idx = focusable.indexOf(e.currentTarget)
      if (idx >= 0 && idx < focusable.length - 1) focusable[idx + 1].focus()
    }
  }

  // [BOEK-031] border color priority: error > focused > default
  const borderColor = hasError ? '#EA4335' : focused ? focusColor : '#E0E0E0'
  const borderWidth = hasError || focused ? '2px' : '1px'

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <label style={{ fontSize: 14, fontWeight: 500, color: hasError ? '#EA4335' : focused ? focusColor : '#5F6368' }}>
        {label}{required && <span style={{ color: M3.error, marginLeft: 2 }}>*</span>}
      </label>
      <input
        type={type}
        value={value}
        onChange={onChange}
        onKeyDown={handleKeyDown}
        onFocus={handleFocus}
        onBlur={() => setFocused(false)}
        placeholder={placeholder}
        style={{
          width: '100%',
          minHeight: 48,
          border: `${borderWidth} solid ${borderColor}`,
          borderRadius: 8,
          padding: '0 16px',
          fontSize: 16,
          color: '#202124',
          backgroundColor: hasError ? '#FFF8F7' : 'white',
          outline: 'none',
          boxSizing: 'border-box',
          transition: 'border 0.1s ease',
          fontFamily: 'inherit',
        }}
      />
    </div>
  )
}

// ─── [FACTUUR-A · DATE-NL] DateField ─────────────────────────────────────────
// A native <input type="date"> renders its SEGMENTS in the browser's locale, so a US desktop puts
// the month first and a Dutch owner cannot type a two-digit day at all — "21" for the 21st becomes
// February and the caret jumps. Measured: `lang` on the input, on a wrapper, and on <html> (which
// this app sets to "nl") change nothing.
//
// An earlier attempt here forced DD-MM-YYYY by OVERLAYING the native control, which produced a
// doubled calendar icon and a worse tap experience, and was rightly reverted to a clean native
// field plus a Dutch caption. The caption made the value unambiguous once typed; it could not make
// the typing work.
//
// DateFieldNL is not that overlay. The typing surface IS a text input in Dutch order, and the
// native control is a 1px hidden element that exists only so the calendar button can call
// showPicker() — it renders no icon of its own, so there is nothing to double. The picker stays
// one tap away, which is what made the native field worth keeping on a phone.
// Value in/out stays ISO (yyyy-mm-dd).
function DateField({
  value, onChange, label, required = false, focusColor, hasError = false, min,
}: {
  value: string                 // ISO yyyy-mm-dd
  onChange: (iso: string) => void
  label: string
  required?: boolean
  focusColor: string
  hasError?: boolean
  min?: string                  // ISO lower bound (optional)
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <label style={{ fontSize: 14, fontWeight: 500, color: hasError ? '#EA4335' : focusColor }}>
        {label}{required && <span style={{ color: M3.error, marginLeft: 2 }}>*</span>}
      </label>
      <DateFieldNL
        value={value}
        onChange={onChange}
        min={min}
        aria-label={label}
        style={{
          minHeight: 48,
          border: `${hasError ? '2px' : '1px'} solid ${hasError ? '#EA4335' : '#E0E0E0'}`,
          borderRadius: 8, padding: '0 16px',
          fontSize: 16, color: '#202124',
          backgroundColor: hasError ? '#FFF8F7' : 'white',
          outline: 'none', boxSizing: 'border-box', fontFamily: 'inherit',
        }}
      />
    </div>
  )
}

// ─── [FACTUUR-A] Payment-term presets — June 2026 ────────────────────────────
// Quick chips that compute Vervaldatum = Factuurdatum + N days. Manual editing
// stays fully available via the DateField. 30 days is the Dutch default.
const BETALINGSTERMIJNEN = [14, 30, 60] as const
const DEFAULT_TERMIJN = 30
function addDaysISO(iso: string, days: number): string {
  // String-based to stay timezone-proof on date-only values.
  const [y, m, d] = iso.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d))
  dt.setUTCDate(dt.getUTCDate() + days)
  return dt.toISOString().split('T')[0]
}

// ─── Component ─────────────────────────────────────────────────────────────────

function NewInvoicePageContent() {
  const router       = useRouter()
  const searchParams = useSearchParams()
  const supabase     = createClient()

  // Read query params at component level so useEffect doesn't depend on searchParams
  const typeParam           = searchParams.get('type') as InvoiceType | null
  const originalParam       = searchParams.get('original') ?? ''
  const offerteParam        = searchParams.get('from_offerte') ?? ''
  const replacesParam       = searchParams.get('replaces') ?? ''
  const replacesNumberParam = searchParams.get('replacesNumber') ?? ''
  // AI-generated params from ZzpDashboard
  const aiClientName    = searchParams.get('client_name') ?? ''
  const aiClientId      = searchParams.get('client_id') || null  // [KLANTEN] pre-link to a customer
  const aiClientEmail   = searchParams.get('client_email') ?? ''
  // [BOEK-029] offerte→factuur params — all client fields
  const aiClientAddress = searchParams.get('client_address') ?? ''
  const aiClientPostal  = searchParams.get('client_postal_code') ?? ''
  const aiClientCity    = searchParams.get('client_city') ?? ''
  const aiClientBtw     = searchParams.get('client_btw_number') ?? ''
  const aiDescription   = searchParams.get('description') ?? ''
  const aiAmount        = parseFloat(searchParams.get('amount') ?? '0') || 0
  const aiBtwRate       = parseFloat(searchParams.get('btw_rate') ?? '21') || 21

  // ── Core state ──────────────────────────────────────────────────────────────
  const [profile, setProfile]         = useState<Profile | null>(null)
  // [BOEK-031] Navigation Strategy — parent + home via helper — May 2026
  const role: Role = (profile?.role === 'accountant' ? 'accountant' : 'zzper')
  const parentHref = useParentPath(role)
  const [invoiceNumber, setInvoiceNumber] = useState('')
  const [loading, setLoading]         = useState(false)
  // [BOEK-031] linesLoading — wait for DB lines before allowing submit — May 2026
  const [linesLoading, setLinesLoading] = useState(!!offerteParam)
  const [error, setError]             = useState('')
  // [BOEK-031] Field-level errors — shows red borders on specific fields — May 2026
  const [fieldErrors, setFieldErrors] = useState<{
    clientName?: boolean
    clientEmail?: boolean
    clientAddress?: boolean
    invoiceDate?: boolean
    dueDate?: boolean
    deliveryDate?: boolean
    lines?: { description?: boolean; unit_price?: boolean; quantity?: boolean }[]
  }>({})

  function clearFieldError(field: string) {
    setFieldErrors(prev => ({ ...prev, [field]: false }))
  }

  // [BOEK-031] Invoice type — from_offerte always forces factuur — May 2026
  const [invoiceType, setInvoiceType] = useState<InvoiceType>(
    offerteParam
      ? 'factuur'  // coming from offerte → always factuur
      : typeParam && ['factuur', 'offerte', 'creditnota'].includes(typeParam)
        ? typeParam
        : 'factuur'
  )

  // ── Client autocomplete ──────────────────────────────────────────────────────
  const [clients, setClients]               = useState<Client[]>([])
  const [clientSearch, setClientSearch]     = useState(aiClientName)
  const [showDropdown, setShowDropdown]     = useState(false)
  const [selectedClientId, setSelectedClientId] = useState<string | null>(aiClientId)
  const autocompleteRef                     = useRef<HTMLDivElement>(null)

  // ── Client fields ────────────────────────────────────────────────────────────
  const [clientName, setClientName]       = useState(aiClientName)
  const [clientEmail, setClientEmail]     = useState(aiClientEmail)
  // [BOEK-029] pre-fill from offerte params — May 2026
  const [clientAddress, setClientAddress] = useState(aiClientAddress)
  const [clientPostal, setClientPostal]   = useState(aiClientPostal)
  const [clientCity, setClientCity]       = useState(aiClientCity)
  const [clientBtw, setClientBtw]         = useState(aiClientBtw)
  // [ICP] A customer number that names another EU member state but cannot have that length.
  // classifyVatNumber is deliberately conservative — it only says "suspect" when the length is
  // impossible for that country, so a valid number is never called wrong.
  const euVatSuspect = classifyVatNumber(clientBtw).kind === 'eu_suspect'
  // [ICP] A customer in another member state. Stated, never decided: whether THIS supply is an
  // intracommunautaire prestatie depends on what is being supplied and on the customer acting as
  // a business — a judgement the app must not make. What it can do is say it here, where the
  // rate is still being chosen, instead of leaving the owner to find out at the aangifte.
  const euVatCustomer = classifyVatNumber(clientBtw).kind === 'eu'

  // ── Dates ────────────────────────────────────────────────────────────────────
  // [TZ] The owner's Amsterdam day, not the UTC one. This value seeds BOTH the
  // factuurdatum and the leverdatum of a document that carries a number from the
  // doorlopende reeks — and toISOString() is still on yesterday until 01:00 (02:00
  // in summer). An invoice typed just after midnight on 1 January would be dated
  // into the previous fiscal year and the previous BTW-quarter.
  const today = amsterdamToday()
  const [invoiceDate, setInvoiceDate] = useState(today)
  const [dueDate, setDueDate]         = useState('')
  // [FACTUUR-A] Leverdatum (Art. 35a sub f) — defaults to invoice date until
  // the user touches it. deliveryTouched tracks that so changing the
  // factuurdatum keeps the (still-untouched) leverdatum in sync.
  const [deliveryDate, setDeliveryDate]       = useState(today)
  const [deliveryTouched, setDeliveryTouched] = useState(false)
  // [FACTUUR-A] Selected payment term (days). Drives Vervaldatum from
  // Factuurdatum. null = manually edited (no chip highlighted).
  const [betalingstermijn, setBetalingstermijn] = useState<number | null>(DEFAULT_TERMIJN)

  // [FACTUUR-A] Send confirmation dialog — sending is irreversible (number
  // consumed + e-mail delivered). Centered modal, per house convention.
  const [showSendConfirm, setShowSendConfirm] = useState(false)
  useCloseOnBack(!!showSendConfirm, () => setShowSendConfirm(false))

  // ── Lines — pre-filled from replace flow, offerte, or AI generation ──────────
  // [BOEK-029] from offerte: use total_ex_btw as unit_price so BTW calculates correctly
  const aiTotalExBtw = parseFloat(searchParams.get('total_ex_btw') ?? '0') || 0
  const aiTotalIncBtw = parseFloat(searchParams.get('total_inc_btw') ?? '0') || 0
  const offerteUnitPrice = aiTotalExBtw > 0 ? aiTotalExBtw : aiTotalIncBtw || aiAmount

  const [lines, setLines] = useState<InvoiceLine[]>(
    replacesNumberParam
      ? [{ description: `Vervangt factuur ${replacesNumberParam}`, quantity: 1, unit_price: 0, btw_rate: 21 }]
      : offerteParam
        ? [{ description: aiDescription || '', quantity: 1, unit_price: offerteUnitPrice, btw_rate: aiBtwRate }]
        : [{ description: aiDescription, quantity: 1, unit_price: aiAmount, btw_rate: aiBtwRate }]
  )

  // [FUNNEL-OVERDRACHT] De factuur uit de gratis generator, als die er is. Alleen bij een
  // gewone nieuwe factuur: komt de gebruiker hier via een offerte, een vervanging of een scan,
  // dan is hij met iets anders bezig en zou dit aanbod alleen in de weg zitten.
  const [handoff, setHandoff] = useState<FactuurHandoff | null>(null)
  useEffect(() => {
    if (replacesNumberParam || offerteParam || aiClientName || aiDescription) return
    try {
      const h = readHandoff(localStorage)
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (hasInvoiceContent(h)) setHandoff(h)
    } catch {
      /* geblokkeerde opslag — dan is er gewoon niets aan te bieden */
    }
  }, [replacesNumberParam, offerteParam, aiClientName, aiDescription])

  // [COHERENCE-CREDITNOTA] Credit-flow state removed — see the note above handleConvertOfferte.
  // Creditnotas are created from the original invoice's detail dialog, not here.

  // ── Replace flow — read-only from URL, never mutated ─────────────────────────
  const replacesId     = replacesParam
  const replacesNumber = replacesNumberParam

  // ── Offerte convert confirm ───────────────────────────────────────────────────
  const [showConvertDialog, setShowConvertDialog] = useState(false)
  useCloseOnBack(!!showConvertDialog, () => setShowConvertDialog(false))
  const [convertingOfferte, setConvertingOfferte] = useState(false)
  // offerte_id if we're converting an existing offerte — read-only from URL
  const offerteId = offerteParam

  // [SUBNAV] Dynamic title (factuur / offerte / creditnota) + the offerte
  // "Omzetten naar factuur" action, pushed into the shared sub-page header.
  // Called before the loading early-return so hook order stays stable.
  useSubPageHeader(
    {
      title:
        invoiceType === 'offerte' ? 'Nieuwe offerte' :
        invoiceType === 'creditnota' ? 'Creditnota' : 'Nieuwe factuur',
      actions: invoiceType === 'offerte' && offerteId ? (
        <button onClick={() => setShowConvertDialog(true)}
          style={{ fontSize: 13, fontWeight: 500, padding: '8px 16px', borderRadius: 9999, border: 'none', backgroundColor: '#1A73E8', color: 'white', cursor: 'pointer' }}>
          Omzetten naar factuur →
        </button>
      ) : undefined,
    },
    [invoiceType, offerteId]
  )

  // ─── Load ──────────────────────────────────────────────────────────────────

  useEffect(() => {
    async function load() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { router.push('/login'); return }

      // Profile
      const { data: p } = await supabase.from('profiles').select('*').eq('id', user.id).single()
      if (p) setProfile(p)

      // [FACTUUR-A] Default Vervaldatum = Factuurdatum + 30 (default term),
      // computed timezone-proof via addDaysISO.
      setDueDate(addDaysISO(today, DEFAULT_TERMIJN))

      // [FACTUUR-A] No browser-side number anymore — numbering is fully
      // server-side (atomic, legal). The UI shows "Concept" until the send
      // route mints the definitive number. Pro forma no longer shows a PF-
      // preview here; it is minted on conversion like everything else.
      setInvoiceNumber('') // empty = "Concept" in UI

      // Clients autocomplete
      const { data: cl } = await supabase
        .from('clients').select('*').eq('user_id', user.id).order('name')
      if (cl) setClients(cl)

      // [BOEK-029] from_offerte: load original invoice_lines for accurate amounts
      if (offerteParam) {
        const { data: offLines } = await supabase
          .from('invoice_lines')
          .select('description, quantity, unit_price, btw_rate')
          .eq('invoice_id', offerteParam)
        if (offLines && offLines.length > 0) {
          setLines(offLines.map(l => ({
            description: l.description ?? '',
            quantity:    l.quantity    ?? 1,
            unit_price:  l.unit_price  ?? 0,
            btw_rate:    l.btw_rate    ?? 21,
          })))
        }
        // [BOEK-031] lines loaded from DB — allow submit — May 2026
        setLinesLoading(false)
      }
    }
    load()
  }, [router, supabase])

  // [COHERENCE-CREDITNOTA] Crediting a SPECIFIC in-app invoice must go through the linked flow
  // (/api/invoice/creditnota): it copies the original's lines negatively and stores
  // original_invoice_id, so the credit↔original link holds and no SECOND credit of that invoice is
  // possible. So when we arrive with ?original=X, hand off to that invoice's detail dialog.
  // A STANDALONE creditnota (no ?original — e.g. crediting an invoice issued OUTSIDE BoekBrug, or a
  // loose correction) legitimately has original_invoice_id=null and stays here on the form; the
  // banner below steers anyone whose original IS in BoekBrug to the linked flow.
  useEffect(() => {
    if (typeParam === 'creditnota' && originalParam) {
      router.replace(`/dashboard/invoice/${originalParam}?action=credit`)
    }
  }, [typeParam, originalParam, router])

  // Close autocomplete on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (autocompleteRef.current && !autocompleteRef.current.contains(e.target as Node)) {
        setShowDropdown(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  // ─── Client autocomplete ───────────────────────────────────────────────────

  // [SEARCH] Accent-insensitive so "café"/"cafe" match; also searches KVK.
  const clientQ = foldText(clientSearch)
  const filteredClients = clients.filter(c =>
    foldText(c.name).includes(clientQ) ||
    foldText(c.email ?? '').includes(clientQ) ||
    foldText((c as { kvk_number?: string | null }).kvk_number ?? '').includes(clientQ)
  ).slice(0, 6)

  function selectClient(c: Client) {
    setSelectedClientId(c.id)
    setClientName(c.name)
    setClientEmail(c.email ?? '')
    setClientAddress(c.address ?? '')
    setClientPostal(c.postal_code ?? '')
    setClientCity(c.city ?? '')
    setClientBtw(c.btw_number ?? '')
    setClientSearch(c.name)
    setShowDropdown(false)
  }

  // [ACTING-FOR] saveNewClient() stond hier. Hij schreef de inline ingetikte klant weg met
  // user_id = de INGELOGDE mens — wat klopt zolang dat de eigenaar is, en fout is zodra een
  // verkoopmedewerker het scherm gebruikt. /api/invoice/draft maakt de klant nu aan onder de
  // EIGENAAR, met created_by als spoor, en geeft het verse id terug (draftJson.clientId) —
  // dezelfde reden als toen: de state is binnen dezelfde handler-tick nog niet bijgewerkt.
  //
  // Bewust weggehaald in plaats van laten staan: een ongebruikte browserfunctie die facturen
  // en klanten kan wegschrijven is precies het soort code dat later per ongeluk terugkomt.

  // ─── Lines ─────────────────────────────────────────────────────────────────

  function addLine() {
    setLines(prev => [...prev, { description: '', quantity: 1, unit_price: 0, btw_rate: 21 }])
  }

  function removeLine(i: number) {
    if (lines.length === 1) return
    setLines(prev => prev.filter((_, idx) => idx !== i))
  }

  function updateLine(i: number, field: keyof InvoiceLine, value: string | number | boolean) {
    setLines(prev => prev.map((l, idx) => idx === i ? { ...l, [field]: value } : l))
  }

  // [PRIJS-MODUS] Het prijsveld schrijft niet rechtstreeks in de regel: in incl-modus is wat er
  // staat het bedrag VOOR DE KLANT, en wat we bewaren de prijs ex-btw.
  function updateLinePrice(i: number, typed: number) {
    setLines(prev => prev.map((l, idx) =>
      idx === i ? { ...l, unit_price: priceFieldToStored(typed, l.btw_rate, priceMode) } : l))
  }

  // [PRIJS-MODUS] Een ander btw-tarief betekent per modus iets anders, en het verkeerde antwoord is
  // stil: in incl-modus zou de klantprijs veranderen terwijl het veld hetzelfde getal blijft tonen.
  //   · excl — de ingetypte prijs blijft staan, het totaal beweegt (ongewijzigd gedrag);
  //   · incl — "€ 50 all-in" blijft € 50 all-in; de marge beweegt, niet de prijs.
  function updateLineRate(i: number, newRate: number) {
    setLines(prev => prev.map((l, idx) => idx === i
      ? { ...l, btw_rate: newRate, vat_treatment: null, unit_price: repriceForRateChange(l.unit_price, l.btw_rate, newRate, priceMode) }
      : l))
  }

  // [VRIJGESTELD] "Vrijgesteld" is geen tarief, dus het kan geen waarde in de tarief-select zijn:
  // het is 0% BTW PLUS een vlag. Aparte functie zodat de twee altijd samen worden gezet — een
  // regel met vat_treatment 'exempt' en een tarief van 21% is een tegenspraak, en die wordt
  // verderop in de keten (resolveSaleTreatment) hoe dan ook in het nadeel van het label beslecht.
  function markLineExempt(i: number) {
    setLines(prev => prev.map((l, idx) => idx === i
      ? { ...l, btw_rate: 0, vat_treatment: 'exempt', unit_price: repriceForRateChange(l.unit_price, l.btw_rate, 0, priceMode) }
      : l))
  }

  // ── [PRIJS-MODUS] Typ ik mijn prijzen inclusief of exclusief btw? ──────────────────────────
  // Een deel van de klanten werkt all-in ("€ 50, klaar"). Die ondernemer moest tot nu toe eerst
  // zelf € 50 / 1,21 uitrekenen en dát in de regel typen — een deling op een rekenmachine bij
  // elke factuur, en elke afronding daarvan werd een cent verschil op wat zijn klant betaalt.
  //
  // De stand raakt ALLEEN de invoer. lines[].unit_price blijft de prijs ex-btw, want dat is wat
  // invoice_lines opslaat en wat alles daarna leest (de rubriekensplitsing van de aangifte, de
  // PDF, het sluitpakket, de export naar de boekhouder). Zie src/lib/price-mode.ts.
  //
  // Onthouden in localStorage: wie all-in werkt, werkt de VOLGENDE factuur ook all-in, en die
  // keuze elke keer opnieuw moeten maken is precies het soort wrijving dat dit zou moeten
  // wegnemen. Standaard 'excl', zodat het scherm zich voor iedereen gedraagt zoals het deed.
  const [priceMode, setPriceMode] = useState<PriceMode>('excl')
  useEffect(() => {
    try {
      const saved = localStorage.getItem('boekbrug.priceMode')
      // Zelfde uitzondering als de handoff hierboven: localStorage is een extern systeem en dit is
      // precies waar een effect voor is — de opgeslagen keuze één keer binnenhalen. De regel die
      // hier klaagt (set-state-in-effect) beschermt tegen cascade-renders, en dat is dit niet: het
      // gebeurt één keer bij het monteren en verandert verder niets.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (saved === 'incl' || saved === 'excl') setPriceMode(saved)
    } catch { /* private mode / storage geblokkeerd: dan gewoon de standaard */ }
  }, [])
  function choosePriceMode(mode: PriceMode) {
    setPriceMode(mode)
    try { localStorage.setItem('boekbrug.priceMode', mode) } catch { /* niet erg */ }
  }

  // [ARTIKELEN] The line-item catalog (gateway #1) — pick a saved article to fill a line
  // by code or name, or save the current line back to the catalog. Fewer clicks per line.
  const [catalog, setCatalog] = useState<Article[]>([])
  const [pickerLine, setPickerLine] = useState<number | null>(null)
  const [savedToCatalog, setSavedToCatalog] = useState<number | null>(null)
  useEffect(() => {
    fetch('/api/articles').then(r => r.ok ? r.json() : null).then(j => { if (j?.articles) setCatalog(j.articles) }).catch(() => {})
  }, [])
  function pickArticle(i: number, a: Article) {
    // [UNIT] De eenheid komt mee uit de catalogus. Zonder deze regel viel hij eraf op precies
    // het moment dat een artikel een factuurregel werd — en dan stond er in de e-factuur "2 stuks"
    // waar "2 uur" hoorde te staan.
    setLines(prev => prev.map((l, idx) => idx === i ? { ...l, description: a.description, unit_price: a.unit_price, btw_rate: a.btw_rate, unit: a.unit ?? null } : l))
    setPickerLine(null)
    // Bump usage so the picker learns the owner's most-used lines. Best-effort.
    fetch(`/api/articles/${a.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ bump: true }) }).catch(() => {})
  }
  async function saveLineToCatalog(i: number, line: InvoiceLine) {
    if (!line.description.trim()) return
    try {
      const res = await fetch('/api/articles', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description: line.description, unit_price: line.unit_price, btw_rate: line.btw_rate, code: '', unit: '' }),
      })
      if (res.ok) {
        const j = await res.json()
        if (j.article) setCatalog(prev => [j.article, ...prev])
        setSavedToCatalog(i); setTimeout(() => setSavedToCatalog(cur => cur === i ? null : cur), 2000)
      }
    } catch { /* silent */ }
  }

  // [BOEK-031] AI translation per line — via API route (client-safe) — May 2026
  async function translateLine(i: number) {
    const line = lines[i]
    if (!line.description.trim()) return
    updateLine(i, 'translating', true)
    try {
      const res = await fetch('/api/ai/translate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: line.description, sourceLanguage: 'auto' }),
      })
      if (res.ok) {
        const result = await res.json()
        if (result.translation) updateLine(i, 'description', result.translation)
      }
      // safe fallback — if fails, keep original
    } catch {
      // keep original
    } finally {
      updateLine(i, 'translating', false)
    }
  }

  // ─── Totals ────────────────────────────────────────────────────────────────

  // [BOEK-031] Credit: user enters positive — system saves negative
  const sign      = invoiceType === 'creditnota' ? -1 : 1
  const totalEx   = lines.reduce((s, l) => s + l.quantity * l.unit_price, 0)
  const btwAmount = lines.reduce((s, l) => s + l.quantity * l.unit_price * (l.btw_rate / 100), 0)
  const totalInc  = totalEx + btwAmount

  // [ACTING-FOR] computeTotals() stond hier en berekende de bedragen die met de INSERT meegingen.
  // Die som woont nu op de server, in src/lib/draft-totals.ts — letterlijk dezelfde formule,
  // inclusief het niet afronden, zodat er voor een bestaande eigenaar geen cent verandert. De
  // reden voor de verhuizing is niet netheid: zodra een tweede mens facturen mag maken onder
  // hetzelfde BTW-nummer, hoort de server te bepalen wat er in de boeken komt, niet de pagina.
  //
  // De drie getallen hierboven (totalEx/btwAmount/totalInc) blijven — die zijn alleen voor wat
  // je op het scherm ziet terwijl je typt, en raken de database niet.

  // BTW breakdown per rate
  const btwByRate: Record<number, number> = {}
  lines.forEach(l => {
    const rate = l.btw_rate
    btwByRate[rate] = (btwByRate[rate] ?? 0) + l.quantity * l.unit_price * (rate / 100)
  })

  // [COHERENCE-CREDITNOTA] The standalone credit-submit flow that lived here was
  // removed: a creditnota is now created only from its original invoice via the detail
  // page's dialog → /api/invoice/creditnota (copies lines, keeps the link). The old
  // handleCredit + the sentInvoices picker + creditReason state were never wired to any
  // control on this page (dead code), and the ?type=creditnota redirect above now sends
  // the owner to the correct place, so the whole standalone path is retired.

  // ─── Offerte → Factuur convert ─────────────────────────────────────────────

  async function handleConvertOfferte() {
    setConvertingOfferte(true); setError('')
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { router.push('/login'); return }

    // [ACTING-FOR] Het concept + de regels worden door de SERVER geschreven, niet meer hier.
    // Waarom: sender_id was `user.id` — de ingelogde mens. Voor een verkoopmedewerker is dat
    // NIET de eigenaar van de boekhouding, en zou hij onder zijn eigen id boeken dan liepen er
    // twee nummerreeksen onder één BTW-nummer (Art. 35: doorlopend, zonder gaten, forward-only).
    // De route lost de eigenaar op en rekent de totalen zelf uit — met exact dezelfde som als
    // computeTotals() hier, dus voor een eigenaar verandert er geen cent.
    // [FACTUUR-A] Nog steeds als DRAFT: de send-route slaat daarna het wettelijke nummer.
    const draftRes = await fetch('/api/invoice/draft', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        invoiceType: 'factuur',
        invoice_date: invoiceDate,
        due_date: dueDate,
        // [FACTUUR-A] offerte conversion gets a Leverdatum too (Art. 35a sub f),
        // defaulting to the invoice date.
        delivery_date: invoiceDate,
        client_id: selectedClientId,
        client_name: clientName,
        client_email: clientEmail,
        client_address: clientAddress,
        client_postal_code: clientPostal,
        client_city: clientCity,
        client_btw_number: clientBtw,
        lines: lines.map(l => ({
          description: l.description,
          quantity: l.quantity,
          unit_price: l.unit_price,
          btw_rate: l.btw_rate,
          unit: l.unit ?? null,
          vat_treatment: l.vat_treatment ?? null,
        })),
      }),
    })
    const draftJson = await draftRes.json().catch(() => ({}))
    if (!draftRes.ok || !draftJson?.invoiceId) {
      setError(draftJson?.error || 'Omzetten mislukt'); setConvertingOfferte(false); return
    }
    const factuur = { id: draftJson.invoiceId as string }

    // Mark offerte as converted
    if (offerteId) {
      await supabase.from('invoices')
        .update({ status: 'archived' })
        .eq('id', offerteId)
    }

    // [FACTUUR-A] Mint number + render PDF + deliver via the route
    try {
      const res = await fetch('/api/invoice/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ invoiceId: factuur.id }),
      })
      const result = await res.json().catch(() => ({}))
      setShowConvertDialog(false)
      if (!res.ok) {
        setError(result.error || 'Verzenden mislukt — opgeslagen als concept')
        setConvertingOfferte(false)
        router.replace(`/dashboard/invoice/${factuur.id}`)
        return
      }
      if (result.warning === 'pdf_failed' || result.warning === 'email_failed') {
        router.replace(`/dashboard/invoice/${factuur.id}?delivery=${result.warning}`)
        return
      }
    } catch {
      setShowConvertDialog(false)
      setError('Verzenden mislukt — opgeslagen als concept')
      setConvertingOfferte(false)
      router.replace(`/dashboard/invoice/${factuur.id}`)
      return
    }

    // [BOEK-031] replace ipv push — Navigation Strategy — May 2026
    router.replace(`/dashboard/invoice/${factuur.id}`)
  }

  // ─── Main submit ───────────────────────────────────────────────────────────

  async function handleSubmit(mode: 'draft' | 'sent') {
    // [BOEK-031] wait for lines to load from DB before submitting — May 2026
    if (linesLoading) return
    // [BOEK-031] Validate all fields at once — show red borders — May 2026
    const errs: typeof fieldErrors = {}
    let hasAnyError = false

    if (!clientName) { errs.clientName = true; hasAnyError = true }
    if (!clientEmail) { errs.clientEmail = true; hasAnyError = true }
    if (!invoiceDate) { errs.invoiceDate = true; hasAnyError = true }
    if (!dueDate) { errs.dueDate = true; hasAnyError = true }

    // [FACTUUR-A] Art. 35a sub c — customer address is mandatory on a FACTUUR and a
    // CREDITNOTA (both are legal invoices; the send route rejects issuance without it),
    // not on an offerte/pro forma. Enforce it inline here so the owner sees a red field
    // up-front instead of a late 400 from /api/invoice/send.
    if ((invoiceType === 'factuur' || invoiceType === 'creditnota') && !clientAddress.trim()) {
      errs.clientAddress = true; hasAnyError = true
    }
    // [FACTUUR-A] Leverdatum required for factuur (Art. 35a sub f)
    if (invoiceType === 'factuur' && !deliveryDate) {
      errs.deliveryDate = true; hasAnyError = true
    }
    // [FACTUUR-A] Customer BTW-id: only block when it LOOKS Dutch but is
    // malformed. Empty or clearly-foreign numbers pass (valid cases).
    if (clientBtw.trim() && looksLikeDutchBtw(clientBtw) && !isValidDutchBtw(clientBtw)) {
      setError('Het BTW-nummer van de klant lijkt onjuist (verwacht: NL123456789B01)')
      return
    }
    // [ICP] A number that names another EU member state but cannot have that length is caught
    // HERE, not three months later. This one invoice decides two things at once: whether the
    // BTW may be verlegd, and whether the customer can go on the ICP-opgaaf — and a rejected
    // opgaaf counts as never filed. Blocking here costs a retype; not blocking costs a quarter.
    if (euVatSuspect) {
      setError(`Het BTW-nummer ${clientBtw.trim()} heeft niet de lengte die dat EU-land gebruikt. Controleer het bij de klant (of via VIES) — het bepaalt of de BTW verlegd mag worden en of de klant in de ICP-opgaaf komt.`)
      return
    }

    const lineErrs = lines.map(l => ({
      description: !l.description.trim(),
      unit_price: l.unit_price <= 0,
      quantity: l.quantity <= 0,
    }))
    const hasLineError = lineErrs.some(l => l.description || l.unit_price || l.quantity)
    if (hasLineError) hasAnyError = true

    if (hasAnyError) {
      setFieldErrors({ ...errs, lines: lineErrs })
      setError('Vul de rood gemarkeerde velden in')
      // Scroll to first error
      setTimeout(() => {
        const firstRed = document.querySelector('[data-form] input[style*="#EA4335"], [data-form] input[style*="FFF8F7"]') as HTMLElement
        firstRed?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      }, 50)
      return
    }

    setFieldErrors({})
    setError('')

    setLoading(true); setError('')
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { router.push('/login'); return }

    // [ACTING-FOR] Eén serverroute schrijft nu de klant, de factuurkop én de regels.
    //
    // Wat hier stond was: saveNewClient() met user_id = user.id, daarna een INSERT met
    // sender_id = user.id en de totalen die deze pagina had uitgerekend. Drie browser-
    // schrijfacties waarin de PAGINA bepaalde wie de eigenaar is en wat de bedragen zijn.
    //
    // Dat kon zolang er één mens per boekhouding was. Met een verkoopmedewerker erbij is
    // `user.id` niet de eigenaar, en twee reeksen onder één BTW-nummer zijn bij een controle
    // gaten in de nummering (Art. 35 Wet OB, forward-only — niet terug te draaien). De server
    // lost de eigenaar op, zet created_by als spoor, en rekent zelf. De som is letterlijk
    // dezelfde als computeTotals() hierboven, inclusief het niet afronden: voor een eigenaar
    // verandert er geen cent en geen veld.
    //
    // [FACTUUR-A] Nog steeds altijd als DRAFT met invoice_number = null; de send-route slaat
    // het wettelijke nummer. De browser heeft er nooit een mogen bedenken.
    const draftRes = await fetch('/api/invoice/draft', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        invoiceType,
        invoice_date: invoiceDate,
        due_date: dueDate,
        // [FACTUUR-A] Leverdatum — only meaningful for factuur; null otherwise.
        delivery_date: invoiceType === 'factuur' ? deliveryDate : null,
        // Leeg ⇒ de route maakt de inline ingetikte klant zelf aan, onder de eigenaar. Dat
        // vervangt saveNewClient(): die schreef de klant op naam van de ingelogde mens.
        client_id: selectedClientId,
        client_name: clientName,
        client_email: clientEmail,
        client_address: clientAddress,
        client_postal_code: clientPostal,
        client_city: clientCity,
        client_btw_number: clientBtw,
        // [BOEK-031] creditnota is standalone — original_invoice_id = null always — May 2026
        replaces_id: invoiceType === 'creditnota' ? null : (replacesId || null),
        // Het teken (credit = negatief) zet de server, op één plek — zie draft-totals.ts.
        lines: lines.map(l => ({
          description: l.description,
          quantity: l.quantity,
          unit_price: l.unit_price,
          btw_rate: l.btw_rate,
          unit: l.unit ?? null,
          vat_treatment: l.vat_treatment ?? null,
        })),
      }),
    })
    const draftJson = await draftRes.json().catch(() => ({}))
    if (!draftRes.ok || !draftJson?.invoiceId) {
      setError(draftJson?.error || 'Aanmaken mislukt — probeer opnieuw')
      setLoading(false); return
    }
    const invoice = { id: draftJson.invoiceId as string }
    if (draftJson.clientId) setSelectedClientId(draftJson.clientId)

    // [BOEK-031] Replace flow — de LINK naar de oude factuur wordt hierboven vastgelegd
    // (original_invoice_id). Wat hier stond, is weg:
    //
    //   await supabase.from('invoices').update({ status: 'archived' }).eq('id', replacesId)
    //
    // [ISSUED-STAYS] Dat was een rauwe browser-schrijfactie die de hele serverautoriteit
    // oversloeg — geen refuseArchive, geen money_settled-controle, geen bank_tx_invoices-probe,
    // geen audit-regel. Ze kon dus een VERSTUURDE, genummerde verkoopfactuur archiveren, precies
    // wat de doorlopende nummering verbiedt: zo'n factuur wordt gecorrigeerd met een creditnota,
    // niet uit de reeks gehaald. Geen enkel scherm linkt naar ?replaces= — dit was alleen te
    // bereiken door de URL zelf te typen — dus er gaat geen werkende flow verloren.
    //
    // Wordt de vervang-flow ooit echt gebouwd, dan hoort hij door /api/invoice/[id]/archive te
    // lopen, waar die grendels wél staan.

    // [BOEK-031] from_offerte flow — archiveer de originele offerte — May 2026
    // Bewust WEL een directe schrijfactie: refuseArchive weigert per definitie alles wat niet
    // 'incoming' is (regel [ISSUED-STAYS]), dus ook een offerte, en die route zou deze werkende
    // flow dus breken. Een offerte draagt geen factuurnummer en geen geld — de twee dingen die
    // die grendel beschermt — dus hier valt niets te omzeilen.
    if (offerteId) {
      await supabase.from('invoices')
        .update({ status: 'archived' })
        .eq('id', offerteId)
    }

    // [FACTUUR-A] Send via the route — the ONLY place that mints the number,
    // renders the PDF and delivers the e-mail with the attachment. Awaited
    // (not fire-and-forget) so we can surface pdf_failed / email_failed and
    // route the user to recovery. A draft save skips this entirely.
    //
    // [FACTUUR-A] OFFERTE NEVER goes through the send route. An offerte is a
    // price quote, not a legal invoice: it gets NO number and does NOT become
    // a factuur here. It is saved (as pro_forma) and the user converts it
    // later via the explicit "Omzetten naar factuur" button. Routing it
    // through /api/invoice/send would mint a factuur number (the bug that
    // produced 007-2026 from an offerte).
    if (mode === 'sent' && invoiceType !== 'offerte') {
      try {
        const res = await fetch('/api/invoice/send', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ invoiceId: invoice.id }),
        })
        const result = await res.json().catch(() => ({}))

        if (!res.ok) {
          // Number was NOT consumed (route validates before minting) — the
          // draft is safe. Show the error and let the user fix + retry.
          setError(result.error || 'Verzenden mislukt — de factuur is opgeslagen als concept')
          setLoading(false)
          router.replace(`/dashboard/invoice/${invoice.id}`)
          return
        }

        // Soft warnings: invoice IS legally issued, delivery needs a retry.
        if (result.warning === 'pdf_failed' || result.warning === 'email_failed') {
          router.replace(`/dashboard/invoice/${invoice.id}?delivery=${result.warning}`)
          return
        }
      } catch {
        // Network blip after a clean insert — the draft is intact.
        setError('Verzenden mislukt — de factuur is opgeslagen als concept')
        setLoading(false)
        router.replace(`/dashboard/invoice/${invoice.id}`)
        return
      }
    }

    // [BOEK-031] replace naar detail pagina — Navigation Strategy — May 2026
    router.replace(`/dashboard/invoice/${invoice.id}`)
  }

  // ─── Derived ───────────────────────────────────────────────────────────────

  const cfg = TYPE_CONFIG[invoiceType]

  // ─── Render ────────────────────────────────────────────────────────────────

  return (
    <div style={{ minHeight: '100vh', backgroundColor: '#F8F9FA', position: 'relative' }}>
      {/* [SUBNAV] Back + title (Nieuwe factuur/offerte/Creditnota) + the offerte
          "Omzetten naar factuur" action now come from the shared sub-page header
          (registered via useSubPageHeader above). */}

      <div data-form style={{ maxWidth: COLUMN.work, margin: '0 auto', padding: '16px', display: 'flex', flexDirection: 'column', gap: 8, paddingBottom: 'calc(160px + var(--bottom-nav-h) + env(safe-area-inset-bottom))' }}>

        {/* [FUNNEL-OVERDRACHT] De factuur die iemand op /factuur-maken maakte vóórdat hij een
            account had. Die pagina beloofde "bewaar je facturen" en leverde tot nu toe een leeg
            formulier op — alles opnieuw tikken, precies bij het besluit om te blijven.

            Dit is een VRAAG, geen automatische invulling. Het bedrijfsblok mag stil worden
            voorgevuld in de onboarding (eigen gegevens, herkenning), maar een compleet ingevulde
            factuur die vanzelf verschijnt is iets anders: dan weet je niet meer wat van jou is
            en wat het systeem verzon. Eén klik ervoor, één klik ertegen, en in beide gevallen is
            de overdracht daarna weg zodat hij nooit een tweede keer opduikt. */}
        {handoff && (
          <div style={{ backgroundColor: '#E6F4EA', border: '1px solid #137333', borderRadius: 16, padding: 16 }}>
            <p style={{ fontSize: 15, fontWeight: 600, color: '#137333', margin: '0 0 4px' }}>
              We vonden de factuur die je eerder maakte
            </p>
            <p style={{ fontSize: 14, color: '#137333', margin: '0 0 12px', lineHeight: 1.5 }}>
              {describeHandoff(handoff)}. Wil je hem hier overnemen? Je factuurnummer krijg je van
              ons — dat loopt door in je eigen reeks.
            </p>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button
                onClick={() => {
                  const c = handoff.client
                  if (c.client_name.trim()) {
                    setClientName(c.client_name)
                    setClientSearch(c.client_name)
                    // Bewust GEEN selectedClientId: deze klant bestaat nog niet in het
                    // klantenbestand. De bestaande opslaglogica maakt hem aan; een verzonnen
                    // koppeling zou naar een record wijzen dat er niet is.
                    setSelectedClientId(null)
                  }
                  if (c.client_email.trim()) setClientEmail(c.client_email)
                  if (c.client_address.trim()) setClientAddress(c.client_address)
                  if (c.client_postal_code.trim()) setClientPostal(c.client_postal_code)
                  if (c.client_city.trim()) setClientCity(c.client_city)
                  if (c.client_btw_number.trim()) setClientBtw(c.client_btw_number)
                  const regels = handoff.lines.filter(isMeaningfulLine)
                  if (regels.length) {
                    setLines(regels.map((l) => ({
                      description: l.description,
                      quantity: l.quantity || 1,
                      unit_price: l.unit_price,
                      btw_rate: l.btw_rate,
                    })))
                  }
                  clearHandoff(localStorage)
                  setHandoff(null)
                }}
                style={{ padding: '10px 16px', borderRadius: 9999, border: 'none', backgroundColor: '#137333', color: 'white', fontSize: 14, fontWeight: 600, cursor: 'pointer' }}
              >
                Overnemen
              </button>
              <button
                onClick={() => { clearHandoff(localStorage); setHandoff(null) }}
                style={{ padding: '10px 16px', borderRadius: 9999, border: '1px solid #137333', backgroundColor: 'transparent', color: '#137333', fontSize: 14, fontWeight: 600, cursor: 'pointer' }}
              >
                Nee, opnieuw beginnen
              </button>
            </div>
          </div>
        )}

        {/* [DS] Segmented Button — Material You, één geheel */}
        <div style={{ backgroundColor: 'white', borderRadius: 16, padding: 16, boxShadow: '0 1px 4px rgba(0,0,0,0.08)' }}>
          <p style={{ fontSize: 14, fontWeight: 500, color: '#202124', margin: '0 0 12px' }}>Type document</p>
          <div style={{ display: 'flex', borderRadius: 9999, border: '1px solid #E0E0E0', overflow: 'hidden', backgroundColor: '#F1F3F4' }}>
            {/* [COHERENCE-CREDITNOTA] 'Credit' is selectable again as a STANDALONE creditnota
                (own CR- number, negative amounts, −omzet) — for crediting an invoice issued
                OUTSIDE BoekBrug or a loose correction. Crediting an in-app invoice still goes
                through that invoice's own linked flow (kept the link + blocks a double credit);
                the banner below steers the owner there when the original is in BoekBrug. */}
            {(Object.keys(TYPE_CONFIG) as InvoiceType[]).map((t, idx, arr) => {
              const c = TYPE_CONFIG[t]
              const active = invoiceType === t
              return (
                <button key={t} onClick={() => setInvoiceType(t)}
                  style={{
                    flex: 1,
                    padding: '10px 8px',
                    border: 'none',
                    borderLeft: idx > 0 ? '1px solid #E0E0E0' : 'none',
                    backgroundColor: active ? c.activeBg : 'transparent',
                    color: active ? c.activeColor : '#5F6368',
                    fontWeight: active ? 600 : 400,
                    fontSize: 14,
                    cursor: 'pointer',
                    transition: 'all 0.15s cubic-bezier(0.4,0,0.2,1)',
                    // [DS] pill radius alleen op uiteinden
                    borderRadius: idx === 0 ? '9999px 0 0 9999px' : idx === arr.length - 1 ? '0 9999px 9999px 0' : 0,
                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                  }}
                >
                  {active && <span style={{ fontSize: 14 }}>✓</span>}
                  {c.label}
                </button>
              )
            })}
          </div>
        </div>


        {/* [DS] Credit banner — border-left 4px style */}
        {invoiceType === 'creditnota' && (
          <div style={{ backgroundColor: '#F9DEDC', borderLeft: '4px solid #EA4335', borderRadius: '0 12px 12px 0', padding: '12px 16px', display: 'flex', gap: 8, alignItems: 'flex-start' }}>
            <span style={{ fontSize: 16, color: '#B3261E', flexShrink: 0 }}>↩</span>
            <div style={{ margin: 0 }}>
              <p style={{ fontSize: 13, color: '#B3261E', margin: 0, lineHeight: 1.5 }}>
                <strong>Losse creditnota</strong> — bedragen worden automatisch negatief. Vul het formulier in zoals een gewone factuur. Gebruik dit voor een factuur die niet in BoekBrug staat.
              </p>
              {/* [COHERENCE-CREDITNOTA] Steer an in-app credit to the linked flow so the
                  credit↔origineel koppeling behouden blijft en er geen tweede credit ontstaat. */}
              <p style={{ fontSize: 12, color: '#B3261E', margin: '6px 0 0', lineHeight: 1.5, opacity: 0.9 }}>
                Staat de originele factuur wél in BoekBrug? Crediteer die dan{' '}
                <Link href="/dashboard/facturen" style={{ color: '#1967D2', textDecoration: 'underline', fontWeight: 600 }}>vanaf de factuur zelf</Link>
                {' '}— dan blijft de koppeling behouden.
              </p>
            </div>
          </div>
        )}

        <>
            {replacesNumber && (
              <div style={{ backgroundColor: '#E8F0FE', borderLeft: '4px solid #1A73E8', borderRadius: '0 12px 12px 0', padding: '12px 16px', display: 'flex', gap: 8, alignItems: 'center' }}>
                <span style={{ color: '#1967D2', flexShrink: 0 }}>🔄</span>
                <p style={{ fontSize: 13, color: '#1967D2', margin: 0 }}>
                  <strong>Vervangende factuur</strong> voor <span style={{ fontFamily: 'Roboto Mono, monospace', fontWeight: 600 }}>{replacesNumber}</span>. De oude factuur wordt automatisch gearchiveerd.
                </p>
              </div>
            )}

            {/* [BOEK-031] from_offerte banner — May 2026 */}
            {offerteId && !replacesNumber && (
              <div style={{ backgroundColor: '#E6F4EA', borderLeft: '4px solid #34A853', borderRadius: '0 12px 12px 0', padding: '12px 16px', display: 'flex', gap: 8, alignItems: 'center' }}>
                <span style={{ color: '#137333', flexShrink: 0 }}>📄</span>
                <p style={{ fontSize: 13, color: '#137333', margin: 0 }}>
                  <strong>Factuur op basis van offerte</strong> — gegevens zijn vooringevuld. De offerte wordt gearchiveerd na opslaan.
                </p>
              </div>
            )}

            {invoiceType === 'offerte' && (
              <div style={{ backgroundColor: '#FEF7E0', borderLeft: '4px solid #FBBC04', borderRadius: '0 12px 12px 0', padding: '12px 16px', display: 'flex', gap: 8, alignItems: 'center' }}>
                <span style={{ color: '#EA8600', flexShrink: 0 }}>📋</span>
                <p style={{ fontSize: 13, color: '#EA8600', margin: 0 }}>
                  <strong>Offerte</strong> — geen factuurnummer. Gebruik &ldquo;Omzetten naar factuur&rdquo; als de klant akkoord gaat.
                </p>
              </div>
            )}

            {/* [DS] Van card */}
            {profile && (
              <div style={{ backgroundColor: 'white', borderRadius: 16, padding: 16, boxShadow: '0 1px 4px rgba(0,0,0,0.08)' }}>
                <p style={{ fontSize: 14, fontWeight: 500, color: '#202124', margin: '0 0 8px' }}>Van</p>
                <div style={{ borderTop: '0.5px solid #E0E0E0', paddingTop: 8, display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <p style={{ fontSize: 14, fontWeight: 600, color: '#202124', margin: 0 }}>{profile.company_name || profile.full_name}</p>
                  {profile.address && <p style={{ fontSize: 13, color: '#5F6368', margin: 0 }}>{profile.address}</p>}
                  {(profile.postal_code || profile.city) && <p style={{ fontSize: 13, color: '#5F6368', margin: 0 }}>{[profile.postal_code, profile.city].filter(Boolean).join(' ')}</p>}
                  <div style={{ display: 'flex', gap: 16, marginTop: 2 }}>
                    {profile.kvk_number && <p style={{ fontSize: 12, color: '#70757a', margin: 0 }}>KVK: {profile.kvk_number}</p>}
                    {profile.btw_number && <p style={{ fontSize: 12, color: '#70757a', margin: 0 }}>BTW: {profile.btw_number}</p>}
                  </div>
                  {/* [FACTUUR-A] Non-blocking legal-completeness warning on the
                      sender's own data — a malformed BTW-id or missing KVK
                      silently lands on every legal invoice otherwise. Links to
                      settings; never blocks the form. */}
                  {(invoiceType === 'factuur' || invoiceType === 'creditnota') && (() => {
                    const missing: string[] = []
                    if (!profile.address || !profile.kvk_number) missing.push('adres/KVK')
                    if (!profile.btw_number) missing.push('BTW-nummer')
                    else if (looksLikeDutchBtw(profile.btw_number) && !isValidDutchBtw(profile.btw_number)) {
                      missing.push('geldig BTW-nummer (NL…B01)')
                    }
                    if (missing.length === 0) return null
                    return (
                      <div style={{ marginTop: 10, backgroundColor: '#FEF7E0', borderLeft: '3px solid #FBBC04', borderRadius: '0 8px 8px 0', padding: '8px 12px' }}>
                        <p style={{ fontSize: 12, color: '#EA8600', margin: 0, lineHeight: 1.5 }}>
                          Je gegevens missen: {missing.join(', ')}. Een factuur is wettelijk pas volledig met deze gegevens.{' '}
                          <Link href="/dashboard/settings" style={{ color: '#1967D2', textDecoration: 'underline' }}>Aanvullen</Link>
                        </p>
                      </div>
                    )
                  })()}
                </div>
              </div>
            )}

            {/* [DS] Aan card */}
            <div style={{ backgroundColor: 'white', borderRadius: 16, padding: 16, boxShadow: '0 1px 4px rgba(0,0,0,0.08)', display: 'flex', flexDirection: 'column', gap: 12 }}>
              <p style={{ fontSize: 14, fontWeight: 500, color: '#202124', margin: 0 }}>Aan</p>
              <div ref={autocompleteRef} style={{ position: 'relative' }}>
                <OutlinedInput value={clientSearch} onChange={e => { setClientSearch(e.target.value); setClientName(e.target.value); setSelectedClientId(null); setShowDropdown(true); clearFieldError('clientName') }} onFocus={() => setShowDropdown(true)} placeholder="Zoek of typ klantnaam..." focusColor={cfg.focusColor} label="Bedrijfsnaam" required hasError={!!fieldErrors.clientName} />
                {showDropdown && filteredClients.length > 0 && (
                  <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, marginTop: 4, backgroundColor: 'white', border: '1px solid #E0E0E0', borderRadius: 12, boxShadow: '0 4px 12px rgba(0,0,0,0.12)', zIndex: 20, overflow: 'hidden' }}>
                    {filteredClients.map(c => (
                      <button key={c.id} onClick={() => selectClient(c)} style={{ width: '100%', textAlign: 'left', padding: '10px 16px', border: 'none', borderBottom: '1px solid #F1F3F4', backgroundColor: 'white', cursor: 'pointer', display: 'block' }} onMouseEnter={e => (e.currentTarget.style.backgroundColor = '#F8F9FA')} onMouseLeave={e => (e.currentTarget.style.backgroundColor = 'white')}>
                        <p style={{ fontSize: 14, fontWeight: 500, color: '#202124', margin: 0 }}>{c.name}</p>
                        {c.email && <p style={{ fontSize: 12, color: '#5F6368', margin: '2px 0 0' }}>{c.email}</p>}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <OutlinedInput value={clientEmail} onChange={e => { setClientEmail(e.target.value); clearFieldError('clientEmail') }} placeholder="klant@bedrijf.nl" label="E-mailadres" type="email" required focusColor={cfg.focusColor} hasError={!!fieldErrors.clientEmail} />
              <OutlinedInput value={clientAddress} onChange={e => { setClientAddress(e.target.value); clearFieldError('clientAddress') }} placeholder="Straatnaam 1" label="Adres" focusColor={cfg.focusColor} required={invoiceType === 'factuur' || invoiceType === 'creditnota'} hasError={!!fieldErrors.clientAddress} />
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                <OutlinedInput value={clientPostal} onChange={e => setClientPostal(e.target.value)} placeholder="1234 AB" label="Postcode" focusColor={cfg.focusColor} />
                <OutlinedInput value={clientCity} onChange={e => setClientCity(e.target.value)} placeholder="Amsterdam" label="Stad" focusColor={cfg.focusColor} />
              </div>
              <div>
                <OutlinedInput value={clientBtw} onChange={e => setClientBtw(e.target.value)} placeholder="NL123456789B01" label="BTW-nummer klant" focusColor={cfg.focusColor} hasError={(!!clientBtw.trim() && looksLikeDutchBtw(clientBtw) && !isValidDutchBtw(clientBtw)) || euVatSuspect} />
                {clientBtw.trim() && looksLikeDutchBtw(clientBtw) && !isValidDutchBtw(clientBtw) && (
                  <p style={{ fontSize: 11, color: M3.error, margin: '4px 0 0' }}>Verwacht formaat: NL123456789B01</p>
                )}
                {/* [ICP] Said while the number is still on screen and still fixable. */}
                {euVatSuspect && (
                  <p style={{ fontSize: 11, color: M3.error, margin: '4px 0 0' }}>
                    Deze lengte klopt niet voor dat EU-land — controleer via VIES. Het bepaalt de BTW-verlegging én de ICP-opgaaf.
                  </p>
                )}
                {euVatCustomer && (
                  <p style={{ fontSize: 11, color: '#5F6368', margin: '4px 0 0', lineHeight: 1.45 }}>
                    Klant in een ander EU-land. Bij een intracommunautaire prestatie zet je 0% BTW — &ldquo;Btw verlegd&rdquo;
                    komt dan automatisch op de factuur, en de klant komt in je ICP-opgaaf.
                  </p>
                )}
              </div>
            </div>

            {/* [DS] Datums card */}
            {/* [FACTUUR-A] Clean native date fields + Dutch DD-MM-YYYY caption
                under each (DateField). Vervaldatum gets quick payment-term chips. */}
            <div style={{ backgroundColor: 'white', borderRadius: 16, padding: 16, boxShadow: '0 1px 4px rgba(0,0,0,0.08)', display: 'flex', flexDirection: 'column', gap: 12 }}>
              <p style={{ fontSize: 14, fontWeight: 500, color: '#202124', margin: 0 }}>Datums</p>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                <DateField
                  value={invoiceDate}
                  label={invoiceType === 'offerte' ? 'Offertedatum' : 'Factuurdatum'}
                  required
                  focusColor={cfg.focusColor}
                  hasError={!!fieldErrors.invoiceDate}
                  onChange={iso => {
                    setInvoiceDate(iso)
                    clearFieldError('invoiceDate')
                    // [FACTUUR-A] If a payment term is active, recompute the
                    // Vervaldatum from the new factuurdatum.
                    if (betalingstermijn !== null && iso) {
                      setDueDate(addDaysISO(iso, betalingstermijn))
                      clearFieldError('dueDate')
                    }
                    // Keep an untouched leverdatum in sync.
                    if (!deliveryTouched) { setDeliveryDate(iso); clearFieldError('deliveryDate') }
                  }}
                />
                <DateField
                  value={dueDate}
                  label={invoiceType === 'offerte' ? 'Geldig tot' : 'Vervaldatum'}
                  required
                  focusColor={cfg.focusColor}
                  hasError={!!fieldErrors.dueDate}
                  min={invoiceDate || undefined}
                  onChange={iso => {
                    // Manual edit clears the active term chip.
                    setBetalingstermijn(null)
                    setDueDate(iso)
                    clearFieldError('dueDate')
                  }}
                />
              </div>

              {/* [FACTUUR-A] Payment-term chips — only for factuur/creditnota
                  (an offerte uses "Geldig tot", not a payment term). */}
              {invoiceType !== 'offerte' && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 12, color: '#70757a' }}>Betalingstermijn:</span>
                  {BETALINGSTERMIJNEN.map(days => {
                    const active = betalingstermijn === days
                    return (
                      <button
                        key={days}
                        type="button"
                        onClick={() => {
                          setBetalingstermijn(days)
                          if (invoiceDate) { setDueDate(addDaysISO(invoiceDate, days)); clearFieldError('dueDate') }
                        }}
                        style={{
                          fontSize: 13, fontWeight: 500,
                          padding: '6px 14px', borderRadius: 9999,
                          border: active ? `1px solid ${cfg.activeBorder}` : '1px solid #E0E0E0',
                          backgroundColor: active ? cfg.activeBg : 'white',
                          color: active ? cfg.activeColor : '#5F6368',
                          cursor: 'pointer', transition: 'all 0.1s ease',
                        }}
                      >
                        {days} dagen
                      </button>
                    )
                  })}
                  {betalingstermijn === null && (
                    <span style={{ fontSize: 12, color: '#70757a', fontStyle: 'italic' }}>Aangepast</span>
                  )}
                </div>
              )}

              {/* [FACTUUR-A] Leverdatum — Art. 35a sub f. Factuur only;
                  defaults to factuurdatum, editable. */}
              {invoiceType === 'factuur' && (
                <DateField
                  value={deliveryDate}
                  label="Leverdatum"
                  required
                  focusColor={cfg.focusColor}
                  hasError={!!fieldErrors.deliveryDate}
                  onChange={iso => { setDeliveryTouched(true); setDeliveryDate(iso); clearFieldError('deliveryDate') }}
                />
              )}
              {invoiceType === 'factuur' && (
                <p style={{ fontSize: 11, color: '#70757a', margin: '-4px 0 0' }}>
                  Leverdatum = datum waarop de levering of dienst is verricht.
                </p>
              )}
            </div>

            {/* [DS] Factuurregels card */}
            <div style={{ backgroundColor: 'white', borderRadius: 16, padding: 16, boxShadow: '0 1px 4px rgba(0,0,0,0.08)', display: 'flex', flexDirection: 'column', gap: 12 }}>
              <p style={{ fontSize: 14, fontWeight: 500, color: '#202124', margin: 0 }}>{invoiceType === 'offerte' ? 'Offerteregels' : 'Factuurregels'}</p>
              <p style={{ fontSize: 12, color: '#70757a', margin: '-4px 0 0' }}>Schrijf in uw eigen taal — druk op <strong>Vertaal</strong> voor professioneel Nederlands</p>

              {/* ── [PRIJS-MODUS] Typ je prijzen met of zonder btw? ────────────────────────────
                  Boven de regels, want het bepaalt wat elk prijsveld eronder BETEKENT. Wie all-in
                  werkt ("€ 50, klaar") hoefde tot nu toe eerst zelf € 50 / 1,21 uit te rekenen om
                  hier te kunnen typen. De keuze wordt onthouden voor de volgende factuur.
                  Wat er wordt opgeslagen verandert niet: de regel houdt de prijs ex-btw vast, en
                  dat is ook wat er op de factuur en in je aangifte komt te staan. */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', backgroundColor: '#F8F9FA', borderRadius: 10, padding: '8px 10px' }}>
                <span style={{ fontSize: 12.5, color: '#5F6368', fontWeight: 500 }}>Prijzen invoeren</span>
                <div role="group" aria-label="Prijzen invoeren inclusief of exclusief btw" style={{ display: 'flex', gap: 4, backgroundColor: '#E8EAED', borderRadius: 9999, padding: 3 }}>
                  {([
                    { id: 'excl' as PriceMode, label: 'excl. btw' },
                    { id: 'incl' as PriceMode, label: 'incl. btw' },
                  ]).map(opt => (
                    <button
                      key={opt.id}
                      type="button"
                      aria-pressed={priceMode === opt.id}
                      onClick={() => choosePriceMode(opt.id)}
                      style={{
                        border: 'none', borderRadius: 9999, padding: '6px 14px', cursor: 'pointer',
                        fontSize: 12.5, fontWeight: 600,
                        backgroundColor: priceMode === opt.id ? 'white' : 'transparent',
                        color: priceMode === opt.id ? '#202124' : '#5F6368',
                        boxShadow: priceMode === opt.id ? '0 1px 2px rgba(0,0,0,0.12)' : 'none',
                      }}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
                <span style={{ fontSize: 11.5, color: '#80868B', flex: 1, minWidth: 180 }}>
                  {priceMode === 'incl'
                    ? 'Je typt wat je klant betaalt; wij rekenen de btw eruit.'
                    : 'Je typt de prijs zonder btw; wij tellen de btw erbij.'}
                </span>
              </div>

              {lines.map((line, i) => {
                const sug = pickerLine === i ? matchArticles(catalog, line.description) : []
                return (
                <div key={i} style={{ backgroundColor: '#F8F9FA', borderRadius: 12, padding: 12, display: 'flex', flexDirection: 'column', gap: 8, position: 'relative' }}>
                  {lines.length > 1 && (
                    <button onClick={() => removeLine(i)} style={{ position: 'absolute', top: 8, right: 8, width: 24, height: 24, borderRadius: 9999, border: 'none', backgroundColor: 'transparent', color: '#70757a', cursor: 'pointer', fontSize: 16, display: 'flex', alignItems: 'center', justifyContent: 'center' }} onMouseEnter={e => (e.currentTarget.style.color = '#EA4335')} onMouseLeave={e => (e.currentTarget.style.color = '#70757a')}>×</button>
                  )}
                  <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
                    <div style={{ flex: 1, position: 'relative' }} onFocusCapture={() => setPickerLine(i)} onBlur={() => setTimeout(() => setPickerLine(cur => (cur === i ? null : cur)), 150)}>
                      <OutlinedInput value={line.description} onChange={e => { updateLine(i, 'description', e.target.value); setPickerLine(i); setFieldErrors(prev => { const l = [...(prev.lines ?? [])]; if (l[i]) l[i] = { ...l[i], description: false }; return { ...prev, lines: l } }) }} placeholder="Omschrijving of code (bijv. 22)" label="Omschrijving" focusColor={cfg.focusColor} hasError={!!fieldErrors.lines?.[i]?.description} />
                      {/* [ARTIKELEN] Catalog picker — fill the line from a saved article. */}
                      {sug.length > 0 && (
                        <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 30, background: '#fff', border: '1px solid #E0E0E0', borderRadius: 8, marginTop: 4, boxShadow: '0 4px 16px rgba(0,0,0,0.14)', maxHeight: 220, overflowY: 'auto' }}>
                          {sug.map(a => (
                            <button key={a.id} type="button" onMouseDown={e => { e.preventDefault(); pickArticle(i, a) }} style={{ display: 'flex', width: '100%', boxSizing: 'border-box', alignItems: 'center', gap: 8, padding: '9px 12px', border: 'none', borderBottom: '1px solid #F1F3F4', background: 'transparent', cursor: 'pointer', textAlign: 'left' }}>
                              {a.code && <span style={{ fontFamily: 'Roboto Mono, monospace', fontSize: 12, fontWeight: 700, color: '#1A73E8', background: '#D3E3FD', borderRadius: 6, padding: '2px 6px' }}>{a.code}</span>}
                              <span style={{ flex: 1, fontSize: 13.5, color: '#202124', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.description}</span>
                              <span style={{ fontSize: 12.5, color: '#5F6368', fontFamily: 'Roboto Mono, monospace', whiteSpace: 'nowrap' }}>{NL_NUMBER.format(a.unit_price)} · {a.btw_rate}%</span>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                    <button onClick={() => translateLine(i)} disabled={line.translating} style={{ flexShrink: 0, fontSize: 12, fontWeight: 500, padding: '10px 12px', borderRadius: 9999, border: 'none', backgroundColor: line.translating ? '#F1F3F4' : cfg.activeBg, color: line.translating ? '#9AA0A6' : cfg.activeColor, cursor: line.translating ? 'not-allowed' : 'pointer', whiteSpace: 'nowrap', marginBottom: 1 }}>
                      {line.translating ? '...' : 'Vertaal'}
                    </button>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
                    {/* [BOEK-031] LineInput: no leading zero, comma=dot, step=1, Enter→next — May 2026 */}
                    <LineInput label="Aantal" value={line.quantity} min={0.01} focusColor={cfg.focusColor} hasError={!!fieldErrors.lines?.[i]?.quantity} onChange={v => { updateLine(i, 'quantity', v); setFieldErrors(prev => { const l = [...(prev.lines ?? [])]; if (l[i]) l[i] = { ...l[i], quantity: false }; return { ...prev, lines: l } }) }} />
                    {/* [PRIJS-MODUS] Het veld toont — en accepteert — de prijs in de gekozen stand.
                        De regel bewaart altijd ex-btw; priceFieldValue/priceFieldToStored zijn de
                        enige twee plekken waar dat verschil bestaat. */}
                    <LineInput label={priceMode === 'incl' ? 'Prijs incl. (€)' : 'Prijs excl. (€)'} value={priceFieldValue(line.unit_price, line.btw_rate, priceMode)} min={0} focusColor={cfg.focusColor} hasError={!!fieldErrors.lines?.[i]?.unit_price} onChange={v => { updateLinePrice(i, v); setFieldErrors(prev => { const l = [...(prev.lines ?? [])]; if (l[i]) l[i] = { ...l[i], unit_price: false }; return { ...prev, lines: l } }) }} />
                    <div>
                      <label style={{ fontSize: 12, fontWeight: 500, color: '#5F6368', display: 'block', marginBottom: 4 }}>BTW %</label>
                      <select value={line.vat_treatment === 'exempt' ? EXEMPT_OPTION : line.btw_rate} onChange={e => { const v = parseFloat(e.target.value); if (v === EXEMPT_OPTION) markLineExempt(i); else updateLineRate(i, v) }} style={{ width: '100%', minHeight: 44, border: '1px solid #E0E0E0', borderRadius: 8, padding: '0 12px', fontSize: 16, backgroundColor: 'white', outline: 'none', boxSizing: 'border-box', appearance: 'none', cursor: 'pointer' }} onFocus={e => { e.currentTarget.style.borderColor = cfg.focusColor; e.currentTarget.style.borderWidth = '2px' }} onBlur={e => { e.currentTarget.style.borderColor = '#E0E0E0'; e.currentTarget.style.borderWidth = '1px' }}>
                        <option value={21}>21%</option>
                        <option value={9}>9%</option>
                        <option value={0}>0%</option>
                        {/* [VRIJGESTELD] Alleen zichtbaar als de ondernemer vrijgestelde omzet
                            heeft verklaard (Instellingen). Voor iedereen anders is deze keuze
                            geen optie maar een valkuil: vrijgesteld ziet eruit als 0%, en een
                            gewone dienst die per ongeluk zo wordt geboekt verdwijnt uit de
                            aangifte én kost de aftrek op de bijbehorende kosten. */}
                        {profile?.vat_exempt_activity && <option value={EXEMPT_OPTION}>Vrijgesteld</option>}
                      </select>
                    </div>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 12, color: '#70757a' }}>
                    {line.description.trim()
                      ? <button type="button" onClick={() => saveLineToCatalog(i, line)} style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontSize: 12, color: savedToCatalog === i ? '#137333' : '#1A73E8', fontWeight: 500 }}>{savedToCatalog === i ? '✓ In catalogus' : '+ Bewaar in catalogus'}</button>
                      : <span>{priceMode === 'incl' ? 'Totaal incl.' : 'Totaal excl.'}</span>}
                    {/* [PRIJS-MODUS] Het regeltotaal in dezelfde stand als het veld erboven: een rij
                        die "10,00" in het prijsveld toont en "8,26" als totaal bij aantal 1, leest
                        als een rekenfout. In incl-modus staat de ex-prijs er klein onder, want dát
                        is wat er straks op de factuur en in de aangifte komt te staan. */}
                    <span style={{ fontWeight: 600, color: '#202124', fontFamily: 'Roboto Mono, monospace' }}>
                      {NL_NUMBER.format(toDisplayCents(
                        priceMode === 'incl'
                          ? line.quantity * line.unit_price * (1 + line.btw_rate / 100)
                          : line.quantity * line.unit_price,
                      ))}
                      {priceMode === 'incl' && (
                        <span style={{ fontWeight: 400, color: '#80868B', fontSize: 11.5, marginInlineStart: 6 }}>
                          ({NL_NUMBER.format(toDisplayCents(line.quantity * line.unit_price))} excl.)
                        </span>
                      )}
                    </span>
                  </div>
                </div>
              )})}

              <button onClick={addLine} style={{ alignSelf: 'flex-start', fontSize: 14, fontWeight: 500, color: '#1A73E8', background: 'none', border: 'none', cursor: 'pointer', padding: '4px 0' }}>
                + Regel toevoegen
              </button>
            </div>

            {/* [DS] Totalen */}
            <div style={{ backgroundColor: 'white', borderRadius: 16, padding: 16, boxShadow: '0 1px 4px rgba(0,0,0,0.08)' }}>
              <div style={{ maxWidth: 280, marginLeft: 'auto', display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14, color: '#5F6368' }}>
                  <span>Subtotaal excl. BTW</span>
                  <span style={{ fontFamily: 'Roboto Mono, monospace' }}>{NL_NUMBER.format(sign * totalEx)}</span>
                </div>
                {Object.entries(btwByRate).filter(([, v]) => v > 0).map(([rate, val]) => (
                  <div key={rate} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14, color: '#5F6368' }}>
                    <span>BTW {rate}%</span>
                    <span style={{ fontFamily: 'Roboto Mono, monospace' }}>{NL_NUMBER.format(sign * val)}</span>
                  </div>
                ))}
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 16, fontWeight: 700, color: sign === -1 ? '#B3261E' : '#202124', paddingTop: 8, borderTop: '1px solid #F1F3F4' }}>
                  <span>Totaal incl. BTW</span>
                  <span style={{ fontFamily: 'Roboto Mono, monospace' }}>{NL_NUMBER.format(sign * totalInc)}</span>
                </div>
              </div>
            </div>

            {/* [DS] Betalingsinformatie */}
            {profile?.iban && invoiceType !== ('creditnota' as InvoiceType) && (
              <div style={{ backgroundColor: 'white', borderRadius: 16, padding: 16, boxShadow: '0 1px 4px rgba(0,0,0,0.08)' }}>
                <p style={{ fontSize: 14, fontWeight: 500, color: '#202124', margin: '0 0 12px' }}>Betalingsinformatie</p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {([['Op naam van', profile.company_name || profile.full_name], ['IBAN', profile.iban], ['Vervaldatum', new Intl.DateTimeFormat('nl-NL', { timeZone: 'Europe/Amsterdam' }).format(new Date(dueDate || today))], ...(invoiceNumber ? [['Betalingskenmerk', invoiceNumber]] : [])] as [string,string][]).map(([label, value]) => (
                    <div key={label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontSize: 14, color: '#5F6368', lineHeight: 1.8 }}>{label}</span>
                      <span style={{ fontSize: label === 'IBAN' ? 13 : 14, fontWeight: 500, color: '#202124', fontFamily: label === 'IBAN' ? 'Roboto Mono, monospace' : 'inherit', maxWidth: '55%', textAlign: 'right' }}>{value}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {error && (
              <div style={{ backgroundColor: '#F9DEDC', borderLeft: '4px solid #EA4335', borderRadius: '0 12px 12px 0', padding: '12px 16px' }}>
                <p style={{ fontSize: 14, color: '#B3261E', margin: 0 }}>{error}</p>
              </div>
            )}

            {/* [DS] Fixed bottom bar — safe area — full-width pill — 48px min */}
            <div style={{ position: 'fixed', bottom: 0, left: 0, right: 0, backgroundColor: 'rgba(255,255,255,0.92)', backdropFilter: 'blur(20px)', borderTop: '1px solid rgba(0,0,0,0.06)', padding: '12px 16px', paddingBottom: 'calc(12px + var(--bottom-nav-h) + env(safe-area-inset-bottom))', zIndex: 10 }}>
              {/* [BAR-ALIGN] The bar centred its content at the column's OUTER
                  width while the form spends 16px of that on its gutters, so the
                  send button sat one gutter wider than every field above it. */}
              <div style={{ maxWidth: columnInner(COLUMN.work), margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 8 }}>
                <button onClick={() => {
                  // [FACTUUR-A] Factuur send is irreversible (number consumed
                  // + e-mail with PDF delivered) → confirm first. Offerte and
                  // creditnota keep their existing direct flow.
                  if (invoiceType === 'factuur') {
                    setShowSendConfirm(true)
                  } else {
                    handleSubmit('sent')
                  }
                }} disabled={loading || linesLoading} style={{ width: '100%', minHeight: 48, borderRadius: 9999, border: 'none', backgroundColor: loading || linesLoading ? '#9AA0A6' : cfg.primaryBtn, color: 'white', fontSize: 16, fontWeight: 600, cursor: loading || linesLoading ? 'not-allowed' : 'pointer', transition: 'all 0.15s cubic-bezier(0.4,0,0.2,1)' }}>
                  {linesLoading ? 'Laden...' : loading ? 'Bezig...' : invoiceType === 'factuur' ? '✉ Opslaan en versturen' : invoiceType === 'offerte' ? '📋 Offerte opslaan' : '↩ Versturen'}
                </button>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button onClick={() => handleSubmit('draft')} disabled={loading} style={{ flex: 1, minHeight: 48, borderRadius: 9999, border: 'none', backgroundColor: cfg.activeBg, color: cfg.activeColor, fontSize: 14, fontWeight: 500, cursor: loading ? 'not-allowed' : 'pointer', transition: 'all 0.15s cubic-bezier(0.4,0,0.2,1)' }}>
                    {invoiceType === 'factuur' ? 'Opslaan als concept' : 'Opslaan'}
                  </button>
                  {/* [BOEK-031] Annuleren — Link to parent — Navigation Strategy — May 2026 */}
                  <Link href={parentHref}
                    style={{ minHeight: 48, padding: '0 20px', borderRadius: 9999, border: 'none', backgroundColor: 'transparent', color: '#5F6368', fontSize: 14, fontWeight: 500, cursor: 'pointer', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
                    Annuleren
                  </Link>
                </div>
              </div>
            </div>
          </>
      </div>

      {/* [FACTUUR-A] Send confirmation — centered modal (house convention) */}
      {showSendConfirm && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 16px', backgroundColor: 'rgba(0,0,0,0.4)' }}>
          <div style={{ backgroundColor: 'white', borderRadius: 24, padding: 24, width: '100%', maxWidth: 420, boxShadow: '0 4px 24px rgba(0,0,0,0.2)', display: 'flex', flexDirection: 'column', gap: 16 }}>
            <h2 style={{ fontSize: 18, fontWeight: 700, color: '#202124', margin: 0 }}>Factuur versturen?</h2>
            <p style={{ fontSize: 14, color: '#5F6368', lineHeight: 1.6, margin: 0 }}>
              Bij verzenden krijgt de factuur een <strong>definitief nummer</strong> en wordt de PDF per e-mail bezorgd. Dit kan niet ongedaan worden gemaakt.
            </p>
            <div style={{ backgroundColor: '#F8F9FA', borderRadius: 12, padding: 12, display: 'flex', flexDirection: 'column', gap: 6 }}>
              {([
                ['Aan', clientName || '—'],
                ['E-mail', clientEmail || '—'],
                ['Bedrag', NL_NUMBER.format(totalInc)],
                ['Factuurdatum', formatDateNL(invoiceDate)],
                ['Vervaldatum', formatDateNL(dueDate)],
              ] as [string, string][]).map(([label, value]) => (
                <div key={label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
                  <span style={{ fontSize: 13, color: '#5F6368' }}>{label}</span>
                  <span style={{ fontSize: 13, fontWeight: 600, color: '#202124', textAlign: 'right', maxWidth: '60%', wordBreak: 'break-word' }}>{value}</span>
                </div>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={() => { setShowSendConfirm(false); handleSubmit('sent') }} disabled={loading}
                style={{ flex: 1, minHeight: 48, borderRadius: 9999, border: 'none', backgroundColor: loading ? '#70757a' : '#1A73E8', color: 'white', fontSize: 16, fontWeight: 600, cursor: loading ? 'not-allowed' : 'pointer' }}>
                {loading ? 'Versturen...' : '✉ Ja, verstuur'}
              </button>
              <button onClick={() => setShowSendConfirm(false)} disabled={loading}
                style={{ flex: 1, minHeight: 48, borderRadius: 9999, border: 'none', backgroundColor: '#F1F3F4', color: '#5F6368', fontSize: 14, fontWeight: 500, cursor: loading ? 'not-allowed' : 'pointer' }}>
                Annuleren
              </button>
            </div>
          </div>
        </div>
      )}

      {/* [DS] Offerte → Factuur convert dialog */}
      {showConvertDialog && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 50, display: 'flex', alignItems: 'flex-end', justifyContent: 'center', padding: '0 16px 24px', paddingBottom: sheetPaddingBottom(24), backgroundColor: 'rgba(0,0,0,0.4)' }}>
          <div style={{ backgroundColor: 'white', borderRadius: 24, padding: 24, width: '100%', maxWidth: 480, boxShadow: '0 4px 24px rgba(0,0,0,0.2)', display: 'flex', flexDirection: 'column', gap: 16 }}>
            <h2 style={{ fontSize: 18, fontWeight: 700, color: '#202124', margin: 0 }}>Omzetten naar factuur</h2>
            <p style={{ fontSize: 14, color: '#5F6368', lineHeight: 1.6, margin: 0 }}>
              Controleer de gegevens voor het aanmaken van de factuur. Een nieuw factuurnummer wordt automatisch toegewezen. De offerte wordt gearchiveerd.
            </p>
            <p style={{ fontSize: 14, fontWeight: 600, color: '#202124', margin: 0 }}>Weet u het zeker?</p>
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={handleConvertOfferte} disabled={convertingOfferte}
                style={{ flex: 1, minHeight: 48, borderRadius: 9999, border: 'none', backgroundColor: '#1A73E8', color: 'white', fontSize: 16, fontWeight: 600, cursor: convertingOfferte ? 'not-allowed' : 'pointer' }}>
                {convertingOfferte ? 'Bezig...' : 'Ja, maak factuur aan'}
              </button>
              <button onClick={() => setShowConvertDialog(false)}
                style={{ flex: 1, minHeight: 48, borderRadius: 9999, border: 'none', backgroundColor: '#F1F3F4', color: '#5F6368', fontSize: 14, fontWeight: 500, cursor: 'pointer' }}>
                Annuleren
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  )
}

export default function NewInvoicePage() {
  return (
    <Suspense>
      <NewInvoicePageContent />
    </Suspense>
  )
}