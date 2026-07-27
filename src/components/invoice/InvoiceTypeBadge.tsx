// src/components/invoice/InvoiceTypeBadge.tsx
// [BoekBrug v1.2] — BOEK-031 — shared component — do not modify without reading SHARED_FILES_PROTOCOL.md
// [BOEK-031] add InvoiceTypeBadge component — May 2026

export type InvoiceType = 'factuur' | 'creditnota' | 'pro_forma'

interface InvoiceTypeBadgeProps {
  type: InvoiceType
  size?: 'sm' | 'xs'
}

const CONFIG: Record<InvoiceType, { label: string; className: string } | null> = {
  factuur: null, // geen badge voor gewone facturen
  creditnota: {
    label: 'Creditnota',
    className: 'bg-red-100 text-red-700 border border-red-200',
  },
  pro_forma: {
    label: 'Pro forma',
    className: 'bg-gray-100 text-gray-500 border border-gray-200',
  },
}

export function InvoiceTypeBadge({ type, size = 'sm' }: InvoiceTypeBadgeProps) {
  const config = CONFIG[type]
  if (!config) return null

  const sizeClass = size === 'xs'
    ? 'text-[10px] px-1.5 py-0.5'
    : 'text-xs px-2 py-0.5'

  return (
    <span className={`inline-flex items-center rounded-full font-medium ${sizeClass} ${config.className}`}>
      {config.label}
    </span>
  )
}