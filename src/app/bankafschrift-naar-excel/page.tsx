// src/app/bankafschrift-naar-excel/page.tsx
// [BANK-CSV] Server shell for the login-free "bankafschrift naar Excel" converter.
// Owns the SEO surface (metadata + JSON-LD) a 'use client' page can't export, then
// renders the shared header and the interactive <BankConverter/> client. The
// conversion itself runs entirely in the browser (see BankConverter). This path is
// in middleware PUBLIC_PATHS so it is reachable logged-out.

import type { Metadata } from 'next'
import BankConverter from './BankConverter'
import PublicHeader from '@/components/public-header'
import PublicFooter from '@/components/public-footer'
import Link from 'next/link'
import { absoluteUrl } from '@/lib/site'
import { otherTools } from '@/lib/tools'

export const metadata: Metadata = {
  title: 'Bankafschrift naar Excel — gratis omzetten (CSV, MT940, CAMT) | BoekBrug',
  description:
    'Zet je bankafschrift gratis om naar Excel. Upload een CSV, MT940 of CAMT.053 van ING, Rabobank, bunq en veel andere Nederlandse banken en download een nette Excel of CSV. Geen account nodig — je bestand blijft in je browser.',
  keywords: [
    'bankafschrift naar excel', 'bankafschrift omzetten', 'mt940 naar excel', 'camt naar excel',
    'csv bankafschrift', 'ing afschrift excel', 'rabobank afschrift excel', 'bankafschrift converteren',
  ],
  alternates: { canonical: '/bankafschrift-naar-excel' },
  openGraph: {
    title: 'Bankafschrift naar Excel — gratis omzetten',
    description: 'Zet je bankafschrift (CSV, MT940, CAMT.053) gratis om naar een nette Excel. Geen account nodig.',
    type: 'website',
  },
}

const faq = [
  {
    q: 'Welke bankbestanden kan ik omzetten naar Excel?',
    a: 'CSV, MT940 (.sta) en CAMT.053 (.xml). Die kun je bij elke Nederlandse bank downloaden. De CSV-omzetter is getest met ING, Rabobank en bunq; MT940 en CAMT.053 werken bij vrijwel elke bank. Het bedrag, de datum, de tegenpartij en de omschrijving komen netjes in kolommen.',
  },
  {
    q: 'Blijft mijn bankafschrift privé?',
    a: 'Ja. Het omzetten gebeurt volledig in je eigen browser. Je bankafschrift wordt niet geüpload en verlaat je apparaat niet.',
  },
  {
    q: 'Is het echt gratis?',
    a: 'Ja, gratis en zonder account. Wil je je afschriften bewaren en automatisch aan je facturen koppelen? Maak dan een gratis BoekBrug-account.',
  },
  {
    q: 'Mijn bank staat er niet bij — werkt het dan toch?',
    a: 'Waarschijnlijk wel. De omzetter herkent de kolommen op naam (datum, bedrag, tegenpartij, omschrijving), dus ook afschriften van andere banken worden meestal goed gelezen. Lukt het niet met de CSV, download dan het MT940- (.sta) of CAMT.053-bestand (.xml) van je bank — die worden vrijwel altijd gelezen.',
  },
]

const jsonLd = {
  '@context': 'https://schema.org',
  '@graph': [
    {
      '@type': 'WebApplication',
      name: 'Bankafschrift naar Excel',
      applicationCategory: 'FinanceApplication',
      operatingSystem: 'Web',
      offers: { '@type': 'Offer', price: '0', priceCurrency: 'EUR' },
      description: 'Zet een bankafschrift (CSV, MT940 of CAMT.053) gratis om naar een nette Excel. Het omzetten gebeurt volledig in de browser.',
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
        { '@type': 'ListItem', position: 3, name: 'Bankafschrift naar Excel', item: absoluteUrl('/bankafschrift-naar-excel') },
      ],
    },
  ],
}

const wrap: React.CSSProperties = { maxWidth: 820, margin: '0 auto', padding: '0 16px' }

export default function BankafschriftNaarExcelPage() {
  const related = otherTools('/bankafschrift-naar-excel', 3)
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <PublicHeader />
      <BankConverter />

      {/* FAQ — indexable, matches the JSON-LD above */}
      <section style={{ ...wrap, paddingBottom: 8 }}>
        <h2 style={{ fontSize: 22, fontWeight: 800, color: '#202124', margin: '8px 0 16px' }}>Veelgestelde vragen</h2>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {faq.map((f) => (
            <div key={f.q} style={{ background: '#fff', border: '1px solid #ececf1', borderRadius: 14, padding: '16px 18px' }}>
              <div style={{ fontSize: 15.5, fontWeight: 700, color: '#202124', marginBottom: 6 }}>{f.q}</div>
              <div style={{ fontSize: 14.5, color: '#5b5b60', lineHeight: 1.6 }}>{f.a}</div>
            </div>
          ))}
        </div>
      </section>

      {/* Cross-links to the other free tools */}
      <section style={{ ...wrap, padding: '28px 16px 48px' }}>
        <div style={{ fontSize: 13, fontWeight: 700, letterSpacing: 0.4, color: '#9aa0a6', marginBottom: 12 }}>MEER GRATIS TOOLS</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
          {related.map((t) => (
            <Link key={t.slug} href={t.slug} style={{ display: 'block', background: '#fff', border: '1px solid #ececf1', borderRadius: 14, padding: 16, textDecoration: 'none' }}>
              <div style={{ fontSize: 24, marginBottom: 6 }} aria-hidden>{t.emoji}</div>
              <div style={{ fontSize: 15.5, fontWeight: 700, color: '#202124', marginBottom: 4 }}>{t.title}</div>
              <div style={{ fontSize: 13.5, color: '#5f6368', lineHeight: 1.5 }}>{t.tagline}</div>
            </Link>
          ))}
        </div>
      </section>

      <PublicFooter />
    </>
  )
}
