'use client'

// src/app/dashboard/clients/[id]/kwartaal/page.tsx
// [BOEK-028] Kwartaal page — per client, per quarter — May 2026
// Accessible via: /dashboard/clients/[id]/kwartaal?q=1&year=2026
// [BRIDGE-A] Shows ALL shared invoices (sent/received/paid) filtered by quarter
// Accounting split: Debiteuren / Crediteuren / Voldaan — Verlopen computed at display
// Inline expand on row click — no page navigation
// Action dropdown: Verwerkt / In behandeling / Vraag (Not Found removed)

import { useState, useEffect, useRef } from 'react'
import { createClient } from '@/lib/supabase'
import { useRouter, useParams, useSearchParams } from 'next/navigation'
import { useSubPageHeader } from '@/components/nav/SubPageHeaderContext'
import { rowMatchesQuery } from '@/lib/search'
import type { InvoiceRow, ProfileRow } from '@/types/rows'
import { useDialog } from '@/components/ui/Dialog'
import { useToast } from '@/components/ui/Toast'
import { EL1, M3, R, COLUMN } from '@/lib/design/tokens'

// De kwartaalpagina leest alleen deze velden van een factuur. Ze expliciet noemen maakt
// zichtbaar waar de pagina van afhangt — en dat `total_inc_btw` en `btw_amount` in de
// database leeg mogen zijn, wat de rekenhulpen hieronder nu netjes afvangen.
type KwartaalInvoice = Pick<InvoiceRow,
  'id' | 'direction' | 'status' | 'due_date' | 'invoice_date' | 'invoice_number' |
  'invoice_type' | 'client_name' | 'total_ex_btw' | 'btw_amount' | 'total_inc_btw' |
  'marked_paid_at' | 'accountant_status' | 'accountant_note' | 'pdf_url' |
  'client_btw_number' | 'replaced_by_number'>

// ─────────────────────────────────────────────────────────
// Types & constants
// ─────────────────────────────────────────────────────────

// [BOEK-028] Not Found removed — 3 actions only
const ACCOUNTANT_ACTIONS = [
  { value: 'verwerkt',       label: 'Verwerkt',        bg: '#E6F4EA', color: '#137333', rowBg: '#F2FAF4' },
  { value: 'in_behandeling', label: 'In behandeling',  bg: '#FEF7E0', color: '#EA8600', rowBg: '#FEFCF0' },
  { value: 'vraag',          label: 'Vraag',           bg: '#E8F0FE', color: '#1967D2', rowBg: '#F0F4FF' },
] as const

type ActionValue = 'verwerkt' | 'in_behandeling' | 'vraag'

// Quarter date ranges
const QUARTER_RANGES: Record<number, { start: string; end: string; label: string }> = {
  1: { start: '-01-01', end: '-03-31', label: 'jan – mrt' },
  2: { start: '-04-01', end: '-06-30', label: 'apr – jun' },
  3: { start: '-07-01', end: '-09-30', label: 'jul – sep' },
  4: { start: '-10-01', end: '-12-31', label: 'okt – dec' },
}

// [BOEK-028] Fixed Dutch formatting — never changes
const NL_NUMBER = new Intl.NumberFormat('nl-NL', { style: 'currency', currency: 'EUR' })
const NL_DATE   = new Intl.DateTimeFormat('nl-NL')

function fmt(d: string | null | undefined) {
  if (!d) return '—'
  try { return NL_DATE.format(new Date(d)) } catch { return d ?? '—' }
}

// [BOEK-028] Amount: outgoing = positive, incoming = negative
function getAmount(inv: KwartaalInvoice): number {
  const total = inv.total_inc_btw ?? 0
  return inv.direction === 'outgoing' ? total : -total
}

// btw_rate does not exist in DB — always calculate
function getBtwRate(inv: KwartaalInvoice): number {
  if (!inv.total_ex_btw || inv.total_ex_btw === 0) return 0
  return Math.round(((inv.btw_amount ?? 0) / inv.total_ex_btw) * 100)
}

// [BRIDGE-A] Accounting split — section definitions (accountant terminology)
const SECTIONS = [
  { key: 'debiteuren',  title: 'Debiteuren',  sub: 'verzonden — nog te ontvangen',
    filter: (i: KwartaalInvoice) => i.direction === 'outgoing' && i.status === 'sent' },
  { key: 'crediteuren', title: 'Crediteuren', sub: 'ontvangen — nog te betalen',
    filter: (i: KwartaalInvoice) => i.direction === 'incoming' && i.status === 'received' },
  { key: 'voldaan',     title: 'Voldaan',     sub: 'betaald',
    filter: (i: KwartaalInvoice) => i.status === 'paid' },
] as const

// [BRIDGE-A] Verlopen is computed at display time — never stored in DB
function isVerlopen(inv: KwartaalInvoice): boolean {
  return inv.status === 'sent' && !!inv.due_date && new Date(inv.due_date) < new Date()
}

// ─────────────────────────────────────────────────────────
// Components
// ─────────────────────────────────────────────────────────

function ActionBadge({ value }: { value: string | null }) {
  const a = ACCOUNTANT_ACTIONS.find(x => x.value === value)
  if (!a) return (
    <span style={{ fontSize: 12, padding: "2px 8px", borderRadius: 4, backgroundColor: "#F1F3F4", color: "#5F6368" }}>—</span>
  )
  return (
    <span style={{ fontSize: 12, padding: "2px 8px", borderRadius: 4, fontWeight: 500, backgroundColor: a.bg, color: a.color }}>
      {a.label}
    </span>
  )
}

// ─────────────────────────────────────────────────────────
// Main component
// ─────────────────────────────────────────────────────────

export default function KwartaalPage() {
  const dialog = useDialog()
  const toast = useToast()
  const router       = useRouter()
  const params       = useParams()
  const searchParams = useSearchParams()
  const supabase     = createClient()

  // [BOEK-028] Next.js 15: params is a Promise — use useParams() which resolves it
  const clientId = params?.id as string
  const q        = Number(searchParams.get('q') ?? 1)
  const year     = Number(searchParams.get('year') ?? new Date().getFullYear())

  const range = QUARTER_RANGES[q] ?? QUARTER_RANGES[1]
  const dateStart = `${year}${range.start}`
  const dateEnd   = `${year}${range.end}`

  const [client, setClient] = useState<ProfileRow | null>(null)
  const [invoices, setInvoices] = useState<KwartaalInvoice[]>([])
  const [loading, setLoading] = useState(true)
  // [TRUST-ACCOUNTANT] The quarter tiles must show the SAME reconciled, turnover-aware
  // figures as the owner's /klaar, the Brug hub and the ZIP — not an invoices-only
  // client-side sum (which, for a retail/cash client, is a fraction of the real omzet
  // and prints a "BTW totaal" that is a naive both-direction sum, equal to neither 5a
  // nor 5g). Sourced from /api/result (omzet/kosten) + /api/aangifte (5g saldo), the
  // exact endpoints the Brug KwartaalPanel already uses. One client, one truth.
  const [recon, setRecon] = useState<{ omzet: number; kosten: number; saldo: number } | null>(null)
  const [sortAsc, setSortAsc] = useState(false)
  const [search, setSearch] = useState('')
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [updatingId, setUpdatingId] = useState<string | null>(null)
  // [COHERENCE-CLOSING] Generate the closing package right where the accountant finishes
  // the quarter — no need to go back to /dashboard/quarterly and re-pick the same client.
  const [packaging, setPackaging] = useState(false)
  const [packageError, setPackageError] = useState<string | null>(null)

  // ── [BRIDGE-NOTIF] Deep-link focus from a notification (?focus={invoiceId}) ──
  // The accountant clicks an enriched notification and lands on the exact row:
  // auto-expand, scroll into view, brief highlight ring.
  const focusId = searchParams.get('focus')
  const [highlightId, setHighlightId] = useState<string | null>(null)
  const rowRefs = useRef<Record<string, HTMLDivElement | null>>({})

  useEffect(() => {
    async function load() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { router.push('/login'); return }

      // Client profile
      const { data: clientData } = await supabase
        .from('profiles').select('*').eq('id', clientId).single()
      if (clientData) setClient(clientData)

      // [BRIDGE-A] Two queries — outgoing + incoming — merged, then split by section
      // Outgoing: sent (Debiteuren) + paid (Voldaan). 'voldaan' removed — never a DB value.
      const { data: outgoing } = await supabase
        .from('invoices')
        .select('*, invoice_lines(*), invoice_type, replaced_by_number')
        .eq('sender_id', clientId)
        .eq('direction', 'outgoing')
        .in('status', ['sent', 'paid'])
        .gte('invoice_date', dateStart)
        .lte('invoice_date', dateEnd)

      // Incoming: received (Crediteuren) + paid (Voldaan).
      const { data: incoming } = await supabase
        .from('invoices')
        .select('*, invoice_lines(*), invoice_type, replaced_by_number')
        .eq('receiver_id', clientId)
        .eq('direction', 'incoming')
        .in('status', ['received', 'paid'])
        .gte('invoice_date', dateStart)
        .lte('invoice_date', dateEnd)

      // [FIN-4-ROWS] NULL-direction rows this client owns are counted by the
      // reconciled tiles (which infer direction from ownership) but were absent
      // from the two typed queries above, so "tile total ≠ sum of visible rows".
      // Fetch them by ownership, infer direction the same way, and keep only the
      // (direction, status) combos the sections show — so the list matches the tiles.
      const { data: nullDir } = await supabase
        .from('invoices')
        .select('*, invoice_lines(*), invoice_type, replaced_by_number')
        .or(`sender_id.eq.${clientId},receiver_id.eq.${clientId}`)
        .is('direction', null)
        .in('status', ['sent', 'received', 'paid'])
        .gte('invoice_date', dateStart)
        .lte('invoice_date', dateEnd)

      const inferred = (nullDir ?? [])
        .map((inv) => {
          const dir = inv.receiver_id === clientId ? 'incoming'
            : inv.sender_id === clientId ? 'outgoing' : null
          return dir ? { ...inv, direction: dir } : null
        })
        .filter((inv): inv is NonNullable<typeof inv> => inv !== null)
        .filter((inv) =>
          inv.direction === 'outgoing'
            ? inv.status === 'sent' || inv.status === 'paid'
            : inv.status === 'received' || inv.status === 'paid'
        )

      const merged = [...(outgoing ?? []), ...(incoming ?? []), ...inferred]
      setInvoices(merged)
      setLoading(false)

      // [TRUST-ACCOUNTANT] Reconciled quarter figures — same source as the ZIP + owner.
      try {
        const params = new URLSearchParams({ year: String(year), quarter: String(q), clientId })
        const [rRes, aRes] = await Promise.all([
          fetch(`/api/result?${params}`),
          fetch(`/api/aangifte?${params}`),
        ])
        if (rRes.ok && aRes.ok) {
          const pnl = await rRes.json()
          const btw = await aRes.json()
          // [TRUST-ACCOUNTANT] Read the ACTUAL response shape: /api/result nests the P&L
          // under `result`, /api/aangifte nests the concept under `aangifte`. Reading
          // pnl.omzet / btw.saldo (the old bug) was always undefined → a confident €0,00
          // shown as reconciled truth for every client and quarter. Only set recon when all
          // three are real numbers; otherwise leave it null so the tiles keep the "…" dash
          // instead of inventing a zero.
          const omzet = Number(pnl?.result?.omzet)
          const kosten = Number(pnl?.result?.kosten)
          const saldo = Number(btw?.aangifte?.saldo)
          if ([omzet, kosten, saldo].every(Number.isFinite)) {
            setRecon({ omzet, kosten, saldo })
          }
        }
      } catch { /* leave recon null → tiles show a loading dash, never a wrong number */ }
    }
    load()
  }, [clientId, q, year])

  // [BRIDGE-NOTIF] When invoices are loaded and a ?focus= row exists, reveal it.
  useEffect(() => {
    if (!focusId || loading) return
    if (!invoices.some(i => i.id === focusId)) return
    // De onthulling hoort bij dezelfde beweging als het scrollen: binnen de wikkel draait
    // ze in dezelfde tick, maar telt ze niet als synchrone setState in de effect-body.
    void (async () => {
      setExpandedId(focusId)
      setHighlightId(focusId)
    })()
    const scrollTimer = setTimeout(() => {
      rowRefs.current[focusId]?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }, 100)
    const fadeTimer = setTimeout(() => setHighlightId(null), 3200)
    return () => { clearTimeout(scrollTimer); clearTimeout(fadeTimer) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusId, loading, invoices.length])

  // [BOEK-028] Sort by marked_paid_at DESC default
  const sorted = [...invoices].sort((a, b) => {
    const da = new Date(a.marked_paid_at ?? a.invoice_date ?? 0).getTime()
    const db = new Date(b.marked_paid_at ?? b.invoice_date ?? 0).getTime()
    return sortAsc ? da - db : db - da
  })

  // [SMART-FILTER] In-page live filter over the quarter's invoices (factuurnummer /
  // klant / bedrag), via the shared decimal-aware matcher. Filters within the fixed
  // status sections below — no navigation.
  const rawKw = search.trim()
  const shown = rawKw
    ? sorted.filter((inv) => rowMatchesQuery(rawKw, [inv.invoice_number, inv.client_name], [getAmount(inv)]))
    : sorted

  // [TRUST-ACCOUNTANT] The invoices-only client-side totals were removed — the quarter
  // tiles now use the reconciled /api/result + /api/aangifte figures (see `recon`), so
  // the accountant sees the SAME numbers as the owner and the ZIP.

  // [BOEK-028] accountant_status update
  // [BOEK-006] action can be null = "niet verwerkt" (neutral, accountant hasn't acted)
  async function handleAction(invoiceId: string, action: ActionValue | null) {
    setUpdatingId(invoiceId)

    // [BOEK-006] null clears the status (neutral state)
    const update: Record<string, string | null> = { accountant_status: action }

    // NOTE: 'voldaan' is a UI-only label, NOT a DB status (violates CHECK).
    // Creditnota stays 'paid' in DB; the UI shows "Voldaan" based on type+status.
    // (removed the previous update.status = 'voldaan' which caused a 23514 error)

    setInvoices(prev => prev.map(i =>
      i.id === invoiceId ? { ...i, accountant_status: action } : i
    ))
    const { error } = await supabase.from('invoices').update(update).eq('id', invoiceId)
    if (error) {
      // revert optimistic on failure
      setInvoices(prev => prev.map(i =>
        i.id === invoiceId ? { ...i, accountant_status: invoices.find(x => x.id === invoiceId)?.accountant_status ?? null } : i
      ))
      // [HONESTY] The revert used to happen in silence: the chip you had just
      // set slid back to its old value and nothing said why. On a screen whose
      // whole job is asserting what has been checked, a status that undoes
      // itself without a word is the one thing that must never happen.
      toast('Status niet opgeslagen — probeer het opnieuw.', { tone: 'error' })
    } else if (action === 'verwerkt' || action === 'vraag') {
      // [READINESS-P3] Close the trust loop with the client — for BOTH 'verwerkt'
      // AND 'vraag'. Previously only 'verwerkt' notified, so a 'vraag' silently
      // told the client nothing (they learned of a question only by luck).
      // Non-blocking; the status change already succeeded. clientId IS the ZZP'er's
      // profile id; the route verifies the accountant↔client link + writes via
      // service_role.
      const inv = invoices.find(x => x.id === invoiceId)
      const nrLabel = inv?.invoice_number ? `factuur ${inv.invoice_number}` : 'een factuur'
      const party = typeof inv?.client_name === 'string' && inv.client_name.trim()
        ? ` (${inv.client_name.trim()})`
        : ''
      // Direction-aware target: outgoing lives in /facturen, incoming in /incoming/manage.
      const target = inv?.direction === 'outgoing'
        ? `/dashboard/facturen?focus=${invoiceId}`
        : `/dashboard/incoming/manage?focus=${invoiceId}`

      let title: string
      let body: string
      if (action === 'verwerkt') {
        const amount = typeof inv?.total_inc_btw === 'number' && inv.total_inc_btw > 0
          ? ` · ${new Intl.NumberFormat('nl-NL', { style: 'currency', currency: 'EUR' }).format(inv.total_inc_btw)}`
          : ''
        title = 'Factuur verwerkt'
        body = `Je boekhouder heeft ${nrLabel}${party}${amount} verwerkt.`
      } else {
        // 'vraag' — capture an optional free-text question to send to the client.
        // This text lands on the client's own screen as a notification, so it is
        // written in the app's dialog: a textarea with the 200-character limit
        // shown as you type, rather than a one-line browser prompt that silently
        // truncated whatever did not fit.
        const q = (await dialog.prompt({
          title: 'Vraag aan de klant',
          message: `Je klant krijgt dit te zien bij ${nrLabel}${party}. Laat je het leeg, dan melden we alleen dát je een vraag hebt.`,
          placeholder: 'Waar gaat deze factuur over?',
          multiline: true,
          maxLength: 200,
          confirmLabel: 'Vraag versturen',
          required: false,
        }))?.trim()
        title = 'Vraag van je boekhouder'
        body = q
          ? q.slice(0, 200)
          : `Je boekhouder heeft een vraag over ${nrLabel}${party}.`
      }
      try {
        await fetch('/api/notifications/notify-client', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ clientId, title, body, type: 'status', link: target }),
        })
      } catch { /* non-blocking — status already saved */ }
    }
    setUpdatingId(null)
  }

  // [SUBNAV] Quarter + client name as the shared header title, with the sort
  // toggle relocated to the bar's actions slot. Called unconditionally (before
  // the loading return) so hook order stays stable.
  useSubPageHeader(
    {
      title: `Q${q} ${year}${client ? ` — ${client.company_name || client.full_name}` : ''}`,
      actions: (
        <button
          onClick={() => setSortAsc(p => !p)}
          style={{ fontSize: 13, fontWeight: 500, color: '#1A73E8', backgroundColor: '#E8F0FE', border: 'none', borderRadius: 8, padding: '6px 12px', cursor: 'pointer', whiteSpace: 'nowrap' }}>
          {sortAsc ? 'Oudste ↑' : 'Nieuwste ↓'}
        </button>
      ),
    },
    [q, year, client?.company_name, client?.full_name, sortAsc]
  )

  if (loading) return (
    <div className="min-h-screen flex items-center justify-center"
      style={{ backgroundColor: '#F8F9FA', minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <p style={{ fontSize: 14, color: '#5F6368' }}>Laden...</p>
    </div>
  )

  return (
    <div style={{ minHeight: '100vh', backgroundColor: '#F8F9FA', fontFamily: "'Roboto', sans-serif" }}>

      <div style={{ maxWidth: COLUMN.work, margin: '0 auto', padding: '24px', display: 'flex', flexDirection: 'column', gap: 16 }}>

        {/* [BRIDGE-A][POLISH ب-2/ب-3] Dead buttons removed (PDF Bank/CAMT/KW — legacy
            pre-pivot idea, never wired). Documenten now opens the Brug — the hub. */}
        <button
          onClick={() => router.push('/dashboard/brug')}
          style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, padding: '12px 16px', backgroundColor: M3.surface, borderRadius: R.lg, boxShadow: EL1, cursor: 'pointer', transition: 'background 0.1s ease', width: '100%' }}
        >
          <span className="text-xl">📂</span>
          <span className="text-xs font-semibold" style={{ color: '#ff6b00', fontSize: 13 }}>Documenten — bekijk in Brug</span>
          <span style={{ color: '#1A73E8', fontWeight: 600 }}>→</span>
        </button>

        {/* [COHERENCE-CLOSING] Download the closing package HERE — the exact place the
            accountant finishes marking the quarter Verwerkt. It used to live only on
            /dashboard/quarterly and the Brug, forcing a client re-selection at the finish
            line. clientId/q/year are already in scope. Same ZIP endpoint as QuarterlyOverview. */}
        <button
          onClick={async () => {
            setPackaging(true); setPackageError(null)
            try {
              const qp = new URLSearchParams({ year: String(year), quarter: String(q), clientId })
              const res = await fetch(`/api/closing-package?${qp}`)
              if (!res.ok) { setPackageError('Pakket genereren mislukt — probeer opnieuw.'); return }
              const blob = await res.blob()
              const url = URL.createObjectURL(blob)
              const a = document.createElement('a')
              a.href = url
              a.download = `kwartaalpakket-Q${q}-${year}.zip`
              a.click()
              URL.revokeObjectURL(url)
            } catch {
              setPackageError('Pakket genereren mislukt — probeer opnieuw.')
            } finally {
              setPackaging(false)
            }
          }}
          disabled={packaging}
          style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, padding: '12px 16px', backgroundColor: packaging ? '#F1F3F4' : '#1A73E8', border: 'none', borderRadius: 8, cursor: packaging ? 'default' : 'pointer', transition: 'background 0.1s ease', width: '100%' }}
        >
          <span className="text-xl">📦</span>
          <span className="text-xs font-semibold" style={{ color: packaging ? '#5F6368' : '#FFFFFF', fontSize: 13 }}>
            {packaging ? 'Kwartaalpakket genereren…' : 'Download kwartaalpakket (ZIP)'}
          </span>
        </button>
        {packageError && (
          <p style={{ fontSize: 12.5, color: '#B3261E', margin: '-8px 2px 0' }}>{packageError}</p>
        )}

        {/* Quarter summary */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
          {[
            // [TRUST-ACCOUNTANT] Reconciled, turnover-aware figures (same as the ZIP +
            // owner). While they load, show "…" rather than a wrong invoices-only sum.
            { label: 'Omzet (excl. BTW)',  value: recon ? NL_NUMBER.format(recon.omzet) : '…',  color: M3.success },
            { label: 'Kosten (excl. BTW)', value: recon ? NL_NUMBER.format(recon.kosten) : '…', color: M3.error },
            { label: 'BTW te betalen (5g)', value: recon ? NL_NUMBER.format(recon.saldo) : '…', color: '#7b1fa2' },
          ].map(s => (
            <div key={s.label} style={{ backgroundColor: M3.surface, borderRadius: R.lg, boxShadow: EL1, padding: 12, textAlign: 'center' }}>
              <p style={{ fontSize: 11, color: '#5F6368', marginBottom: 2 }}>{s.label}</p>
              <p style={{ fontSize: 14, fontWeight: 600, color: s.color, margin: 0 }}>{s.value}</p>
            </div>
          ))}
        </div>

        {/* [BOEK-028] Invoice table — outgoing + incoming merged */}
        <div style={{ backgroundColor: M3.surface, borderRadius: R.lg, boxShadow: EL1, overflow: 'hidden' }}>

          <div style={{ padding: '12px 16px', borderBottom: '1px solid #E0E0E0' }}>
            <h2 style={{ fontSize: 16, fontWeight: 600, color: '#202124', margin: 0 }}>
              Facturen
              <span style={{ fontSize: 14, fontWeight: 400, marginLeft: 6, color: '#5F6368' }}>
                ({invoices.length})
              </span>
            </h2>
          </div>

          {sorted.length > 0 && (
            <div style={{ padding: '12px 16px', borderBottom: '1px solid #E0E0E0', position: 'relative' }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#9aa0a6" strokeWidth="2" style={{ position: 'absolute', left: 28, top: '50%', transform: 'translateY(-50%)' }}><circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3" strokeLinecap="round" /></svg>
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Zoek op factuurnummer, klant of bedrag…"
                aria-label="Facturen zoeken"
                style={{ width: '100%', boxSizing: 'border-box', padding: '9px 34px', borderRadius: 8, border: '1px solid #E0E0E0', fontSize: 14, outline: 'none', color: '#202124', fontFamily: "'Roboto', sans-serif" }}
              />
              {search && (
                <button onClick={() => setSearch('')} aria-label="Wissen" className="tap-44" style={{ position: 'absolute', right: 24, top: '50%', transform: 'translateY(-50%)', width: 20, height: 20, borderRadius: '50%', border: 'none', background: '#E0E0E0', color: '#5F6368', cursor: 'pointer', fontSize: 12, lineHeight: 1 }}>×</button>
              )}
            </div>
          )}

          {sorted.length === 0 ? (
            <p style={{ fontSize: 14, color: '#5F6368', textAlign: 'center', padding: '48px 0' }}>
              Geen facturen in Q{q} {year}
            </p>
          ) : shown.length === 0 ? (
            <p style={{ fontSize: 14, color: '#5F6368', textAlign: 'center', padding: '48px 0' }}>
              Geen facturen gevonden voor &ldquo;{rawKw}&rdquo;
            </p>
          ) : (
            <div style={{ borderTop: '1px solid #E0E0E0' }}>
              {/* [BRIDGE-A] Accounting sections — empty sections hidden */}
              {SECTIONS.map(section => {
                const rows = shown.filter(section.filter)
                if (rows.length === 0) return null
                return (
                  <div key={section.key}>
                    <div style={{ padding: '10px 16px', backgroundColor: '#F8F9FA', borderBottom: '1px solid #E0E0E0', display: 'flex', alignItems: 'baseline', gap: 8 }}>
                      <h3 style={{ fontSize: 13, fontWeight: 600, color: '#202124', margin: 0 }}>{section.title}</h3>
                      <span style={{ fontSize: 12, color: '#5F6368' }}>({rows.length}) · {section.sub}</span>
                    </div>
                    {rows.map(invoice => {
                const amount      = getAmount(invoice)
                const isExpanded  = expandedId === invoice.id
                const isUpdating  = updatingId === invoice.id
                const isOutgoing  = invoice.direction === 'outgoing'
                const rowBg       = ACCOUNTANT_ACTIONS.find(a => a.value === invoice.accountant_status)?.rowBg

                return (
                  <div key={invoice.id}
                    ref={el => { rowRefs.current[invoice.id] = el }}
                    style={{
                      backgroundColor: rowBg,
                      opacity: isUpdating ? 0.6 : 1,
                      boxShadow: highlightId === invoice.id ? '0 0 0 2px #1A73E8' : undefined,
                      transition: 'box-shadow 0.4s ease',
                    }}>

                    {/* Main row — click to expand inline */}
                    <div
                      className="px-4 py-3 cursor-pointer active:opacity-80 transition-opacity"
                      onClick={() => {
                        setExpandedId(isExpanded ? null : invoice.id)
                      }}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 min-w-0">
                            {/* [ROW-LAYOUT] minWidth:0 lets the invoice number actually ellipsize in
                                this flex row; without it a long number spills over the badges/amount. */}
                            <p style={{ minWidth: 0, fontSize: 14, fontWeight: 500, color: '#202124', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {/* [QUARTER-VENDOR-NAME v2] invoice_number primary — matches bridge pattern */}
                              {invoice.invoice_number}
                            </p>
                            {/* direction badge */}
                            <span className="text-xs px-1.5 py-0.5 rounded font-medium flex-shrink-0"
                              style={{
                                backgroundColor: isOutgoing ? '#E6F4EA' : '#FCE8E6',
                                color: isOutgoing ? '#137333' : '#C5221F',
                              }}>
                              {isOutgoing ? 'Uitg.' : 'Ink.'}
                            </span>
                            {/* [BRIDGE-A] Verlopen — computed, display-only */}
                            {isVerlopen(invoice) && (
                              <span className="text-xs px-1.5 py-0.5 rounded font-medium flex-shrink-0"
                                style={{ backgroundColor: '#F9DEDC', color: '#B3261E' }}>
                                Verlopen
                              </span>
                            )}
                            {invoice.invoice_type === 'creditnota' && (
                              <span className="text-xs px-1.5 py-0.5 rounded font-medium"
                                style={{ fontSize: 11, padding: '2px 6px', borderRadius: 4, backgroundColor: '#FCE8E6', color: '#C5221F', fontWeight: 500 }}>
                                Creditnota
                              </span>
                            )}
                          </div>
                          <p style={{ fontSize: 12, color: '#5F6368', marginTop: 2 }}>
                            {/* [QUARTER-VENDOR-NAME v2] party name secondary — incoming=vendor, outgoing=client */}
                            {invoice.client_name && (
                              <span style={{ fontWeight: 500, color: '#202124' }}>{invoice.client_name} · </span>
                            )}
                            {fmt(invoice.invoice_date)}
                            {invoice.marked_paid_at && (
                              <span> · betaald {fmt(invoice.marked_paid_at)}</span>
                            )}
                          </p>
                        </div>

                        <div className="flex items-center gap-2 flex-shrink-0">
                          <p style={{ fontSize: 14, fontWeight: 600, color: amount >= 0 ? '#34A853' : '#EA4335', fontFamily: "'Roboto Mono', monospace" }}>
                            {NL_NUMBER.format(amount)}
                          </p>
                        </div>
                      </div>

                      {/* [BOEK-006] status badge preview (when collapsed) */}
                      {!isExpanded && invoice.accountant_status && (
                        <div className="mt-1.5">
                          <ActionBadge value={invoice.accountant_status} />
                        </div>
                      )}
                    </div>

                    {/* [BOEK-028] Inline expand — no page navigation */}
                    {isExpanded && (
                      <div className="px-4 pb-4 pt-1" onClick={e => e.stopPropagation()}>
                        <div style={{ backgroundColor: '#F8F9FA', border: '1px solid #E0E0E0', borderRadius: 8, padding: 16, display: 'flex', flexDirection: 'column', gap: 8 }}>

                          {/* [BOEK-006] Status actions — 3 states + neutral, one tap */}
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, paddingBottom: 10, borderBottom: '1px solid #E0E0E0' }}>
                            <span style={{ fontSize: 12, color: '#5F6368', fontWeight: 500 }}>Status</span>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                              {ACCOUNTANT_ACTIONS.map(a => {
                                const active = invoice.accountant_status === a.value
                                return (
                                  <button key={a.value}
                                    onClick={() => handleAction(invoice.id, active ? null : a.value)}
                                    style={{
                                      padding: '8px', borderRadius: 6, fontSize: 12, fontWeight: 500,
                                      backgroundColor: active ? a.bg : '#FFFFFF',
                                      color: active ? a.color : '#5F6368',
                                      border: active ? `1px solid ${a.color}` : '1px solid #E0E0E0',
                                      cursor: 'pointer',
                                    }}>
                                    {a.label}
                                  </button>
                                )
                              })}
                              {/* neutral — accountant hasn't acted */}
                              <button
                                onClick={() => handleAction(invoice.id, null)}
                                style={{
                                  padding: '8px', borderRadius: 6, fontSize: 12, fontWeight: 500,
                                  backgroundColor: !invoice.accountant_status ? '#f1f3f4' : '#FFFFFF',
                                  color: !invoice.accountant_status ? '#5f6368' : '#5F6368',
                                  border: !invoice.accountant_status ? '1px solid #5f6368' : '1px solid #E0E0E0',
                                  cursor: 'pointer',
                                }}>
                                Niet verwerkt
                              </button>
                            </div>
                          </div>

                          {/* Client info */}
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, paddingBottom: 10, borderBottom: '1px solid #E0E0E0' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
                              <span style={{ color: '#5F6368' }}>Aan</span>
                              <span style={{ fontWeight: 500, textAlign: 'right', color: '#202124' }}>
                                {invoice.client_name || '—'}
                              </span>
                            </div>
                            {invoice.client_btw_number && (
                              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
                                <span style={{ color: '#5F6368' }}>BTW</span>
                                <span className="font-medium" style={{ fontWeight: 500, color: '#202124' }}>
                                  {invoice.client_btw_number}
                                </span>
                              </div>
                            )}
                            {/* [BOEK-028] replaced_by_number — shown on creditnota — May 2026 */}
                            {invoice.invoice_type === 'creditnota' && invoice.replaced_by_number && (
                              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
                                <span style={{ color: '#5F6368' }}>Vervangt</span>
                                <span className="font-medium" style={{ color: M3.error }}>
                                  {invoice.replaced_by_number}
                                </span>
                              </div>
                            )}
                          </div>

                          {/* Amounts — sign follows direction */}
                          {[
                            {
                              label: 'Excl. BTW',
                              value: isOutgoing ? (invoice.total_ex_btw ?? 0) : -(invoice.total_ex_btw ?? 0),
                            },
                            {
                              label: `BTW ${getBtwRate(invoice)}%`,
                              value: isOutgoing ? (invoice.btw_amount ?? 0) : -(invoice.btw_amount ?? 0),
                            },
                            {
                              label: 'Incl. BTW',
                              value: amount,
                            },
                          ].map(row => (
                            <div key={row.label} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
                              <span style={{ color: '#5F6368' }}>{row.label}</span>
                              <span className="font-semibold"
                                style={{ fontWeight: 500, color: (row.value ?? 0) >= 0 ? '#202124' : '#EA4335', fontFamily: "'Roboto Mono', monospace" }}>
                                {NL_NUMBER.format(row.value ?? 0)}
                              </span>
                            </div>
                          ))}

                          {/* Openen button — only this navigates */}
                          <div className="pt-2">
                            <button
                              onClick={() => router.push(`/dashboard/invoice/${invoice.id}?from=client&clientId=${clientId}&q=${q}&year=${year}`)}
                              style={{ width: '100%', padding: '8px 16px', borderRadius: 8, backgroundColor: '#1A73E8', color: '#FFFFFF', fontSize: 13, fontWeight: 500, border: 'none', cursor: 'pointer' }}>
                              Openen →
                            </button>
                          </div>
                        </div>
                      </div>
                    )}

                  </div>
                )
                    })}
                  </div>
                )
              })}
            </div>
          )}
        </div>

      </div>
    </div>
  )
}