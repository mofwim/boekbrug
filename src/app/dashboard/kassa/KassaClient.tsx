'use client'

// src/app/dashboard/kassa/KassaClient.tsx
// [KASSA] The counter of a shop that has no till — the state and the network half. Everything that
// renders a row lives in KassaPanels.tsx so the render gate can hand those components real data.
//
// ── WHAT THIS SCREEN IS FOR ──
// A barber, a garage, a nail salon: dozens of small sales a day, no invoices, and a kassa-rapport
// that does not exist because there is no kassa. Until now that owner's revenue could only reach
// the books through a Z-report file he does not have — and his PIN takings arrived over the bank
// with no btw rate at all, which BLOCKS his own aangifte (/api/btw/file refuses on
// cashOmzetZonderBtw). This is the door that fixes it at the source.
//
// ── ONE DAY, ONE SOURCE ──
// A ticket rung up here is NOT written to the cash book. It lands in till_sales, and the day is
// rebuilt into exactly one daily_turnover row, which is the only thing the financial engines read.
// The drawer still balances — buildKasboek counts daily_turnover.cash_amount as ontvangsten. See
// the header of supabase/migrations/till_sales.sql for why a second money source would be the
// [KAS-DUBBELTELLING] bug a third time. The server refuses a day another source already claims,
// and this screen shows that refusal before the owner taps anything.

import { useCallback, useEffect, useState } from 'react'
import { M3, COLUMN } from '@/lib/design/tokens'
import { useLocale } from '@/lib/i18n/use-locale'
import { translator } from '@/lib/i18n/t'
import { failureText } from '@/lib/server-message'
import { parseAmountNL } from '@/lib/parse-nl'
import { articleGrossPrice, TILL_RATES, type TillMethod } from '@/lib/till-day'
import {
  DayTakings, PriceList, TicketPanel, SalesHistory,
  type TicketLine, type StoredSale, type DayTotals, type PriceListItem,
} from './KassaPanels'

const FONT = "'Roboto', -apple-system, sans-serif"

interface ArticleRow {
  id: string
  description: string
  unit_price: number
  btw_rate: number
}

const EMPTY_TOTALS: DayTotals = { total: 0, pin: 0, cash: 0, other: 0 }

export default function KassaClient() {
  const t = translator(useLocale())

  const [items, setItems] = useState<PriceListItem[]>([])
  const [sales, setSales] = useState<StoredSale[]>([])
  const [totals, setTotals] = useState<DayTotals>(EMPTY_TOTALS)
  const [lines, setLines] = useState<TicketLine[]>([])
  const [conflict, setConflict] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  // The free-amount form: a haircut that is not on the price list, or a one-off.
  const [freeDescription, setFreeDescription] = useState('')
  const [freeAmount, setFreeAmount] = useState('')
  const [freeRate, setFreeRate] = useState<number>(21)

  const loadDay = useCallback(async () => {
    try {
      const res = await fetch('/api/till/sale')
      const json = await res.json()
      if (!res.ok) { setError(failureText(res.status, json, t('kassa.fout.laden'))); return }
      setSales(json.sales ?? [])
      setTotals(json.totals ?? EMPTY_TOTALS)
      // A day another source already claims is refused by the server on the first sale. Showing it
      // up front is the difference between a counter that explains itself and one that refuses a
      // customer who is standing there.
      setConflict(json.conflict ?? null)
    } catch {
      setError(t('kassa.fout.laden'))
    }
  }, [t])

  const loadArticles = useCallback(async () => {
    try {
      const res = await fetch('/api/articles')
      const json = await res.json()
      if (!res.ok) return
      const rows: ArticleRow[] = json.articles ?? json ?? []
      setItems(
        rows.map((a) => ({
          id: a.id,
          description: a.description,
          // articles.unit_price is stored EX-btw because it feeds invoice lines; a shop's price
          // list is what the customer PAYS. One conversion, in one tested place.
          gross: articleGrossPrice(Number(a.unit_price), Number(a.btw_rate)),
          btw_rate: Number(a.btw_rate),
        })),
      )
    } catch {
      /* an empty price list is a usable counter — the free-amount form still works */
    }
  }, [])

  // The repo's own load idiom (see KasClient): the work happens inside an async function with a
  // `cancelled` flag, never as a bare call in the effect body. Two reasons, and only one of them is
  // the lint rule. A counter is opened and left constantly, so a reply that arrives after the owner
  // has navigated away would set state on a screen that is gone; and the ticket he has already
  // started building must never be overwritten by a response to a request he has moved past.
  useEffect(() => {
    let cancelled = false
    const run = async () => {
      if (cancelled) return
      await loadDay()
      if (cancelled) return
      await loadArticles()
    }
    void run()
    return () => { cancelled = true }
  }, [loadDay, loadArticles])

  function addLine(line: Omit<TicketLine, 'key'>) {
    setError('')
    setLines((current) => {
      // Tapping the same service twice is one line of two, not two lines — that is how a counter
      // behaves and it keeps a long ticket readable.
      const match = current.findIndex(
        (l) => l.description === line.description
          && l.unit_price_incl === line.unit_price_incl
          && l.btw_rate === line.btw_rate,
      )
      if (match >= 0) {
        const next = [...current]
        next[match] = { ...next[match], quantity: next[match].quantity + line.quantity }
        return next
      }
      return [...current, { ...line, key: `${Date.now()}-${current.length}` }]
    })
  }

  function changeQuantity(key: string, delta: number) {
    setLines((current) =>
      current
        .map((l) => (l.key === key ? { ...l, quantity: l.quantity + delta } : l))
        // A line dragged to zero is gone, not a zero-quantity line: the server refuses those
        // (a zero quantity is not a sale), so leaving one on screen would make the whole ticket
        // unsendable with nothing pointing at which line did it.
        .filter((l) => l.quantity !== 0),
    )
  }

  function addFreeAmount() {
    // [PARSE-NL] parseAmountNL returns 0 for anything it cannot read — it never returns null. So
    // the guard is on the VALUE, not on a null: an unreadable amount and an empty box are the same
    // refusal, and neither may reach the ticket as a free line worth nothing.
    const amount = parseAmountNL(freeAmount)
    const description = freeDescription.trim()
    if (!description || amount <= 0) return
    addLine({ description, quantity: 1, unit_price_incl: amount, btw_rate: freeRate, article_id: null })
    setFreeDescription('')
    setFreeAmount('')
  }

  async function tender(method: TillMethod) {
    if (lines.length === 0 || busy) return
    setBusy(true)
    setError('')
    try {
      const res = await fetch('/api/till/sale', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          lines: lines.map((l) => ({
            description: l.description,
            quantity: l.quantity,
            unit_price_incl: l.unit_price_incl,
            btw_rate: l.btw_rate,
            method,
            article_id: l.article_id,
          })),
        }),
      })
      const json = await res.json()
      if (!res.ok) {
        setError(failureText(res.status, json, t('kassa.fout.opslaan')))
        // A 409 is the day being claimed by another source — refresh so the banner appears and the
        // owner sees WHY, rather than a sale that simply refuses to go through.
        if (res.status === 409) void loadDay()
        return
      }
      // Only now is the ticket gone from the screen. Clearing it before the server answered would
      // lose a sale on any failure, and the customer has already walked out.
      setLines([])
      setSales(json.sales ?? [])
      setTotals(json.totals ?? EMPTY_TOTALS)
    } catch {
      setError(t('kassa.fout.opslaan'))
    } finally {
      setBusy(false)
    }
  }

  async function voidTicket(ticketId: string) {
    if (busy) return
    if (!window.confirm(t('kassa.terugdraaienVraag'))) return
    setBusy(true)
    setError('')
    try {
      const res = await fetch(`/api/till/sale?ticket=${encodeURIComponent(ticketId)}`, { method: 'DELETE' })
      const json = await res.json()
      if (!res.ok) { setError(failureText(res.status, json, t('kassa.fout.opslaan'))); return }
      setSales(json.sales ?? [])
      setTotals(json.totals ?? EMPTY_TOTALS)
    } catch {
      setError(t('kassa.fout.opslaan'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div style={{ ...COLUMN, display: 'flex', flexDirection: 'column', gap: 16, padding: '16px 16px 96px' }}>
      <header>
        <h1 style={{ fontFamily: FONT, fontSize: 22, fontWeight: 700, margin: 0, color: M3.onSurface }}>
          {t('kassa.titel')}
        </h1>
        <p style={{ fontFamily: FONT, fontSize: 14, color: M3.onSurfaceVariant, margin: '6px 0 0' }}>
          {t('kassa.uitleg')}
        </p>
      </header>

      {conflict && (
        <div
          role="status"
          style={{
            fontFamily: FONT, fontSize: 14, color: M3.warning,
            background: M3.warningContainer, borderRadius: 12, padding: 12,
          }}
        >
          {conflict}
        </div>
      )}

      {error && (
        <div
          role="alert"
          style={{
            fontFamily: FONT, fontSize: 14, color: M3.error,
            background: M3.errorContainer, borderRadius: 12, padding: 12,
          }}
        >
          {error}
        </div>
      )}

      <DayTakings totals={totals} t={t} />

      <PriceList
        items={items}
        onPick={(item) => addLine({
          description: item.description,
          quantity: 1,
          unit_price_incl: item.gross,
          btw_rate: item.btw_rate,
          article_id: item.id,
        })}
        t={t}
      />

      <section
        style={{
          background: M3.surface, border: `1px solid ${M3.outlineVariant}`,
          borderRadius: 16, padding: 16,
        }}
      >
        <h2 style={{ fontFamily: FONT, fontSize: 15, fontWeight: 600, margin: '0 0 12px', color: M3.onSurface }}>
          {t('kassa.vrijBedrag')}
        </h2>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <input
            value={freeDescription}
            onChange={(e) => setFreeDescription(e.target.value)}
            placeholder={t('kassa.omschrijving')}
            aria-label={t('kassa.omschrijving')}
            style={field}
          />
          <input
            value={freeAmount}
            onChange={(e) => setFreeAmount(e.target.value)}
            inputMode="decimal"
            placeholder={t('kassa.bedrag')}
            aria-label={t('kassa.bedrag')}
            style={field}
          />
          <div style={{ display: 'flex', gap: 8 }} role="group" aria-label={t('kassa.tarief')}>
            {TILL_RATES.map((rate) => (
              <button
                key={rate}
                type="button"
                onClick={() => setFreeRate(rate)}
                aria-pressed={freeRate === rate}
                style={{
                  flex: 1, fontFamily: FONT, fontSize: 14, borderRadius: 10, padding: '10px 8px',
                  cursor: 'pointer',
                  border: `1px solid ${freeRate === rate ? M3.primary : M3.outlineVariant}`,
                  background: freeRate === rate ? M3.primary : M3.surface,
                  color: freeRate === rate ? '#fff' : M3.onSurface,
                }}
              >
                {rate}%
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={addFreeAmount}
            style={{
              fontFamily: FONT, fontSize: 15, fontWeight: 600, borderRadius: 12, padding: '12px 8px',
              border: `1px solid ${M3.primary}`, background: M3.surface, color: M3.primary, cursor: 'pointer',
            }}
          >
            {t('kassa.toevoegen')}
          </button>
          <p style={{ fontFamily: FONT, fontSize: 12, color: M3.onSurfaceVariant, margin: 0 }}>
            {t('kassa.waaromTarief')}
          </p>
        </div>
      </section>

      <TicketPanel
        lines={lines}
        onQuantity={changeQuantity}
        onRemove={(key) => setLines((current) => current.filter((l) => l.key !== key))}
        onTender={(method) => void tender(method)}
        busy={busy}
        t={t}
      />

      <SalesHistory sales={sales} onVoid={(id) => void voidTicket(id)} t={t} />
    </div>
  )
}

const field = {
  fontFamily: FONT, fontSize: 15, padding: '12px 14px', borderRadius: 10,
  border: `1px solid ${M3.outlineVariant}`, background: M3.surface, color: M3.onSurface,
  width: '100%', boxSizing: 'border-box' as const,
}
