// src/app/en/uurtarief-berekenen/page.tsx
// [UURTARIEF-TOOL/EN] English hourly-rate calculator. Renders the SAME
// <UurtariefCalculator/> with locale="en"; the rate math is shared and
// unchanged. Targets "freelance hourly rate Netherlands" search demand.

import type { Metadata } from 'next'
import Link from 'next/link'
import UurtariefCalculator from '@/app/uurtarief-berekenen/UurtariefCalculator'
import PublicFooter from '@/components/public-footer'
import PublicHeader from '@/components/public-header'
import { absoluteUrl } from '@/lib/site'

export const metadata: Metadata = {
  title: 'Freelance hourly rate calculator (Netherlands / ZZP) | BoekBrug',
  description:
    'Work out your hourly rate as a freelancer in the Netherlands: desired annual income, business costs and billable hours, with a buffer for tax and pension. Free, no account needed.',
  keywords: ['freelance hourly rate netherlands', 'zzp hourly rate calculator', 'what to charge per hour netherlands', 'freelancer rate calculator netherlands', 'day rate calculator netherlands'],
  alternates: {
    canonical: '/en/uurtarief-berekenen',
    languages: { 'nl-NL': '/uurtarief-berekenen', 'en': '/en/uurtarief-berekenen' },
  },
  openGraph: {
    title: 'Freelance hourly rate calculator (Netherlands)',
    description: 'Desired income + costs ÷ billable hours, with a buffer. Free hourly-rate calculator.',
    type: 'website',
  },
}

const faq = [
  {
    q: 'How do I calculate my hourly rate as a freelancer?',
    a: 'Add your desired annual income to your business costs. Divide that by the hours you can invoice per year. Then add a buffer on top for tax, pension and downtime.',
  },
  {
    q: 'How many billable hours does a freelancer have per year?',
    a: 'From a full-time year of about 1,800 working hours you can often only really invoice about 1,200. The rest goes to finding clients, admin and time off.',
  },
  {
    q: 'Why a buffer on top of my rate?',
    a: 'As a freelancer you pay your own income tax, pension and insurance. You also have hours you cannot invoice. A buffer of, say, 30% accounts for this.',
  },
]

const jsonLd = {
  '@context': 'https://schema.org',
  '@graph': [
    {
      '@type': 'WebApplication',
      name: 'Freelance hourly rate calculator (Netherlands)',
      applicationCategory: 'FinanceApplication',
      operatingSystem: 'Web',
      offers: { '@type': 'Offer', price: '0', priceCurrency: 'EUR' },
      description: 'Free hourly-rate calculator: desired income + costs ÷ billable hours, with a buffer.',
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
        { '@type': 'ListItem', position: 3, name: 'Freelance hourly rate calculator', item: absoluteUrl('/en/uurtarief-berekenen') },
      ],
    },
  ],
}

const wrap: React.CSSProperties = { maxWidth: 680, margin: '0 auto', padding: '0 16px' }
const h2: React.CSSProperties = { fontSize: 20, fontWeight: 700, color: '#202124', margin: '0 0 12px' }
const p: React.CSSProperties = { fontSize: 15, lineHeight: 1.65, color: '#3c4043', margin: '0 0 14px' }

export default function EnUurtariefPage() {
  return (
    <div style={{ minHeight: '100vh', backgroundColor: '#f8f9fa', fontFamily: 'var(--font-sans), system-ui, sans-serif' }}>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <PublicHeader />

      <div style={{ ...wrap, paddingTop: 40, textAlign: 'center' }}>
        <h1 style={{ fontSize: 32, fontWeight: 800, color: '#202124', margin: '0 0 8px', letterSpacing: -0.5 }}>
          Freelance hourly rate calculator
        </h1>
        <p style={{ fontSize: 16, color: '#5f6368', margin: '0 0 8px' }}>
          What should you charge per hour as a freelancer in the Netherlands? Work it out from your income,
          costs and hours.
        </p>
        <p style={{ fontSize: 14, margin: '0 0 28px' }}>
          <Link href="/uurtarief-berekenen" style={{ color: '#1a73e8', textDecoration: 'none', fontWeight: 600 }}>
            🇳🇱 Bekijk in het Nederlands →
          </Link>
        </p>
      </div>

      <div style={{ ...wrap, paddingBottom: 40 }}>
        <UurtariefCalculator locale="en" />
      </div>

      <div style={{ ...wrap, paddingBottom: 64 }}>
        <section style={{ marginTop: 24 }}>
          <h2 style={h2}>How do you set your hourly rate?</h2>
          <p style={p}>
            A good hourly rate covers more than just your desired income. The formula:{' '}
            <strong>(desired annual income + business costs) ÷ the hours you can invoice</strong>. On top of
            that you add a buffer for tax, pension, insurance and hours you cannot invoice.
          </p>
          <p style={p}>
            Don't forget the hours you cannot invoice. Finding clients, admin, illness and holidays all come
            off your billable time. So plan with about 1,200 rather than 1,800 hours.
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

        <section style={{ marginTop: 32, background: '#ffffff', border: '1px solid #e0e0e0', borderRadius: 16, padding: 24, textAlign: 'center' }}>
          <div style={{ fontSize: 18, fontWeight: 700, color: '#202124', marginBottom: 6 }}>Invoice your rate?</div>
          <div style={{ fontSize: 15, color: '#5f6368', marginBottom: 16 }}>
            Put your hourly rate straight onto a tidy invoice with BoekBrug. The VAT is calculated
            automatically.
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
          BoekBrug — the bridge between you and your accountant. This is an estimate; not tax advice.
        </p>
      </div>

      <PublicFooter />
    </div>
  )
}
