'use client'

// src/app/dashboard/kas/KasClient.tsx
// [CASH-LEDGER] The cash book. Running balance + a light add form + the ledger.
// Cash sales (in) and cash expenses (out); deposits/withdrawals to the bank are
// 'transfer' so they change the drawer balance but never the revenue/cost picture.

// [TAAL] useCallback/useMemo are gone from this file on purpose — see catLabel and filteredEntries
// below: the React Compiler memoizes the component, and a manual memo whose dependency it cannot
// prove stable is refused anyway.
import { useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { rowMatchesQuery } from '@/lib/search'
// [INTAKE-IMG-NORMALIZE] A cash receipt snapped as HEIC/HEIF on an iPhone would reach the reader as
// an "unsupported type" and be filed unreadable — the contant-betaald flow then never books. Convert
// to a bounded JPEG before upload (a PDF/normal JPG/PNG passes through untouched).
// [UPLOAD-PLAFOND] One shared fit-and-send — see upload-fit.ts.
import { sendWithFit } from '@/lib/upload-fit'
// [SERVER-ZIN] Never a machine code in front of the owner — see server-message.ts.
import { failureText } from '@/lib/server-message'
// [PARSE-NL] One tolerant reader for an amount a Dutch owner TYPES — see parse-nl.ts. This screen
// used `Number(x.replace(',', '.'))`, which reads the two ordinary Dutch ways of writing money
// wrongly and in opposite directions: "1.306,36" became NaN (refused with "bedrag moet groter dan
// 0" over an amount that is plainly valid), and "1.250" became 1.25 — a cash sale booked at a
// thousandth of itself, into the drawer, the BTW and the kasboek an inspector reads, with nothing
// on screen to suggest anything was misread.
import { parseAmountNL } from '@/lib/parse-nl'
// [DESIGN] Palette and radius come from the shared source now
// (src/lib/design/tokens.ts). This file used to declare its own copy; see the
// header of tokens.ts for why the copies had to go — two of the values in them
// were below the contrast floor for text.
import { M3, COLUMN } from '@/lib/design/tokens'
// [DATE-NL] A date the owner types, in the order they read it — see date-field-nl.ts.
import DateFieldNL from '@/components/ui/DateFieldNL'
import { useLocale } from '@/lib/i18n/use-locale'
import { translator } from '@/lib/i18n/t'

const FONT = "'Roboto', -apple-system, sans-serif"
const FONT_NUM = "'Roboto Mono', monospace"
const eur = new Intl.NumberFormat('nl-NL', { style: 'currency', currency: 'EUR' })

// [TAAL] The keys are DATABASE values and stay Dutch; only the labels travel through the
// catalogue (rendered via the component's translator).
const CATS = [
  { key: 'omzet', labelKey: 'kas.cat.omzet' },
  { key: 'kosten', labelKey: 'kas.cat.kosten' },
  { key: 'prive', labelKey: 'kas.cat.prive' },
  { key: 'transfer', labelKey: 'kas.cat.transfer' },
] as const

interface Entry {
  id: string
  entry_date: string
  direction: 'in' | 'out'
  amount: number
  category: string
  description: string | null
}

// [KASBOEK] The live quarterly cash book (a pure projection over the truth layer — see
// /api/kasboek). Mirrors the shapes in lib/kasboek.ts, only the fields the panel renders.
interface KasRow { date: string; beginsaldo: number; ontvangsten: number; uitgaven: number; descriptions: string[]; eindsaldo: number }
interface KasMonth { key: string; label: string; rows: KasRow[]; totalIn: number; totalOut: number }
interface Kasboek {
  year: number; quarter: number; openingBalance: number; closingBalance: number
  months: KasMonth[]; totalIn: number; totalOut: number
}

// Previous quarter for the ◀ selector (Q1 → Q4 of the prior year).
function prevQuarter(y: number, q: number): { year: number; quarter: number } {
  return q <= 1 ? { year: y - 1, quarter: 4 } : { year: y, quarter: q - 1 }
}
function nextQuarter(y: number, q: number): { year: number; quarter: number } {
  return q >= 4 ? { year: y + 1, quarter: 1 } : { year: y, quarter: q + 1 }
}
// The quarter we are living in, in Amsterdam time — the ceiling for ▶. Without one the button
// walked forever into quarters that cannot have data, each one answering "Geen kasbewegingen in
// dit kwartaal", which reads like a finding rather than a place that does not exist yet.
function currentQuarter(): { year: number; quarter: number } {
  const iso = todayIso()
  return { year: Number(iso.slice(0, 4)), quarter: Math.floor((Number(iso.slice(5, 7)) - 1) / 3) + 1 }
}
function isAtOrAfter(a: { year: number; quarter: number }, b: { year: number; quarter: number }): boolean {
  return a.year > b.year || (a.year === b.year && a.quarter >= b.quarter)
}
/**
 * "Q1 2026" for the quarter the readiness gate blocks on — the one the negative-drawer banner is
 * about.
 *
 * DERIVED, not read from alertPeriodRef: a ref may not be read during render (the label would not
 * re-render when it changed), and it does not need to be. The unparameterised /api/kasboek call
 * defaults through quarterFromParams to lastCompletedQuarter, which is exactly
 * prevQuarter(currentQuarter()) on the same Amsterdam day this file already pins — the identical
 * definition, so the label cannot drift from the quarter it names.
 */
function readinessQuarterLabel(): string {
  const now = currentQuarter()
  const p = prevQuarter(now.year, now.quarter)
  return `Q${p.quarter} ${p.year}`
}

function formatDate(iso: string | null): string {
  if (!iso) return ''
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso)
  if (!m) return ''
  const months = ['jan.', 'feb.', 'mrt.', 'apr.', 'mei', 'jun.', 'jul.', 'aug.', 'sep.', 'okt.', 'nov.', 'dec.']
  return `${Number(m[3])} ${months[Number(m[2]) - 1]}`
}
function todayIso(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Amsterdam', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
}

export default function KasClient() {
  const t = translator(useLocale())
  const [entries, setEntries] = useState<Entry[]>([])
  // [SEARCH] in-page live ledger filter. Seeded from ?find= (set by the global Cmd+K search
  // when the owner opens a kas hit) and synced on param change, so the exact boeking surfaces.
  const searchParams = useSearchParams()
  const findParam = searchParams.get('find') ?? ''
  const [search, setSearch] = useState(findParam)
  useEffect(() => {
    const timer = setTimeout(() => setSearch(findParam), 0)
    return () => clearTimeout(timer)
  }, [findParam])
  const [balance, setBalance] = useState(0)
  // [KAS-OPENING] the drawer's starting float (beginsaldo) — a config value the owner sets once.
  const [openingBalance, setOpeningBalance] = useState(0)
  const [openingEdit, setOpeningEdit] = useState(false)
  const [openingInput, setOpeningInput] = useState('')
  const [openingSaving, setOpeningSaving] = useState(false)
  const [loading, setLoading] = useState(true)
  // [COHERENCE-ERRSTATE] Distinguish "loaded, drawer is empty" from "load failed".
  // Without this, a /api/cash failure was swallowed and the page showed a reassuring
  // €0,00 saldo + "Nog geen kasboekingen" — a false money figure indistinguishable
  // from a fresh account (locked constraint #3: no false reassurance).
  const [loadError, setLoadError] = useState(false)

  const [direction, setDirection] = useState<'in' | 'out'>('in')
  const [amount, setAmount] = useState('')
  const [category, setCategory] = useState('omzet')
  const [btwRate, setBtwRate] = useState(21)
  const [date, setDate] = useState(todayIso())
  const [description, setDescription] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  // [KASBOEK] Live quarterly cash book. Loaded lazily; on first open the endpoint defaults to
  // the last completed quarter and tells us which one it picked (kb.year/kb.quarter).
  const [kbOpen, setKbOpen] = useState(false)
  const [kb, setKb] = useState<Kasboek | null>(null)
  const [kbLoading, setKbLoading] = useState(false)
  const [kbPeriod, setKbPeriod] = useState<{ year: number; quarter: number } | null>(null)
  // [KAS-NEGATIEF] The day this quarter's drawer went below zero, if it ever did. A negative
  // kassaldo is physically impossible — you cannot pay out cash you never had — and it is the
  // single strongest reason the Belastingdienst rejects a cash administration. The app already
  // detected it and blocked the aangifte on it; it just never said so HERE, on the one screen
  // where the owner can actually fix it. Same witness as the readiness gate, so the two can
  // never disagree.
  const [lowestPoint, setLowestPoint] = useState<{ date: string; balance: number } | null>(null)
  // [KAS-NEGATIEF] Which quarter the banner above is ABOUT — the one the readiness gate blocks on
  // (the endpoint's own default: the last completed quarter). Browsing the panel to another
  // quarter must not rewrite it. It did: loadKasboek set lowestPoint from whatever quarter was
  // loaded, so one tap on ◀ into a healthy older quarter made the red banner vanish while the
  // aangifte stayed blocked — and a tap into an old quarter that once dipped showed the banner
  // claiming, in the present tense, that it is blocking the filing today. Held in a ref because
  // loadKasboek reads it from inside an async callback.
  const alertPeriodRef = useRef<{ year: number; quarter: number } | null>(null)
  // [NO-EMPTY-LEDGER] The negative-cash check could not be RUN (the kasboek sources were
  // unreadable). Not the same as "your drawer is fine", and this screen must not let the two
  // look alike — the absence of the banner is the only thing the owner has to go on.
  const [lowestPointUnknown, setLowestPointUnknown] = useState(false)
  // [KAS-NEGATIEF-NU] The dip in the quarter that is STILL OPEN — the one nobody was told about.
  //
  // Everything above is about the readiness quarter (the last completed one), because that is what
  // the filing gate blocks on. So a drawer that goes below zero TODAY had exactly one witness on
  // this screen: the headline saldo turning red — and only if it is STILL negative right now. A dip
  // that recovered before today (a cash purchase booked before the takings that paid for it, the
  // single most common shape of this error) showed nothing at all, in the one place it is cheap to
  // fix: this quarter is not filed, the days are days old, and the owner still remembers them.
  //
  // Then the quarter closes, and the same dip arrives as a blocked aangifte with three months of
  // hindsight to reconstruct. The information existed the whole time — /api/kasboek answers for any
  // quarter you ask it about, and nobody was asking about this one.
  const [openDip, setOpenDip] = useState<{ date: string; balance: number } | null>(null)

  async function loadKasboek(period: { year: number; quarter: number } | null) {
    setKbLoading(true)
    try {
      const qs = period ? `?year=${period.year}&quarter=${period.quarter}` : ''
      const res = await fetch(`/api/kasboek${qs}`)
      const json = await res.json()
      if (res.ok && json.kasboek) {
        setKb(json.kasboek as Kasboek)
        setKbPeriod({ year: json.kasboek.year, quarter: json.kasboek.quarter })
        // The first load (no explicit period) IS the readiness quarter — remember it.
        if (!period) alertPeriodRef.current = { year: json.kasboek.year, quarter: json.kasboek.quarter }
        // [SHADOW] Named alertQ, not alert: a local `alert` shadows window.alert for the whole
        // module, the same trap BankClient and CategoriseClient already carry a note about.
        const alertQ = alertPeriodRef.current
        // Only the banner's own quarter may update it; every other quarter is just browsing.
        if (!alertQ || (json.kasboek.year === alertQ.year && json.kasboek.quarter === alertQ.quarter)) {
          setLowestPoint((json.lowestPoint ?? null) as { date: string; balance: number } | null)
          setLowestPointUnknown(false)
        }
      } else {
        // A 503 here means the sources could not be read (see [NO-EMPTY-LEDGER] in the route).
        // The panel shows its own retry; the banner state must not silently read as "all clear".
        setKb(null)
        if (!period) setLowestPointUnknown(true)
      }
    } catch {
      setKb(null)
      if (!period) setLowestPointUnknown(true)
    } finally { setKbLoading(false) }
  }

  function openKasboek() {
    setKbOpen(true)
    if (!kb) void loadKasboek(null)
  }

  // [KAS-NEGATIEF] Re-ask the readiness quarter's drawer whether it ever dipped below zero.
  //
  // Its own quarter only — the unparameterised call, which IS the quarter the readiness gate blocks
  // on (see alertPeriodRef) — and deliberately WITHOUT touching kb/kbPeriod: the owner may be
  // browsing another quarter in the panel, and refreshing a warning must not walk them out of it.
  //
  // Called after every write, not only on mount. That is the fix: the banner is a VERDICT over a
  // whole quarter, and the three remedies it names — book the missing bon, correct a date, record
  // the opname from the bank — are all carried out on THIS screen, usually with the panel closed.
  // Fetched once at mount it then went stale in both directions, and both are worse than a stale
  // list would be:
  //   · the owner books exactly what the banner asked for and the red banner stays, so the fix
  //     reads as ineffective and the blocked aangifte stays unexplained;
  //   · or they backdate a cash expense into that quarter, push the drawer under zero, and the
  //     screen says nothing at all until someone happens to reload — while the filing gate, which
  //     re-reads this same witness per request, has already started refusing.
  // A page that keeps a money verdict from before the money moved is the one thing this screen
  // exists to prevent.
  // [KAS-NEGATIEF-NU] …and the same question about the quarter we are IN, asked in the same breath.
  // Two quarters, two answers, and they cannot be folded into one call: the endpoint reports the
  // lowest point of the period it was asked about, and these are always different periods (the
  // readiness quarter is by definition the one BEFORE the current one). Run together so asking twice
  // costs one wait rather than two.
  async function refreshDrawerAlert(isCancelled: () => boolean = () => false) {
    const cur = currentQuarter()
    const ask = async (qs: string) => {
      const res = await fetch(`/api/kasboek${qs}`)
      const json = await res.json()
      return { ok: res.ok && !!json.kasboek, json }
    }
    try {
      const [blocking, open] = await Promise.all([
        ask(''),
        ask(`?year=${cur.year}&quarter=${cur.quarter}`),
      ])
      if (isCancelled()) return
      if (blocking.ok) {
        // This unparameterised answer owns the banner, and pins which quarter may update it later.
        alertPeriodRef.current = { year: blocking.json.kasboek.year, quarter: blocking.json.kasboek.quarter }
        setLowestPoint((blocking.json.lowestPoint ?? null) as { date: string; balance: number } | null)
        setLowestPointUnknown(false)
      } else {
        // [NO-EMPTY-LEDGER] The check could not run. Say so instead of showing nothing, which on
        // this screen is indistinguishable from "your drawer never went negative".
        setLowestPointUnknown(true)
      }
      if (open.ok) {
        setOpenDip((open.json.lowestPoint ?? null) as { date: string; balance: number } | null)
      } else {
        // Same rule for this half: an unanswered question must not render as a clean drawer. It
        // shares the one "could not check" banner rather than raising a second — the sentence is
        // already exactly right for both, and two of them would only be noise.
        setLowestPointUnknown(true)
      }
    } catch {
      if (!isCancelled()) setLowestPointUnknown(true)
    }
  }

  async function load() {
    try {
      const res = await fetch('/api/cash')
      const json = await res.json()
      if (res.ok) { setEntries(json.entries ?? []); setBalance(json.balance ?? 0); setOpeningBalance(json.openingBalance ?? 0); setLoadError(false) }
      else { setLoadError(true) }
    } catch { setLoadError(true) } finally { setLoading(false) }
  }

  // [KAS-OPENING] Persist the starting float, then reload so the saldo reflects it immediately.
  async function saveOpeningBalance() {
    // [PARSE-NL] A float is typed the way a Dutch owner writes money ("1.000", "1.000,50").
    // parseAmountNL answers 0 for anything it cannot read, which on THIS field would silently
    // store €0,00 over a typo — so the digit test comes first and keeps that an error.
    const raw = (openingInput || '').trim()
    const val = /\d/.test(raw) ? parseAmountNL(raw) : NaN
    if (!Number.isFinite(val) || val < 0) { setError(t('kas.beginsaldoNegatief')); return }
    setOpeningSaving(true)
    try {
      const res = await fetch('/api/cash', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kas_opening_balance: val }),
      })
      if (res.ok) { setOpeningEdit(false); await load() }
      // [SERVER-ZIN] `j.error` showed opening_balance_lookup_failed in the kasboek.
      else { const j = await res.json().catch(() => ({})); setError(failureText(res.status, j, t('kas.fout.beginsaldoOpslaan'))) }
    } catch { setError(t('kas.fout.verbinding')) } finally { setOpeningSaving(false) }
  }
  // Initial load — inline async IIFE so no setState runs synchronously in the effect.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch('/api/cash')
        const json = await res.json()
        if (!cancelled) {
          if (res.ok) { setEntries(json.entries ?? []); setBalance(json.balance ?? 0); setOpeningBalance(json.openingBalance ?? 0); setLoadError(false) }
          else { setLoadError(true) }
        }
      } catch { if (!cancelled) setLoadError(true) } finally { if (!cancelled) setLoading(false) }

      // [KAS-NEGATIEF] Then, separately and silently, ask this quarter's drawer whether it ever
      // dipped below zero. A dip can happen mid-quarter and recover — the headline saldo would
      // look perfectly healthy while the kasboek an inspector reads does not. Failure here is
      // silent on purpose: it is a warning channel, never a reason to break the page.
      // One implementation, shared with every write on this screen — see refreshDrawerAlert.
      await refreshDrawerAlert(() => cancelled)
    })()
    return () => { cancelled = true }
  }, [])

  // Default the category to match the direction (in → omzet, out → kost).
  function setDir(d: 'in' | 'out') {
    setDirection(d)
    setCategory(d === 'in' ? 'omzet' : 'kosten')
  }

  async function add() {
    // [PARSE-NL] "1.306,36" is a valid amount and "1.250" means twelve hundred and fifty — see the
    // import. An unreadable amount parses to 0 and is caught by the same test as before.
    const val = parseAmountNL(amount)
    if (!Number.isFinite(val) || val <= 0) { setError(t('kas.fout.bedragNul')); return }
    setSaving(true); setError('')
    try {
      const res = await fetch('/api/cash', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ entry_date: date, direction, amount: val, category, description, btw_rate: category === 'omzet' ? btwRate : undefined }),
      })
      if (res.ok) {
        setAmount(''); setDescription(''); setError('')
        await load()
        if (kbOpen) void loadKasboek(kbPeriod)
        // [KAS-NEGATIEF] The boeking may have pushed the readiness quarter's drawer under zero — or
        // been the very receipt that lifts it back over. Either way the banner's verdict is now
        // older than the money it describes. Backdating INTO that quarter is not an edge case: it
        // is the fix the banner itself asks for.
        void refreshDrawerAlert()
      }
      else {
        // [CASH-ADD-HONEST] The route answers with the actual reason ("ongeldige categorie",
        // "beginsaldo moet 0 of hoger zijn", …). Replacing it with "probeer opnieuw" told the
        // owner to repeat the one thing that cannot work.
        const json = await res.json().catch(() => ({} as { detail?: string; error?: string }))
        setError(json?.detail || json?.error || t('kas.fout.boekingOpslaan'))
      }
    } catch { setError(t('bank.fout.algemeen')) } finally { setSaving(false) }
  }

  async function remove(id: string) {
    setEntries((prev) => prev.filter((e) => e.id !== id)) // optimistic
    // [CASH-DELETE-HONEST] The response was thrown away. A refusal (a 'betaling' row, which
    // belongs to an invoice and is recreated by the reconciler on the next read) or a server
    // error looked exactly like a success: the row disappeared, load() brought it back, and
    // nothing explained why. Read the answer and say it.
    try {
      const res = await fetch(`/api/cash?id=${id}`, { method: 'DELETE' })
      if (!res.ok) {
        const json = await res.json().catch(() => ({} as { detail?: string; error?: string }))
        setError(json?.detail || json?.error || t('kas.fout.boekingVerwijderen'))
      } else {
        setError('')
      }
      await load()
      if (kbOpen) void loadKasboek(kbPeriod)
      // [KAS-NEGATIEF] Removing a receipt is the ordinary way a drawer goes negative — the money
      // that covered the day's expenses is the thing that just disappeared. Re-ask the witness.
      void refreshDrawerAlert()
    } catch {
      setError(t('kas.fout.verwijderd'))
      await load()
      void refreshDrawerAlert()
    }
  }

  // [KAS-UPLOAD] Add a receipt/invoice the owner ALREADY paid in cash. It runs through the normal
  // intake (AI read + duplicate guard), pre-marked "contant betaald" (paid_method=kas + the chosen
  // date), so it lands in the verify queue with method + date pre-filled. The human confirms there,
  // and that confirm books the invoice→kasboek cash settlement automatically — keeping the BTW
  // aftrekbaar. It is deliberately NOT a manual cash 'kosten' entry (that would drop the
  // voorbelasting and double-count once the same receipt is booked as an invoice).
  const [cashUploading, setCashUploading] = useState(false)
  // [COHERENCE-KAS-UPLOAD] The link target depends on WHERE the file actually landed:
  // a recognised invoice/receipt goes to the verify queue (Te verifiëren); an
  // unreadable/unrecognised photo goes to Mijn bestanden. The success link must point
  // to the real destination, never blindly to the verify queue on any res.ok.
  const [cashUploadMsg, setCashUploadMsg] = useState<{ kind: 'ok' | 'warn' | 'err'; text: string; link?: { href: string; label: string } } | null>(null)
  const cashFileRef = useRef<HTMLInputElement | null>(null)

  async function uploadCashInvoice(file: File) {
    setCashUploading(true); setCashUploadMsg(null)
    try {
      // [UPLOAD-PLAFOND] Fit an image OR a PDF to the upload budget, and answer a platform 413 by
      // squeezing harder rather than failing. A kasbon photographed by a modern phone is regularly
      // over the budget, and this screen had no answer for a scanned PDF at all.
      const { response: res } = await sendWithFit(file, (f) => {
        const form = new FormData()
        form.append('file', f)
        form.append('paid_method', 'kas')
        form.append('paid_date', date) // the date chosen in the form above (defaults to today)
        return fetch('/api/intake', { method: 'POST', body: form })
      })
      const json = await res.json().catch(() => ({}))
      if (res.ok && json?.destination === 'document') {
        // [COHERENCE-KAS-UPLOAD] The AI could not read the photo or did not recognise
        // it as an invoice/bon, so paid_method=kas was NOT applied and the file went to
        // Mijn bestanden — NOT the verify queue. Showing "bevestig in Te verifiëren"
        // here would send the owner to an empty queue and the cash payment would never
        // be booked. Surface the server's honest message + a link to where it actually is.
        setCashUploadMsg({
          kind: 'warn',
          text: json?.message || t('kas.upload.nietLezen'),
          link: { href: `/dashboard/bestanden${json?.folder_id ? `?folder=${json.folder_id}` : ''}`, label: t('kas.upload.naarBestanden') },
        })
      } else if (res.ok) {
        setCashUploadMsg({
          kind: 'ok',
          text: t('kas.upload.toegevoegd'),
          link: { href: '/dashboard/incoming', label: t('kas.upload.naarVerifieren') },
        })
      } else if (json?.duplicate) {
        setCashUploadMsg({ kind: 'err', text: t('kas.upload.dubbel') })
      } else {
        setCashUploadMsg({ kind: 'err', text: json?.error || t('kas.upload.mislukt') })
      }
    } catch {
      setCashUploadMsg({ kind: 'err', text: t('kas.upload.misging') })
    } finally {
      setCashUploading(false)
      if (cashFileRef.current) cashFileRef.current.value = ''
    }
  }

  // [CASH-SETTLE] 'betaling' is a system-managed settlement of a cash-paid invoice — labelled
  // for display, but never offered in the add form (CATS), and not manually deletable (undo the
  // payment on the invoice instead; the kasboek then reconciles it away).
  // A 'transfer' is disambiguated by DIRECTION so the accountant sees the real move: cash OUT of
  // the drawer to the bank = storting, cash INTO the drawer from the bank = opname.
  // [PERF] useCallback houdt catLabel stabiel (hij hangt alleen van de constante CATS af),
  // zodat de gememoïseerde filter hieronder een vaste dependency heeft.
  // [TAAL] Plain function, no manual useCallback: `t` comes from translator(useLocale()) —
  // stable per locale by its own cache, but the React Compiler cannot see that cache and
  // refuses to preserve a manual memo whose dependency it cannot prove stable. The compiler
  // memoizes this whole component itself, which is the better half of the bargain anyway.
  const catLabel = (k: string, dir?: 'in' | 'out') => {
    if (k === 'betaling') return t('kas.cat.betaling')
    if (k === 'transfer') return dir === 'in' ? t('kas.cat.opname') : dir === 'out' ? t('kas.cat.storting') : t('kas.cat.transfer')
    const key = CATS.find((c) => c.key === k)?.labelKey
    return key ? t(key) : k
  }

  // [SEARCH] In-page live filter over the cash ledger (omschrijving / categorie / bedrag).
  // [SMART-FILTER] shared matcher — decimaal- én duizendtal-bewust (src/lib/search.ts)
  // [PERF] useMemo: alleen herberekenen als de zoekterm of de boekingen wijzigen —
  // niet bij elke render (typen in het add-formulier raakt dit filter niet).
  const rawK = search.trim()
  // [TAAL] Same trade as catLabel above: the compiler memoizes this, we stop promising.
  const filteredEntries = rawK
    ? entries.filter((e) =>
        rowMatchesQuery(rawK, [e.description, catLabel(e.category, e.direction)], [e.amount])
      )
    : entries

  return (
    <div style={{ minHeight: '100vh', background: '#F8F9FA', fontFamily: FONT }}>
      <div style={{ maxWidth: COLUMN.work, margin: '0 auto', padding: '20px 16px 64px' }}>
        {/* [COHERENCE-ERRSTATE] A failed load must NOT show a reassuring €0,00 saldo that
            looks like an empty drawer. Show the number ONLY when the data actually loaded;
            on error surface an honest banner with a retry instead of a false money figure. */}
        {loadError && (
          <div style={{ margin: '16px 0 0', background: '#FCECEA', border: `1px solid ${M3.error}`, borderRadius: 14, padding: '14px 16px' }}>
            <div style={{ fontSize: 14.5, fontWeight: 700, color: M3.error }}>{t('kas.fout.saldo')}</div>
            <div style={{ fontSize: 13, color: M3.onSurface, marginTop: 4 }}>
              {t('kas.fout.saldoNiet')}
            </div>
            <button
              type="button"
              onClick={() => { setLoading(true); void load() }}
              style={{ marginTop: 10, padding: '8px 16px', borderRadius: 10, border: 'none', background: M3.primary, color: '#fff', fontSize: 13.5, fontWeight: 600, cursor: 'pointer' }}
            >
              {t('inkoop.opnieuwProberen')}
            </button>
          </div>
        )}

        {/* Balance */}
        <div style={{ margin: '16px 0 20px' }}>
          <div style={{ fontSize: 12.5, fontWeight: 700, letterSpacing: 0.6, color: M3.neutral }}>{t('kas.titelSaldo')}</div>
          <div style={{ fontFamily: FONT_NUM, fontSize: 34, fontWeight: 700, color: loadError ? M3.neutral : balance < 0 ? M3.error : M3.onSurface, marginTop: 4 }}>
            {loadError ? '—' : eur.format(balance)}
          </div>
          {/* Gated on a successful load: the figure above already reads '—' on error, and a red
              "negatief saldo" line under a dash is a verdict on a number we did not get. */}
          {!loadError && balance < 0 && (
            <div style={{ fontSize: 12.5, color: M3.error, marginTop: 2 }}>{t('kas.negatiefSaldo')}</div>
          )}
          {/* [KAS-OPENING] Beginsaldo — the cash already in the drawer when you started. Included in
              the saldo above; not counted as omzet. Set it once so the saldo matches reality. */}
          {!openingEdit ? (
            <button
              type="button"
              onClick={() => { setOpeningInput(openingBalance ? String(openingBalance).replace('.', ',') : ''); setOpeningEdit(true); setError('') }}
              style={{ marginTop: 6, background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontSize: 12, color: M3.neutral, textAlign: 'start' }}
            >
              {t('kas.beginsaldoKort')} <strong style={{ color: M3.onSurface }}>{eur.format(openingBalance)}</strong> · {t('kas.wijzigen')}
            </button>
          ) : (
            <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 12.5, color: M3.neutral }}>{t('kas.beginsaldoEuro')}</span>
              <input
                inputMode="decimal" value={openingInput} onChange={(e) => setOpeningInput(e.target.value)}
                placeholder="0,00" autoFocus
                style={{ width: 90, padding: '6px 8px', borderRadius: 8, border: `1px solid ${M3.outlineVariant}`, fontSize: 14, fontFamily: FONT_NUM }}
              />
              <button type="button" onClick={saveOpeningBalance} disabled={openingSaving}
                style={{ padding: '6px 12px', borderRadius: 8, border: 'none', background: M3.primary, color: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
                {openingSaving ? t('act.bezig') : t('kas.opslaan')}
              </button>
              <button type="button" onClick={() => { setOpeningEdit(false); setError('') }}
                style={{ padding: '6px 10px', borderRadius: 8, border: `1px solid ${M3.outlineVariant}`, background: 'none', fontSize: 13, cursor: 'pointer', color: M3.neutral }}>
                {t('lijst.annuleren')}
              </button>
            </div>
          )}
        </div>

        {/* [KAS-NEGATIEF] The dip the headline saldo cannot show. A drawer can go below zero
            mid-quarter and recover before today, so the big number above looks perfectly healthy
            while the kasboek — the document an inspector actually reads, day by day — says money
            was paid out that was never there. The app already knew (it blocks the aangifte on
            exactly this witness); it just never said it on the screen where the owner can fix it.
            The three causes are named, because "your cash is negative" without a next step is an
            accusation, not help. */}
        {/* [NO-EMPTY-LEDGER] The check itself could not run. On this screen an ABSENT warning is
            the only signal that the drawer is fine, so silence here would be a claim we cannot
            back — the same reason the saldo shows '—' instead of €0,00 when its load fails. */}
        {lowestPointUnknown && !lowestPoint && (
          <div style={{ margin: '0 0 20px', background: '#FEF7E0', border: '1px solid #FBBC04', borderRadius: 14, padding: '12px 16px' }}>
            <div style={{ fontSize: 13.5, fontWeight: 700, color: '#7A4F00' }}>{t('kas.fout.controle')}</div>
            <div style={{ fontSize: 12.5, color: M3.onSurface, marginTop: 4, lineHeight: 1.5 }}>
              {t('kas.fout.controleNiet')}
            </div>
          </div>
        )}

        {lowestPoint && (
          <DrawerDipNotice
            tone="blocking"
            heading={t('kas.negatief.titel', { datum: formatDate(lowestPoint.date), bedrag: eur.format(lowestPoint.balance) })}
            period={readinessQuarterLabel()}
            explanation={t('kas.negatief.uitleg')}
            reasons={[t('kas.negatief.reden1'), t('kas.negatief.reden2'), t('kas.negatief.reden3')]}
            closing={t('kas.negatief.blokkeert')}
          />
        )}

        {/* [KAS-NEGATIEF-NU] The same dip in the quarter that is still OPEN — see the openDip state.
            Amber, not red, and it says something different: nothing is being blocked yet, and this is
            the cheap moment. Claiming a blocked aangifte here would simply be false.
            Its own panel rather than a variant of the one above, because both can be true at once:
            two quarters can each hold a dip, and collapsing them would hide one. The period is named
            on both for that reason — two near-identical red blocks with no quarter on them is how an
            owner fixes the wrong one. */}
        {openDip && (
          <DrawerDipNotice
            tone="open"
            heading={t('kas.negatief.titel', { datum: formatDate(openDip.date), bedrag: eur.format(openDip.balance) })}
            period={`Q${currentQuarter().quarter} ${currentQuarter().year}`}
            explanation={t('kas.negatief.uitleg')}
            reasons={[t('kas.negatief.reden1'), t('kas.negatief.reden2'), t('kas.negatief.reden3')]}
            closing={t('kas.negatief.nogNietIngediend')}
          />
        )}

        {/* [KAS-UPLOAD] Add a cash-paid invoice/receipt (photo or PDF). It goes to the verify queue
            pre-marked "contant betaald"; the human confirms and the payment lands in the kasboek
            automatically — the BTW stays aftrekbaar (unlike a plain cash-cost entry). */}
        <div style={{ background: M3.surface, borderRadius: 16, border: `1px solid ${M3.outlineVariant}`, padding: 16, marginBottom: 20 }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: M3.onSurface, marginBottom: 4 }}>{t('kas.contantToevoegen')}</div>
          <div style={{ fontSize: 12.5, color: M3.neutral, marginBottom: 12, lineHeight: 1.45 }}>
            {t('kas.upload.uitleg')}
          </div>
          <input
            ref={cashFileRef} type="file" accept="image/*,application/pdf" style={{ display: 'none' }}
            onChange={(e) => { const f = e.target.files?.[0]; if (f) void uploadCashInvoice(f) }}
          />
          <button
            onClick={() => cashFileRef.current?.click()} disabled={cashUploading}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '11px 16px', borderRadius: 12, border: 'none', cursor: cashUploading ? 'default' : 'pointer', background: M3.primary, color: M3.onPrimary, fontFamily: FONT, fontSize: 14, fontWeight: 600, opacity: cashUploading ? 0.6 : 1 }}
          >
            {cashUploading ? t('kas.upload.bezig') : t('kas.upload.knop')}
          </button>
          {cashUploadMsg && (
            <div style={{ marginTop: 10, fontSize: 12.5, color: cashUploadMsg.kind === 'ok' ? M3.success : cashUploadMsg.kind === 'warn' ? M3.warning : M3.error, lineHeight: 1.45 }}>
              {cashUploadMsg.text}
              {cashUploadMsg.link && (
                <> <a href={cashUploadMsg.link.href} style={{ color: M3.primary, fontWeight: 600 }}>{cashUploadMsg.link.label}</a></>
              )}
            </div>
          )}
        </div>

        {/* Add form */}
        <div style={{ background: M3.surface, borderRadius: 16, border: `1px solid ${M3.outlineVariant}`, padding: 16, marginBottom: 20 }}>
          <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
            <Toggle active={direction === 'in'} onClick={() => setDir('in')} label={t('kas.ontvangen')} color={M3.success} />
            <Toggle active={direction === 'out'} onClick={() => setDir('out')} label={t('kas.uitgegeven')} color={M3.error} />
          </div>

          <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
            <input
              inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0,00"
              style={{ flex: 1, minWidth: 0, padding: '12px 14px', fontSize: 16, borderRadius: 12, border: `1.5px solid ${M3.outlineVariant}`, fontFamily: FONT_NUM, boxSizing: 'border-box' }}
            />
            {/* [DATE-NL] The kasboek date decides the day a cash movement lands on, which is what
                the drawer is reconciled against. Same reason as the payment dialogs. */}
            <DateFieldNL value={date} onChange={setDate} aria-label={t('kas.datum')} />
          </div>

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
            {CATS.map((c) => {
              const active = category === c.key
              return (
                <button key={c.key} onClick={() => setCategory(c.key)}
                  style={{ padding: '7px 12px', borderRadius: 999, fontSize: 13, fontWeight: 500, cursor: 'pointer', fontFamily: FONT,
                    background: active ? M3.primaryContainer : '#F1F3F4', color: active ? '#041E49' : M3.neutral,
                    border: active ? `1px solid ${M3.primary}` : '1px solid transparent' }}>
                  {c.key === 'transfer' ? (direction === 'in' ? t('kas.cat.opname') : t('kas.cat.storting')) : t(c.labelKey)}
                </button>
              )
            })}
          </div>

          {/* BTW rate — only for a cash sale, so verschuldigde BTW is exact. */}
          {category === 'omzet' && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
              <span style={{ fontSize: 13, color: M3.neutral }}>{t('kas.btw')}</span>
              {[21, 9, 0].map((r) => {
                const active = btwRate === r
                return (
                  <button key={r} onClick={() => setBtwRate(r)}
                    style={{ padding: '6px 12px', borderRadius: 999, fontSize: 13, fontWeight: 500, cursor: 'pointer', fontFamily: FONT,
                      background: active ? M3.primaryContainer : '#F1F3F4', color: active ? '#041E49' : M3.neutral,
                      border: active ? `1px solid ${M3.primary}` : '1px solid transparent' }}>
                    {r}%
                  </button>
                )
              })}
            </div>
          )}

          <input
            value={description} onChange={(e) => setDescription(e.target.value)} placeholder={t('kas.omschrijvingOptioneel')}
            style={{ width: '100%', padding: '12px 14px', fontSize: 16, borderRadius: 12, border: `1.5px solid ${M3.outlineVariant}`, fontFamily: FONT, boxSizing: 'border-box', marginBottom: 12 }}
          />

          {error && <div style={{ fontSize: 13, color: M3.error, marginBottom: 10 }}>{error}</div>}

          <button onClick={add} disabled={saving}
            style={{ width: '100%', padding: '12px', borderRadius: 12, border: 'none', background: saving ? '#dadce0' : M3.primary, color: M3.onPrimary, fontSize: 15, fontWeight: 600, cursor: saving ? 'default' : 'pointer', fontFamily: FONT }}>
            {saving ? t('act.bezig') : t('ink.toevoegen')}
          </button>
        </div>

        {/* Ledger */}
        <div style={{ fontSize: 12.5, fontWeight: 700, letterSpacing: 0.6, color: M3.neutral, margin: '0 2px 10px' }}>{t('kas.boekingen')}</div>

        {/* [SEARCH] In-page live filter over the ledger */}
        {!loading && !loadError && entries.length > 0 && (
          <div style={{ position: 'relative', marginBottom: 10 }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#9aa0a6" strokeWidth="2" style={{ position: 'absolute', insetInlineStart: 13, top: '50%', transform: 'translateY(-50%)' }}><circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3" strokeLinecap="round" /></svg>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t('kas.zoek')}
              aria-label={t('kas.zoek.aria')}
              style={{ width: '100%', boxSizing: 'border-box', padding: '10px 38px', borderRadius: 12, border: `1px solid ${M3.outlineVariant}`, fontSize: 14, outline: 'none', background: '#fff', color: M3.onSurface, fontFamily: FONT }}
            />
            {search && (
              <button onClick={() => setSearch('')} aria-label={t('inkoop.wissen')} className="tap-44"
                style={{ position: 'absolute', insetInlineEnd: 10, top: '50%', transform: 'translateY(-50%)', width: 22, height: 22, borderRadius: '50%', border: 'none', background: '#e5e5ea', color: '#3a3a3c', cursor: 'pointer', fontSize: 13, lineHeight: 1 }}>×</button>
            )}
          </div>
        )}

        {loading ? (
          <div style={{ height: 80, borderRadius: 16, background: '#f1f3f4' }} />
        ) : loadError ? (
          <div style={{ background: '#FCECEA', border: `1px solid ${M3.error}`, borderRadius: 16, padding: '24px 20px', textAlign: 'center', color: M3.onSurface, fontSize: 14 }}>
            {t('kas.fout.ladenNietLeeg')}
          </div>
        ) : entries.length === 0 ? (
          <div style={{ background: M3.surface, border: `1px solid ${M3.outlineVariant}`, borderRadius: 16, padding: '24px 20px', textAlign: 'center', color: M3.neutral, fontSize: 14 }}>
            {t('kas.ledgerLeeg')}
          </div>
        ) : filteredEntries.length === 0 ? (
          <div style={{ background: M3.surface, border: `1px solid ${M3.outlineVariant}`, borderRadius: 16, padding: '24px 20px', textAlign: 'center', color: M3.neutral, fontSize: 14 }}>
            {t('kas.geenGevonden', { query: search.trim() })}
          </div>
        ) : (
          <div style={{ background: M3.surface, border: `1px solid ${M3.outlineVariant}`, borderRadius: 16, overflow: 'hidden' }}>
            {filteredEntries.map((e, i) => (
              <div key={e.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', borderTop: i > 0 ? '1px solid #e0e0e0' : 'none' }}>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontSize: 14.5, fontWeight: 600, color: M3.onSurface, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {e.description?.trim() || catLabel(e.category, e.direction)}
                  </div>
                  <div style={{ fontSize: 12, color: M3.neutral, marginTop: 1 }}>{formatDate(e.entry_date)} · {catLabel(e.category, e.direction)}</div>
                </div>
                <div style={{ fontFamily: FONT_NUM, fontSize: 14.5, fontWeight: 700, color: e.direction === 'in' ? M3.success : M3.error, whiteSpace: 'nowrap' }}>
                  {e.direction === 'in' ? '+' : '−'}{eur.format(e.amount)}
                </div>
                {e.category === 'betaling' ? (
                  <span title={t('kas.betalingAutomatisch')}
                    style={{ flexShrink: 0, color: '#70757a', fontSize: 16, lineHeight: 1 }}>🔗</span>
                ) : (
                  <button onClick={() => remove(e.id)} aria-label={t('lijst.verwijderen')}
                    style={{ flexShrink: 0, border: 'none', background: 'transparent', color: '#70757a', fontSize: 18, cursor: 'pointer', lineHeight: 1 }}>×</button>
                )}
              </div>
            ))}
          </div>
        )}

        {/* [KASBOEK] Live quarterly cash book — the running-balance view the accountant gets,
            built live from the till's daily cash takings + these boekingen (never stored twice). */}
        <div style={{ marginTop: 28 }}>
          {!kbOpen ? (
            <button onClick={openKasboek}
              style={{ width: '100%', padding: '13px 16px', borderRadius: 16, border: `1px solid ${M3.outlineVariant}`, background: M3.surface, color: M3.onSurface, fontSize: 14.5, fontWeight: 600, cursor: 'pointer', fontFamily: FONT, textAlign: 'start', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span>{t('kas.kasboekKnop')}</span>
              <span style={{ color: M3.primary, fontSize: 20, lineHeight: 1 }}>＋</span>
            </button>
          ) : (
            <div style={{ background: M3.surface, border: `1px solid ${M3.outlineVariant}`, borderRadius: 16, padding: 16 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                <div style={{ fontSize: 12.5, fontWeight: 700, letterSpacing: 0.6, color: M3.neutral }}>{t('kas.kasboekTitel')}</div>
                <button onClick={() => setKbOpen(false)} aria-label={t('lijst.sluiten')}
                  style={{ border: 'none', background: 'transparent', color: '#70757a', fontSize: 20, cursor: 'pointer', lineHeight: 1 }}>×</button>
              </div>

              {/* Quarter selector */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 14, margin: '10px 0 6px' }}>
                <button onClick={() => kbPeriod && loadKasboek(prevQuarter(kbPeriod.year, kbPeriod.quarter))} disabled={!kbPeriod || kbLoading} aria-label={t('kas.vorigKwartaal')}
                  style={{ border: `1px solid ${M3.outlineVariant}`, background: M3.surface, borderRadius: 999, width: 34, height: 34, cursor: kbPeriod ? 'pointer' : 'default', fontSize: 16, color: M3.onSurface }}>◀</button>
                <div style={{ fontSize: 15.5, fontWeight: 700, color: M3.onSurface, minWidth: 96, textAlign: 'center' }}>
                  {kbPeriod ? `Q${kbPeriod.quarter} ${kbPeriod.year}` : '—'}
                </div>
                {/* Stops at the quarter we are actually in — see currentQuarter(). */}
                {(() => {
                  const atEnd = !kbPeriod || isAtOrAfter(kbPeriod, currentQuarter())
                  return (
                    <button onClick={() => kbPeriod && !atEnd && loadKasboek(nextQuarter(kbPeriod.year, kbPeriod.quarter))} disabled={!kbPeriod || kbLoading || atEnd} aria-label={t('kas.volgendKwartaal')}
                      style={{ border: `1px solid ${M3.outlineVariant}`, background: M3.surface, borderRadius: 999, width: 34, height: 34, cursor: kbPeriod && !atEnd ? 'pointer' : 'default', fontSize: 16, color: M3.onSurface, opacity: atEnd ? 0.4 : 1 }}>▶</button>
                  )
                })()}
              </div>

              {kbLoading ? (
                <div style={{ height: 120, borderRadius: 12, background: '#F0F1F3', marginTop: 10 }} />
              ) : !kb ? (
                <div style={{ textAlign: 'center', color: M3.neutral, fontSize: 14, padding: '20px 0' }}>
                  {t('kas.fout.laden')} <button onClick={() => loadKasboek(kbPeriod)} style={{ border: 'none', background: 'transparent', color: M3.primary, cursor: 'pointer', fontFamily: FONT, fontSize: 14 }}>{t('kas.opnieuw')}</button>
                </div>
              ) : (
                <>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13.5, color: M3.neutral, padding: '6px 2px', borderBottom: `1px solid ${M3.outlineVariant}` }}>
                    <span>{t('kas.beginsaldo')}</span>
                    <span style={{ fontFamily: FONT_NUM, fontWeight: 600, color: M3.onSurface }}>{eur.format(kb.openingBalance)}</span>
                  </div>

                  {kb.months.length === 0 ? (
                    <div style={{ textAlign: 'center', color: M3.neutral, fontSize: 14, padding: '18px 0' }}>
                      {t('kas.leeg')}
                    </div>
                  ) : kb.months.map((m) => (
                    <div key={m.key} style={{ marginTop: 14 }}>
                      <div style={{ fontSize: 13, fontWeight: 700, color: M3.onSurface, marginBottom: 4 }}>{m.label}</div>
                      {/* [LEDGER-SCROLL] A day with BOTH a receipt and an expense packs the fixed
                          date + three nowrap money columns (ontvangsten / uitgaven / eindsaldo)
                          wider than a phone, which starved the description to 0 and clipped the
                          running balance. This is a ledger — the columns must stay aligned — so the
                          strip scrolls horizontally (hidden scrollbar, swipe) below its min width
                          instead of wrapping. On a wide screen the min width is exceeded and nothing
                          scrolls. */}
                      <div style={{ border: `1px solid ${M3.outlineVariant}`, borderRadius: 10, overflow: 'hidden' }}>
                        <div className="inv-strip">
                          {/* One shared min width so every row is the same width and the columns
                              line up; below it the strip scrolls as a unit (see [LEDGER-SCROLL]). */}
                          <div style={{ minWidth: 320 }}>
                        {m.rows.map((r, i) => (
                          <div key={r.date} style={{ display: 'flex', alignItems: 'baseline', gap: 8, padding: '7px 10px', borderTop: i > 0 ? '1px solid #ECEFF1' : 'none', fontSize: 13 }}>
                            <span style={{ width: 52, flexShrink: 0, color: M3.neutral }}>{formatDate(r.date)}</span>
                            <span style={{ flex: 1, minWidth: 0, color: M3.onSurface, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {r.descriptions.length ? r.descriptions.join(' · ') : (r.ontvangsten > 0 ? t('kas.ontvangstenLabel') : t('kas.uitgaveLabel'))}
                            </span>
                            {r.ontvangsten > 0 && <span style={{ fontFamily: FONT_NUM, color: M3.success, whiteSpace: 'nowrap', flexShrink: 0 }}>+{eur.format(r.ontvangsten)}</span>}
                            {r.uitgaven > 0 && <span style={{ fontFamily: FONT_NUM, color: M3.error, whiteSpace: 'nowrap', flexShrink: 0 }}>−{eur.format(r.uitgaven)}</span>}
                            <span style={{ fontFamily: FONT_NUM, fontWeight: 700, color: r.eindsaldo < 0 ? M3.error : M3.onSurface, minWidth: 72, textAlign: 'end', whiteSpace: 'nowrap', flexShrink: 0 }}>{eur.format(r.eindsaldo)}</span>
                          </div>
                        ))}
                        <div style={{ display: 'flex', justifyContent: 'space-between', padding: '7px 10px', borderTop: `1px solid ${M3.outlineVariant}`, background: '#FAFAFA', fontSize: 12.5, fontWeight: 600, color: M3.neutral }}>
                          <span>{t('kas.totaalMaand', { maand: m.label })}</span>
                          <span style={{ fontFamily: FONT_NUM }}>+{eur.format(m.totalIn)} · −{eur.format(m.totalOut)}</span>
                        </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}

                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14, fontWeight: 700, padding: '10px 2px 2px', marginTop: 8, borderTop: `2px solid ${M3.outlineVariant}` }}>
                    <span>{t('kas.eindsaldo')}</span>
                    <span style={{ fontFamily: FONT_NUM, color: kb.closingBalance < 0 ? M3.error : M3.onSurface }}>{eur.format(kb.closingBalance)}</span>
                  </div>

                  {kbPeriod && (
                    <a href={`/api/kasboek?year=${kbPeriod.year}&quarter=${kbPeriod.quarter}&format=xlsx`}
                      style={{ display: 'block', marginTop: 14, padding: '11px', borderRadius: 12, background: M3.primaryContainer, color: '#041E49', fontSize: 14, fontWeight: 600, textAlign: 'center', textDecoration: 'none', fontFamily: FONT }}>
                      {t('kas.downloadXlsx')}
                    </a>
                  )}
                  <div style={{ fontSize: 11.5, color: M3.neutral, marginTop: 8, lineHeight: 1.4 }}>
                    {t('kas.kasboekUitleg')}
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

/**
 * [KAS-NEGATIEF] A drawer that went below zero, in one quarter, said once.
 *
 * Two callers, two tones, and the difference between them is a fact about the quarter rather than a
 * decoration: a dip in the quarter the filing gate is refusing right now is red and says the aangifte
 * is blocked; the same dip in the quarter still open is amber and says it is not blocked yet. The
 * copy for both is handed in — [TAAL] this component holds no language of its own, so it cannot be
 * the place a Dutch sentence survives a translation pass.
 */
function DrawerDipNotice({ tone, heading, period, explanation, reasons, closing }: {
  tone: 'blocking' | 'open'
  heading: string
  /** "Q2 2026" — a period label, identical in every language. Named on BOTH panels so that when
   *  they appear together the owner can tell which quarter each one is about. */
  period: string | null
  explanation: string
  reasons: string[]
  closing: string
}) {
  const blocking = tone === 'blocking'
  const accent = blocking ? M3.error : '#B06000'
  return (
    <div style={{
      margin: '0 0 20px', background: blocking ? '#FCECEA' : '#FEF7E0',
      border: `1px solid ${blocking ? M3.error : '#FBBC04'}`, borderRadius: 14, padding: '14px 16px',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <span className="material-symbols-outlined" style={{ fontSize: 18, color: accent }}>
          {blocking ? 'error' : 'warning'}
        </span>
        <div style={{ fontSize: 14.5, fontWeight: 700, color: accent }}>{heading}</div>
        {period && (
          <span style={{ fontSize: 11.5, fontWeight: 700, color: accent, border: `1px solid ${accent}`, borderRadius: 999, padding: '1px 8px', fontFamily: FONT_NUM }}>
            {period}
          </span>
        )}
      </div>
      <div style={{ fontSize: 13, color: M3.onSurface, marginTop: 6, lineHeight: 1.5 }}>{explanation}</div>
      {/* [TAAL] The mid-sentence <strong> tags were dropped: emphasis cannot travel through a
          translated sentence whose word order changes (see messages.ts rule 1). */}
      <ul style={{ fontSize: 13, color: M3.onSurface, margin: '8px 0 0', paddingInlineStart: 18, lineHeight: 1.6 }}>
        {reasons.map((r) => <li key={r}>{r}</li>)}
      </ul>
      <div style={{ fontSize: 12.5, color: M3.neutral, marginTop: 8 }}>{closing}</div>
    </div>
  )
}

function Toggle({ active, onClick, label, color }: { active: boolean; onClick: () => void; label: string; color: string }) {
  return (
    <button onClick={onClick}
      style={{ flex: 1, padding: '10px', borderRadius: 12, fontSize: 14, fontWeight: 600, cursor: 'pointer', fontFamily: FONT,
        background: active ? color : '#F1F3F4', color: active ? '#fff' : '#5F6368', border: 'none' }}>
      {label}
    </button>
  )
}
