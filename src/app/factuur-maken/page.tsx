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

export const metadata: Metadata = {
  title: 'Factuur maken — gratis factuur als PDF | BoekBrug',
  description:
    'Maak gratis een nette factuur die klopt met de Nederlandse regels. Vul in, download als PDF. Geen account nodig — je gegevens blijven in je browser.',
  keywords: ['factuur maken', 'gratis factuur', 'factuur pdf', 'factuur voorbeeld', 'zzp factuur'],
  alternates: { canonical: '/factuur-maken' },
  openGraph: {
    title: 'Factuur maken — gratis factuur als PDF',
    description: 'Maak gratis een nette factuur en download hem als PDF. Geen account nodig.',
    type: 'website',
  },
}

const faq = [
  {
    q: 'Kan ik gratis een factuur maken?',
    a: 'Ja. Vul je gegevens in en download je factuur als PDF. Je hebt geen account nodig en er zijn geen kosten.',
  },
  {
    q: 'Klopt de factuur met de Nederlandse regels?',
    a: 'De factuur bevat de vaste onderdelen: je gegevens, de klant, een factuurnummer, de datum, de BTW per tarief en het totaal.',
  },
  {
    q: 'Blijven mijn gegevens privé?',
    a: 'Ja. Je gegevens blijven in je eigen browser. Wil je je facturen bewaren en versturen? Maak dan een gratis BoekBrug-account.',
  },
]

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
