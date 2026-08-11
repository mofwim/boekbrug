// src/components/ui/StatusFilter.tsx
// [BoekBrug v1.2] — BOEK-009 — Filter tabs (ZZP + Accountant)
// [BOEK-009] added overdue tab + optional count badges — May 2026

"use client";

import type { InvoiceStatusFilter, AccountantStatusFilter } from '@/hooks/useInfiniteInvoices'
import { statusLabel } from '@/lib/invoice-status'
import { useLocale } from '@/lib/i18n/use-locale'
import { translator } from '@/lib/i18n/t'

// ── ZZP filters ───────────────────────────────────────────────────────────────

interface ZzpProps {
  mode: 'zzp'
  value: InvoiceStatusFilter
  onChange: (v: InvoiceStatusFilter) => void
  /** Optional counts — shown as badges next to label */
  counts?: Partial<Record<InvoiceStatusFilter, number>>
}

// [BOEK-009] overdue tab added — May 2026
// [STATUS] Alleen 'all' houdt een eigen woord: dat is een FILTER, geen status. De vier andere
// halen hun woord uit invoice-status.ts, zodat het tabblad en de chip in de rij eronder nooit
// een ander woord voor hetzelfde kunnen tonen — in welke taal dan ook.
const ZZP_FILTERS: InvoiceStatusFilter[] = ['all', 'sent', 'paid', 'draft', 'overdue']

// ── Accountant filters ────────────────────────────────────────────────────────

interface AccountantProps {
  mode: 'accountant'
  value: AccountantStatusFilter
  onChange: (v: AccountantStatusFilter) => void
  counts?: Partial<Record<AccountantStatusFilter, number>>
}

const ACCOUNTANT_FILTERS: {
  value: AccountantStatusFilter
  label: string
  activeClass: string
}[] = [
  { value: 'all',            label: 'Alle',             activeClass: 'bg-gray-900 text-white' },
  { value: 'verwerkt',       label: '✓ Verwerkt',        activeClass: 'bg-[#ceead6] text-[#137333] border border-[#a8dab5]' },
  { value: 'in_behandeling', label: '⏳ In behandeling', activeClass: 'bg-[#d3e3fd] text-[#1967d2] border border-[#a8c7fa]' },
  { value: 'vraag',          label: '? Vraag',           activeClass: 'bg-[#fef7e0] text-[#b06000] border border-[#fde293]' },
]

// ── Shared badge ──────────────────────────────────────────────────────────────

function Badge({ count, active }: { count: number; active: boolean }) {
  if (count === 0) return null
  return (
    <span
      className={`ml-1 inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full text-[11px] font-bold leading-none ${
        active ? 'bg-white/25 text-white' : 'bg-gray-300 text-gray-600'
      }`}
    >
      {count > 99 ? '99+' : count}
    </span>
  )
}

// ── Component ─────────────────────────────────────────────────────────────────

type Props = ZzpProps | AccountantProps

export function StatusFilter(props: Props) {
  // Before the branch: a hook may not sit behind a condition.
  const taal = useLocale()
  const t = translator(taal)
  if (props.mode === 'accountant') {
    return (
      <div className="flex items-center gap-2 px-5 py-3 border-b border-gray-100 overflow-x-auto scrollbar-none">
        {ACCOUNTANT_FILTERS.map(f => {
          const isActive = props.value === f.value
          const count = props.counts?.[f.value] ?? 0
          return (
            <button
              key={f.value}
              onClick={() => props.onChange(f.value)}
              className={`text-xs px-3 py-1.5 rounded-full font-medium whitespace-nowrap transition-colors ${
                isActive ? f.activeClass : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
              }`}
            >
              {f.label}
              {count > 0 && <Badge count={count} active={isActive} />}
            </button>
          )
        })}
      </div>
    )
  }

  return (
    <div className="flex items-center gap-2 px-5 py-3 border-b border-gray-100 overflow-x-auto scrollbar-none">
      {ZZP_FILTERS.map(f => {
        const isActive = props.value === f
        const count = props.counts?.[f] ?? 0
        return (
          <button
            key={f}
            onClick={() => props.onChange(f)}
            className={`text-xs px-3 py-1.5 rounded-full font-medium whitespace-nowrap transition-colors ${
              isActive ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
            }`}
          >
            {f === 'all' ? t('filter.all') : statusLabel(f, taal)}
            {count > 0 && <Badge count={count} active={isActive} />}
          </button>
        )
      })}
    </div>
  )
}