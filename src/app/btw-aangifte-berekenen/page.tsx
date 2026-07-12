// src/app/btw-aangifte-berekenen/page.tsx
// [AANGIFTE-TOOL] Public BTW-aangifte simulator (lead-gen). Server: SEO + JSON-LD.

import type { Metadata } from 'next'
import Link from 'next/link'
import BtwAangifteCalculator from './BtwAangifteCalculator'
import ToolsCrossLinks from '@/app/tools/ToolsCrossLinks'
import PublicFooter from '@/components/public-footer'

export const metadata: Metadata = {
  title: 'BTW-aangifte berekenen — hoeveel BTW moet ik betalen? | BoekBrug',
  description:
    'Bereken je BTW-aangifte: verschuldigde BTW over je omzet (21% en 9%) min voorbelasting = te betalen of terug te vragen. Gratis, geen account nodig.',
  keywords: ['btw aangifte berekenen', 'hoeveel btw moet ik betalen', 'btw teruggave berekenen', 'voorbelasting'],
  alternates: { canonical: '/btw-aangifte-berekenen' },
  openGraph: {
    title: 'BTW-aangifte berekenen',
    description: 'Verschuldigde BTW − voorbelasting = te betalen of terug. Gratis simulator.',
    type: 'website',
  },
}

const faq = [
  {
    q: 'Hoe bereken ik hoeveel BTW ik moet betalen?',
    a: 'Tel de BTW over je omzet op (21% en 9%). Trek daar de voorbelasting af: de BTW die je zelf op je kosten betaalde. Wat overblijft betaal je. Is het bedrag negatief? Dan krijg je BTW terug.',
  },
  {
    q: 'Wat is voorbelasting?',
    a: 'Voorbelasting is de BTW die je betaalt op je zakelijke inkopen en kosten. Die mag je aftrekken van de BTW die je over je omzet moet afdragen.',
  },
  {
    q: 'Wanneer moet ik BTW-aangifte doen?',
    a: 'De meeste ZZP’ers doen elk kwartaal aangifte. Dat doe je vóór de laatste dag van de maand na het kwartaal (bijvoorbeeld Q1 vóór 30 april). BoekBrug houdt je BTW per kwartaal bij.',
  },
]

const jsonLd = {
  '@context': 'https://schema.org',
  '@graph': [
    { '@type': 'WebApplication', name: 'BTW-aangifte simulator', applicationCategory: 'FinanceApplication', operatingSystem: 'Web', offers: { '@type': 'Offer', price: '0', priceCurrency: 'EUR' }, description: 'Bereken je te betalen of terug te vragen BTW: omzet-BTW min voorbelasting.' },
    { '@type': 'FAQPage', mainEntity: faq.map((f) => ({ '@type': 'Question', name: f.q, acceptedAnswer: { '@type': 'Answer', text: f.a } })) },
  ],
}

const wrap: React.CSSProperties = { maxWidth: 680, margin: '0 auto', padding: '0 16px' }
const h2: React.CSSProperties = { fontSize: 20, fontWeight: 700, color: '#1c1c1e', margin: '0 0 12px' }
const p: React.CSSProperties = { fontSize: 15, lineHeight: 1.65, color: '#3c3c43', margin: '0 0 14px' }

export default function BtwAangiftePage() {
  return (
    <div style={{ minHeight: '100vh', backgroundColor: '#f2f2f7', fontFamily: 'var(--font-sans), system-ui, sans-serif' }}>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />

      <div style={{ ...wrap, paddingTop: 40, textAlign: 'center' }}>
        <h1 style={{ fontSize: 32, fontWeight: 800, color: '#1c1c1e', margin: '0 0 8px', letterSpacing: -0.5 }}>
          BTW-aangifte berekenen
        </h1>
        <p style={{ fontSize: 16, color: '#6b6b6e', margin: '0 0 28px' }}>
          Hoeveel BTW moet je betalen — of krijg je terug? Vul je omzet en voorbelasting in.
        </p>
      </div>

      <div style={{ ...wrap, paddingBottom: 40 }}>
        <BtwAangifteCalculator />
      </div>

      <div style={{ ...wrap, paddingBottom: 64 }}>
        <section style={{ marginTop: 24 }}>
          <h2 style={h2}>Hoe werkt de BTW-aangifte?</h2>
          <p style={p}>
            Je betaalt de BTW die je over je omzet rekende (21% en 9%). Daar trek je de{' '}
            <strong>voorbelasting</strong> van af: de BTW die je zelf op je kosten betaalde. Het saldo
            (rubriek 5c) betaal je. Is het negatief? Dan krijg je BTW terug.
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
          <div style={{ fontSize: 18, fontWeight: 700, color: '#1c1c1e', marginBottom: 6 }}>Je BTW automatisch bijgehouden?</div>
          <div style={{ fontSize: 15, color: '#6b6b6e', marginBottom: 16 }}>
            BoekBrug telt je BTW per kwartaal op uit je facturen en kosten. Klaar voor de aangifte.
          </div>
          <div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
            <Link href="/register" style={{ backgroundColor: '#007aff', color: '#fff', fontSize: 15, fontWeight: 600, padding: '12px 22px', borderRadius: 9999, textDecoration: 'none' }}>Gratis account</Link>
            <Link href="/factuur-maken" style={{ backgroundColor: '#fff', color: '#007aff', fontSize: 15, fontWeight: 600, padding: '12px 22px', borderRadius: 9999, border: '1.5px solid #007aff', textDecoration: 'none' }}>Factuur maken</Link>
          </div>
        </section>

        <p style={{ textAlign: 'center', fontSize: 12, color: '#aeaeb2', marginTop: 40 }}>
          BoekBrug — de brug tussen jou en je boekhouder. Dit is een schatting. Bij vrijstellingen, ICP of
          verlegde BTW gelden extra regels.
        </p>
      </div>

      <ToolsCrossLinks currentSlug="/btw-aangifte-berekenen" />
      <PublicFooter />
    </div>
  )
}
