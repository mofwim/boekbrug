// src/components/ui/Feedback.tsx
// BOEK-004: مكونات رسائل الخطأ والنجاح — مشتركة في كل الصفحات

// ── رسالة خطأ ─────────────────────────────────────────────────────────────────
export function ErrorMessage({ message }: { message: string }) {
  if (!message) return null
  return (
    <div className="flex items-start gap-2.5 bg-red-50 border border-red-100 rounded-xl px-4 py-3">
      <span className="text-red-400 text-sm mt-0.5 flex-shrink-0">✕</span>
      <p className="text-sm text-red-600">{message}</p>
    </div>
  )
}

// ── رسالة نجاح ────────────────────────────────────────────────────────────────
export function SuccessMessage({ message }: { message: string }) {
  if (!message) return null
  return (
    <div className="flex items-start gap-2.5 bg-green-50 border border-green-100 rounded-xl px-4 py-3">
      <span className="text-green-400 text-sm mt-0.5 flex-shrink-0">✓</span>
      <p className="text-sm text-green-600">{message}</p>
    </div>
  )
}

// ── رسالة تحذير ───────────────────────────────────────────────────────────────
export function WarningMessage({ message }: { message: string }) {
  if (!message) return null
  return (
    <div className="flex items-start gap-2.5 bg-amber-50 border border-amber-100 rounded-xl px-4 py-3">
      <span className="text-amber-400 text-sm mt-0.5 flex-shrink-0">⚠</span>
      <p className="text-sm text-amber-600">{message}</p>
    </div>
  )
}
