// components/ui/StatusFilter.tsx
// Filter tabs voor factuurstatus (BOEK-009)

"use client";

// src/components/ui/StatusFilter.tsx
// Filters: Alles | Verzonden | Betaald | Concept
// Verlopen is NOT a filter — it's computed per-invoice in DashboardClient

import type { InvoiceStatusFilter } from '@/hooks/useInfiniteInvoices'

interface Props {
  value: InvoiceStatusFilter
  onChange: (v: InvoiceStatusFilter) => void
}

const FILTERS: { value: InvoiceStatusFilter; label: string }[] = [
  { value: 'all',   label: 'Alles' },
  { value: 'sent',  label: 'Verzonden' },
  { value: 'paid',  label: 'Betaald' },
  { value: 'draft', label: 'Concept' },
]

export function StatusFilter({ value, onChange }: Props) {
  return (
    <div className="flex items-center gap-2 px-5 py-3 border-b border-gray-100 overflow-x-auto">
      {FILTERS.map(f => (
        <button
          key={f.value}
          onClick={() => onChange(f.value)}
          className={`text-xs px-3 py-1.5 rounded-full font-medium whitespace-nowrap transition-colors ${
            value === f.value
              ? 'bg-gray-900 text-white'
              : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
          }`}
        >
          {f.label}
        </button>
      ))}
    </div>
  )
}