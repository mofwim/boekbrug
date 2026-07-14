// src/app/en/btw-aangifte-berekenen/page.tsx
// [AANGIFTE-TOOL/EN] English VAT-return calculator. Renders the SAME
// <BtwAangifteCalculator/> with locale="en"; the rubrieken/box math is shared
// and unchanged. Targets "Dutch VAT return calculator" / "BTW aangifte english".

import type { Metadata } from 'next'
import Link from 'next/link'
import BtwAangifteCalculator from '@/app/btw-aangifte-berekenen/BtwAangifteCalculator'
import PublicFooter from '@/components/public-footer'
import PublicHeader from '@/components/public-header'
import { absoluteUrl } from '@/lib/site'

export const metadata: Metadata = {
  title: 'Dutch VAT return calculator — how much VAT do I pay? (BTW) | BoekBrug',
  description:
    'Calculate your Dutch VAT return (BTW-aangifte): VAT due on your revenue (21% and 9%) minus input VAT = to pay or to reclaim. Free, no account needed.',
  keywords: ['dutch vat return calculator', 'btw aangifte english', 'vat return netherlands', 'how much vat do i pay netherlands', 'input vat netherlands'],
  alternates: {
    canonical: '/en/btw-aangifte-berekenen',
    languages: { 'nl-NL': '/btw-aangifte-berekenen', 'en': '/en/btw-aangifte-berekenen' },
  },
  openGraph: {
    title: 'Dutch VAT return calculator',
    description: 'VAT due − input VAT = to pay or to reclaim. Free VAT-return simulator.',
    type: 'website',
  },
}

const faq = [
  {
    q: 'How do I calculate how much VAT I have to pay?',
    a: 'Add up the VAT on your revenue (21% and 9%). Subtract the input VAT: the VAT you paid yourself on your costs. What remains, you pay. Is the amount negative? Then you get VAT back.',
  },
  {
    q: 'What is input VAT (voorbelasting)?',
    a: 'Input VAT is the VAT you pay on your business purchases and costs. You may deduct it from the VAT you owe on your revenue.',
  },
  {
    q: 'When do I file a VAT return in the Netherlands?',
    a: 'Most freelancers file each quarter, before the last day of the month after the quarter (for example Q1 before 30 April). BoekBrug keeps your VAT per quarter.',
  },
]

const jsonLd = {
  '@context': 'https://schema.org',
  '@graph': [
    { '@type': 'WebApplication', name: 'Dutch VAT return calculator', applicationCategory: 'FinanceApplication', operatingSystem: 'Web', offers: { '@type': 'Offer', price: '0', priceCurrency: 'EUR' }, description: 'Calculate your VAT to pay or reclaim: VAT on revenue minus input VAT.' },
    { '@type': 'FAQPage', mainEntity: faq.map((f) => ({ '@type': 'Question', name: f.q, acceptedAnswer: { '@type': 'Answer', text: f.a } })) },
    {
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Home', item: absoluteUrl('/') },
        { '@type': 'ListItem', position: 2, name: 'Blog', item: absoluteUrl('/en/blog') },
        { '@type': 'ListItem', position: 3, name: 'Dutch VAT return calculator', item: absoluteUrl('/en/btw-aangifte-berekenen') },
      ],
    },
  ],
}

const wrap: React.CSSProperties = { maxWidth: 680, margin: '0 auto', padding: '0 16px' }
const h2: React.CSSProperties = { fontSize: 20, fontWeight: 700, color: '#1c1c1e', margin: '0 0 12px' }
const p: React.CSSProperties = { fontSize: 15, lineHeight: 1.65, color: '#3c3c43', margin: '0 0 14px' }

export default function EnBtwAangiftePage() {
  return (
    <div style={{ minHeight: '100vh', backgroundColor: '#f2f2f7', fontFamily: 'var(--font-sans), system-ui, sans-serif' }}>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <PublicHeader />

      <div style={{ ...wrap, paddingTop: 40, textAlign: 'center' }}>
        <h1 style={{ fontSize: 32, fontWeight: 800, color: '#1c1c1e', margin: '0 0 8px', letterSpacing: -0.5 }}>
          Dutch VAT return calculator
        </h1>
        <p style={{ fontSize: 16, color: '#6b6b6e', margin: '0 0 8px' }}>
          How much VAT do you pay — or get back? Enter your revenue and input VAT.
        </p>
        <p style={{ fontSize: 14, margin: '0 0 28px' }}>
          <Link href="/btw-aangifte-berekenen" style={{ color: '#007aff', textDecoration: 'none', fontWeight: 600 }}>
            🇳🇱 Bekijk in het Nederlands →
          </Link>
        </p>
      </div>

      <div style={{ ...wrap, paddingBottom: 40 }}>
        <BtwAangifteCalculator locale="en" />
      </div>

      <div style={{ ...wrap, paddingBottom: 64 }}>
        <section style={{ marginTop: 24 }}>
          <h2 style={h2}>How does the VAT return work?</h2>
          <p style={p}>
            You pay the VAT you charged on your revenue (21% and 9%). From that you subtract the{' '}
            <strong>input VAT</strong>: the VAT you paid yourself on your costs. The balance (box 5c) is what
            you pay. Is it negative? Then you get VAT back.
          </p>
        </section>

        <section style={{ marginTop: 28 }}>
          <h2 style={h2}>Frequently asked questions</h2>
          {faq.map((f) => (
            <div key={f.q} style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 15, fontWeight: 700, color: '#1c1c1e', marginBottom: 4 }}>{f.q}</div>
              <div style={{ fontSize: 15, lineHeight: 1.6, color: '#3c3c43' }}>{f.a}</div>
            </div>
          ))}
        </section>

        <section style={{ marginTop: 32, background: '#ffffff', border: '1px solid #ececf1', borderRadius: 16, padding: 24, textAlign: 'center' }}>
          <div style={{ fontSize: 18, fontWeight: 700, color: '#1c1c1e', marginBottom: 6 }}>Your VAT tracked automatically?</div>
          <div style={{ fontSize: 15, color: '#6b6b6e', marginBottom: 16 }}>
            BoekBrug adds up your VAT per quarter from your invoices and costs. Ready for the return.
          </div>
          <div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
            <Link href="/register" style={{ backgroundColor: '#007aff', color: '#fff', fontSize: 15, fontWeight: 600, padding: '12px 22px', borderRadius: 9999, textDecoration: 'none' }}>Create a free account</Link>
            <Link href="/en/btw-berekenen" style={{ backgroundColor: '#fff', color: '#007aff', fontSize: 15, fontWeight: 600, padding: '12px 22px', borderRadius: 9999, border: '1.5px solid #007aff', textDecoration: 'none' }}>VAT calculator</Link>
          </div>
        </section>

        <p style={{ textAlign: 'center', fontSize: 12, color: '#aeaeb2', marginTop: 40 }}>
          BoekBrug — the bridge between you and your accountant. This is an estimate. For exemptions, ICP or
          reverse-charge VAT, extra rules apply.
        </p>
      </div>

      <PublicFooter />
    </div>
  )
}
