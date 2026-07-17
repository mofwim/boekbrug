// src/app/factuur-scannen/page.tsx
// [SCAN-TOOL] Public AI invoice scanner (lead-gen). Server: SEO + JSON-LD.

import type { Metadata } from 'next'
import Link from 'next/link'
import FactuurScanner from './FactuurScanner'
import ToolsCrossLinks from '@/app/tools/ToolsCrossLinks'
import KennisbankLinks from '@/components/KennisbankLinks'
import PublicFooter from '@/components/public-footer'
import PublicHeader from '@/components/public-header'
import { absoluteUrl } from '@/lib/site'

export const metadata: Metadata = {
  title: 'Factuur scannen met AI — gegevens uitlezen | BoekBrug',
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
    a: 'Je uploadt een PDF of foto van je factuur. De AI leest de belangrijkste velden uit: leverancier, factuurnummer, datum, bedragen en BTW. Je hoeft niets over te typen.',
  },
  {
    q: 'Welke bestanden kan ik uploaden?',
    a: 'PDF, JPG, PNG en WebP tot 8 MB. Een scherpe foto of een originele PDF geeft de beste resultaten.',
  },
  {
    q: 'Worden mijn facturen opgeslagen?',
    a: 'Nee. In deze gratis tool gebruiken we je bestand alleen om de gegevens uit te lezen. Daarna bewaren we het niet. Wil je facturen wél bewaren en beheren? Maak dan een gratis BoekBrug-account.',
  },
  {
    q: 'Is de herkenning altijd 100% correct?',
    a: 'Bij een duidelijke factuur is de herkenning erg goed. Controleer toch altijd zelf de bedragen en de BTW. Het is een hulpmiddel, geen vervanging voor je eigen controle.',
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
    {
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Home', item: absoluteUrl('/') },
        { '@type': 'ListItem', position: 2, name: 'Gratis tools', item: absoluteUrl('/tools') },
        { '@type': 'ListItem', position: 3, name: 'Factuur scannen met AI', item: absoluteUrl('/factuur-scannen') },
      ],
    },
  ],
}

const wrap: React.CSSProperties = { maxWidth: 680, margin: '0 auto', padding: '0 16px' }
const h2: React.CSSProperties = { fontSize: 20, fontWeight: 700, color: '#202124', margin: '0 0 12px' }
const p: React.CSSProperties = { fontSize: 15, lineHeight: 1.65, color: '#3c4043', margin: '0 0 14px' }

export default function FactuurScannenPage() {
  return (
    <div style={{ minHeight: '100vh', backgroundColor: '#f8f9fa', fontFamily: 'var(--font-sans), system-ui, sans-serif' }}>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <PublicHeader />

      <div style={{ ...wrap, paddingTop: 40, textAlign: 'center' }}>
        <h1 style={{ fontSize: 32, fontWeight: 800, color: '#202124', margin: '0 0 8px', letterSpacing: -0.5 }}>
          Factuur scannen met AI
        </h1>
        <p style={{ fontSize: 16, color: '#5f6368', margin: '0 0 28px' }}>
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
            Facturen overtypen is saai en je maakt snel fouten. Upload je factuur als PDF of maak er een foto
            van. De AI haalt de <strong>leverancier</strong>, het <strong>factuurnummer</strong>, de{' '}
            <strong>datum</strong>, de <strong>bedragen</strong> en de <strong>BTW</strong> eruit. Even
            controleren en je bent klaar.
          </p>
        </section>

        <section style={{ marginTop: 28 }}>
          <h2 style={h2}>Veelgestelde vragen</h2>
          {faq.map((f) => (
            <div key={f.q} style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 15, fontWeight: 700, color: '#202124', marginBottom: 4 }}>{f.q}</div>
              <div style={{ fontSize: 15, lineHeight: 1.6, color: '#3c4043' }}>{f.a}</div>
            </div>
          ))}
        </section>

        <section style={{ marginTop: 32, background: '#ffffff', border: '1px solid #e0e0e0', borderRadius: 16, padding: 24, textAlign: 'center' }}>
          <div style={{ fontSize: 18, fontWeight: 700, color: '#202124', marginBottom: 6 }}>Al je facturen op één plek</div>
          <div style={{ fontSize: 15, color: '#5f6368', marginBottom: 16 }}>
            BoekBrug scant je facturen, bewaart ze en zet ze op een rij — klaar voor je BTW-aangifte en je
            boekhouder.
          </div>
          <div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
            <Link href="/register" style={{ backgroundColor: '#1a73e8', color: '#fff', fontSize: 15, fontWeight: 600, padding: '12px 22px', borderRadius: 9999, textDecoration: 'none' }}>Gratis account maken</Link>
            <Link href="/factuur-maken" style={{ backgroundColor: '#fff', color: '#1a73e8', fontSize: 15, fontWeight: 600, padding: '12px 22px', borderRadius: 9999, border: '1.5px solid #1a73e8', textDecoration: 'none' }}>Factuur maken</Link>
          </div>
        </section>

        <p style={{ textAlign: 'center', fontSize: 12, color: '#bdc1c6', marginTop: 40 }}>
          BoekBrug — de brug tussen jou en je boekhouder. AI-herkenning is een hulpmiddel; controleer altijd de
          uitgelezen bedragen en het BTW-tarief.
        </p>
      </div>

      <ToolsCrossLinks currentSlug="/factuur-scannen" />
      <KennisbankLinks tool="/factuur-scannen" />
      <PublicFooter />
    </div>
  )
}
