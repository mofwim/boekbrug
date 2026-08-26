// src/app/factuur-maken/page.tsx
// [GRATIS-FACTUUR] Server shell for the login-free invoice generator. Owns the
// SEO surface (metadata + JSON-LD) that a 'use client' page can't export, then
// renders the shared header and the interactive <GratisFactuur/> client.
// The generator itself lives in ./GratisFactuur (client). This page is in
// middleware PUBLIC_PATHS so it is reachable logged-out.

import type { Metadata } from 'next'
import GratisFactuur from './GratisFactuur'
import PublicHeader from '@/components/public-header'
import { absoluteUrl } from '@/lib/site'
import { INVOICE_TOOL_FAQ } from '@/lib/invoice-tool-faq'

export const metadata: Metadata = {
  // The searched phrase first and the title short enough to survive Google's truncation. The
  // previous one led with "Factuur maken —", which spent the most-weighted position on a word
  // the phrase already contains.
  title: 'Gratis factuur maken als PDF | BoekBrug',
  description:
    'Gratis een professionele factuur maken als PDF. Voor ZZP’ers en kleine ondernemers. Geen account nodig. Vul in, download en klaar.',
  keywords: ['factuur maken', 'gratis factuur', 'factuur pdf', 'factuur voorbeeld', 'zzp factuur'],
  alternates: { canonical: '/factuur-maken' },
  openGraph: {
    title: 'Factuur maken — gratis factuur als PDF',
    description: 'Maak gratis een nette factuur en download hem als PDF. Geen account nodig.',
    type: 'website',
  },
}

// [FACTUUR-FAQ] Imported, never copied. These same questions are RENDERED by <GratisFactuur/>
// below; Google only honours FAQ markup whose questions are visible on the page, so a second
// literal here would be a violation the moment either side is edited. It already was one: this
// file used to declare three questions that appeared nowhere on the page.
const faq = INVOICE_TOOL_FAQ

const jsonLd = {
  '@context': 'https://schema.org',
  '@graph': [
    {
      '@type': 'WebApplication',
      name: 'Gratis factuur maken',
      applicationCategory: 'FinanceApplication',
      operatingSystem: 'Web',
      offers: { '@type': 'Offer', price: '0', priceCurrency: 'EUR' },
      description: 'Maak gratis een nette factuur die klopt met de Nederlandse regels en download hem als PDF.',
    },
    {
      '@type': 'FAQPage',
      mainEntity: faq.map((f) => ({
        '@type': 'Question',
        name: f.q,
        acceptedAnswer: { '@type': 'Answer', text: f.a },
      })),
    },
    {
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Home', item: absoluteUrl('/') },
        { '@type': 'ListItem', position: 2, name: 'Gratis tools', item: absoluteUrl('/tools') },
        { '@type': 'ListItem', position: 3, name: 'Factuur maken', item: absoluteUrl('/factuur-maken') },
      ],
    },
  ],
}

export default function FactuurMakenPage() {
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <PublicHeader />
      <GratisFactuur />
    </>
  )
}
