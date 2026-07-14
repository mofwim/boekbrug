// src/app/en/netto-inkomen-zzp/page.tsx
// [NETTO-TOOL/EN] English version of the ZZP net-income estimator. Server: EN
// SEO + JSON-LD; renders the SAME <NettoCalculator/> with locale="en". The 2026
// tax parameters and the whole calculation are shared and unchanged — only the
// display language and number formatting differ. Targets "freelance net income
// Netherlands" / "self-employed tax calculator Netherlands" search demand.

import type { Metadata } from 'next'
import Link from 'next/link'
import NettoCalculator from '@/app/netto-inkomen-zzp/NettoCalculator'
import PublicFooter from '@/components/public-footer'
import PublicHeader from '@/components/public-header'
import { absoluteUrl } from '@/lib/site'

export const metadata: Metadata = {
  title: 'Freelance net income calculator Netherlands 2026 (ZZP) | BoekBrug',
  description:
    'Work out what you keep net as a freelancer (ZZP) in the Netherlands in 2026: income tax, the self-employed deduction, SME profit exemption, tax credits and the Zvw contribution. An estimate. Free.',
  keywords: ['freelance net income netherlands', 'zzp net income calculator', 'self-employed tax calculator netherlands', 'freelancer take home pay netherlands 2026', 'dutch freelance tax calculator'],
  alternates: {
    canonical: '/en/netto-inkomen-zzp',
    languages: { 'nl-NL': '/netto-inkomen-zzp', 'en': '/en/netto-inkomen-zzp' },
  },
  openGraph: {
    title: 'Freelance net income calculator Netherlands (2026)',
    description: 'How much do you keep? An estimate with tax, deductions, tax credits and Zvw.',
    type: 'website',
  },
}

const faq = [
  {
    q: 'How much do I keep net as a freelancer?',
    a: 'It depends on your profit and your deductions. From your profit come first the self-employed deduction and the SME profit exemption (12.7%). On the rest you pay income tax (minus tax credits) and the Zvw health contribution. What is left is your net.',
  },
  {
    q: 'What is the self-employed deduction in 2026?',
    a: 'The self-employed deduction (zelfstandigenaftrek) is € 1,200 in 2026 if you meet the hours criterion (≥ 1,225 hours). Starters get an extra € 2,123 starter’s deduction on top.',
  },
  {
    q: 'Is this calculation exact?',
    a: 'No, it is an estimate based on the 2026 rates. Your situation (partner, other income, allowances, exact labour credit) can differ. This is not tax advice.',
  },
]

const jsonLd = {
  '@context': 'https://schema.org',
  '@graph': [
    { '@type': 'WebApplication', name: 'Freelance net income calculator (Netherlands)', applicationCategory: 'FinanceApplication', operatingSystem: 'Web', offers: { '@type': 'Offer', price: '0', priceCurrency: 'EUR' }, description: 'Indicative net-income calculator for freelancers (ZZP) in the Netherlands (2026).' },
    { '@type': 'FAQPage', mainEntity: faq.map((f) => ({ '@type': 'Question', name: f.q, acceptedAnswer: { '@type': 'Answer', text: f.a } })) },
    {
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Home', item: absoluteUrl('/') },
        { '@type': 'ListItem', position: 2, name: 'Blog', item: absoluteUrl('/en/blog') },
        { '@type': 'ListItem', position: 3, name: 'Freelance net income calculator', item: absoluteUrl('/en/netto-inkomen-zzp') },
      ],
    },
  ],
}

const wrap: React.CSSProperties = { maxWidth: 680, margin: '0 auto', padding: '0 16px' }
const h2: React.CSSProperties = { fontSize: 20, fontWeight: 700, color: '#1c1c1e', margin: '0 0 12px' }
const p: React.CSSProperties = { fontSize: 15, lineHeight: 1.65, color: '#3c3c43', margin: '0 0 14px' }

export default function EnNettoInkomenPage() {
  return (
    <div style={{ minHeight: '100vh', backgroundColor: '#f2f2f7', fontFamily: 'var(--font-sans), system-ui, sans-serif' }}>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <PublicHeader />

      <div style={{ ...wrap, paddingTop: 40, textAlign: 'center' }}>
        <h1 style={{ fontSize: 32, fontWeight: 800, color: '#1c1c1e', margin: '0 0 8px', letterSpacing: -0.5 }}>
          Freelance net income calculator (Netherlands)
        </h1>
        <p style={{ fontSize: 16, color: '#6b6b6e', margin: '0 0 8px' }}>
          How much of your profit do you keep net in 2026? Work it out. It is an estimate.
        </p>
        <p style={{ fontSize: 14, margin: '0 0 28px' }}>
          <Link href="/netto-inkomen-zzp" style={{ color: '#007aff', textDecoration: 'none', fontWeight: 600 }}>
            🇳🇱 Bekijk in het Nederlands →
          </Link>
        </p>
      </div>

      <div style={{ ...wrap, paddingBottom: 40 }}>
        <NettoCalculator locale="en" />
      </div>

      <div style={{ ...wrap, paddingBottom: 64 }}>
        <section style={{ marginTop: 24 }}>
          <h2 style={h2}>From profit to net</h2>
          <p style={p}>
            From your <strong>profit</strong> comes first the self-employed deduction (if you meet the hours
            criterion). Then the <strong>SME profit exemption</strong> of 12.7% comes off. On the rest you pay
            income tax in box 1. The general tax credit and the labour credit then come off that. Finally the
            <strong> Zvw</strong> health contribution is added (4.85% in 2026). What is left is your net income.
          </p>
          <p style={p}>
            This tool uses the 2026 rates and shows every step. It is an estimate. Your situation can differ,
            and it is not tax advice.
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
          <div style={{ fontSize: 18, fontWeight: 700, color: '#1c1c1e', marginBottom: 6 }}>Know where you stand all year</div>
          <div style={{ fontSize: 15, color: '#6b6b6e', marginBottom: 16 }}>
            BoekBrug keeps your revenue and VAT per quarter. So your VAT return is as good as done.
          </div>
          <div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
            <Link href="/register" style={{ backgroundColor: '#007aff', color: '#fff', fontSize: 15, fontWeight: 600, padding: '12px 22px', borderRadius: 9999, textDecoration: 'none' }}>Create a free account</Link>
            <Link href="/en/blog" style={{ backgroundColor: '#fff', color: '#007aff', fontSize: 15, fontWeight: 600, padding: '12px 22px', borderRadius: 9999, border: '1.5px solid #007aff', textDecoration: 'none' }}>Read the blog</Link>
          </div>
        </section>

        <p style={{ textAlign: 'center', fontSize: 12, color: '#aeaeb2', marginTop: 40 }}>
          BoekBrug — the bridge between you and your accountant. An estimate based on the 2026 rates. Not tax
          advice. In doubt? Check the Belastingdienst (Dutch tax office).
        </p>
      </div>

      <PublicFooter />
    </div>
  )
}
