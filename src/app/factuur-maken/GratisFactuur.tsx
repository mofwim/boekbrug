'use client'

// src/app/factuur-maken/GratisFactuur.tsx
// [GRATIS-FACTUUR] Interactive client generator for the login-free invoice tool.
// Carved out of the former page.tsx so page.tsx can stay a server component that
// owns metadata + JSON-LD (SEO). All generator logic/JSX is unchanged; only the
// mobile-responsive grids and the register CTA were added.
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
import Link from 'next/link'
import { formatEuroNL } from '@/lib/format-nl'
import { parseAmountNL as parseNum } from '@/lib/parse-nl'
// [MIN-REGEL] What a READING means by a quantity and a price — including a credit line, which the
// guard here used to turn into a charge. See read-line.ts.
import { readLineAmounts } from '@/lib/read-line'
import { round2 } from '@/lib/invoice-totals'
import ToolsCrossLinks from '@/app/tools/ToolsCrossLinks'
import KennisbankLinks from '@/components/KennisbankLinks'
import PublicFooter from '@/components/public-footer'
import { M3 } from '@/lib/design/tokens'
import { buildHandoff, writeHandoff } from '@/lib/factuur-handoff'
import { vakOpties, vakBySlug, vakRegelsVoorFormulier, regelsNaVakwissel } from '@/lib/vak-sjablonen'
import { INVOICE_TOOL_FAQ } from '@/lib/invoice-tool-faq'
// [DATE-NL] The typing surface, in Dutch order — see date-field-nl.ts. The public tool gets it
// too: a wrong invoice date here becomes a wrong quarter the moment the invoice is real.
import DateFieldNL from '@/components/ui/DateFieldNL'

// [PDF-LAZY] react-pdf touches browser APIs AND weighs 1,4 MB, dus hij hoort pas geladen te worden
// wanneer er echt gedownload wordt. Dat stond hier al — en werkte niet: twaalf regels hoger stond
// `import { InvoicePDF } from '@/lib/invoice-pdf'`, en dát bestand importeert @react-pdf gewoon
// statisch. Eén import verderop in de keten haalt de hele bundel alsnog binnen, dus deze dynamic()
// stelde niets voor: de pagina woog 2,5 MB, op twaalf publieke pagina's die een vreemde op een
// telefoon moeten overtuigen.
//
// Nu zit de renderer MET zijn document in één apart bestand (PdfDownloadButton), zodat de grens om
// allebei heen ligt en een latere import hem niet ongemerkt weer kan doorbreken.
const PdfDownloadButton = dynamic(() => import('./PdfDownloadButton'), { ssr: false })

// ─── Types ───────────────────────────────────────────────────────────────────
// The free tool stays deliberately simple: only a factuur and its creditnota.
// Offerte / pro forma live in the full product.
type InvoiceType = 'factuur' | 'creditnota'

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
}

const NL_BTW_RE = /^NL\d{9}B\d{2}$/i

// [CENT] round2 comes from invoice-totals — the same one the paid app rounds with, so a figure
// this free tool shows is the figure the invoice gets. It was a byte-identical copy.

// Dutch amount parsing lives in lib/parse-nl (parseAmountNL, imported as
// parseNum) — shared with the BTW/km/uurtarief tools so "1.000" is 1000, not 1.

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

// A YYYY-MM-DD string with a plausible year (2000–2100), else '' — guards
// against native date inputs emitting things like "0002-01-02".
const MIN_DATE = '2000-01-01'
const MAX_DATE = '2100-12-31'
function sanitizeISODate(s: string | null | undefined): string {
  const m = s ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(s) : null
  if (!m) return ''
  const year = Number(m[1])
  return year >= 2000 && year <= 2100 ? (s as string) : ''
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
    backgroundColor: '#f8f9fa',
    color: '#202124',
    fontFamily: 'var(--font-sans), -apple-system, system-ui, sans-serif',
  } as React.CSSProperties,
  wrap: {
    maxWidth: 900,
    margin: '0 auto',
    padding: '24px 16px 64px',
  } as React.CSSProperties,
  h1: { fontSize: 28, fontWeight: 700, margin: '0 0 4px' } as React.CSSProperties,
  sub: { fontSize: 14, color: '#5f6368', margin: '0 0 24px' } as React.CSSProperties,
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
    color: '#bdc1c6',
    margin: '0 0 14px',
  } as React.CSSProperties,
  // Paired fields collapse to one column on narrow screens (auto-fit) instead
  // of forcing a rigid 2-column grid that overflows a phone.
  grid2: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 12 } as React.CSSProperties,
  field: { display: 'flex', flexDirection: 'column', gap: 4 } as React.CSSProperties,
  label: { fontSize: 12, color: '#5f6368', fontWeight: 500 } as React.CSSProperties,
  input: {
    fontSize: 15,
    padding: '10px 12px',
    borderRadius: 10,
    border: '1px solid #e0e0e0',
    backgroundColor: '#f8f9fa',
    outline: 'none',
    width: '100%',
    minWidth: 0,
    boxSizing: 'border-box',
    fontFamily: 'inherit',
  } as React.CSSProperties,
  btnPrimary: {
    backgroundColor: '#1a73e8',
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
    color: '#1a73e8',
    fontSize: 14,
    fontWeight: 600,
    padding: '8px 12px',
    borderRadius: 9999,
    border: '1px solid #1a73e8',
    cursor: 'pointer',
  } as React.CSSProperties,
  // The line-item table keeps its column layout; on narrow screens it scrolls
  // inside its own container (minWidth) rather than overflowing the page.
  lineScroll: { overflowX: 'auto' } as React.CSSProperties,
  lineRow: {
    display: 'grid',
    gridTemplateColumns: '1fr 70px 100px 90px 90px 32px',
    gap: 8,
    alignItems: 'center',
    marginBottom: 8,
    minWidth: 520,
  } as React.CSSProperties,
  totalRow: {
    display: 'flex',
    justifyContent: 'space-between',
    fontSize: 14,
    padding: '4px 0',
  } as React.CSSProperties,
}

// ─── Component ───────────────────────────────────────────────────────────────
/**
 * [VAK-SLOT] `belowTool` is long-form copy that a SERVER component renders and hands in.
 *
 * It could have been imported here and switched on `initialVak`, and that would have been worse
 * twice over: prose written for a crawler would ship in the client bundle of a page whose whole
 * problem was weight, and every vakpagina would carry the text of all the others. The server
 * builds only its own, and this component never learns what is in it.
 *
 * It lands directly above <ToolsCrossLinks/> because <PublicFooter/> is rendered INSIDE this
 * component — anything a page appends after <GratisFactuur/> would sit underneath the footer.
 */
export default function GratisFactuur(
  { initialVak = '', belowTool }: { initialVak?: string; belowTool?: React.ReactNode } = {},
) {
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
  // Pre-filled to today (= the factuurdatum default) so eis #6 is visibly set
  // and the user doesn't fumble an empty native date field.
  const [deliveryDate, setDeliveryDate] = useState(todayISO)
  const [sender, setSender] = useState<Sender>(emptySender())
  const [client, setClient] = useState<Client>(emptyClient())
  const [lines, setLines] = useState<Line[]>(() => {
    // Op een vakpagina staan de regels er meteen in: dat is de hele belofte van die pagina, en
    // een lege tabel onder de kop "Factuur maken voor loodgieters" zou hem breken.
    const sjabloon = initialVak ? vakRegelsVoorFormulier(initialVak) : []
    return sjabloon.length
      ? sjabloon.map((r) => ({ description: r.description, quantity: r.quantity, unit_price: r.unit_price, btw_rate: r.btw_rate }))
      : [emptyLine()]
  })
  // [FUNNEL] Set when regels were carried over from /factuur-scannen, so the UI
  // can say so and ask the user to check them. See the effect below.
  const [fromScan, setFromScan] = useState(false)
  // [VAK-SJABLONEN] Het gekozen beroep. Stuurt alleen de knop en de let_op-melding — de regels
  // zelf zijn na het invoegen gewoon van de gebruiker, dus wisselen van vak wist niets.
  // Vanaf een vakpagina (/factuur-maken/loodgieter) staat het vak al vast. De beginwaarde is een
  // pure functie van de prop, dus server en client renderen hetzelfde — geen hydratiegedoe.
  const [vak, setVak] = useState(initialVak)
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
    // [FUNNEL] Carry over a scan from /factuur-scannen. Read ONCE and removed
    // immediately: a stale handoff silently reappearing on a later, unrelated
    // visit would be worse than no handoff at all.
    //
    // Only the LINE ITEMS, amounts and the invoice date come across — the
    // tedious part. The counterparty deliberately does NOT: a scanned invoice is
    // one you RECEIVED, so its vendor is not your client, and prefilling that
    // would quietly address your invoice to the wrong party.
    try {
      const raw = sessionStorage.getItem('boekbrug.scan-handoff')
      if (raw) {
        sessionStorage.removeItem('boekbrug.scan-handoff')
        const h = JSON.parse(raw) as {
          line_items?: Array<{ description?: string | null; quantity?: number | null; unit_price?: number | null; amount?: number | null }>
          invoice_date?: string | null
        }
        const carried = (h.line_items ?? [])
          .map((li) => {
            // [MIN-REGEL] A scan may give quantity+unit_price, or only a line total. When it is
            // only a total, treat it as 1 × total so the arithmetic still adds up to what the
            // paper said — and keep a NEGATIVE quantity, which is a credit line and not an
            // unreadable one. The guard here was `quantity > 0 ? quantity : 1`, which turned
            // -3 × € 23,95 = € -71,85 into 1 × € 23,95: € 95,80 of swing on one row, towards
            // charging the customer, with nothing on the screen saying a number had changed.
            // read-line.ts also moves a minus out of the price, where it may not be issued.
            const read = readLineAmounts(li)
            if (read === null) return null
            return {
              description: (li.description ?? '').trim(),
              quantity: String(read.quantity),
              unit_price: read.unit_price.toFixed(2).replace('.', ','),
              btw_rate: 21,
            } as Line
          })
          .filter((l): l is Line => l !== null)

        if (carried.length > 0) {
          setLines(carried)
          setFromScan(true)
        }
        if (h.invoice_date && /^\d{4}-\d{2}-\d{2}$/.test(h.invoice_date)) {
          setInvoiceDate(h.invoice_date)
        }
      }
    } catch {
      /* ignore corrupt storage — the user just fills it in themselves */
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
        const qty = parseNum(l.quantity)
        const price = parseNum(l.unit_price)
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

  // A native date input can yield an absurd year (typing "2" → 0002). Never let
  // that reach the PDF: sanitize to a plausible year, else fall back sanely.
  const safeInvoiceDate = sanitizeISODate(invoiceDate) || todayISO()

  // Shapes InvoicePDF expects — identical to the full app's DB rows.
  const invoice = {
    invoice_type: invoiceType,
    invoice_number: invoiceNumber || 'CONCEPT',
    invoice_date: safeInvoiceDate,
    due_date: sanitizeISODate(dueDate) || addDaysISO(safeInvoiceDate, 14),
    // Leverdatum is factuureis #6 — always print one. If the user leaves it
    // empty (or enters a garbage date) we default it to the invoice date so the
    // requirement is met without them having to think about it.
    delivery_date: sanitizeISODate(deliveryDate) || safeInvoiceDate,
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

  // [FUNNEL-OVERDRACHT] Bewaar de hele factuur, niet alleen het afzenderblok.
  //
  // Hieronder staat een knop die zegt "Maak een gratis account. **Bewaar je facturen**". Die
  // zin was tot nu toe niet waar: alleen de afzender stond in localStorage, en geen enkel
  // scherm ná registratie las hem. Wie zich liet overtuigen kwam binnen op een leeg formulier
  // en mocht alles opnieuw tikken — zijn bedrijfsgegevens, zijn klant, al zijn regels — op
  // precies het moment dat hij besloot te blijven.
  //
  // Nu wordt de hele factuur weggeschreven terwijl hij typt, en lezen de onboarding (het
  // bedrijfsblok) en het factuurformulier (klant + regels) hem uit. Zie factuur-handoff.ts voor
  // waarom dit localStorage is en geen sessionStorage, en waarom het NUMMER met opzet niet
  // meegaat.
  //
  // Het schrijven gebeurt zonder debounce, net als bij de afzender hierboven: de payload is een
  // paar honderd bytes en de gebruiker mag nooit werk verliezen omdat hij net op het verkeerde
  // moment wegklikte.
  useEffect(() => {
    if (!hydrated) return
    writeHandoff(localStorage, buildHandoff({
      sender,
      client,
      // De ONGETEKENDE bedragen gaan mee. Een creditnota is in het volledige product een eigen
      // document met een eigen route; hem hier als negatieve factuur overdragen zou een
      // creditnota maken zonder de factuur die hij corrigeert.
      lines: lines.map((l) => ({
        description: l.description,
        quantity: parseNum(l.quantity),
        unit_price: parseNum(l.unit_price),
        btw_rate: l.btw_rate,
      })),
      invoiceDate,
      deliveryDate,
    }))
  }, [hydrated, sender, client, lines, invoiceDate, deliveryDate])

  // [VAK-SJABLONEN] Regels van een beroep erbij zetten. Ingevulde regels blijven staan; wat het
  // VORIGE sjabloon onaangeraakt heeft achtergelaten gaat weg.
  //
  // Dat tweede ontbrak, en het gevolg was zichtbaar: monteur kiezen, dan schoonmaker, dan
  // transport gaf negentien regels van 0,00 onder elkaar. De maatstaf hier was "heeft een
  // omschrijving" — en die heeft een sjabloonregel altijd, want het sjabloon zette hem er zelf
  // neer. Het formulier beschermde het werk van zichzelf tegen zichzelf.
  //
  // De regel zelf staat nu in vak-sjablonen.ts (regelsNaVakwissel), met een test erbij: wat er
  // met andermans ingevulde bedragen gebeurt, is niets om in een klikhandler te laten wonen.
  function pasVakToe(slug: string) {
    const vorig = vak
    setVak(slug)
    setLines((prev) => regelsNaVakwissel(prev, vorig, slug) as Line[])
  }

  const gekozenVak = vakBySlug(vak)

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
  // ONLY the factuur series is auto-managed — a creditnota carries its own
  // reference (usually the original factuur's), so it must not consume or
  // advance the factuur sequence (Belastingdienst: gapless invoice numbering).
  function handleDownload() {
    // Ignore clicks while the PDF is still rendering — the browser has nothing
    // to download yet, so advancing would skip a number.
    if (pdfLoadingRef.current) return
    if (invoiceType !== 'factuur') return
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
        {/* [EEN-H1] Op /factuur-maken IS "Gratis factuur maken" de kop van de pagina. Op
            /factuur-maken/<vak> is dat de kop van de vakpagina hierboven ("Factuur maken voor
            loodgieter"), en stond deze regel er als TWEEDE h1 onder — twee koppen die allebei
            claimen waar de pagina over gaat, terwijl de bezoeker op de eerste geklikt heeft.
            Daar is het de kop van dít blok, de generator zelf, en dus een h2. */}
        {initialVak === ''
          ? <h1 style={s.h1}>Gratis factuur maken</h1>
          : <h2 style={s.h1}>Gratis factuur maken</h2>}
        {/* [SEO-INTRO] Twee inleidingen, en het onderscheid is `initialVak` — de ROUTE, niet de
            keuzelijst. Een bezoeker die hierboven zijn vak kiest verandert `vak`, en als die de
            tekst zou sturen verdween de inleiding onder zijn handen.
            Op /factuur-maken staat de volledige tekst: dit is de pagina die op "gratis factuur
            maken" gevonden moet worden en een zoekmachine krijgt hier zinnen in plaats van alleen
            formuliervelden. Op /factuur-maken/<vak> blijft de korte regel staan — die pagina heeft
            haar eigen kop en haar eigen BTW-uitleg in de server-component, en dezelfde alinea er
            tien keer onder plakken is precies de dubbele inhoud die [VAK-PAGINAS] vermijdt. */}
        {initialVak === '' ? (
          <>
            <p style={{ ...s.sub, marginBottom: 12 }}>
              Maak snel en gratis een professionele factuur als PDF. Vul je gegevens en die van je
              klant in, voeg je werkzaamheden toe en download je factuur direct.
            </p>
            <p style={s.sub}>
              Geen account nodig en geen kosten. Je gegevens blijven in je browser zolang je geen
              account maakt.
            </p>
          </>
        ) : (
          <p style={s.sub}>
            Vul in, download je PDF. Geen account nodig — je gegevens blijven in je browser.
          </p>
        )}

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
              <DateFieldNL
                min={MIN_DATE}
                max={MAX_DATE}
                style={s.input}
                value={invoiceDate}
                onChange={setInvoiceDate}
                aria-label="Factuurdatum"
              />
            </div>
            <div style={s.field}>
              <label style={s.label}>Vervaldatum</label>
              <DateFieldNL
                min={MIN_DATE}
                max={MAX_DATE}
                style={s.input}
                value={dueDate}
                onChange={setDueDate}
                aria-label="Vervaldatum"
              />
            </div>
            <div style={s.field}>
              <label style={s.label}>Leverdatum (standaard = factuurdatum)</label>
              <DateFieldNL
                min={MIN_DATE}
                max={MAX_DATE}
                style={s.input}
                value={deliveryDate}
                onChange={setDeliveryDate}
                aria-label="Leverdatum"
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
                style={{ ...s.input, borderColor: btwWarn ? '#e37400' : '#e0e0e0' }}
                value={sender.btw_number}
                onChange={setS('btw_number')}
                placeholder="NL123456789B01"
              />
              {btwWarn && (
                <span style={{ fontSize: 11, color: M3.warning }}>
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

          {/* [VAK-SJABLONEN] Kies je vak → regels erbij, met het juiste BTW-tarief.
              De winst zit niet in het typwerk maar in dat tarief: schilderwerk aan een woning
              ouder dan twee jaar mag 9%, personenvervoer 9% en goederenvervoer 21%, schoonmaak
              bínnen een woning 9% en in een kantoor 21%. Dat zijn de fouten die pas bij de
              aangifte opvallen, als de factuur allang verstuurd is. Prijzen staan er met opzet
              NIET in — zie vak-sjablonen.ts. */}
          <div style={{ marginBottom: 12 }}>
            <label htmlFor="vak" style={{ ...s.label, display: 'block' }}>
              Wat voor werk doe je? (optioneel)
            </label>
            <select
              id="vak"
              value={vak}
              onChange={(e) => pasVakToe(e.target.value)}
              style={{ ...s.input, cursor: 'pointer' }}
            >
              <option value="">Kies je vak — dan zetten we de regels klaar</option>
              {vakOpties().map((o) => (
                <option key={o.slug} value={o.slug}>{o.label}</option>
              ))}
            </select>
            <p style={{ fontSize: 12, color: '#5f6368', margin: '6px 0 0' }}>
              Je krijgt de gebruikelijke regels met het juiste BTW-tarief. Bedragen vul je zelf
              in — die zijn van jou, niet van ons.
            </p>
          </div>

          {/* De let_op-melding is het waardevolste deel van deze functie: hij verschijnt juist
              bij de vakken waar het tarief van de situatie afhangt. Geel, niet rood: het is een
              keuze die de ondernemer moet maken, geen fout die hij heeft gemaakt. */}
          {gekozenVak?.let_op && (
            <div
              role="status"
              style={{
                background: '#FEE8C4', border: '1px solid #7C5800', color: '#7C5800',
                borderRadius: 10, padding: '10px 12px', margin: '0 0 12px',
                fontSize: 13, lineHeight: 1.5,
              }}
            >
              <strong>Let op bij {gekozenVak.label.toLowerCase()}:</strong> {gekozenVak.let_op}
            </div>
          )}

          {/* [FUNNEL] Say plainly that these came from a machine read, and ask
              for a check. The AI is a suggestion, never a fact — the same rule
              the rest of the app follows, and §4.3 of the terms commits to it. */}
          {fromScan && (
            <div
              role="status"
              style={{
                background: '#FEE8C4', border: '1px solid #7C5800', color: '#7C5800',
                borderRadius: 10, padding: '10px 12px', margin: '0 0 12px',
                fontSize: 13, lineHeight: 1.5,
              }}
            >
              <strong>Overgenomen uit je gescande factuur.</strong> Controleer de regels,
              bedragen en het BTW-tarief — een scan is een suggestie, geen feit. Je klant
              vul je zelf in: een gescande factuur is er één die jij <em>ontvangen</em> hebt.
            </div>
          )}
          <div style={s.lineScroll}>
            <div style={{ ...s.lineRow, marginBottom: 6 }}>
              <span style={s.label}>Omschrijving</span>
              <span style={{ ...s.label, textAlign: 'center' }}>Aantal</span>
              <span style={{ ...s.label, textAlign: 'end' }}>Prijs</span>
              <span style={{ ...s.label, textAlign: 'center' }}>BTW</span>
              <span style={{ ...s.label, textAlign: 'end' }}>Totaal</span>
              <span />
            </div>
            {lines.map((l, i) => {
              const qty = parseNum(l.quantity)
              const price = parseNum(l.unit_price)
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
                    style={{ ...s.input, textAlign: 'end' }}
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
                  <span style={{ textAlign: 'end', fontSize: 14 }}>
                    {formatEuroNL(qty * price * sign)}
                  </span>
                  <button
                    onClick={() => removeLine(i)}
                    aria-label="Verwijder regel"
                    style={{
                      background: 'none',
                      border: 'none',
                      color: M3.error,
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
          </div>
          <button onClick={addLine} style={{ ...s.btnGhost, marginTop: 8 }}>
            + Regel toevoegen
          </button>

          <div style={{ marginTop: 20, borderTop: '1px solid #e0e0e0', paddingTop: 12 }}>
            <div style={s.totalRow}>
              <span style={{ color: '#5f6368' }}>Subtotaal excl. BTW</span>
              <span>{formatEuroNL(totals.ex)}</span>
            </div>
            <div style={s.totalRow}>
              <span style={{ color: '#5f6368' }}>BTW</span>
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
            <PdfDownloadButton
              invoice={invoice}
              lines={numericLines}
              profile={sender}
              fileName={fileName}
              style={s.btnPrimary}
              onClick={handleDownload}
              onLoadingChange={(loading) => { pdfLoadingRef.current = loading }}
            />
          ) : (
            <button style={{ ...s.btnPrimary, opacity: 0.4, cursor: 'not-allowed' }} disabled>
              ↓ Download PDF
            </button>
          )}
        </div>
        {!canDownload && (
          <p style={{ textAlign: 'center', fontSize: 12, color: '#bdc1c6', marginTop: 8 }}>
            Vul je naam, de klant en minstens één regel in.
          </p>
        )}

        {/* [SEO-TEKST] Beschrijft wat de tool hierboven zojuist gedaan heeft, in gewone zinnen.
            Dat is de reden dat hij ONDER het formulier staat en niet erboven: wie is komen
            factureren is dan klaar, en wie via Google binnenkomt vindt hier de woorden die bij
            zijn zoekopdracht horen. Alleen op de generieke pagina — zie [SEO-INTRO]. */}
        {initialVak === '' && (
          <div style={{ ...s.card, marginTop: 24 }}>
            <h2 style={{ fontSize: 18, fontWeight: 700, color: '#202124', margin: '0 0 10px' }}>
              Gratis een factuur maken als ZZP’er
            </h2>
            <p style={{ fontSize: 14, color: '#5f6368', margin: '0 0 10px', lineHeight: 1.6 }}>
              Werk je als ZZP’er, freelancer of kleine ondernemer? Met BoekBrug maak je eenvoudig
              een professionele factuur die je als PDF kunt downloaden.
            </p>
            <p style={{ fontSize: 14, color: '#5f6368', margin: '0 0 10px', lineHeight: 1.6 }}>
              Je hoeft geen account aan te maken en je betaalt niets. Vul je bedrijfsgegevens, de
              gegevens van je klant en de factuurregels in. BoekBrug berekent automatisch het
              BTW-bedrag en het totaal.
            </p>
            <p style={{ fontSize: 14, color: '#5f6368', margin: 0, lineHeight: 1.6 }}>
              Wil je je facturen later bewaren, versturen en bijhouden? Dan kun je gratis een
              BoekBrug-account maken.
            </p>
          </div>
        )}

        {/* ── Peak-intent register CTA (only real features) ──
            [FUNNEL-OVERDRACHT] Deze knop beloofde "bewaar je facturen" en leverde een leeg
            formulier: de gegevens stonden in localStorage maar werden na registratie nergens
            gelezen. Nu gaat de factuur wél mee, dus de tekst mag zeggen wat er gebeurt — en
            zegt het concreet ("je hoeft niets opnieuw in te tikken"), want dat is precies de
            twijfel die iemand op dit punt tegenhoudt. */}
        <div style={{ ...s.card, marginTop: 24, textAlign: 'center' }}>
          <div style={{ fontSize: 17, fontWeight: 700, color: '#202124', marginBottom: 6 }}>
            Wil je deze factuur bewaren en versturen?
          </div>
          <div style={{ fontSize: 14, color: '#5f6368', marginBottom: 16 }}>
            Maak een gratis account — <strong>deze factuur gaat mee</strong>. Je bedrijfsgegevens,
            je klant en je regels staan er straks al in; je hoeft niets opnieuw in te tikken.
          </div>
          <Link href="/register" style={s.btnPrimary}>
            Gratis account maken
          </Link>
          <div style={{ fontSize: 12, color: '#5f6368', marginTop: 12 }}>
            Je factuur blijft zeven dagen in je eigen browser bewaard. Er gaat niets naar ons
            toe zolang je geen account maakt.
          </div>
        </div>

        <p style={{ textAlign: 'center', fontSize: 12, color: '#bdc1c6', marginTop: 40 }}>
          Gemaakt met BoekBrug — de brug tussen jou en je boekhouder.
        </p>

        {/* [VAK-PAGINAS] Naar de andere beroepen. Twee redenen, en de tweede is de belangrijkste:
            een bezoeker die "factuur maken" zocht maar loodgieter is, komt hier terecht en vindt
            zijn eigen pagina — mét het BTW-tarief dat bij zijn vak hoort. En de crawler vindt via
            deze links alle vakpagina's vanaf de sterkste pagina van de site, in plaats van ze
            alleen uit de sitemap te moeten halen. Dit staat in de client-component maar de pagina
            wordt statisch geprerenderd, dus de links staan gewoon in de HTML. */}
        <div style={{ ...s.card, marginTop: 24 }}>
          <p style={s.cardTitle}>Factuur maken voor jouw vak</p>
          <p style={{ fontSize: 13, color: '#5f6368', margin: '0 0 12px', lineHeight: 1.5 }}>
            Elke pagina heeft de gebruikelijke regels én het BTW-tarief dat bij dat werk hoort.
          </p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {vakOpties()
              .filter((o) => o.slug !== vak)
              .map((o) => (
                <Link
                  key={o.slug}
                  href={`/factuur-maken/${o.slug}`}
                  style={{
                    fontSize: 13, color: '#1a73e8', textDecoration: 'none',
                    border: '1px solid #dadce0', borderRadius: 9999, padding: '6px 12px',
                  }}
                >
                  {o.label}
                </Link>
              ))}
          </div>
        </div>

        {/* [FACTUUR-FAQ] Dezelfde vragen die de server-shell als FAQPage-markup meestuurt, uit
            dezelfde module — zie src/lib/invoice-tool-faq.ts. Ze stonden tot nu toe alléén in de
            JSON-LD, en markup zonder zichtbare vraag telt niet mee; dit blok maakt de markup waar.
            Niet op de vakpagina's: die hebben hun eigen vraag ("welk BTW-tarief geldt voor …?"),
            en die is daar het antwoord waarvoor de bezoeker gekomen is. */}
        {initialVak === '' && (
          <div style={{ ...s.card, marginTop: 24 }}>
            <h2 style={{ fontSize: 18, fontWeight: 700, color: '#202124', margin: '0 0 12px' }}>
              Veelgestelde vragen over gratis facturen maken
            </h2>
            {INVOICE_TOOL_FAQ.map((item) => (
              <div key={item.q} style={{ marginBottom: 14 }}>
                <h3 style={{ fontSize: 14, fontWeight: 600, color: '#202124', margin: '0 0 4px' }}>
                  {item.q}
                </h3>
                <p style={{ fontSize: 14, color: '#5f6368', margin: 0, lineHeight: 1.6 }}>
                  {item.a}
                </p>
              </div>
            ))}
          </div>
        )}

        {belowTool}

        <ToolsCrossLinks currentSlug="/factuur-maken" />
        <KennisbankLinks tool="/factuur-maken" />
      </div>
      <PublicFooter />
    </div>
  )
}
