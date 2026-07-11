// src/app/kilometervergoeding/page.tsx
// [KM-TOOL] Public, login-free kilometervergoeding calculator (lead-gen).
// Server component: SEO metadata + JSON-LD + renders <KmCalculator/> (client).

import type { Metadata } from 'next'
import Link from 'next/link'
import KmCalculator from './KmCalculator'

export const metadata: Metadata = {
  title: 'Kilometervergoeding berekenen 2026 (€0,25/km) — gratis | BoekBrug',
  description:
    'Bereken snel je reiskostenvergoeding: kilometers × tarief, met retour en meerdere ritten. Tarief 2026: € 0,25 per km. Gratis, geen account nodig.',
  keywords: ['kilometervergoeding berekenen', 'reiskostenvergoeding', 'km vergoeding 2026', '0,25 per km'],
  alternates: { canonical: '/kilometervergoeding' },
  openGraph: {
    title: 'Kilometervergoeding berekenen (2026)',
    description: 'Kilometers × tarief, met retour en ritten. Tarief 2026: € 0,25 per km. Gratis.',
    type: 'website',
  },
}

const faq = [
  {
    q: 'Hoeveel is de kilometervergoeding in 2026?',
    a: 'De onbelaste kilometervergoeding is in 2026 € 0,25 per kilometer (verhoogd van € 0,23). Je mag dit bedrag belastingvrij vergoeden of, als ondernemer, per zakelijke kilometer van je winst aftrekken.',
  },
  {
    q: 'Hoe bereken ik mijn reiskostenvergoeding?',
    a: 'Vermenigvuldig het aantal kilometers met het tarief per kilometer. Rijd je heen en terug, tel dan beide ritten mee (× 2).',
  },
  {
    q: 'Mag ik als ZZP’er reiskosten aftrekken?',
    a: 'Voor zakelijke ritten met een privéauto mag je € 0,25 per kilometer als kosten aftrekken van je winst. Rijd je in een auto van de zaak, dan gelden andere regels.',
  },
]

const jsonLd = {
  '@context': 'https://schema.org',
  '@graph': [
    {
      '@type': 'WebApplication',
      name: 'Kilometervergoeding-calculator',
      applicationCategory: 'FinanceApplication',
      operatingSystem: 'Web',
      offers: { '@type': 'Offer', price: '0', priceCurrency: 'EUR' },
      description: 'Gratis calculator voor reiskosten-/kilometervergoeding (2026: € 0,25 per km).',
    },
    {
      '@type': 'FAQPage',
      mainEntity: faq.map((f) => ({
        '@type': 'Question',
        name: f.q,
        acceptedAnswer: { '@type': 'Answer', text: f.a },
      })),
    },
  ],
}

const wrap: React.CSSProperties = { maxWidth: 680, margin: '0 auto', padding: '0 16px' }
const h2: React.CSSProperties = { fontSize: 20, fontWeight: 700, color: '#1c1c1e', margin: '0 0 12px' }
const p: React.CSSProperties = { fontSize: 15, lineHeight: 1.65, color: '#3c3c43', margin: '0 0 14px' }

export default function KilometervergoedingPage() {
  return (
    <div style={{ minHeight: '100vh', backgroundColor: '#f2f2f7', fontFamily: 'var(--font-sans), system-ui, sans-serif' }}>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />

      <div style={{ ...wrap, paddingTop: 40, textAlign: 'center' }}>
        <h1 style={{ fontSize: 32, fontWeight: 800, color: '#1c1c1e', margin: '0 0 8px', letterSpacing: -0.5 }}>
          Kilometervergoeding berekenen
        </h1>
        <p style={{ fontSize: 16, color: '#6b6b6e', margin: '0 0 28px' }}>
          Reiskosten uitrekenen in seconden. Tarief 2026: <strong>€ 0,25 per km</strong>. Gratis, geen account
          nodig.
        </p>
      </div>

      <div style={{ ...wrap, paddingBottom: 40 }}>
        <KmCalculator />
      </div>

      <div style={{ ...wrap, paddingBottom: 64 }}>
        <section style={{ marginTop: 24 }}>
          <h2 style={h2}>Kilometervergoeding 2026</h2>
          <p style={p}>
            De onbelaste kilometervergoeding is per 1 januari 2026 verhoogd naar <strong>€ 0,25 per
            kilometer</strong> (was € 0,23). Werkgevers mogen dit belastingvrij vergoeden; als ZZP’er trek je
            € 0,25 per zakelijke kilometer af van je winst.
          </p>
          <p style={p}>
            Reken je vergoeding uit door de kilometers met het tarief te vermenigvuldigen. Voor een retourrit
            tel je de afstand twee keer; rijd je de rit vaker, gebruik dan het aantal ritten.
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
          <div style={{ fontSize: 18, fontWeight: 700, color: '#1c1c1e', marginBottom: 6 }}>
            Reiskosten netjes op je factuur?
          </div>
          <div style={{ fontSize: 15, color: '#6b6b6e', marginBottom: 16 }}>
            Met BoekBrug zet je reiskosten als aparte regel op een professionele factuur — inclusief de juiste
            BTW.
          </div>
          <div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
            <Link
              href="/factuur-maken"
              style={{ backgroundColor: '#007aff', color: '#fff', fontSize: 15, fontWeight: 600, padding: '12px 22px', borderRadius: 9999, textDecoration: 'none' }}
            >
              Gratis factuur maken
            </Link>
            <Link
              href="/btw-berekenen"
              style={{ backgroundColor: '#fff', color: '#007aff', fontSize: 15, fontWeight: 600, padding: '12px 22px', borderRadius: 9999, border: '1.5px solid #007aff', textDecoration: 'none' }}
            >
              BTW berekenen
            </Link>
          </div>
        </section>

        <p style={{ textAlign: 'center', fontSize: 12, color: '#aeaeb2', marginTop: 40 }}>
          BoekBrug — de brug tussen jou en je boekhouder. Tarief onder voorbehoud; controleer bij twijfel de
          Belastingdienst.
        </p>
      </div>
    </div>
  )
}
