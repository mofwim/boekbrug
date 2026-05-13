'use client'

// src/app/dashboard/error.tsx
// BOEK-004: Dashboard Error Boundary

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  const router = useRouter()

  useEffect(() => {
    console.error('Dashboard error:', error)
  }, [error])

  return (
    <div className="min-h-screen bg-[#f2f2f7] flex items-center justify-center px-6">
      <div className="text-center space-y-4 max-w-sm">

        <p className="text-5xl font-bold text-gray-200">!</p>

        <div className="space-y-1">
          <h1 className="text-lg font-bold text-gray-900">Er is iets misgegaan</h1>
          <p className="text-sm text-gray-400">
            De pagina kon niet worden geladen. Probeer het opnieuw.
          </p>
        </div>

        <div className="flex gap-3 justify-center pt-2">
          <button
            onClick={reset}
            className="bg-blue-600 text-white px-5 py-2.5 rounded-xl text-sm font-semibold hover:bg-blue-700 transition-colors"
          >
            Opnieuw proberen
          </button>
          <button
            onClick={() => router.push('/dashboard')}
            className="border border-gray-200 text-gray-600 px-5 py-2.5 rounded-xl text-sm font-medium hover:bg-gray-50 transition-colors"
          >
            Naar dashboard
          </button>
        </div>

      </div>
    </div>
  )
}
