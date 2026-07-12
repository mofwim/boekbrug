// src/app/privacy/page.tsx
// [LEGAL] Privacyverklaring (AVG). Public page — see docs/legal for the source.

import type { Metadata } from 'next'
import LegalArticle from '@/components/legal-article'
import markdown from '@/content/legal/privacyverklaring'

export const metadata: Metadata = {
  title: 'Privacyverklaring | BoekBrug',
  description: 'Hoe BoekBrug omgaat met je persoonsgegevens — AVG-conform.',
  alternates: { canonical: '/privacy' },
}

export default function PrivacyPage() {
  return <LegalArticle markdown={markdown} />
}
