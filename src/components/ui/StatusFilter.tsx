// components/ui/StatusFilter.tsx
// Filter tabs voor factuurstatus (BOEK-009)

"use client";

import type { InvoiceStatusFilter } from "@/hooks/useInfiniteInvoices";

const FILTERS: { value: InvoiceStatusFilter; label: string }[] = [
  { value: "all",     label: "Alle" },
  { value: "draft",   label: "Concept" },
  { value: "sent",    label: "Verzonden" },
  { value: "paid",    label: "Betaald" },
  { value: "overdue", label: "Verlopen" },
];

interface StatusFilterProps {
  value: InvoiceStatusFilter;
  onChange: (status: InvoiceStatusFilter) => void;
}

/** Horizontaal scrollbare filter-pills boven de facturenlijst */
export function StatusFilter({ value, onChange }: StatusFilterProps) {
  return (
    <div className="flex gap-2 overflow-x-auto pb-1 px-5 pt-3">
      {FILTERS.map((f) => (
        <button
          key={f.value}
          onClick={() => onChange(f.value)}
          className={`whitespace-nowrap rounded-full px-4 py-1.5 text-sm font-medium transition-colors ${
            value === f.value
              ? "bg-blue-600 text-white"
              : "bg-gray-100 text-gray-600 hover:bg-gray-200"
          }`}
        >
          {f.label}
        </button>
      ))}
    </div>
  );
}