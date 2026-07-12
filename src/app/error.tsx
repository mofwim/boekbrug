'use client'

// src/app/error.tsx
// BOEK-004: Global Error Boundary — يمسك أي خطأ غير متوقع

import { useEffect } from 'react'
import Link from 'next/link'

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    // يمكن إضافة error logging هنا لاحقاً
    console.error('Global error:', error)
  }, [error])

  return (
    <div className="min-h-screen bg-[#f2f2f7] flex items-center justify-center px-6">
      <div className="text-center space-y-4 max-w-sm">

        <p className="text-5xl font-bold text-[#c7c7cc]">!</p>

        <div className="space-y-1">
          <h1 className="text-lg font-bold text-[#1c1c1e]">Er is iets misgegaan</h1>
          <p className="text-sm text-[#8a8a8e]">
            Er is een onverwachte fout opgetreden. Probeer het opnieuw.
          </p>
        </div>

        <div className="flex flex-wrap gap-3 justify-center pt-2">
          <button
            onClick={reset}
            className="bg-[#007aff] text-white px-5 py-2.5 rounded-xl text-sm font-semibold hover:opacity-90 transition-opacity"
          >
            Opnieuw proberen
          </button>
          <Link
            href="/"
            className="border border-[#e5e5ea] text-[#007aff] px-5 py-2.5 rounded-xl text-sm font-medium hover:bg-[#f9f9fb] transition-colors"
          >
            Terug naar de startpagina
          </Link>
        </div>

      </div>
    </div>
  )
}
