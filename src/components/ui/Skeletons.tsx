// src/components/ui/Skeletons.tsx
// BOEK-005: Loading States — مكونات مشتركة لكل الصفحات

// ── صف فاتورة في القائمة ──────────────────────────────────────────────────────
export function InvoiceRowSkeleton() {
  return (
    <div className="flex items-center justify-between px-5 py-4 animate-pulse">
      <div className="space-y-2">
        <div className="h-3 w-24 bg-gray-100 rounded-full" />
        <div className="h-2.5 w-36 bg-gray-100 rounded-full" />
      </div>
      <div className="flex items-center gap-3">
        <div className="h-3 w-16 bg-gray-100 rounded-full" />
        <div className="h-6 w-20 bg-gray-100 rounded-full" />
      </div>
    </div>
  )
}

// ── بطاقة إحصاء ───────────────────────────────────────────────────────────────
export function StatCardSkeleton() {
  return (
    <div className="bg-white rounded-2xl p-5 shadow-sm animate-pulse">
      <div className="h-2.5 w-20 bg-gray-100 rounded-full mb-3" />
      <div className="h-7 w-12 bg-gray-100 rounded-full" />
    </div>
  )
}

// ── صفحة تفاصيل الفاتورة ─────────────────────────────────────────────────────
export function InvoiceDetailSkeleton() {
  return (
    <div className="max-w-3xl mx-auto px-6 py-6 space-y-4 animate-pulse">

      {/* Van / Aan / Details */}
      <div className="bg-white rounded-2xl p-5 shadow-sm">
        <div className="grid grid-cols-3 gap-6">
          {[0, 1, 2].map(i => (
            <div key={i} className="space-y-2">
              <div className="h-2.5 w-16 bg-gray-100 rounded-full" />
              <div className="h-3 w-28 bg-gray-100 rounded-full" />
              <div className="h-2.5 w-24 bg-gray-100 rounded-full" />
              <div className="h-2.5 w-20 bg-gray-100 rounded-full" />
            </div>
          ))}
        </div>
      </div>

      {/* Factuurregels */}
      <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100">
          <div className="h-3 w-24 bg-gray-100 rounded-full" />
        </div>
        {[0, 1, 2].map(i => (
          <div key={i} className="flex items-center justify-between px-5 py-3 border-b border-gray-50">
            <div className="h-2.5 w-40 bg-gray-100 rounded-full" />
            <div className="h-2.5 w-16 bg-gray-100 rounded-full" />
          </div>
        ))}
      </div>

      {/* Totalen */}
      <div className="bg-white rounded-2xl p-5 shadow-sm">
        <div className="space-y-3 max-w-xs ml-auto">
          <div className="flex justify-between">
            <div className="h-2.5 w-28 bg-gray-100 rounded-full" />
            <div className="h-2.5 w-16 bg-gray-100 rounded-full" />
          </div>
          <div className="flex justify-between">
            <div className="h-2.5 w-12 bg-gray-100 rounded-full" />
            <div className="h-2.5 w-16 bg-gray-100 rounded-full" />
          </div>
          <div className="flex justify-between pt-2 border-t border-gray-100">
            <div className="h-3.5 w-32 bg-gray-100 rounded-full" />
            <div className="h-3.5 w-20 bg-gray-100 rounded-full" />
          </div>
        </div>
      </div>

    </div>
  )
}

// ── صفحة تفاصيل العميل ────────────────────────────────────────────────────────
export function ClientDetailSkeleton() {
  return (
    <div className="max-w-4xl mx-auto px-6 py-6 space-y-4 animate-pulse">

      {/* Klantgegevens */}
      <div className="bg-white rounded-2xl p-5 shadow-sm">
        <div className="h-2.5 w-24 bg-gray-100 rounded-full mb-4" />
        <div className="grid grid-cols-3 gap-4">
          {[0, 1, 2].map(i => (
            <div key={i} className="space-y-2">
              <div className="h-2 w-10 bg-gray-100 rounded-full" />
              <div className="h-3 w-24 bg-gray-100 rounded-full" />
            </div>
          ))}
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4">
        <StatCardSkeleton />
        <StatCardSkeleton />
        <StatCardSkeleton />
      </div>

      {/* Facturen */}
      <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100">
          <div className="h-3 w-16 bg-gray-100 rounded-full" />
        </div>
        <div className="divide-y divide-gray-50">
          <InvoiceRowSkeleton />
          <InvoiceRowSkeleton />
          <InvoiceRowSkeleton />
        </div>
      </div>

    </div>
  )
}

// ── Dashboard ZZP'er ──────────────────────────────────────────────────────────
export function DashboardSkeleton() {
  return (
    <div className="max-w-4xl mx-auto px-6 py-6 space-y-4 animate-pulse">

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4">
        <StatCardSkeleton />
        <StatCardSkeleton />
        <StatCardSkeleton />
      </div>

      {/* Facturen lijst */}
      <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <div className="h-3 w-16 bg-gray-100 rounded-full" />
          <div className="h-8 w-28 bg-gray-100 rounded-xl" />
        </div>
        <div className="divide-y divide-gray-50">
          <InvoiceRowSkeleton />
          <InvoiceRowSkeleton />
          <InvoiceRowSkeleton />
          <InvoiceRowSkeleton />
        </div>
      </div>

    </div>
  )
}

// ── صف عميل في قائمة المحاسب ─────────────────────────────────────────────────
export function ClientRowSkeleton() {
  return (
    <div className="flex items-center justify-between px-5 py-4 animate-pulse">
      <div className="space-y-2">
        <div className="h-3 w-32 bg-gray-100 rounded-full" />
        <div className="h-2.5 w-40 bg-gray-100 rounded-full" />
      </div>
      <div className="h-2.5 w-16 bg-gray-100 rounded-full" />
    </div>
  )
}
