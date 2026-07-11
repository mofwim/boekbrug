// src/app/netto-inkomen-zzp/page.tsx
// [NETTO-TOOL] Public ZZP net-income estimator (lead-gen). Server: SEO + JSON-LD.

import type { Metadata } from 'next'
import Link from 'next/link'
import NettoCalculator from './NettoCalculator'

export const metadata: Metadata = {
  title: 'Netto inkomen ZZP berekenen 2026 — hoeveel houd ik over? | BoekBrug',
  description:
    'Bereken indicatief wat je als ZZP’er netto overhoudt in 2026: inkomstenbelasting, zelfstandigenaftrek, MKB-winstvrijstelling, heffingskortingen en Zvw. Gratis.',
  keywords: ['netto inkomen zzp', 'zzp belasting berekenen', 'hoeveel houd ik over zzp', 'bruto netto zzp 2026'],
  alternates: { canonical: '/netto-inkomen-zzp' },
  openGraph: {
    title: 'Netto inkomen ZZP berekenen (2026)',
    description: 'Hoeveel houd je over? Indicatie met belasting, aftrek, heffingskortingen en Zvw.',
    type: 'website',
  },
}

const faq = [
  {
    q: 'Hoeveel houd ik netto over als ZZP’er?',
    a: 'Dat hangt af van je winst en aftrekposten. Van je winst gaan de zelfstandigenaftrek en de MKB-winstvrijstelling (12,7%) af; over de belastbare winst betaal je inkomstenbelasting (min heffingskortingen) en de inkomensafhankelijke bijdrage Zvw. Wat overblijft is je netto.',
  },
  {
    q: 'Wat is de zelfstandigenaftrek in 2026?',
    a: 'De zelfstandigenaftrek is in 2026 € 1.200 als je aan het urencriterium (≥ 1.225 uur) voldoet. Starters krijgen daarbovenop € 2.123 startersaftrek.',
  },
  {
    q: 'Is deze berekening exact?',
    a: 'Nee, het is een indicatie op basis van de 2026-tarieven. Je persoonlijke situatie (partner, andere inkomsten, toeslagen, exacte arbeidskorting) kan afwijken. Geen fiscaal advies.',
  },
]

const jsonLd = {
  '@context': 'https://schema.org',
  '@graph': [
    { '@type': 'WebApplication', name: 'Netto-inkomen ZZP calculator', applicationCategory: 'FinanceApplication', operatingSystem: 'Web', offers: { '@type': 'Offer', price: '0', priceCurrency: 'EUR' }, description: 'Indicatieve netto-inkomen calculator voor ZZP’ers (2026).' },
    { '@type': 'FAQPage', mainEntity: faq.map((f) => ({ '@type': 'Question', name: f.q, acceptedAnswer: { '@type': 'Answer', text: f.a } })) },
  ],
}

const wrap: React.CSSProperties = { maxWidth: 680, margin: '0 auto', padding: '0 16px' }
const h2: React.CSSProperties = { fontSize: 20, fontWeight: 700, color: '#1c1c1e', margin: '0 0 12px' }
const p: React.CSSProperties = { fontSize: 15, lineHeight: 1.65, color: '#3c3c43', margin: '0 0 14px' }

export default function NettoInkomenPage() {
  return (
    <div style={{ minHeight: '100vh', backgroundColor: '#f2f2f7', fontFamily: 'var(--font-sans), system-ui, sans-serif' }}>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />

      <div style={{ ...wrap, paddingTop: 40, textAlign: 'center' }}>
        <h1 style={{ fontSize: 32, fontWeight: 800, color: '#1c1c1e', margin: '0 0 8px', letterSpacing: -0.5 }}>
          Netto inkomen ZZP berekenen
        </h1>
        <p style={{ fontSize: 16, color: '#6b6b6e', margin: '0 0 28px' }}>
          Hoeveel houd je in 2026 netto over van je winst? Reken het indicatief uit.
        </p>
      </div>

      <div style={{ ...wrap, paddingBottom: 40 }}>
        <NettoCalculator />
      </div>

      <div style={{ ...wrap, paddingBottom: 64 }}>
        <section style={{ marginTop: 24 }}>
          <h2 style={h2}>Van winst naar netto</h2>
          <p style={p}>
            Als ZZP’er reken je van je <strong>winst</strong> eerst de zelfstandigenaftrek af (bij het
            urencriterium), daarna de <strong>MKB-winstvrijstelling</strong> van 12,7%. Over de belastbare
            winst betaal je inkomstenbelasting in box 1, verminderd met de algemene heffingskorting en
            arbeidskorting. Tot slot komt de inkomensafhankelijke bijdrage <strong>Zvw</strong> (4,85% in
            2026) erbij. Wat overblijft, houd je netto over.
          </p>
          <p style={p}>
            Deze tool gebruikt de 2026-tarieven en toont elke stap. Het is een indicatie — je persoonlijke
            situatie kan afwijken, en het is geen fiscaal advies.
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
          <div style={{ fontSize: 18, fontWeight: 700, color: '#1c1c1e', marginBottom: 6 }}>Weet het hele jaar waar je staat</div>
          <div style={{ fontSize: 15, color: '#6b6b6e', marginBottom: 16 }}>
            BoekBrug houdt je omzet, kosten en winst live bij — zodat je nooit voor verrassingen staat bij de
            aangifte.
          </div>
          <div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
            <Link href="/register" style={{ backgroundColor: '#007aff', color: '#fff', fontSize: 15, fontWeight: 600, padding: '12px 22px', borderRadius: 9999, textDecoration: 'none' }}>Gratis account</Link>
            <Link href="/uurtarief-berekenen" style={{ backgroundColor: '#fff', color: '#007aff', fontSize: 15, fontWeight: 600, padding: '12px 22px', borderRadius: 9999, border: '1.5px solid #007aff', textDecoration: 'none' }}>Uurtarief berekenen</Link>
          </div>
        </section>

        <p style={{ textAlign: 'center', fontSize: 12, color: '#aeaeb2', marginTop: 40 }}>
          BoekBrug — de brug tussen jou en je boekhouder. Indicatieve schatting op basis van 2026-tarieven;
          geen fiscaal advies. Controleer bij twijfel de Belastingdienst.
        </p>
      </div>
    </div>
  )
}
