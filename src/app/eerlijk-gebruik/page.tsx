// src/app/eerlijk-gebruik/page.tsx
// [FAIR-USE] Publiek beleid eerlijk gebruik. Bron: src/content/legal/eerlijk-gebruik.ts,
// die de grenzen uit src/lib/fair-use.ts leest — nooit met de hand overtypen.

import type { Metadata } from 'next'
import LegalArticle from '@/components/legal-article'
import markdown from '@/content/legal/eerlijk-gebruik'

export const metadata: Metadata = {
  title: 'Eerlijk gebruik | BoekBrug',
  description:
    'Wat gratis is bij BoekBrug, waar de grens ligt en wat er gebeurt als je erboven komt. Geen automatische afschrijving, geen verlies van je gegevens.',
  alternates: { canonical: '/eerlijk-gebruik' },
}

export default function EerlijkGebruikPage() {
  return <LegalArticle markdown={markdown} />
}
