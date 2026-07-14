// src/app/uurtarief-berekenen/page.tsx
// [UURTARIEF-TOOL] Public, login-free ZZP hourly-rate calculator (lead-gen).
// Server component: SEO metadata + JSON-LD + renders <UurtariefCalculator/>.

import type { Metadata } from 'next'
import Link from 'next/link'
import UurtariefCalculator from './UurtariefCalculator'
import ToolsCrossLinks from '@/app/tools/ToolsCrossLinks'
import KennisbankLinks from '@/components/KennisbankLinks'
import PublicFooter from '@/components/public-footer'
import PublicHeader from '@/components/public-header'
import { absoluteUrl } from '@/lib/site'

export const metadata: Metadata = {
  title: 'Uurtarief berekenen ZZP — gratis calculator | BoekBrug',
  description:
    'Bereken je uurtarief als ZZP’er: gewenst jaarinkomen, zakelijke kosten en factureerbare uren, met buffer voor belasting en pensioen. Gratis, geen account nodig.',
  keywords: ['uurtarief berekenen', 'uurtarief zzp', 'wat moet ik vragen per uur', 'tarief freelancer'],
  alternates: {
    canonical: '/uurtarief-berekenen',
    languages: { 'nl-NL': '/uurtarief-berekenen', 'en': '/en/uurtarief-berekenen' },
  },
  openGraph: {
    title: 'Uurtarief berekenen als ZZP’er',
    description: 'Gewenst inkomen + kosten ÷ factureerbare uren, met buffer. Gratis uurtarief-calculator.',
    type: 'website',
  },
}

const faq = [
  {
    q: 'Hoe bereken ik mijn uurtarief als ZZP’er?',
    a: 'Tel je gewenste jaarinkomen op bij je zakelijke kosten. Deel dat door de uren die je per jaar kunt factureren. Reken daar een buffer bovenop voor belasting, pensioen en lege uren.',
  },
  {
    q: 'Hoeveel declarabele uren heeft een ZZP’er per jaar?',
    a: 'Van een fulltime jaar van ongeveer 1.800 werkuren kun je vaak maar ongeveer 1.200 uur echt factureren. De rest gaat naar klanten zoeken, administratie en vrije dagen.',
  },
  {
    q: 'Waarom een buffer bovenop mijn tarief?',
    a: 'Als ZZP’er betaal je zelf inkomstenbelasting, pensioen en verzekeringen. Ook heb je uren die je niet kunt factureren. Een buffer van bijvoorbeeld 30% houdt hier rekening mee.',
  },
]

const jsonLd = {
  '@context': 'https://schema.org',
  '@graph': [
    {
      '@type': 'WebApplication',
      name: 'Uurtarief-calculator voor ZZP’ers',
      applicationCategory: 'FinanceApplication',
      operatingSystem: 'Web',
      offers: { '@type': 'Offer', price: '0', priceCurrency: 'EUR' },
      description: 'Gratis uurtarief-calculator: gewenst inkomen + kosten ÷ declarabele uren, met buffer.',
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
        { '@type': 'ListItem', position: 3, name: 'Uurtarief berekenen', item: absoluteUrl('/uurtarief-berekenen') },
      ],
    },
  ],
}

const wrap: React.CSSProperties = { maxWidth: 680, margin: '0 auto', padding: '0 16px' }
const h2: React.CSSProperties = { fontSize: 20, fontWeight: 700, color: '#1c1c1e', margin: '0 0 12px' }
const p: React.CSSProperties = { fontSize: 15, lineHeight: 1.65, color: '#3c3c43', margin: '0 0 14px' }

export default function UurtariefBerekenenPage() {
  return (
    <div style={{ minHeight: '100vh', backgroundColor: '#f2f2f7', fontFamily: 'var(--font-sans), system-ui, sans-serif' }}>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <PublicHeader />

      <div style={{ ...wrap, paddingTop: 40, textAlign: 'center' }}>
        <h1 style={{ fontSize: 32, fontWeight: 800, color: '#1c1c1e', margin: '0 0 8px', letterSpacing: -0.5 }}>
          Uurtarief berekenen
        </h1>
        <p style={{ fontSize: 16, color: '#6b6b6e', margin: '0 0 28px' }}>
          Wat moet je als ZZP’er per uur vragen? Reken het uit op basis van je inkomen, kosten en uren.
        </p>
      </div>

      <div style={{ ...wrap, paddingBottom: 40 }}>
        <UurtariefCalculator />
      </div>

      <div style={{ ...wrap, paddingBottom: 64 }}>
        <section style={{ marginTop: 24 }}>
          <h2 style={h2}>Hoe bepaal je je uurtarief?</h2>
          <p style={p}>
            Een goed uurtarief dekt meer dan alleen je gewenste inkomen. De formule:{' '}
            <strong>(gewenst jaarinkomen + zakelijke kosten) ÷ de uren die je kunt factureren</strong>. Daar
            reken je een buffer bovenop voor belasting, pensioen, verzekeringen en uren die je niet kunt
            factureren.
          </p>
          <p style={p}>
            Vergeet de uren niet die je niet kunt factureren. Klanten zoeken, administratie, ziekte en
            vakantie gaan van je factureerbare tijd af. Reken daarom eerder met ongeveer 1.200 dan met 1.800
            uur.
          </p>
        </section>

        <section style={{ marginTop: 28 }}>
          <h2 style={h2}>Veelgestelde vragen</h2>
          {faq.map((f) => (
            <div key={f.q} style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 15, fontWeight: 700, color: '#1c1c1e', marginBottom: 4 }}>{f.q}</div>
              <div style={{ fontSize: 15, lineHeight: 1.6, color: '#3c3c43' }}>{f.a}</div>
            </div>
          ))}
        </section>

        <section style={{ marginTop: 32, background: '#ffffff', border: '1px solid #ececf1', borderRadius: 16, padding: 24, textAlign: 'center' }}>
          <div style={{ fontSize: 18, fontWeight: 700, color: '#1c1c1e', marginBottom: 6 }}>
            Je tarief factureren?
          </div>
          <div style={{ fontSize: 15, color: '#6b6b6e', marginBottom: 16 }}>
            Zet je uurtarief meteen op een nette factuur met BoekBrug. De BTW wordt automatisch berekend.
          </div>
          <div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
            <Link href="/register" style={{ backgroundColor: '#007aff', color: '#fff', fontSize: 15, fontWeight: 600, padding: '12px 22px', borderRadius: 9999, textDecoration: 'none' }}>
              Gratis account maken
            </Link>
            <Link href="/btw-berekenen" style={{ backgroundColor: '#fff', color: '#007aff', fontSize: 15, fontWeight: 600, padding: '12px 22px', borderRadius: 9999, border: '1.5px solid #007aff', textDecoration: 'none' }}>
              BTW berekenen
            </Link>
          </div>
        </section>

        <p style={{ textAlign: 'center', fontSize: 12, color: '#aeaeb2', marginTop: 40 }}>
          BoekBrug — de brug tussen jou en je boekhouder. Dit is een schatting; geen fiscaal advies.
        </p>
      </div>

      <ToolsCrossLinks currentSlug="/uurtarief-berekenen" />
      <KennisbankLinks tool="/uurtarief-berekenen" />
      <PublicFooter />
    </div>
  )
}
