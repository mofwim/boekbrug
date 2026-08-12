'use client'

// src/app/dashboard/not-found.tsx
// BOEK-006: 404 داخل الـ dashboard
// [NAVIGATION] "Terug" resolves the canonical parent of the (broken) path via
// BackLink — never router.back(), which could bounce straight back to the dead
// link and loop.

import Link from 'next/link'
import { BackLink } from '@/components/ui/BackLink'
// [TAAL] Even the 404 speaks the owner's language.
import { useLocale } from '@/lib/i18n/use-locale'
import { translator } from '@/lib/i18n/t'

export default function DashboardNotFound() {
  const t = translator(useLocale())
  return (
    <div className="min-h-screen bg-[#f8f9fa] flex items-center justify-center px-6">
      <div className="text-center space-y-4 max-w-sm">

        <p className="text-6xl font-bold text-gray-200">404</p>

        <div className="space-y-1">
          <h1 className="text-lg font-bold text-gray-900">{t('fout404.titel')}</h1>
          <p className="text-sm text-gray-400">
            {t('fout404.uitleg')}
          </p>
        </div>

        <div className="flex gap-3 justify-center items-center pt-2">
          <Link
            href="/dashboard"
            className="bg-blue-600 text-white px-5 py-2.5 rounded-xl text-sm font-semibold hover:bg-blue-700 transition-colors no-underline"
          >
            {t('fout.naarDashboard')}
          </Link>
          <BackLink
            label={t('nav.terug')}
            className="border border-gray-200 text-gray-600 px-5 py-2.5 rounded-xl text-sm font-medium hover:bg-gray-50 transition-colors"
            style={{ color: '#4b5563' }}
          />
        </div>

      </div>
    </div>
  )
}
