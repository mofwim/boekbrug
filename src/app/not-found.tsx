// src/app/not-found.tsx
// BOEK-006: 404 Page

import Link from 'next/link'

export default function NotFound() {
  return (
    <div className="min-h-screen bg-[#f8f9fa] flex items-center justify-center px-6">
      <div className="text-center space-y-4 max-w-sm">

        <p className="text-6xl font-bold text-[#dadce0]">404</p>

        <div className="space-y-1">
          <h1 className="text-lg font-bold text-[#202124]">Pagina niet gevonden</h1>
          <p className="text-sm text-[#9aa0a6]">
            De pagina die je zoekt bestaat niet of is verplaatst.
          </p>
        </div>

        <div className="flex flex-wrap gap-3 justify-center pt-2">
          <Link
            href="/"
            className="bg-[#1a73e8] text-white px-5 py-2.5 rounded-xl text-sm font-semibold hover:opacity-90 transition-opacity"
          >
            Terug naar de startpagina
          </Link>
          <Link
            href="/dashboard"
            className="border border-[#e0e0e0] text-[#1a73e8] px-5 py-2.5 rounded-xl text-sm font-medium hover:bg-[#f8f9fa] transition-colors"
          >
            Naar dashboard
          </Link>
        </div>

      </div>
    </div>
  )
}
