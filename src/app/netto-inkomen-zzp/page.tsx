// src/app/netto-inkomen-zzp/page.tsx
// [NETTO-TOOL] Public ZZP net-income estimator (lead-gen). Server: SEO + JSON-LD.

import type { Metadata } from 'next'
import Link from 'next/link'
import NettoCalculator from './NettoCalculator'
import ToolsCrossLinks from '@/app/tools/ToolsCrossLinks'
import KennisbankLinks from '@/components/KennisbankLinks'
import PublicFooter from '@/components/public-footer'
import PublicHeader from '@/components/public-header'
import { absoluteUrl } from '@/lib/site'

export const metadata: Metadata = {
  title: 'Netto inkomen ZZP 2026 — wat houd je over? | BoekBrug',
  description:
    'Reken uit wat je als ZZP’er netto overhoudt in 2026: inkomstenbelasting, zelfstandigenaftrek, MKB-winstvrijstelling, heffingskortingen en Zvw. Het is een schatting. Gratis.',
  keywords: ['netto inkomen zzp', 'zzp belasting berekenen', 'hoeveel houd ik over zzp', 'bruto netto zzp 2026'],
  alternates: {
    canonical: '/netto-inkomen-zzp',
    languages: { 'nl-NL': '/netto-inkomen-zzp', 'en': '/en/netto-inkomen-zzp' },
  },
  openGraph: {
    title: 'Netto inkomen ZZP berekenen (2026)',
    description: 'Hoeveel houd je over? Een schatting met belasting, aftrek, heffingskortingen en Zvw.',
    type: 'website',
  },
  twitter: {
    // [DEEL-KAART] Dezelfde woorden als openGraph hierboven, want X leest twitter: en negeert
    // og: zodra Next die tags schrijft — en dat doet het altijd, uit de ROOT-metadata. Zonder
    // dit blok heet deze pagina op X "BoekBrug — Financieel Command Center".
    // De afbeelding komt uit opengraph-image.tsx in deze map; die hoeft hier niet genoemd.
    title: 'Netto inkomen ZZP berekenen (2026)',
    description: 'Hoeveel houd je over? Een schatting met belasting, aftrek, heffingskortingen en Zvw.',
  },
}

const faq = [
  {
    q: 'Hoeveel houd ik netto over als ZZP’er?',
    a: 'Dat hangt af van je winst en je aftrekposten. Van je winst gaan eerst de zelfstandigenaftrek en de MKB-winstvrijstelling (12,7%) af. Over de rest betaal je inkomstenbelasting (min heffingskortingen) en de Zvw-bijdrage. Wat overblijft, is je netto.',
  },
  {
    q: 'Wat is de zelfstandigenaftrek in 2026?',
    a: 'De zelfstandigenaftrek is in 2026 € 1.200 als je aan het urencriterium (≥ 1.225 uur) voldoet. Starters krijgen daarbovenop € 2.123 startersaftrek.',
  },
  {
    q: 'Is deze berekening exact?',
    a: 'Nee, het is een schatting op basis van de tarieven van 2026. Jouw situatie (partner, ander inkomen, toeslagen, exacte arbeidskorting) kan anders zijn. Dit is geen fiscaal advies.',
  },
]

const jsonLd = {
  '@context': 'https://schema.org',
  '@graph': [
    { '@type': 'WebApplication', name: 'Netto-inkomen ZZP calculator', applicationCategory: 'FinanceApplication', operatingSystem: 'Web', offers: { '@type': 'Offer', price: '0', priceCurrency: 'EUR' }, description: 'Indicatieve netto-inkomen calculator voor ZZP’ers (2026).' },
    { '@type': 'FAQPage', mainEntity: faq.map((f) => ({ '@type': 'Question', name: f.q, acceptedAnswer: { '@type': 'Answer', text: f.a } })) },
    {
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Home', item: absoluteUrl('/') },
        { '@type': 'ListItem', position: 2, name: 'Gratis tools', item: absoluteUrl('/tools') },
        { '@type': 'ListItem', position: 3, name: 'Netto inkomen ZZP', item: absoluteUrl('/netto-inkomen-zzp') },
      ],
    },
  ],
}

const wrap: React.CSSProperties = { maxWidth: 680, margin: '0 auto', padding: '0 16px' }
const h2: React.CSSProperties = { fontSize: 20, fontWeight: 700, color: '#202124', margin: '0 0 12px' }
const p: React.CSSProperties = { fontSize: 15, lineHeight: 1.65, color: '#3c4043', margin: '0 0 14px' }

export default function NettoInkomenPage() {
  return (
    <div style={{ minHeight: '100vh', backgroundColor: '#f8f9fa', fontFamily: 'var(--font-sans), system-ui, sans-serif' }}>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <PublicHeader />

      <div style={{ ...wrap, paddingTop: 40, textAlign: 'center' }}>
        <h1 style={{ fontSize: 32, fontWeight: 800, color: '#202124', margin: '0 0 8px', letterSpacing: -0.5 }}>
          Netto inkomen ZZP berekenen
        </h1>
        <p style={{ fontSize: 16, color: '#5f6368', margin: '0 0 28px' }}>
          Hoeveel houd je in 2026 netto over van je winst? Reken het uit. Het is een schatting.
        </p>
      </div>

      <div style={{ ...wrap, paddingBottom: 40 }}>
        <NettoCalculator />
      </div>

      <div style={{ ...wrap, paddingBottom: 64 }}>
        <section style={{ marginTop: 24 }}>
          <h2 style={h2}>Van winst naar netto</h2>
          <p style={p}>
            Van je <strong>winst</strong> gaat eerst de zelfstandigenaftrek af (als je aan het urencriterium
            voldoet). Daarna gaat de <strong>MKB-winstvrijstelling</strong> van 12,7% eraf. Over de rest
            betaal je inkomstenbelasting in box 1. Daar gaan de algemene heffingskorting en de arbeidskorting
            weer vanaf. Tot slot komt de <strong>Zvw</strong>-bijdrage erbij (4,85% in 2026). Wat overblijft,
            houd je netto over.
          </p>
          <p style={p}>
            Deze tool gebruikt de tarieven van 2026 en laat elke stap zien. Het is een schatting. Jouw
            situatie kan anders zijn, en het is geen fiscaal advies.
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
          <div style={{ fontSize: 18, fontWeight: 700, color: '#202124', marginBottom: 6 }}>Weet het hele jaar waar je staat</div>
          <div style={{ fontSize: 15, color: '#5f6368', marginBottom: 16 }}>
            BoekBrug houdt je omzet en BTW per kwartaal bij. Zo is je BTW-aangifte zo klaar.
          </div>
          <div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
            <Link href="/register" style={{ backgroundColor: '#1a73e8', color: '#fff', fontSize: 15, fontWeight: 600, padding: '12px 22px', borderRadius: 9999, textDecoration: 'none' }}>Gratis account maken</Link>
            <Link href="/uurtarief-berekenen" style={{ backgroundColor: '#fff', color: '#1a73e8', fontSize: 15, fontWeight: 600, padding: '12px 22px', borderRadius: 9999, border: '1.5px solid #1a73e8', textDecoration: 'none' }}>Uurtarief berekenen</Link>
          </div>
        </section>

        <p style={{ textAlign: 'center', fontSize: 12, color: '#bdc1c6', marginTop: 40 }}>
          BoekBrug — de brug tussen jou en je boekhouder. Een schatting op basis van de tarieven van 2026.
          Geen fiscaal advies. Twijfel je? Kijk bij de Belastingdienst.
        </p>
      </div>

      <ToolsCrossLinks currentSlug="/netto-inkomen-zzp" />
      <KennisbankLinks tool="/netto-inkomen-zzp" />
      <PublicFooter />
    </div>
  )
}
