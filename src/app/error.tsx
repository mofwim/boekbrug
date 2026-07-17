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
    <div className="min-h-screen bg-[#f8f9fa] flex items-center justify-center px-6">
      <div className="text-center space-y-4 max-w-sm">

        <p className="text-5xl font-bold text-[#dadce0]">!</p>

        <div className="space-y-1">
          <h1 className="text-lg font-bold text-[#202124]">Er is iets misgegaan</h1>
          <p className="text-sm text-[#9aa0a6]">
            Er is een onverwachte fout opgetreden. Probeer het opnieuw.
          </p>
        </div>

        <div className="flex flex-wrap gap-3 justify-center pt-2">
          <button
            onClick={reset}
            className="bg-[#1a73e8] text-white px-5 py-2.5 rounded-xl text-sm font-semibold hover:opacity-90 transition-opacity"
          >
            Opnieuw proberen
          </button>
          <Link
            href="/"
            className="border border-[#e0e0e0] text-[#1a73e8] px-5 py-2.5 rounded-xl text-sm font-medium hover:bg-[#f8f9fa] transition-colors"
          >
            Terug naar de startpagina
          </Link>
        </div>

      </div>
    </div>
  )
}
