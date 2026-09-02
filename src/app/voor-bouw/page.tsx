// src/app/voor-bouw/page.tsx
// [SEGMENT-VOORDEUR] Eén deur, één boodschap — de app erachter is dezelfde.
// Alle tekst staat in src/lib/segment-pages.ts; deze file is alleen de route en de metadata.

import type { Metadata } from 'next'
import SegmentVoordeur from '@/components/SegmentVoordeur'
import { segmentBySlug } from '@/lib/segment-pages'

const pagina = segmentBySlug('bouw')!

export const metadata: Metadata = {
  title: pagina.title,
  description: pagina.description,
  keywords: pagina.keywords,
  alternates: { canonical: '/voor-bouw' },
  openGraph: { title: pagina.title, description: pagina.description, type: 'website' },
}

export default function BouwPage() {
  return <SegmentVoordeur pagina={pagina} />
}
