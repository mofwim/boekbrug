// src/app/btw-berekenen/page.tsx
// [BTW-TOOL] Public, login-free BTW calculator — a lead-gen tool for the Dutch
// market. Server component: owns the SEO metadata + structured data and renders
// the interactive <BtwCalculator/> (client). Added to middleware PUBLIC_PATHS.
// Dutch slug on purpose — people search "btw berekenen", not "vat calculator".

import type { Metadata } from 'next'
import Link from 'next/link'
import BtwCalculator from './BtwCalculator'
import ToolsCrossLinks from '@/app/tools/ToolsCrossLinks'
import KennisbankLinks from '@/components/KennisbankLinks'
import PublicFooter from '@/components/public-footer'
import PublicHeader from '@/components/public-header'
import { absoluteUrl } from '@/lib/site'

export const metadata: Metadata = {
  title: 'BTW berekenen (21%, 9% of 0%) — gratis BTW-calculator | BoekBrug',
  description:
    'Bereken snel je BTW: van bedrag exclusief naar inclusief BTW of andersom, met 21%, 9% of 0%. Gratis, direct in je browser, geen account nodig.',
  keywords: ['btw berekenen', 'btw calculator', 'btw 21 procent', 'btw 9 procent', 'inclusief exclusief btw'],
  alternates: {
    canonical: '/btw-berekenen',
    languages: { 'nl-NL': '/btw-berekenen', 'en': '/en/btw-berekenen' },
  },
  openGraph: {
    title: 'BTW berekenen — gratis BTW-calculator',
    description: 'Van exclusief naar inclusief BTW of andersom. 21%, 9% of 0%. Gratis en direct.',
    type: 'website',
  },
  twitter: {
    // [DEEL-KAART] Dezelfde woorden als openGraph hierboven, want X leest twitter: en negeert
    // og: zodra Next die tags schrijft — en dat doet het altijd, uit de ROOT-metadata. Zonder
    // dit blok heet deze pagina op X "BoekBrug — Financieel Command Center".
    // De afbeelding komt uit opengraph-image.tsx in deze map; die hoeft hier niet genoemd.
    title: 'BTW berekenen — gratis BTW-calculator',
    description: 'Van exclusief naar inclusief BTW of andersom. 21%, 9% of 0%. Gratis en direct.',
  },
}

const faq = [
  {
    q: 'Hoe bereken ik de BTW over een bedrag?',
    a: 'BTW over een bedrag exclusief BTW = bedrag × tarief. Bij 21% reken je € 100 × 21% = € 21 BTW, dus € 121 inclusief BTW.',
  },
  {
    q: 'Hoe haal ik de BTW uit een bedrag inclusief BTW?',
    a: 'Deel het bedrag inclusief BTW door 1 plus het tarief. Bij 21%: € 121 ÷ 1,21 = € 100 exclusief, de BTW is € 21.',
  },
  {
    q: 'Welke BTW-tarieven zijn er in Nederland?',
    a: 'Het algemene tarief is 21%. Het lage tarief is 9% (bijvoorbeeld voeding, boeken, kappers). En 0% voor sommige goederen en diensten (bijvoorbeeld export binnen de EU).',
  },
  // [BTW-VRAGEN] Deze twee staan er niet omdat ze goed klinken maar omdat ze gesteld worden: het
  // zijn de formuleringen waarmee mensen deze pagina in Search Console bereiken. Een vraag die
  // niemand stelt hoort hier niet, ook niet als ze de tekst langer maakt.
  {
    q: 'Wat is de formule om BTW te berekenen?',
    a: 'BTW erbij: bedrag × 0,21 bij het hoge tarief, of × 0,09 bij het lage. Het totaal inclusief BTW is bedrag × 1,21 (of × 1,09). BTW eruit halen doe je andersom: bedrag inclusief ÷ 1,21 geeft het bedrag exclusief BTW.',
  },
  {
    q: 'Is omzetbelasting hetzelfde als BTW?',
    a: 'Ja. Omzetbelasting is de officiële naam die de Belastingdienst gebruikt; BTW is de naam die iedereen gebruikt. Een aangifte omzetbelasting gaat dus over dezelfde belasting die je met deze calculator uitrekent.',
  },
]

const jsonLd = {
  '@context': 'https://schema.org',
  '@graph': [
    {
      '@type': 'WebApplication',
      name: 'BTW-calculator',
      applicationCategory: 'FinanceApplication',
      operatingSystem: 'Web',
      offers: { '@type': 'Offer', price: '0', priceCurrency: 'EUR' },
      description: 'Gratis BTW-calculator: bereken BTW van exclusief naar inclusief of andersom (21%, 9%, 0%).',
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
        { '@type': 'ListItem', position: 3, name: 'BTW berekenen', item: absoluteUrl('/btw-berekenen') },
      ],
    },
  ],
}

const wrap: React.CSSProperties = { maxWidth: 680, margin: '0 auto', padding: '0 16px' }
const h2: React.CSSProperties = { fontSize: 20, fontWeight: 700, color: '#202124', margin: '0 0 12px' }
const p: React.CSSProperties = { fontSize: 15, lineHeight: 1.65, color: '#3c4043', margin: '0 0 14px' }

export default function BtwBerekenenPage() {
  return (
    <div style={{ minHeight: '100vh', backgroundColor: '#f8f9fa', fontFamily: 'var(--font-sans), system-ui, sans-serif' }}>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <PublicHeader />

      <div style={{ ...wrap, paddingTop: 40, paddingBottom: 8, textAlign: 'center' }}>
        <h1 style={{ fontSize: 34, fontWeight: 800, color: '#202124', margin: '0 0 8px', letterSpacing: -0.5 }}>
          BTW berekenen
        </h1>
        <p style={{ fontSize: 16, color: '#5f6368', margin: '0 0 28px' }}>
          Van exclusief naar inclusief BTW — of andersom. Gratis en direct, geen account nodig.
        </p>
      </div>

      <div style={{ ...wrap, paddingBottom: 40 }}>
        <BtwCalculator />
      </div>

      {/* SEO / helpful content */}
      <div style={{ ...wrap, paddingBottom: 64 }}>
        <section style={{ marginTop: 24 }}>
          <h2 style={h2}>Hoe werkt BTW berekenen?</h2>
          <p style={p}>
            Wil je de BTW <strong>optellen</strong> bij een bedrag exclusief BTW? Vermenigvuldig het bedrag
            met het tarief. Bijvoorbeeld: € 100 × 21% = € 21 BTW, samen € 121 inclusief BTW.
          </p>
          <p style={p}>
            Wil je de BTW juist <strong>uit</strong> een bedrag inclusief BTW halen? Deel door 1 plus het
            tarief: € 121 ÷ 1,21 = € 100 exclusief BTW, de BTW is dan € 21. De calculator hierboven doet dit
            live, in beide richtingen — heen en terug omrekenen kan dus met dezelfde twee velden.
          </p>

          {/* [BTW-FORMULE] De formule als formule, niet alleen als zin. Wie hem opzoekt wil hem
              overtikken in een spreadsheet of op papier narekenen, en dan is een regel proza het
              verkeerde formaat — die moet hij eerst terugvertalen naar wat er gedeeld en
              vermenigvuldigd wordt. */}
          <div
            style={{
              background: '#f8f9fa',
              border: '1px solid #e0e0e0',
              borderRadius: 12,
              padding: '16px 18px',
              margin: '0 0 14px',
              fontSize: 15,
              lineHeight: 1.9,
              color: '#202124',
            }}
          >
            <strong style={{ display: 'block', marginBottom: 8, fontSize: 14, color: '#5f6368' }}>
              De formule
            </strong>
            BTW erbij: <code>bedrag × tarief</code> — bij 21% dus <code>× 0,21</code>
            <br />
            Totaal inclusief: <code>bedrag × 1,21</code>
            <br />
            BTW eruit: <code>bedrag ÷ 1,21</code> geeft het bedrag exclusief BTW
            <br />
            Bij 9% reken je met <code>0,09</code> en <code>1,09</code>.
          </div>
        </section>

        <section style={{ marginTop: 28 }}>
          {/* [OMZETBELASTING] Dit woord stond nergens op de pagina, en het is niet zomaar een
              synoniem: het is de term die de Belastingdienst op de formulieren gebruikt terwijl de
              rest van de wereld "btw" zegt. Een ZZP'er die net zijn eerste aangifte openslaat
              vraagt zich oprecht af of hij naar iets anders zit te kijken. Die vraag hoort
              beantwoord te worden, en met één zin is dat gebeurd. */}
          <h2 style={h2}>BTW of omzetbelasting — is dat hetzelfde?</h2>
          <p style={p}>
            Ja. <strong>Omzetbelasting</strong> is de officiële naam die de Belastingdienst gebruikt;{' '}
            {/* De spatie staat expliciet: bij een regelafbreking direct na </strong> slikt JSX hem
                op, en dan staat er "BTW(belasting" op het scherm. */}
            <strong>BTW</strong>{' '}
            (belasting over de toegevoegde waarde) is hoe vrijwel iedereen het noemt.
            Staat er op je formulier &ldquo;aangifte omzetbelasting&rdquo;, dan gaat dat over precies de
            belasting die je hierboven uitrekent. Er is geen tweede heffing die je gemist hebt.
          </p>
        </section>

        <section style={{ marginTop: 28 }}>
          <h2 style={h2}>De Nederlandse BTW-tarieven</h2>
          <p style={p}>
            <strong>21% — algemeen tarief:</strong> geldt voor de meeste goederen en diensten.
            <br />
            <strong>9% — laag tarief:</strong> bijvoorbeeld voeding, medicijnen, boeken, kappers,
            fietsreparatie.
            <br />
            <strong>0% — nultarief:</strong> bijvoorbeeld leveringen naar het buitenland en leveringen naar
            andere EU-landen.
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

        {/* Funnel */}
        <section
          style={{
            marginTop: 32,
            background: '#ffffff',
            border: '1px solid #e0e0e0',
            borderRadius: 16,
            padding: 24,
            textAlign: 'center',
          }}
        >
          <div style={{ fontSize: 18, fontWeight: 700, color: '#202124', marginBottom: 6 }}>
            Facturen met de BTW er al bij?
          </div>
          <div style={{ fontSize: 15, color: '#5f6368', marginBottom: 16 }}>
            Met BoekBrug maak je snel een nette factuur. De BTW wordt automatisch berekend en per tarief
            gesplitst.
          </div>
          <div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
            <Link
              href="/factuur-maken"
              style={{
                backgroundColor: '#1a73e8',
                color: '#fff',
                fontSize: 15,
                fontWeight: 600,
                padding: '12px 22px',
                borderRadius: 9999,
                textDecoration: 'none',
              }}
            >
              Gratis factuur maken
            </Link>
            <Link
              href="/register"
              style={{
                backgroundColor: '#fff',
                color: '#1a73e8',
                fontSize: 15,
                fontWeight: 600,
                padding: '12px 22px',
                borderRadius: 9999,
                border: '1.5px solid #1a73e8',
                textDecoration: 'none',
              }}
            >
              Account aanmaken
            </Link>
          </div>
        </section>

        <p style={{ textAlign: 'center', fontSize: 12, color: '#bdc1c6', marginTop: 40 }}>
          BoekBrug — de brug tussen jou en je boekhouder. Tarieven kunnen veranderen. Twijfel je? Kijk bij de
          Belastingdienst.
        </p>
      </div>

      <ToolsCrossLinks currentSlug="/btw-berekenen" />
      <KennisbankLinks tool="/btw-berekenen" />
      <PublicFooter />
    </div>
  )
}
