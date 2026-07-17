// src/app/en/kilometervergoeding/page.tsx
// [KM-TOOL/EN] English mileage-allowance calculator. Renders the SAME
// <KmCalculator/> with locale="en"; km × rate math is shared and unchanged.
// Targets "mileage allowance Netherlands" / "kilometervergoeding english".

import type { Metadata } from 'next'
import Link from 'next/link'
import KmCalculator from '@/app/kilometervergoeding/KmCalculator'
import PublicFooter from '@/components/public-footer'
import PublicHeader from '@/components/public-header'
import { absoluteUrl } from '@/lib/site'

export const metadata: Metadata = {
  title: 'Mileage allowance calculator Netherlands 2026 (€0.25/km) | BoekBrug',
  description:
    'Quickly calculate your Dutch mileage allowance: kilometres × rate, with return trips and multiple journeys. 2026 rate: € 0.25 per km. Free, no account needed.',
  keywords: ['mileage allowance netherlands', 'kilometervergoeding english', 'travel allowance netherlands 2026', 'business mileage netherlands', '0.25 per km netherlands'],
  alternates: {
    canonical: '/en/kilometervergoeding',
    languages: { 'nl-NL': '/kilometervergoeding', 'en': '/en/kilometervergoeding' },
  },
  openGraph: {
    title: 'Mileage allowance calculator Netherlands (2026)',
    description: 'Kilometres × rate, with return trips and journeys. 2026 rate: € 0.25 per km. Free.',
    type: 'website',
  },
}

const faq = [
  {
    q: 'How much is the mileage allowance in the Netherlands in 2026?',
    a: 'The tax-free mileage allowance in 2026 is € 0.25 per kilometre (up from € 0.23). It may be paid tax-free. As a freelancer you deduct this amount per business kilometre from your profit.',
  },
  {
    q: 'How do I calculate my travel allowance?',
    a: 'Multiply the number of kilometres by the rate per kilometre. If you drive there and back, count both journeys (× 2).',
  },
  {
    q: 'Can I deduct travel costs as a freelancer?',
    a: 'For business trips in a private car you may deduct € 0.25 per kilometre from your profit. If you drive a company car, different rules apply.',
  },
]

const jsonLd = {
  '@context': 'https://schema.org',
  '@graph': [
    {
      '@type': 'WebApplication',
      name: 'Mileage allowance calculator (Netherlands)',
      applicationCategory: 'FinanceApplication',
      operatingSystem: 'Web',
      offers: { '@type': 'Offer', price: '0', priceCurrency: 'EUR' },
      description: 'Free calculator for the Dutch mileage / travel allowance (2026: € 0.25 per km).',
    },
    {
      '@type': 'FAQPage',
      mainEntity: faq.map((f) => ({ '@type': 'Question', name: f.q, acceptedAnswer: { '@type': 'Answer', text: f.a } })),
    },
    {
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Home', item: absoluteUrl('/') },
        { '@type': 'ListItem', position: 2, name: 'Blog', item: absoluteUrl('/en/blog') },
        { '@type': 'ListItem', position: 3, name: 'Mileage allowance calculator', item: absoluteUrl('/en/kilometervergoeding') },
      ],
    },
  ],
}

const wrap: React.CSSProperties = { maxWidth: 680, margin: '0 auto', padding: '0 16px' }
const h2: React.CSSProperties = { fontSize: 20, fontWeight: 700, color: '#202124', margin: '0 0 12px' }
const p: React.CSSProperties = { fontSize: 15, lineHeight: 1.65, color: '#3c4043', margin: '0 0 14px' }

export default function EnKilometervergoedingPage() {
  return (
    <div style={{ minHeight: '100vh', backgroundColor: '#f8f9fa', fontFamily: 'var(--font-sans), system-ui, sans-serif' }}>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <PublicHeader />

      <div style={{ ...wrap, paddingTop: 40, textAlign: 'center' }}>
        <h1 style={{ fontSize: 32, fontWeight: 800, color: '#202124', margin: '0 0 8px', letterSpacing: -0.5 }}>
          Mileage allowance calculator
        </h1>
        <p style={{ fontSize: 16, color: '#5f6368', margin: '0 0 8px' }}>
          Work out your travel costs in seconds. 2026 rate: <strong>€ 0.25 per km</strong>. Free, no account
          needed.
        </p>
        <p style={{ fontSize: 14, margin: '0 0 28px' }}>
          <Link href="/kilometervergoeding" style={{ color: '#1a73e8', textDecoration: 'none', fontWeight: 600 }}>
            🇳🇱 Bekijk in het Nederlands →
          </Link>
        </p>
      </div>

      <div style={{ ...wrap, paddingBottom: 40 }}>
        <KmCalculator locale="en" />
      </div>

      <div style={{ ...wrap, paddingBottom: 64 }}>
        <section style={{ marginTop: 24 }}>
          <h2 style={h2}>Mileage allowance 2026</h2>
          <p style={p}>
            Since 1 January 2026 the tax-free mileage allowance is <strong>€ 0.25 per kilometre</strong> (up
            from € 0.23). Employers may pay it tax-free. As a freelancer you deduct € 0.25 per business
            kilometre from your profit.
          </p>
          <p style={p}>
            Work out your allowance: kilometres × rate. Driving there and back? Count the distance twice.
            Making the trip more often? Enter the number of trips.
          </p>
        </section>

        <section style={{ marginTop: 28 }}>
          <h2 style={h2}>Frequently asked questions</h2>
          {faq.map((f) => (
            <div key={f.q} style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 15, fontWeight: 700, color: '#202124', marginBottom: 4 }}>{f.q}</div>
              <div style={{ fontSize: 15, lineHeight: 1.6, color: '#3c4043' }}>{f.a}</div>
            </div>
          ))}
        </section>

        <section style={{ marginTop: 32, background: '#ffffff', border: '1px solid #ececf1', borderRadius: 16, padding: 24, textAlign: 'center' }}>
          <div style={{ fontSize: 18, fontWeight: 700, color: '#202124', marginBottom: 6 }}>Travel costs tidily on your invoice?</div>
          <div style={{ fontSize: 15, color: '#5f6368', marginBottom: 16 }}>
            With BoekBrug you put travel costs as a separate line on a tidy invoice, with the right VAT.
          </div>
          <div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
            <Link href="/register" style={{ backgroundColor: '#1a73e8', color: '#fff', fontSize: 15, fontWeight: 600, padding: '12px 22px', borderRadius: 9999, textDecoration: 'none' }}>
              Create a free account
            </Link>
            <Link href="/en/btw-berekenen" style={{ backgroundColor: '#fff', color: '#1a73e8', fontSize: 15, fontWeight: 600, padding: '12px 22px', borderRadius: 9999, border: '1.5px solid #1a73e8', textDecoration: 'none' }}>
              VAT calculator
            </Link>
          </div>
        </section>

        <p style={{ textAlign: 'center', fontSize: 12, color: '#bdc1c6', marginTop: 40 }}>
          BoekBrug — the bridge between you and your accountant. The rate can change. In doubt? Check the
          Belastingdienst (Dutch tax office).
        </p>
      </div>

      <PublicFooter />
    </div>
  )
}
