// src/app/not-found.tsx
// BOEK-006: 404 Page

import Link from 'next/link'

export default function NotFound() {
  return (
    <div className="min-h-screen bg-[#f2f2f7] flex items-center justify-center px-6">
      <div className="text-center space-y-4 max-w-sm">

        <p className="text-6xl font-bold text-[#c7c7cc]">404</p>

        <div className="space-y-1">
          <h1 className="text-lg font-bold text-[#1c1c1e]">Pagina niet gevonden</h1>
          <p className="text-sm text-[#8a8a8e]">
            De pagina die je zoekt bestaat niet of is verplaatst.
          </p>
        </div>

        <div className="flex flex-wrap gap-3 justify-center pt-2">
          <Link
            href="/"
            className="bg-[#007aff] text-white px-5 py-2.5 rounded-xl text-sm font-semibold hover:opacity-90 transition-opacity"
          >
            Terug naar de startpagina
          </Link>
          <Link
            href="/dashboard"
            className="border border-[#e5e5ea] text-[#007aff] px-5 py-2.5 rounded-xl text-sm font-medium hover:bg-[#f9f9fb] transition-colors"
          >
            Naar dashboard
          </Link>
        </div>

      </div>
    </div>
  )
}
