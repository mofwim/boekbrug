'use client'

// src/app/dashboard/not-found.tsx
// BOEK-006: 404 داخل الـ dashboard

import { useRouter } from 'next/navigation'

export default function DashboardNotFound() {
  const router = useRouter()

  return (
    <div className="min-h-screen bg-[#f2f2f7] flex items-center justify-center px-6">
      <div className="text-center space-y-4 max-w-sm">

        <p className="text-6xl font-bold text-gray-200">404</p>

        <div className="space-y-1">
          <h1 className="text-lg font-bold text-gray-900">Niet gevonden</h1>
          <p className="text-sm text-gray-400">
            Deze factuur, klant of pagina bestaat niet.
          </p>
        </div>

        <div className="flex gap-3 justify-center pt-2">
          <button
            onClick={() => router.push('/dashboard')}
            className="bg-blue-600 text-white px-5 py-2.5 rounded-xl text-sm font-semibold hover:bg-blue-700 transition-colors"
          >
            Naar dashboard
          </button>
          <button
            onClick={() => router.back()}
            className="border border-gray-200 text-gray-600 px-5 py-2.5 rounded-xl text-sm font-medium hover:bg-gray-50 transition-colors"
          >
            Terug
          </button>
        </div>

      </div>
    </div>
  )
}
