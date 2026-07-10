'use client'

// src/app/factuur-maken/page.tsx
// [GRATIS-FACTUUR] Standalone public invoice generator — July 2026
// =====================================================
// A carved-out, login-free MVP of the create-invoice flow: fill the form →
// live preview → download a legal-layout PDF. No Supabase, no auth, no DB.
//   * Reuses <InvoicePDF> (lib/invoice-pdf) and lib/format-nl verbatim — the
//     same document customers get from the full app, so nothing to maintain
//     twice.
//   * invoice_number is a plain editable field here (the atomic legal
//     numbering lives server-side in the full product, not in a free tool).
//   * Sender details persist in localStorage so a returning user never
//     re-types their own company block. Nothing leaves the browser.
// This page is added to middleware PUBLIC_PATHS so it is reachable logged-out.
// =====================================================

import React, { useEffect, useMemo, useRef, useState } from 'react'
import dynamic from 'next/dynamic'
import { InvoicePDF } from '@/lib/invoice-pdf'
import { formatEuroNL } from '@/lib/format-nl'

// react-pdf touches browser APIs — load the link client-side only (same
// pattern as dashboard/invoice/[id]).
const PDFDownloadLink = dynamic(
  () => import('@react-pdf/renderer').then((mod) => mod.PDFDownloadLink),
  { ssr: false }
)

// ─── Types ───────────────────────────────────────────────────────────────────
type InvoiceType = 'factuur' | 'creditnota' | 'offerte' | 'pro_forma'

type Sender = {
  company_name: string
  full_name: string
  address: string
  postal_code: string
  city: string
  kvk_number: string
  btw_number: string
  iban: string
  email: string
}

type Client = {
  client_name: string
  client_address: string
  client_postal_code: string
  client_city: string
  client_btw_number: string
  client_email: string
}

type Line = {
  description: string
  quantity: string
  unit_price: string
  btw_rate: number
}

// ─── Constants ───────────────────────────────────────────────────────────────
const SENDER_KEY = 'boekbrug.gratis-factuur.sender'
// Last invoice number the user actually downloaded — the seed for the next one.
const NR_KEY = 'boekbrug.gratis-factuur.lastnr'

const DOC_LABELS: Record<InvoiceType, string> = {
  factuur: 'Factuur',
  creditnota: 'Creditnota',
  offerte: 'Offerte',
  pro_forma: 'Pro forma',
}

const NL_BTW_RE = /^NL\d{9}B\d{2}$/i

// Round to whole cents (half-up, EPSILON-guarded against float noise).
function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100
}

// Timezone-proof today (Europe/Amsterdam) as ISO yyyy-mm-dd, no Date math traps.
function todayISO(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Amsterdam',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())
}

function addDaysISO(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d))
  dt.setUTCDate(dt.getUTCDate() + days)
  return dt.toISOString().slice(0, 10)
}

// ─── Invoice numbering: YEAR + zero-padded sequence, e.g. 20260327 (#327) ────
const currentYear = () => todayISO().slice(0, 4)
function firstNumberOfYear(year: string): string {
  return `${year}0001`
}
// Increment the trailing counter of a "YYYY####" number, keeping its width.
// A non-standard number (manually edited to something else) is left untouched.
function nextInvoiceNumber(n: string): string {
  const m = /^(\d{4})(\d+)$/.exec(n.trim())
  if (!m) return n
  const seq = String(Number(m[2]) + 1).padStart(m[2].length, '0')
  return m[1] + seq
}
// What to suggest on load, given the last DOWNLOADED number: the next in
// sequence within the same year, else a fresh 0001 when the year rolled over.
function suggestFromLast(last: string | null, year: string): string {
  const m = last ? /^(\d{4})(\d+)$/.exec(last.trim()) : null
  if (m && m[1] === year) return nextInvoiceNumber(last as string)
  return firstNumberOfYear(year)
}

function emptySender(): Sender {
  return {
    company_name: '',
    full_name: '',
    address: '',
    postal_code: '',
    city: '',
    kvk_number: '',
    btw_number: '',
    iban: '',
    email: '',
  }
}

function emptyClient(): Client {
  return {
    client_name: '',
    client_address: '',
    client_postal_code: '',
    client_city: '',
    client_btw_number: '',
    client_email: '',
  }
}

function emptyLine(): Line {
  return { description: '', quantity: '1', unit_price: '', btw_rate: 21 }
}

// ─── Styles ──────────────────────────────────────────────────────────────────
const s = {
  page: {
    minHeight: '100vh',
    backgroundColor: '#f2f2f7',
    color: '#1c1c1e',
    fontFamily: 'var(--font-sans), -apple-system, system-ui, sans-serif',
  } as React.CSSProperties,
  wrap: {
    maxWidth: 900,
    margin: '0 auto',
    padding: '24px 16px 64px',
  } as React.CSSProperties,
  h1: { fontSize: 28, fontWeight: 700, margin: '0 0 4px' } as React.CSSProperties,
  sub: { fontSize: 14, color: '#6b6b6e', margin: '0 0 24px' } as React.CSSProperties,
  card: {
    backgroundColor: '#ffffff',
    borderRadius: 16,
    padding: 20,
    marginBottom: 16,
    boxShadow: '0 1px 2px rgba(0,0,0,0.04)',
  } as React.CSSProperties,
  cardTitle: {
    fontSize: 13,
    fontWeight: 700,
    textTransform: 'uppercase',
    letterSpacing: 1,
    color: '#aeaeb2',
    margin: '0 0 14px',
  } as React.CSSProperties,
  grid2: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 } as React.CSSProperties,
  field: { display: 'flex', flexDirection: 'column', gap: 4 } as React.CSSProperties,
  label: { fontSize: 12, color: '#6b6b6e', fontWeight: 500 } as React.CSSProperties,
  input: {
    fontSize: 15,
    padding: '10px 12px',
    borderRadius: 10,
    border: '1px solid #e5e5ea',
    backgroundColor: '#f9f9fb',
    outline: 'none',
    width: '100%',
    boxSizing: 'border-box',
    fontFamily: 'inherit',
  } as React.CSSProperties,
  btnPrimary: {
    backgroundColor: '#007aff',
    color: '#fff',
    fontSize: 15,
    fontWeight: 600,
    padding: '14px 24px',
    borderRadius: 9999,
    border: 'none',
    cursor: 'pointer',
    textDecoration: 'none',
    display: 'inline-block',
  } as React.CSSProperties,
  btnGhost: {
    backgroundColor: 'transparent',
    color: '#007aff',
    fontSize: 14,
    fontWeight: 600,
    padding: '8px 12px',
    borderRadius: 9999,
    border: '1px solid #007aff',
    cursor: 'pointer',
  } as React.CSSProperties,
  lineRow: {
    display: 'grid',
    gridTemplateColumns: '1fr 70px 100px 90px 90px 32px',
    gap: 8,
    alignItems: 'center',
    marginBottom: 8,
  } as React.CSSProperties,
  totalRow: {
    display: 'flex',
    justifyContent: 'space-between',
    fontSize: 14,
    padding: '4px 0',
  } as React.CSSProperties,
}

// ─── Component ───────────────────────────────────────────────────────────────
export default function GratisFactuurPage() {
  const [hydrated, setHydrated] = useState(false)
  const [invoiceType, setInvoiceType] = useState<InvoiceType>('factuur')
  // Date/number defaults are deterministic (pinned to Europe/Amsterdam), so a
  // lazy initializer yields the SAME value on server and client — no effect,
  // no hydration mismatch.
  // Default number = YEAR + 0001 (e.g. 20260001). The mount effect overrides
  // this with the next number in sequence once localStorage is available.
  const [invoiceNumber, setInvoiceNumber] = useState(() => firstNumberOfYear(currentYear()))
  const [invoiceDate, setInvoiceDate] = useState(todayISO)
  const [dueDate, setDueDate] = useState(() => addDaysISO(todayISO(), 14))
  const [deliveryDate, setDeliveryDate] = useState('')
  const [sender, setSender] = useState<Sender>(emptySender())
  const [client, setClient] = useState<Client>(emptyClient())
  const [lines, setLines] = useState<Line[]>([emptyLine()])
  // Mirrors the PDF link's loading flag so handleDownload can ignore early clicks.
  const pdfLoadingRef = useRef(false)

  // localStorage is client-only, so the saved sender is read AFTER mount (a
  // genuine external-store sync). Starting empty on both server and first
  // client render keeps hydration clean; the effect then fills it in.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(SENDER_KEY)
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (raw) setSender({ ...emptySender(), ...JSON.parse(raw) })
    } catch {
      /* ignore corrupt storage */
    }
    try {
      // Suggest the number that follows the last one the user downloaded.
      setInvoiceNumber(suggestFromLast(localStorage.getItem(NR_KEY), currentYear()))
    } catch {
      /* ignore corrupt storage */
    }
    setHydrated(true)
  }, [])

  // Persist sender as the user types (debounce-free; the payload is tiny).
  useEffect(() => {
    if (!hydrated) return
    try {
      localStorage.setItem(SENDER_KEY, JSON.stringify(sender))
    } catch {
      /* storage may be full/blocked — non-fatal */
    }
  }, [sender, hydrated])

  const sign = invoiceType === 'creditnota' ? -1 : 1

  // Derived numeric lines (empty/NaN treated as 0) + running totals.
  // line_total is rounded to whole cents so the amounts printed per line sum
  // EXACTLY to the subtotal shown below — a legal invoice must be internally
  // consistent (no visible 1-cent drift between the lines and the subtotal).
  const numericLines = useMemo(
    () =>
      lines.map((l) => {
        const qty = parseFloat(l.quantity.replace(',', '.')) || 0
        const price = parseFloat(l.unit_price.replace(',', '.')) || 0
        return {
          description: l.description,
          quantity: qty,
          unit_price: price * sign,
          btw_rate: l.btw_rate,
          line_total: round2(qty * price * sign),
        }
      }),
    [lines, sign]
  )

  const totals = useMemo(() => {
    // Belastingdienst rule: VAT is computed per rate on the summed base and
    // rounded ONCE per rate — not per line — then those are added. This keeps
    // subtotal, BTW and total mutually consistent for both single- and
    // mixed-rate invoices (and matches InvoicePDF's own per-rate breakdown).
    const baseByRate = new Map<number, number>()
    for (const l of numericLines) {
      baseByRate.set(l.btw_rate, (baseByRate.get(l.btw_rate) ?? 0) + l.line_total)
    }
    const ex = round2([...baseByRate.values()].reduce((a, v) => a + v, 0))
    const btw = round2(
      [...baseByRate.entries()].reduce((a, [rate, base]) => a + round2((base * rate) / 100), 0)
    )
    return { ex, btw, inc: round2(ex + btw) }
  }, [numericLines])

  // Shapes InvoicePDF expects — identical to the full app's DB rows.
  const invoice = {
    invoice_type: invoiceType,
    invoice_number: invoiceNumber || 'CONCEPT',
    invoice_date: invoiceDate,
    due_date: dueDate,
    // Leverdatum is factuureis #6 — always print one. If the user leaves it
    // empty we default it to the invoice date (the common case) so the
    // requirement is met without them having to think about it.
    delivery_date: deliveryDate || invoiceDate || null,
    client_name: client.client_name,
    client_address: client.client_address,
    client_postal_code: client.client_postal_code,
    client_city: client.client_city,
    client_btw_number: client.client_btw_number,
    client_email: client.client_email,
    total_ex_btw: totals.ex,
    btw_amount: totals.btw,
    total_inc_btw: totals.inc,
  }

  const btwWarn =
    sender.btw_number.trim() !== '' && !NL_BTW_RE.test(sender.btw_number.replace(/\s/g, '')) &&
    /^NL/i.test(sender.btw_number.trim())

  const canDownload =
    (sender.company_name.trim() || sender.full_name.trim()) &&
    client.client_name.trim() &&
    numericLines.some((l) => l.line_total !== 0)

  const setS = (k: keyof Sender) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setSender((p) => ({ ...p, [k]: e.target.value }))
  const setC = (k: keyof Client) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setClient((p) => ({ ...p, [k]: e.target.value }))

  function updateLine(i: number, patch: Partial<Line>) {
    setLines((p) => p.map((l, idx) => (idx === i ? { ...l, ...patch } : l)))
  }
  function addLine() {
    setLines((p) => [...p, emptyLine()])
  }
  function removeLine(i: number) {
    setLines((p) => (p.length === 1 ? p : p.filter((_, idx) => idx !== i)))
  }

  // On download: remember the number just used, then advance the field to the
  // next one so the following invoice is pre-numbered without any user effort.
  function handleDownload() {
    // Ignore clicks while the PDF is still rendering — the browser has nothing
    // to download yet, so advancing would skip a number.
    if (pdfLoadingRef.current) return
    try {
      localStorage.setItem(NR_KEY, invoiceNumber)
    } catch {
      /* storage blocked — the advance below still works for this session */
    }
    setInvoiceNumber((n) => nextInvoiceNumber(n))
  }

  const fileName = `${invoiceNumber || 'concept'}.pdf`

  return (
    <div style={s.page}>
      <div style={s.wrap}>
        <h1 style={s.h1}>Gratis factuur maken</h1>
        <p style={s.sub}>
          Vul in, download je PDF. Geen account nodig — je gegevens blijven in je browser.
        </p>

        {/* ── Documentgegevens ── */}
        <div style={s.card}>
          <p style={s.cardTitle}>Document</p>
          <div style={s.grid2}>
            <div style={s.field}>
              <label style={s.label}>Type</label>
              <select
                style={s.input as React.CSSProperties}
                value={invoiceType}
                onChange={(e) => setInvoiceType(e.target.value as InvoiceType)}
              >
                {(Object.keys(DOC_LABELS) as InvoiceType[]).map((t) => (
                  <option key={t} value={t}>
                    {DOC_LABELS[t]}
                  </option>
                ))}
              </select>
            </div>
            <div style={s.field}>
              <label style={s.label}>Nummer</label>
              <input
                style={s.input}
                value={invoiceNumber}
                onChange={(e) => setInvoiceNumber(e.target.value)}
                placeholder="20260001"
              />
            </div>
            <div style={s.field}>
              <label style={s.label}>Factuurdatum</label>
              <input
                type="date"
                style={s.input}
                value={invoiceDate}
                onChange={(e) => setInvoiceDate(e.target.value)}
              />
            </div>
            <div style={s.field}>
              <label style={s.label}>Vervaldatum</label>
              <input
                type="date"
                style={s.input}
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
              />
            </div>
            <div style={s.field}>
              <label style={s.label}>Leverdatum (standaard = factuurdatum)</label>
              <input
                type="date"
                style={s.input}
                value={deliveryDate}
                onChange={(e) => setDeliveryDate(e.target.value)}
              />
            </div>
          </div>
        </div>

        {/* ── Afzender ── */}
        <div style={s.card}>
          <p style={s.cardTitle}>Jouw gegevens (afzender)</p>
          <div style={s.grid2}>
            <div style={s.field}>
              <label style={s.label}>Bedrijfsnaam</label>
              <input style={s.input} value={sender.company_name} onChange={setS('company_name')} />
            </div>
            <div style={s.field}>
              <label style={s.label}>Naam</label>
              <input style={s.input} value={sender.full_name} onChange={setS('full_name')} />
            </div>
            <div style={s.field}>
              <label style={s.label}>Adres</label>
              <input style={s.input} value={sender.address} onChange={setS('address')} />
            </div>
            <div style={s.field}>
              <label style={s.label}>Postcode + plaats</label>
              <div style={{ display: 'flex', gap: 8 }}>
                <input
                  style={{ ...s.input, width: 110 }}
                  value={sender.postal_code}
                  onChange={setS('postal_code')}
                  placeholder="1234 AB"
                />
                <input style={s.input} value={sender.city} onChange={setS('city')} placeholder="Plaats" />
              </div>
            </div>
            <div style={s.field}>
              <label style={s.label}>KVK-nummer</label>
              <input style={s.input} value={sender.kvk_number} onChange={setS('kvk_number')} />
            </div>
            <div style={s.field}>
              <label style={s.label}>BTW-nummer</label>
              <input
                style={{ ...s.input, borderColor: btwWarn ? '#ff9500' : '#e5e5ea' }}
                value={sender.btw_number}
                onChange={setS('btw_number')}
                placeholder="NL123456789B01"
              />
              {btwWarn && (
                <span style={{ fontSize: 11, color: '#ff9500' }}>
                  Ziet er niet uit als een geldig NL BTW-id (NL + 9 cijfers + B + 2).
                </span>
              )}
            </div>
            <div style={s.field}>
              <label style={s.label}>IBAN</label>
              <input style={s.input} value={sender.iban} onChange={setS('iban')} />
            </div>
            <div style={s.field}>
              <label style={s.label}>E-mail</label>
              <input style={s.input} value={sender.email} onChange={setS('email')} />
            </div>
          </div>
        </div>

        {/* ── Klant ── */}
        <div style={s.card}>
          <p style={s.cardTitle}>Klant (ontvanger)</p>
          <div style={s.grid2}>
            <div style={s.field}>
              <label style={s.label}>Naam / bedrijf</label>
              <input style={s.input} value={client.client_name} onChange={setC('client_name')} />
            </div>
            <div style={s.field}>
              <label style={s.label}>E-mail</label>
              <input style={s.input} value={client.client_email} onChange={setC('client_email')} />
            </div>
            <div style={s.field}>
              <label style={s.label}>Adres</label>
              <input style={s.input} value={client.client_address} onChange={setC('client_address')} />
            </div>
            <div style={s.field}>
              <label style={s.label}>Postcode + plaats</label>
              <div style={{ display: 'flex', gap: 8 }}>
                <input
                  style={{ ...s.input, width: 110 }}
                  value={client.client_postal_code}
                  onChange={setC('client_postal_code')}
                  placeholder="1234 AB"
                />
                <input
                  style={s.input}
                  value={client.client_city}
                  onChange={setC('client_city')}
                  placeholder="Plaats"
                />
              </div>
            </div>
            <div style={s.field}>
              <label style={s.label}>BTW-nummer (optioneel)</label>
              <input style={s.input} value={client.client_btw_number} onChange={setC('client_btw_number')} />
            </div>
          </div>
        </div>

        {/* ── Regels ── */}
        <div style={s.card}>
          <p style={s.cardTitle}>Regels</p>
          <div style={{ ...s.lineRow, marginBottom: 6 }}>
            <span style={s.label}>Omschrijving</span>
            <span style={{ ...s.label, textAlign: 'center' }}>Aantal</span>
            <span style={{ ...s.label, textAlign: 'right' }}>Prijs</span>
            <span style={{ ...s.label, textAlign: 'center' }}>BTW</span>
            <span style={{ ...s.label, textAlign: 'right' }}>Totaal</span>
            <span />
          </div>
          {lines.map((l, i) => {
            const qty = parseFloat(l.quantity.replace(',', '.')) || 0
            const price = parseFloat(l.unit_price.replace(',', '.')) || 0
            return (
              <div key={i} style={s.lineRow}>
                <input
                  style={s.input}
                  value={l.description}
                  onChange={(e) => updateLine(i, { description: e.target.value })}
                  placeholder="Omschrijving"
                />
                <input
                  style={{ ...s.input, textAlign: 'center' }}
                  value={l.quantity}
                  onChange={(e) => updateLine(i, { quantity: e.target.value })}
                  inputMode="decimal"
                />
                <input
                  style={{ ...s.input, textAlign: 'right' }}
                  value={l.unit_price}
                  onChange={(e) => updateLine(i, { unit_price: e.target.value })}
                  inputMode="decimal"
                  placeholder="0,00"
                />
                <select
                  style={{ ...s.input, padding: '10px 4px' }}
                  value={l.btw_rate}
                  onChange={(e) => updateLine(i, { btw_rate: Number(e.target.value) })}
                >
                  <option value={21}>21%</option>
                  <option value={9}>9%</option>
                  <option value={0}>0%</option>
                </select>
                <span style={{ textAlign: 'right', fontSize: 14 }}>
                  {formatEuroNL(qty * price * sign)}
                </span>
                <button
                  onClick={() => removeLine(i)}
                  aria-label="Verwijder regel"
                  style={{
                    background: 'none',
                    border: 'none',
                    color: '#ff3b30',
                    fontSize: 20,
                    cursor: 'pointer',
                    opacity: lines.length === 1 ? 0.3 : 1,
                  }}
                >
                  ×
                </button>
              </div>
            )
          })}
          <button onClick={addLine} style={{ ...s.btnGhost, marginTop: 8 }}>
            + Regel toevoegen
          </button>

          <div style={{ marginTop: 20, borderTop: '1px solid #e5e5ea', paddingTop: 12 }}>
            <div style={s.totalRow}>
              <span style={{ color: '#6b6b6e' }}>Subtotaal excl. BTW</span>
              <span>{formatEuroNL(totals.ex)}</span>
            </div>
            <div style={s.totalRow}>
              <span style={{ color: '#6b6b6e' }}>BTW</span>
              <span>{formatEuroNL(totals.btw)}</span>
            </div>
            <div style={{ ...s.totalRow, fontWeight: 700, fontSize: 16 }}>
              <span>Totaal incl. BTW</span>
              <span>{formatEuroNL(totals.inc)}</span>
            </div>
          </div>
        </div>

        {/* ── Download ── */}
        <div style={{ display: 'flex', justifyContent: 'center', marginTop: 24 }}>
          {hydrated && canDownload ? (
            <PDFDownloadLink
              document={<InvoicePDF invoice={invoice} lines={numericLines} profile={sender} />}
              fileName={fileName}
              style={s.btnPrimary}
              onClick={handleDownload}
            >
              {({ loading }: { loading: boolean }) => {
                pdfLoadingRef.current = loading
                return loading ? 'PDF wordt gemaakt…' : '↓ Download PDF'
              }}
            </PDFDownloadLink>
          ) : (
            <button style={{ ...s.btnPrimary, opacity: 0.4, cursor: 'not-allowed' }} disabled>
              ↓ Download PDF
            </button>
          )}
        </div>
        {!canDownload && (
          <p style={{ textAlign: 'center', fontSize: 12, color: '#aeaeb2', marginTop: 8 }}>
            Vul je naam, de klant en minstens één regel in.
          </p>
        )}

        <p style={{ textAlign: 'center', fontSize: 12, color: '#aeaeb2', marginTop: 40 }}>
          Gemaakt met BoekBrug — de brug tussen jou en je boekhouder.
        </p>
      </div>
    </div>
  )
}
