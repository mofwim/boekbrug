// src/app/factuur-scannen/page.tsx
// [SCAN-TOOL] Public AI invoice scanner (lead-gen). Server: SEO + JSON-LD.

import type { Metadata } from 'next'
import Link from 'next/link'
import FactuurScanner from './FactuurScanner'
import ToolsCrossLinks from '@/app/tools/ToolsCrossLinks'
import PublicFooter from '@/components/public-footer'

export const metadata: Metadata = {
  title: 'Factuur scannen met AI — gegevens automatisch uitlezen | BoekBrug',
  description:
    'Upload een PDF of foto van een factuur en lees automatisch leverancier, bedrag, BTW en factuurnummer uit met AI. Gratis, geen account nodig.',
  keywords: ['factuur scannen', 'factuur uitlezen', 'ocr factuur', 'factuur naar tekst', 'ai factuur scanner'],
  alternates: { canonical: '/factuur-scannen' },
  openGraph: {
    title: 'Factuur scannen met AI',
    description: 'Upload een factuur, wij lezen de gegevens automatisch uit. Gratis.',
    type: 'website',
  },
}

const faq = [
  {
    q: 'Hoe werkt het scannen van een factuur?',
    a: 'Je uploadt een PDF of foto van je factuur. Onze AI leest de belangrijkste velden uit — leverancier, factuurnummer, datum, bedragen en BTW — en toont ze overzichtelijk. Je hoeft niets over te typen.',
  },
  {
    q: 'Welke bestanden kan ik uploaden?',
    a: 'PDF, JPG, PNG en WebP tot 8 MB. Een scherpe foto of een originele PDF geeft de beste resultaten.',
  },
  {
    q: 'Worden mijn facturen opgeslagen?',
    a: 'Nee. In deze gratis tool wordt je bestand alleen gebruikt om de gegevens uit te lezen en daarna niet bewaard. Wil je facturen wél beheren en bewaren? Maak dan een gratis BoekBrug-account.',
  },
  {
    q: 'Is de herkenning altijd 100% correct?',
    a: 'Bij een duidelijke factuur is de herkenning erg goed, maar controleer altijd de bedragen en het BTW-tarief voordat je ze gebruikt. Het is een hulpmiddel, geen vervanging voor je eigen controle.',
  },
]

const jsonLd = {
  '@context': 'https://schema.org',
  '@graph': [
    {
      '@type': 'WebApplication',
      name: 'AI factuur scanner',
      applicationCategory: 'FinanceApplication',
      operatingSystem: 'Web',
      offers: { '@type': 'Offer', price: '0', priceCurrency: 'EUR' },
      description: 'Lees automatisch de gegevens van een factuur uit met AI (PDF of foto).',
    },
    { '@type': 'FAQPage', mainEntity: faq.map((f) => ({ '@type': 'Question', name: f.q, acceptedAnswer: { '@type': 'Answer', text: f.a } })) },
  ],
}

const wrap: React.CSSProperties = { maxWidth: 680, margin: '0 auto', padding: '0 16px' }
const h2: React.CSSProperties = { fontSize: 20, fontWeight: 700, color: '#1c1c1e', margin: '0 0 12px' }
const p: React.CSSProperties = { fontSize: 15, lineHeight: 1.65, color: '#3c3c43', margin: '0 0 14px' }

export default function FactuurScannenPage() {
  return (
    <div style={{ minHeight: '100vh', backgroundColor: '#f2f2f7', fontFamily: 'var(--font-sans), system-ui, sans-serif' }}>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />

      <div style={{ ...wrap, paddingTop: 40, textAlign: 'center' }}>
        <h1 style={{ fontSize: 32, fontWeight: 800, color: '#1c1c1e', margin: '0 0 8px', letterSpacing: -0.5 }}>
          Factuur scannen met AI
        </h1>
        <p style={{ fontSize: 16, color: '#6b6b6e', margin: '0 0 28px' }}>
          Upload een PDF of foto van je factuur. Wij lezen de gegevens automatisch uit.
        </p>
      </div>

      <div style={{ ...wrap, paddingBottom: 40 }}>
        <FactuurScanner />
      </div>

      <div style={{ ...wrap, paddingBottom: 64 }}>
        <section style={{ marginTop: 24 }}>
          <h2 style={h2}>Nooit meer overtypen</h2>
          <p style={p}>
            Facturen overtypen is saai en foutgevoelig. Upload je factuur als PDF of maak er een foto van, en
            onze AI haalt er automatisch de <strong>leverancier</strong>, het <strong>factuurnummer</strong>,
            de <strong>datum</strong>, de <strong>bedragen</strong> en de <strong>BTW</strong> uit. Controleer,
            en je bent klaar.
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
          <div style={{ fontSize: 18, fontWeight: 700, color: '#1c1c1e', marginBottom: 6 }}>Al je facturen op één plek</div>
          <div style={{ fontSize: 15, color: '#6b6b6e', marginBottom: 16 }}>
            BoekBrug scant, bewaart en boekt je facturen automatisch — klaar voor je BTW-aangifte en je
            boekhouder.
          </div>
          <div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
            <Link href="/register" style={{ backgroundColor: '#007aff', color: '#fff', fontSize: 15, fontWeight: 600, padding: '12px 22px', borderRadius: 9999, textDecoration: 'none' }}>Gratis account</Link>
            <Link href="/factuur-maken" style={{ backgroundColor: '#fff', color: '#007aff', fontSize: 15, fontWeight: 600, padding: '12px 22px', borderRadius: 9999, border: '1.5px solid #007aff', textDecoration: 'none' }}>Factuur maken</Link>
          </div>
        </section>

        <p style={{ textAlign: 'center', fontSize: 12, color: '#aeaeb2', marginTop: 40 }}>
          BoekBrug — de brug tussen jou en je boekhouder. AI-herkenning is een hulpmiddel; controleer altijd de
          uitgelezen bedragen en het BTW-tarief.
        </p>
      </div>

      <ToolsCrossLinks currentSlug="/factuur-scannen" />
      <PublicFooter />
    </div>
  )
}
