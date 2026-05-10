'use client'

import { useRouter } from 'next/navigation'

export default function DashboardClient({ profile }: { profile: any }) {
  const router = useRouter()

  return (
    <div className="min-h-screen bg-gray-50">

      {/* Header */}
      <div className="bg-white border-b border-gray-200 px-6 py-4">
        <div className="max-w-4xl mx-auto flex items-center justify-between">
          <h1 className="text-lg font-bold text-gray-900">BoekBrug</h1>
          <div className="flex items-center gap-3">
            <span className="text-sm text-gray-500">{profile.company_name}</span>
            <span className={`text-xs px-2 py-1 rounded-full font-medium ${
              profile.role === 'accountant'
                ? 'bg-purple-100 text-purple-700'
                : 'bg-blue-100 text-blue-700'
            }`}>
              {profile.role === 'accountant' ? 'Boekhouder' : "ZZP'er"}
            </span>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-4xl mx-auto px-6 py-8">

        {/* ZZP'er Dashboard */}
        {profile.role === 'zzper' && (
          <div className="space-y-6">
            <div className="grid grid-cols-3 gap-4">
              <div className="bg-white rounded-xl p-5 border border-gray-200">
                <p className="text-sm text-gray-500">Verzonden</p>
                <p className="text-2xl font-bold text-gray-900 mt-1">0</p>
              </div>
              <div className="bg-white rounded-xl p-5 border border-gray-200">
                <p className="text-sm text-gray-500">Ontvangen</p>
                <p className="text-2xl font-bold text-gray-900 mt-1">0</p>
              </div>
              <div className="bg-white rounded-xl p-5 border border-gray-200">
                <p className="text-sm text-gray-500">Openstaand</p>
                <p className="text-2xl font-bold text-gray-900 mt-1">€0</p>
              </div>
            </div>

            <div className="bg-white rounded-xl border border-gray-200 p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="font-medium text-gray-900">Facturen</h2>
                <button
                  onClick={() => router.push('/dashboard/invoice/new')}
                  className="bg-blue-600 text-white text-sm px-4 py-2 rounded-lg hover:bg-blue-700"
                >
                  + Nieuwe factuur
                </button>
              </div>
              <p className="text-sm text-gray-400 text-center py-8">
                Nog geen facturen — maak je eerste factuur aan
              </p>
            </div>
          </div>
        )}

        {/* Accountant Dashboard */}
        {profile.role === 'accountant' && (
          <div className="space-y-6">
            <div className="grid grid-cols-2 gap-4">
              <div className="bg-white rounded-xl p-5 border border-gray-200">
                <p className="text-sm text-gray-500">Klanten</p>
                <p className="text-2xl font-bold text-gray-900 mt-1">0</p>
              </div>
              <div className="bg-white rounded-xl p-5 border border-gray-200">
                <p className="text-sm text-gray-500">Nieuwe facturen</p>
                <p className="text-2xl font-bold text-gray-900 mt-1">0</p>
              </div>
            </div>

            <div className="bg-white rounded-xl border border-gray-200 p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="font-medium text-gray-900">Mijn klanten</h2>
                <button className="bg-purple-600 text-white text-sm px-4 py-2 rounded-lg hover:bg-purple-700">
                  + Klant toevoegen
                </button>
              </div>
              <p className="text-sm text-gray-400 text-center py-8">
                Nog geen klanten — voeg je eerste klant toe
              </p>
            </div>
          </div>
        )}

      </div>
    </div>
  )
}