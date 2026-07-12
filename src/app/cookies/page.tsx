// src/app/cookies/page.tsx
// [LEGAL] Cookiebeleid. Public page — source in docs/legal.

import type { Metadata } from 'next'
import LegalArticle from '@/components/legal-article'
import markdown from '@/content/legal/cookiebeleid'

export const metadata: Metadata = {
  title: 'Cookiebeleid | BoekBrug',
  description: 'Welke cookies BoekBrug gebruikt en waarom. Geen marketing- of trackingcookies.',
  alternates: { canonical: '/cookies' },
}

export default function CookiesPage() {
  return <LegalArticle markdown={markdown} />
}
