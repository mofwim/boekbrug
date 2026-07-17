// src/app/en/btw-berekenen/page.tsx
// [BTW-TOOL/EN] English version of the public BTW (VAT) calculator. Server
// component: owns English SEO metadata + structured data and renders the SAME
// interactive <BtwCalculator/> (client) with locale="en". The calculation and
// number engine are shared and unchanged — only the display language differs.
// Targets the underserved "Dutch VAT calculator (English)" search demand.

import type { Metadata } from 'next'
import Link from 'next/link'
import BtwCalculator from '@/app/btw-berekenen/BtwCalculator'
import PublicFooter from '@/components/public-footer'
import PublicHeader from '@/components/public-header'
import { absoluteUrl } from '@/lib/site'

export const metadata: Metadata = {
  title: 'Dutch VAT calculator (21%, 9% or 0%) — free BTW calculator | BoekBrug',
  description:
    'Quickly calculate Dutch VAT (BTW): from an amount excluding VAT to including VAT or the other way around, at 21%, 9% or 0%. Free, instant, in your browser, no account needed.',
  keywords: ['dutch vat calculator', 'btw calculator english', 'vat calculator netherlands', 'calculate vat netherlands', '21% vat netherlands'],
  alternates: {
    canonical: '/en/btw-berekenen',
    languages: { 'nl-NL': '/btw-berekenen', 'en': '/en/btw-berekenen' },
  },
  openGraph: {
    title: 'Dutch VAT calculator — free BTW calculator',
    description: 'From excluding to including VAT or the other way around. 21%, 9% or 0%. Free and instant.',
    type: 'website',
  },
}

const faq = [
  {
    q: 'How do I calculate VAT on an amount?',
    a: 'VAT on an amount excluding VAT = amount × rate. At 21% you calculate € 100 × 21% = € 21 VAT, so € 121 including VAT.',
  },
  {
    q: 'How do I take the VAT out of an amount including VAT?',
    a: 'Divide the amount including VAT by 1 plus the rate. At 21%: € 121 ÷ 1.21 = € 100 excluding, and the VAT is € 21.',
  },
  {
    q: 'Which VAT rates exist in the Netherlands?',
    a: 'The standard rate is 21%. The reduced rate is 9% (for example food, books, hairdressers). And 0% for some goods and services (for example exports within the EU).',
  },
]

const jsonLd = {
  '@context': 'https://schema.org',
  '@graph': [
    {
      '@type': 'WebApplication',
      name: 'Dutch VAT calculator',
      applicationCategory: 'FinanceApplication',
      operatingSystem: 'Web',
      offers: { '@type': 'Offer', price: '0', priceCurrency: 'EUR' },
      description: 'Free Dutch VAT (BTW) calculator: calculate VAT from excluding to including or the other way around (21%, 9%, 0%).',
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
        { '@type': 'ListItem', position: 2, name: 'Blog', item: absoluteUrl('/en/blog') },
        { '@type': 'ListItem', position: 3, name: 'Dutch VAT calculator', item: absoluteUrl('/en/btw-berekenen') },
      ],
    },
  ],
}

const wrap: React.CSSProperties = { maxWidth: 680, margin: '0 auto', padding: '0 16px' }
const h2: React.CSSProperties = { fontSize: 20, fontWeight: 700, color: '#202124', margin: '0 0 12px' }
const p: React.CSSProperties = { fontSize: 15, lineHeight: 1.65, color: '#3c4043', margin: '0 0 14px' }

export default function EnBtwCalculatorPage() {
  return (
    <div style={{ minHeight: '100vh', backgroundColor: '#f8f9fa', fontFamily: 'var(--font-sans), system-ui, sans-serif' }}>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <PublicHeader />

      <div style={{ ...wrap, paddingTop: 40, paddingBottom: 8, textAlign: 'center' }}>
        <h1 style={{ fontSize: 34, fontWeight: 800, color: '#202124', margin: '0 0 8px', letterSpacing: -0.5 }}>
          Dutch VAT calculator
        </h1>
        <p style={{ fontSize: 16, color: '#5f6368', margin: '0 0 8px' }}>
          From excluding to including VAT — or the other way around. Free and instant, no account needed.
        </p>
        <p style={{ fontSize: 14, margin: '0 0 28px' }}>
          <Link href="/btw-berekenen" style={{ color: '#1a73e8', textDecoration: 'none', fontWeight: 600 }}>
            🇳🇱 Bekijk in het Nederlands →
          </Link>
        </p>
      </div>

      <div style={{ ...wrap, paddingBottom: 40 }}>
        <BtwCalculator locale="en" />
      </div>

      {/* SEO / helpful content */}
      <div style={{ ...wrap, paddingBottom: 64 }}>
        <section style={{ marginTop: 24 }}>
          <h2 style={h2}>How does calculating VAT work?</h2>
          <p style={p}>
            Want to <strong>add</strong> VAT to an amount excluding VAT? Multiply the amount by the rate.
            For example: € 100 × 21% = € 21 VAT, together € 121 including VAT.
          </p>
          <p style={p}>
            Want to take the VAT <strong>out</strong> of an amount including VAT? Divide by 1 plus the
            rate: € 121 ÷ 1.21 = € 100 excluding VAT, so the VAT is € 21. The calculator above does this
            live, in both directions.
          </p>
        </section>

        <section style={{ marginTop: 28 }}>
          <h2 style={h2}>The Dutch VAT rates</h2>
          <p style={p}>
            <strong>21% — standard rate:</strong> applies to most goods and services.
            <br />
            <strong>9% — reduced rate:</strong> for example food, medicines, books, hairdressers, bicycle
            repair.
            <br />
            <strong>0% — zero rate:</strong> for example supplies abroad and supplies to other EU countries.
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

        {/* Funnel */}
        <section
          style={{
            marginTop: 32,
            background: '#ffffff',
            border: '1px solid #ececf1',
            borderRadius: 16,
            padding: 24,
            textAlign: 'center',
          }}
        >
          <div style={{ fontSize: 18, fontWeight: 700, color: '#202124', marginBottom: 6 }}>
            Invoices with the VAT already on them?
          </div>
          <div style={{ fontSize: 15, color: '#5f6368', marginBottom: 16 }}>
            With BoekBrug you quickly make a tidy invoice. The VAT is calculated automatically and split
            per rate.
          </div>
          <div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
            <Link
              href="/register"
              style={{
                backgroundColor: '#1a73e8',
                color: '#fff',
                fontSize: 15,
                fontWeight: 600,
                padding: '12px 22px',
                borderRadius: 9999,
                textDecoration: 'none',
              }}
            >
              Create a free account
            </Link>
            <Link
              href="/en/blog"
              style={{
                backgroundColor: '#fff',
                color: '#1a73e8',
                fontSize: 15,
                fontWeight: 600,
                padding: '12px 22px',
                borderRadius: 9999,
                border: '1.5px solid #1a73e8',
                textDecoration: 'none',
              }}
            >
              Read the blog
            </Link>
          </div>
        </section>

        <p style={{ textAlign: 'center', fontSize: 12, color: '#bdc1c6', marginTop: 40 }}>
          BoekBrug — the bridge between you and your accountant. Rates can change. In doubt? Check the
          Belastingdienst (Dutch tax office).
        </p>
      </div>

      <PublicFooter />
    </div>
  )
}
