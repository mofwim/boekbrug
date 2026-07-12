// src/app/voorwaarden/page.tsx
// [LEGAL] Algemene Voorwaarden. Public page — source in docs/legal.

import type { Metadata } from 'next'
import LegalArticle from '@/components/legal-article'
import markdown from '@/content/legal/algemene-voorwaarden'

export const metadata: Metadata = {
  title: 'Algemene Voorwaarden | BoekBrug',
  description: 'De algemene voorwaarden voor het gebruik van BoekBrug.',
  alternates: { canonical: '/voorwaarden' },
}

export default function VoorwaardenPage() {
  return <LegalArticle markdown={markdown} />
}
