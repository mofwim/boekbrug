// src/lib/invoice-sort.ts
// [SORT] Shared invoice-list ordering — the same options the market (Moneybird,
// e-Boekhouden, Exact) offers, so the owner can find an invoice by whatever
// date/number matters to them, not only "date added". Extracted from
// IncomingManageClient so every list surface (Inkoopfacturen, Vandaag, …) sorts
// with ONE implementation instead of drifting copies.
//
// Pure + client-safe: no React, no Supabase, no Date.now().

export type SortKey =
  | 'added_desc' | 'invdate_desc' | 'invdate_asc'
  | 'due_asc' | 'paydate_desc' | 'amount_desc' | 'amount_asc' | 'vendor_asc'

export const SORTS: { id: SortKey; label: string }[] = [
  { id: 'added_desc',   label: 'Toegevoegd (nieuwste eerst)'  },
  { id: 'invdate_desc', label: 'Factuurdatum (nieuwste eerst)' },
  { id: 'invdate_asc',  label: 'Factuurdatum (oudste eerst)'   },
  { id: 'due_asc',      label: 'Vervaldatum (eerst verlopen)'  },
  { id: 'paydate_desc', label: 'Betaaldatum (nieuwste eerst)'  },
  { id: 'amount_desc',  label: 'Bedrag (hoog → laag)'          },
  { id: 'amount_asc',   label: 'Bedrag (laag → hoog)'          },
  { id: 'vendor_asc',   label: 'Leverancier (A–Z)'             },
]

// Minimal shape a row must have to be sortable. Every field optional: a surface
// that doesn't select a column (e.g. Vandaag has no created_at/payment_date)
// simply shouldn't OFFER the sort keys that read it — but if such a key is used
// anyway, the missing-value rule below keeps the sort stable, never a crash.
export interface SortableInvoiceRow {
  client_name?: string | null
  invoice_date?: string | null
  due_date?: string | null
  payment_date?: string | null
  created_at?: string | null
  total_inc_btw?: number | null
}

// Comparators — a MISSING value always sorts LAST (a dateless/amountless invoice
// must never jump to the top and hide a real one), regardless of asc/desc. Dates
// are ISO "YYYY-MM-DD" so a plain string compare is chronological.
function cmpDate(a: string | null | undefined, b: string | null | undefined, dir: 'asc' | 'desc'): number {
  const aa = a ?? '', bb = b ?? ''
  if (!aa && !bb) return 0
  if (!aa) return 1
  if (!bb) return -1
  return dir === 'asc' ? aa.localeCompare(bb) : bb.localeCompare(aa)
}
function cmpNum(a: number | null | undefined, b: number | null | undefined, dir: 'asc' | 'desc'): number {
  const aNull = a == null, bNull = b == null
  if (aNull && bNull) return 0
  if (aNull) return 1
  if (bNull) return -1
  return dir === 'asc' ? (a as number) - (b as number) : (b as number) - (a as number)
}
function cmpStr(a: string | null | undefined, b: string | null | undefined): number {
  const aa = (a ?? '').trim(), bb = (b ?? '').trim()
  if (!aa && !bb) return 0
  if (!aa) return 1
  if (!bb) return -1
  return aa.localeCompare(bb, 'nl', { sensitivity: 'base' })
}

// Array.prototype.sort is stable, so equal keys keep the incoming order (the
// caller's server order) — a deterministic tiebreak with no extra code.
export function sortRows<T extends SortableInvoiceRow>(rows: T[], key: SortKey): T[] {
  const s = [...rows]
  switch (key) {
    case 'invdate_desc': return s.sort((a, b) => cmpDate(a.invoice_date, b.invoice_date, 'desc'))
    case 'invdate_asc':  return s.sort((a, b) => cmpDate(a.invoice_date, b.invoice_date, 'asc'))
    case 'due_asc':      return s.sort((a, b) => cmpDate(a.due_date, b.due_date, 'asc'))
    case 'paydate_desc': return s.sort((a, b) => cmpDate(a.payment_date, b.payment_date, 'desc'))
    case 'amount_desc':  return s.sort((a, b) => cmpNum(a.total_inc_btw, b.total_inc_btw, 'desc'))
    case 'amount_asc':   return s.sort((a, b) => cmpNum(a.total_inc_btw, b.total_inc_btw, 'asc'))
    case 'vendor_asc':   return s.sort((a, b) => cmpStr(a.client_name, b.client_name))
    case 'added_desc':
    default:             return s.sort((a, b) => cmpDate(a.created_at, b.created_at, 'desc'))
  }
}
